import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromaClient } from "chromadb";

import { mineConvos } from "../src/convo-miner";

async function hasChromaServer(): Promise<boolean> {
  try {
    const client = new ChromaClient();
    await client.heartbeat();
    return true;
  } catch {
    return false;
  }
}

const chromaTest = (await hasChromaServer()) ? test : test.skip;

describe("mineConvos", () => {
  let tempDir = "";
  let palacePath = "";
  let wing = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mempalace-convos-"));
    palacePath = join(tempDir, "palace");
    wing = `test_convos_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  chromaTest("mines conversation files into ChromaDB", async () => {
    await writeFile(
      join(tempDir, "chat.txt"),
      "> What is memory?\nMemory is persistence.\n\n> Why does it matter?\nIt enables continuity.\n\n> How do we build it?\nWith structured storage.\n",
    );

    await mineConvos({
      convoDir: tempDir,
      palacePath,
      wing,
    });

    const client = new ChromaClient();
    const collection = await client.getCollection({ name: "mempalace_drawers" });
    const inserted = await collection.get({ where: { wing } });
    const results = await collection.query({
      queryTexts: ["memory persistence"],
      nResults: 1,
      where: { wing },
    });

    expect(inserted.ids.length).toBeGreaterThanOrEqual(2);
    expect(results.documents?.[0]?.length ?? 0).toBeGreaterThan(0);
  });
});
