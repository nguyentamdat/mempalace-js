import { existsSync, readFileSync } from "node:fs";
import { EntityRegistry } from "./entity-registry";

const SYSTEM_DICT_PATH = "/usr/share/dict/words";
const HAS_DIGIT = /\d/u;
const IS_CAMEL = /[A-Z][a-z]+[A-Z]/u;
const IS_ALLCAPS = /^(?:[A-Z_@#$%^&*()+={}|<>?.:/\\]|\[|\])+$/u;
const IS_TECHNICAL = /[-_]/u;
const IS_URL = /https?:\/\/|www\.|\/Users\/|~\/|\.[a-z]{2,4}$/iu;
const IS_CODE_OR_EMOJI = /[`*_#{}[\]\\]/u;
const TOKEN_RE = /(\S+)/gu;
const TRAILING_PUNCTUATION_RE = /[.,!?;:'")]+$/u;
const MIN_LENGTH = 4;

type Speller = (token: string) => string;

let systemWordsCache: ReadonlySet<string> | null = null;

function defaultSpeller(token: string): string {
  // TODO: Plug in a Bun-compatible spellchecker when we choose one.
  return token;
}

function shouldSkip(token: string, knownNames: ReadonlySet<string>): boolean {
  if (token.length < MIN_LENGTH) {
    return true;
  }
  if (HAS_DIGIT.test(token)) {
    return true;
  }
  if (IS_CAMEL.test(token)) {
    return true;
  }
  if (IS_ALLCAPS.test(token)) {
    return true;
  }
  if (IS_TECHNICAL.test(token)) {
    return true;
  }
  if (IS_URL.test(token)) {
    return true;
  }
  if (IS_CODE_OR_EMOJI.test(token)) {
    return true;
  }
  if (knownNames.has(token.toLowerCase())) {
    return true;
  }
  return false;
}

function loadKnownNames(): Set<string> {
  try {
    const registry = EntityRegistry.load();
    const names = new Set<string>();

    for (const [canonical, info] of Object.entries(registry.people)) {
      if (canonical) {
        names.add(canonical.toLowerCase());
      }

      for (const alias of info.aliases) {
        names.add(alias.toLowerCase());
      }

      if (typeof info.canonical === "string" && info.canonical) {
        names.add(info.canonical.toLowerCase());
      }
    }

    for (const project of registry.projects) {
      names.add(project.toLowerCase());
    }

    return names;
  } catch {
    return new Set<string>();
  }
}

function editDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previousRow = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 0; i < a.length; i += 1) {
    const currentRow = [i + 1];

    for (let j = 0; j < b.length; j += 1) {
      const substitutionCost = a[i] === b[j] ? 0 : 1;
      currentRow.push(
        Math.min(
          previousRow[j + 1] + 1,
          currentRow[j] + 1,
          previousRow[j] + substitutionCost,
        ),
      );
    }

    previousRow = currentRow;
  }

  return previousRow[previousRow.length - 1];
}

function getSystemWords(): ReadonlySet<string> {
  if (systemWordsCache !== null) {
    return systemWordsCache;
  }

  if (!existsSync(SYSTEM_DICT_PATH)) {
    systemWordsCache = new Set<string>();
    return systemWordsCache;
  }

  const words = readFileSync(SYSTEM_DICT_PATH, "utf-8")
    .split(/\r?\n/u)
    .map((word) => word.trim().toLowerCase())
    .filter((word) => word.length > 0);

  systemWordsCache = new Set(words);
  return systemWordsCache;
}

function splitTrailingPunctuation(token: string): { stripped: string; punctuation: string } {
  const punctuation = token.match(TRAILING_PUNCTUATION_RE)?.[0] ?? "";
  if (punctuation.length === 0) {
    return { stripped: token, punctuation: "" };
  }
  return {
    stripped: token.slice(0, token.length - punctuation.length),
    punctuation,
  };
}

export function spellcheckUserText(
  text: string,
  knownNames?: ReadonlySet<string>,
  speller: Speller = defaultSpeller,
): string {
  const resolvedKnownNames = knownNames ?? loadKnownNames();
  const systemWords = getSystemWords();

  return text.replace(TOKEN_RE, (token) => {
    const { stripped, punctuation } = splitTrailingPunctuation(token);
    if (!stripped || shouldSkip(stripped, resolvedKnownNames)) {
      return token;
    }

    if (stripped[0] !== stripped[0].toLowerCase()) {
      return token;
    }

    if (systemWords.has(stripped.toLowerCase())) {
      return token;
    }

    const corrected = speller(stripped);
    if (corrected !== stripped) {
      const distance = editDistance(stripped, corrected);
      const maxEdits = stripped.length <= 7 ? 2 : 3;
      if (distance > maxEdits) {
        return token;
      }
    }

    return `${corrected}${punctuation}`;
  });
}

export function spellcheckTranscriptLine(line: string): string {
  const stripped = line.trimStart();
  if (!stripped.startsWith(">")) {
    return line;
  }

  const leadingWhitespaceLength = line.length - stripped.length;
  const prefixLength = leadingWhitespaceLength + (stripped.startsWith("> ") ? 2 : 1);
  const message = line.slice(prefixLength);
  if (message.trim().length === 0) {
    return line;
  }

  return `${line.slice(0, prefixLength)}${spellcheckUserText(message)}`;
}

export function spellcheckTranscript(content: string): string {
  return content
    .split("\n")
    .map((line) => spellcheckTranscriptLine(line))
    .join("\n");
}
