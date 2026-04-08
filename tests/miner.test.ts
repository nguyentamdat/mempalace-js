import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromaClient } from "chromadb";

import { mine } from "../src/miner";

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

describe("mine", () => {
  let tempDir = "";
  let palacePath = "";
  let wing = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mempalace-miner-"));
    palacePath = join(tempDir, "palace");
    wing = `test_project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  chromaTest("mines project files into ChromaDB", async () => {
    await mkdir(join(tempDir, "backend"), { recursive: true });
    await writeFile(
      join(tempDir, "backend", "app.py"),
      "def main():\n    print('hello world')\n".repeat(20),
    );
    await writeFile(
      join(tempDir, "mempalace.yaml"),
      [
        `wing: ${wing}`,
        "rooms:",
        "  - name: backend",
        "    description: Backend code",
        "  - name: general",
        "    description: General",
        "",
      ].join("\n"),
    );

    await mine(tempDir, palacePath);

    const client = new ChromaClient();
    const collection = await client.getCollection({ name: "mempalace_drawers" });
    const inserted = await collection.get({ where: { wing } });

    expect(inserted.ids.length).toBeGreaterThan(0);
  });
});
