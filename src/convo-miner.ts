import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { ChromaClient } from "chromadb";
import { MempalaceConfig } from "./config";

import { extractMemories } from "./general-extractor";
import { normalize } from "./normalize";

export const CONVO_EXTENSIONS = new Set([".txt", ".md", ".json", ".jsonl"]);

export const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  ".next",
  ".mempalace",
]);

export const MIN_CHUNK_SIZE = 30;

export const TOPIC_KEYWORDS: Record<string, string[]> = {
  technical: ["code", "python", "function", "bug", "error", "api", "database", "server", "deploy", "git", "test", "debug", "refactor"],
  architecture: ["architecture", "design", "pattern", "structure", "schema", "interface", "module", "component", "service", "layer"],
  planning: ["plan", "roadmap", "milestone", "deadline", "priority", "sprint", "backlog", "scope", "requirement", "spec"],
  decisions: ["decided", "chose", "picked", "switched", "migrated", "replaced", "trade-off", "alternative", "option", "approach"],
  problems: ["problem", "issue", "broken", "failed", "crash", "stuck", "workaround", "fix", "solved", "resolved"],
};

const COLLECTION_NAME = "mempalace_drawers";

type ExtractMode = "exchange" | "general";

type Chunk = {
  content: string;
  chunk_index: number;
  memory_type?: string;
};

type MineConvosOptions = {
  convoDir: string;
  palacePath: string;
  wing?: string;
  agent?: string;
  limit?: number;
  dryRun?: boolean;
  extractMode?: ExtractMode;
};

type DrawerCollection = Awaited<ReturnType<ChromaClient["getCollection"]>>;

function formatRule(char: string, width = 55): string {
  return char.repeat(width);
}

export function chunkExchanges(content: string): Chunk[] {
  const lines = content.split("\n");
  const quoteLines = lines.filter((line) => line.trim().startsWith(">")).length;

  if (quoteLines >= 3) {
    return chunkByExchange(lines);
  }

  return chunkByParagraph(content);
}

function chunkByExchange(lines: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim().startsWith(">")) {
      const userTurn = line.trim();
      index += 1;

      const aiLines: string[] = [];
      while (index < lines.length) {
        const nextLine = lines[index];
        const stripped = nextLine.trim();

        if (stripped.startsWith(">") || stripped.startsWith("---")) {
          break;
        }

        if (stripped) {
          aiLines.push(stripped);
        }

        index += 1;
      }

      const aiResponse = aiLines.slice(0, 8).join(" ");
      const chunkContent = aiResponse ? `${userTurn}\n${aiResponse}` : userTurn;

      if (chunkContent.trim().length > MIN_CHUNK_SIZE) {
        chunks.push({
          content: chunkContent,
          chunk_index: chunks.length,
        });
      }
    } else {
      index += 1;
    }
  }

  return chunks;
}

function chunkByParagraph(content: string): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = content
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph);

  if (paragraphs.length <= 1 && content.split("\n").length - 1 > 20) {
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 25) {
      const group = lines.slice(index, index + 25).join("\n").trim();
      if (group.length > MIN_CHUNK_SIZE) {
        chunks.push({ content: group, chunk_index: chunks.length });
      }
    }
    return chunks;
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > MIN_CHUNK_SIZE) {
      chunks.push({ content: paragraph, chunk_index: chunks.length });
    }
  }

  return chunks;
}

export function detectConvoRoom(content: string): string {
  const contentLower = content.slice(0, 3000).toLowerCase();
  const scores = new Map<string, number>();

  for (const [room, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    const score = keywords.reduce((total, keyword) => total + (contentLower.includes(keyword) ? 1 : 0), 0);
    if (score > 0) {
      scores.set(room, score);
    }
  }

  let bestRoom = "general";
  let bestScore = 0;
  for (const [room, score] of scores.entries()) {
    if (score > bestScore) {
      bestRoom = room;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestRoom : "general";
}

export async function getCollection(palacePath: string): Promise<DrawerCollection> {
  mkdirSync(palacePath, { recursive: true });
  const client = new ChromaClient({ path: new MempalaceConfig().chromaUrl });
  return client.getOrCreateCollection({ name: COLLECTION_NAME });
}

export async function fileAlreadyMined(collection: DrawerCollection, sourceFile: string): Promise<boolean> {
  try {
    const results = await collection.get({ where: { source_file: sourceFile }, limit: 1 });
    return results.ids.length > 0;
  } catch {
    return false;
  }
}

export function scanConvos(convoDir: string): string[] {
  const convoPath = resolve(convoDir.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const files: string[] = [];

  const walk = (currentDir: string) => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(`${currentDir}/${entry.name}`);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const filepath = `${currentDir}/${entry.name}`;
      if (!CONVO_EXTENSIONS.has(extname(filepath).toLowerCase())) {
        continue;
      }

      try {
        statSync(filepath);
        files.push(filepath);
      } catch {
      }
    }
  };

  walk(convoPath);
  return files;
}

export async function mineConvos({
  convoDir,
  palacePath,
  wing,
  agent = "mempalace",
  limit = 0,
  dryRun = false,
  extractMode = "exchange",
}: MineConvosOptions): Promise<void> {
  const convoPath = resolve(convoDir.replace(/^~(?=$|\/)/, process.env.HOME ?? "~"));
  const resolvedWing = wing ?? basename(convoPath).toLowerCase().replace(/ /g, "_").replace(/-/g, "_");

  let files = scanConvos(convoDir);
  if (limit > 0) {
    files = files.slice(0, limit);
  }

  console.log(`\n${formatRule("=")}`);
  console.log("  MemPalace Mine — Conversations");
  console.log(formatRule("="));
  console.log(`  Wing:    ${resolvedWing}`);
  console.log(`  Source:  ${convoPath}`);
  console.log(`  Files:   ${files.length}`);
  console.log(`  Palace:  ${palacePath}`);
  if (dryRun) {
    console.log("  DRY RUN — nothing will be filed");
  }
  console.log(`${formatRule("─")}\n`);

  const collection = dryRun ? null : await getCollection(palacePath);

  let totalDrawers = 0;
  let filesSkipped = 0;
  const roomCounts = new Map<string, number>();

  for (const [index, filepath] of files.entries()) {
    const sourceFile = filepath;

    if (!dryRun) {
      if (collection === null) {
        throw new Error("Collection is required when dryRun is false");
      }
      if (await fileAlreadyMined(collection, sourceFile)) {
        filesSkipped += 1;
        continue;
      }
    }

    let content: string;
    try {
      content = await normalize(sourceFile);
    } catch {
      continue;
    }

    if (!content.trim() || content.trim().length < MIN_CHUNK_SIZE) {
      continue;
    }

    const chunks = extractMode === "general" ? extractMemories(content) : chunkExchanges(content);
    if (chunks.length === 0) {
      continue;
    }

    const room = extractMode !== "general" ? detectConvoRoom(content) : null;

    if (dryRun) {
      if (extractMode === "general") {
        const typeCounts = new Map<string, number>();
        for (const chunk of chunks) {
          const memoryType = chunk.memory_type ?? "general";
          typeCounts.set(memoryType, (typeCounts.get(memoryType) ?? 0) + 1);
        }
        const typesStr = [...typeCounts.entries()]
          .sort((left, right) => right[1] - left[1])
          .map(([type, count]) => `${type}:${count}`)
          .join(", ");
        console.log(`    [DRY RUN] ${basename(filepath)} → ${chunks.length} memories (${typesStr})`);
      } else {
        console.log(`    [DRY RUN] ${basename(filepath)} → room:${room} (${chunks.length} drawers)`);
      }

      totalDrawers += chunks.length;
      if (extractMode === "general") {
        for (const chunk of chunks) {
          const memoryType = chunk.memory_type ?? "general";
          roomCounts.set(memoryType, (roomCounts.get(memoryType) ?? 0) + 1);
        }
      } else if (room !== null) {
        roomCounts.set(room, (roomCounts.get(room) ?? 0) + 1);
      }
      continue;
    }

    if (extractMode !== "general" && room !== null) {
      roomCounts.set(room, (roomCounts.get(room) ?? 0) + 1);
    }

    let drawersAdded = 0;
    for (const chunk of chunks) {
      const chunkRoom = extractMode === "general" ? (chunk.memory_type ?? "general") : (room ?? "general");
      if (extractMode === "general") {
        roomCounts.set(chunkRoom, (roomCounts.get(chunkRoom) ?? 0) + 1);
      }

      const drawerId = `drawer_${resolvedWing}_${chunkRoom}_${createHash("md5")
        .update(sourceFile + String(chunk.chunk_index))
        .digest("hex")
        .slice(0, 16)}`;

      if (collection === null) {
        throw new Error("Collection is required when dryRun is false");
      }

      try {
        await collection.add({
          documents: [chunk.content],
          ids: [drawerId],
          metadatas: [
            {
              wing: resolvedWing,
              room: chunkRoom,
              source_file: sourceFile,
              chunk_index: chunk.chunk_index,
              added_by: agent,
              filed_at: new Date().toISOString(),
              ingest_mode: "convos",
              extract_mode: extractMode,
            },
          ],
        });
        drawersAdded += 1;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.toLowerCase().includes("already exists")) {
          throw error;
        }
      }
    }

    totalDrawers += drawersAdded;
    console.log(
      `  ✓ [${String(index + 1).padStart(4)}/${files.length}] ${basename(filepath)
        .slice(0, 50)
        .padEnd(50)} +${drawersAdded}`,
    );
  }

  console.log(`\n${formatRule("=")}`);
  console.log("  Done.");
  console.log(`  Files processed: ${files.length - filesSkipped}`);
  console.log(`  Files skipped (already filed): ${filesSkipped}`);
  console.log(`  Drawers filed: ${totalDrawers}`);
  if (roomCounts.size > 0) {
    console.log("\n  By room:");
    for (const [roomName, count] of [...roomCounts.entries()].sort((left, right) => right[1] - left[1])) {
      console.log(`    ${roomName.padEnd(20)} ${count} files`);
    }
  }
  console.log('\n  Next: mempalace search "what you\'re looking for"');
  console.log(`${formatRule("=")}\n`);
}
