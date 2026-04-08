import { readFileSync } from "fs";
import { extname } from "path";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type Role = "user" | "assistant";
type MessageTuple = [Role, string];

type ClaudeCodeEntry = {
  type?: JsonValue;
  message?: JsonValue;
};

type ClaudeAiEnvelope = {
  messages?: JsonValue;
  chat_messages?: JsonValue;
};

type ChatGptMessage = {
  author?: JsonValue;
  content?: JsonValue;
};

type ChatGptNode = {
  parent?: JsonValue;
  message?: JsonValue;
  children?: JsonValue;
};

type SpellcheckModule = {
  spellcheckUserText?: (text: string) => string;
};

export async function normalize(filepath: string): Promise<string> {
  let content: string;

  try {
    content = readFileSync(filepath, "utf-8");
  } catch (error) {
    throw new Error(`Could not read ${filepath}: ${String(error)}`);
  }

  if (!content.trim()) {
    return content;
  }

  const lines = content.split("\n");
  if (lines.filter((line) => line.trim().startsWith(">")).length >= 3) {
    return content;
  }

  const extension = extname(filepath).toLowerCase();
  if (extension === ".json" || extension === ".jsonl" || ["{", "["].includes(content.trim().slice(0, 1))) {
    const normalized = await _tryNormalizeJson(content);
    if (normalized) {
      return normalized;
    }
  }

  return content;
}

async function _tryNormalizeJson(content: string): Promise<string | null> {
  let normalized = await _tryClaudeCodeJsonl(content);
  if (normalized) {
    return normalized;
  }

  let data: JsonValue;
  try {
    data = JSON.parse(content) as JsonValue;
  } catch {
    return null;
  }

  for (const parser of [_tryClaudeAiJson, _tryChatgptJson, _trySlackJson]) {
    normalized = await parser(data);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

async function _tryClaudeCodeJsonl(content: string): Promise<string | null> {
  const lines = content
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line);

  const messages: MessageTuple[] = [];

  for (const line of lines) {
    let entry: JsonValue;
    try {
      entry = JSON.parse(line) as JsonValue;
    } catch {
      continue;
    }

    if (!isObject(entry)) {
      continue;
    }

    const claudeEntry = entry as ClaudeCodeEntry;
    const msgType = typeof claudeEntry.type === "string" ? claudeEntry.type : "";
    const message = isObject(claudeEntry.message) ? claudeEntry.message : {};

    if (msgType === "human") {
      const text = _extractContent(message.content ?? "");
      if (text) {
        messages.push(["user", text]);
      }
    } else if (msgType === "assistant") {
      const text = _extractContent(message.content ?? "");
      if (text) {
        messages.push(["assistant", text]);
      }
    }
  }

  if (messages.length >= 2) {
    return _messagesToTranscript(messages);
  }

  return null;
}

async function _tryClaudeAiJson(data: JsonValue): Promise<string | null> {
  let candidate: JsonValue = data;

  if (isObject(candidate)) {
    const envelope = candidate as ClaudeAiEnvelope;
    candidate = envelope.messages ?? envelope.chat_messages ?? [];
  }

  if (!Array.isArray(candidate)) {
    return null;
  }

  const messages: MessageTuple[] = [];

  for (const item of candidate) {
    if (!isObject(item)) {
      continue;
    }

    const role = typeof item.role === "string" ? item.role : "";
    const text = _extractContent(item.content ?? "");

    if ((role === "user" || role === "human") && text) {
      messages.push(["user", text]);
    } else if ((role === "assistant" || role === "ai") && text) {
      messages.push(["assistant", text]);
    }
  }

  if (messages.length >= 2) {
    return _messagesToTranscript(messages);
  }

  return null;
}

async function _tryChatgptJson(data: JsonValue): Promise<string | null> {
  if (!isObject(data) || !isObject(data.mapping)) {
    return null;
  }

  const mapping: Record<string, JsonValue> = data.mapping;
  const messages: MessageTuple[] = [];
  let rootId: string | null = null;
  let fallbackRoot: string | null = null;

  for (const [nodeId, nodeValue] of Object.entries(mapping)) {
    if (!isObject(nodeValue)) {
      continue;
    }

    const node = nodeValue as ChatGptNode;
    if (node.parent === null || node.parent === undefined) {
      if (node.message === null || node.message === undefined) {
        rootId = nodeId;
        break;
      }

      if (fallbackRoot === null) {
        fallbackRoot = nodeId;
      }
    }
  }

  if (!rootId) {
    rootId = fallbackRoot;
  }

  if (rootId) {
    let currentId: string | null = rootId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);

      const nodeValue: JsonValue | undefined = mapping[currentId];
      const node: ChatGptNode = isObject(nodeValue) ? (nodeValue as ChatGptNode) : {};
      const messageValue = node.message;

      if (isObject(messageValue)) {
        const message = messageValue as ChatGptMessage;
        const role = isObject(message.author) && typeof message.author.role === "string" ? message.author.role : "";
        const content = isObject(message.content) ? message.content : {};
        const parts = Array.isArray(content.parts) ? content.parts : [];
        const text = parts
          .filter((part): part is string => typeof part === "string" && Boolean(part))
          .join(" ")
          .trim();

        if (role === "user" && text) {
          messages.push(["user", text]);
        } else if (role === "assistant" && text) {
          messages.push(["assistant", text]);
        }
      }

      const children: JsonValue[] = Array.isArray(node.children) ? node.children : [];
      currentId = typeof children[0] === "string" ? children[0] : null;
    }
  }

  if (messages.length >= 2) {
    return _messagesToTranscript(messages);
  }

  return null;
}

async function _trySlackJson(data: JsonValue): Promise<string | null> {
  if (!Array.isArray(data)) {
    return null;
  }

  const messages: MessageTuple[] = [];
  const seenUsers: Record<string, Role> = {};
  let lastRole: Role | null = null;

  for (const item of data) {
    if (!isObject(item) || item.type !== "message") {
      continue;
    }

    const userIdValue = typeof item.user === "string" ? item.user : typeof item.username === "string" ? item.username : "";
    const textValue = typeof item.text === "string" ? item.text.trim() : "";

    if (!textValue || !userIdValue) {
      continue;
    }

    if (!(userIdValue in seenUsers)) {
      if (Object.keys(seenUsers).length === 0) {
        seenUsers[userIdValue] = "user";
      } else if (lastRole === "user") {
        seenUsers[userIdValue] = "assistant";
      } else {
        seenUsers[userIdValue] = "user";
      }
    }

    lastRole = seenUsers[userIdValue];
    messages.push([seenUsers[userIdValue], textValue]);
  }

  if (messages.length >= 2) {
    return _messagesToTranscript(messages);
  }

  return null;
}

function _extractContent(content: JsonValue): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];

    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (isObject(item) && item.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }

    return parts.join(" ").trim();
  }

  if (isObject(content) && typeof content.text === "string") {
    return content.text.trim();
  }

  return "";
}

export async function messagesToTranscript(messages: MessageTuple[], spellcheck = true): Promise<string> {
  return _messagesToTranscript(messages, spellcheck);
}

async function _messagesToTranscript(messages: MessageTuple[], spellcheck = true): Promise<string> {
  let fix: ((text: string) => string) | null = null;

  if (spellcheck) {
    try {
      const spellcheckPath = "./spellcheck";
      const spellcheckModuleUnknown: unknown = await import(spellcheckPath);

      if (isSpellcheckModule(spellcheckModuleUnknown)) {
        fix = spellcheckModuleUnknown.spellcheckUserText ?? null;
      }
    } catch {
      fix = null;
    }
  }

  const lines: string[] = [];
  let index = 0;

  while (index < messages.length) {
    let [role, text] = messages[index];

    if (role === "user") {
      if (fix !== null) {
        text = fix(text);
      }

      lines.push(`> ${text}`);

      if (index + 1 < messages.length && messages[index + 1][0] === "assistant") {
        lines.push(messages[index + 1][1]);
        index += 2;
      } else {
        index += 1;
      }
    } else {
      lines.push(text);
      index += 1;
    }

    lines.push("");
  }

  return lines.join("\n");
}

function isObject(value: JsonValue | undefined | null): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSpellcheckModule(value: unknown): value is SpellcheckModule {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("spellcheckUserText" in value)) {
    return true;
  }

  const moduleValue = value as { spellcheckUserText?: unknown };
  return moduleValue.spellcheckUserText === undefined || typeof moduleValue.spellcheckUserText === "function";
}
