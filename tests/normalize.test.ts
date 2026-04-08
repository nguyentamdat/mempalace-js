import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalize } from "../src/normalize";

describe("normalize", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "mempalace-normalize-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  test("returns plain text unchanged", async () => {
    const filePath = join(tempDir, "notes.txt");
    await writeFile(filePath, "Hello world\nSecond line\n");

    const result = await normalize(filePath);

    expect(result).toContain("Hello world");
  });

  test("normalizes Claude-style JSON messages into a transcript", async () => {
    const filePath = join(tempDir, "chat.json");
    await writeFile(
      filePath,
      JSON.stringify([
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello" },
      ]),
    );

    const result = await normalize(filePath);

    expect(result).toContain("Hi");
    expect(result).toContain("Hello");
  });

  test("returns an empty string for empty files", async () => {
    const filePath = join(tempDir, "empty.txt");
    await writeFile(filePath, "");

    const result = await normalize(filePath);

    expect(result.trim()).toBe("");
  });
});
