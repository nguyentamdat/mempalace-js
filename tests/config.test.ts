import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MempalaceConfig } from "../src/config";

describe("MempalaceConfig", () => {
  let configDir = "";
  let originalPalacePath: string | undefined;
  let originalLegacyPalacePath: string | undefined;

  beforeEach(async () => {
    configDir = await mkdtemp(join(tmpdir(), "mempalace-config-"));
    originalPalacePath = process.env.MEMPALACE_PALACE_PATH;
    originalLegacyPalacePath = process.env.MEMPAL_PALACE_PATH;
    delete process.env.MEMPALACE_PALACE_PATH;
    delete process.env.MEMPAL_PALACE_PATH;
  });

  afterEach(async () => {
    if (originalPalacePath === undefined) {
      delete process.env.MEMPALACE_PALACE_PATH;
    } else {
      process.env.MEMPALACE_PALACE_PATH = originalPalacePath;
    }

    if (originalLegacyPalacePath === undefined) {
      delete process.env.MEMPAL_PALACE_PATH;
    } else {
      process.env.MEMPAL_PALACE_PATH = originalLegacyPalacePath;
    }

    await rm(configDir, { recursive: true, force: true });
  });

  test("uses defaults when no config file exists", () => {
    const config = new MempalaceConfig(configDir);

    expect(config.palacePath).toContain("palace");
    expect(config.collectionName).toBe("mempalace_drawers");
  });

  test("reads config values from config.json", async () => {
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({ palace_path: "/custom/palace" }),
    );

    const config = new MempalaceConfig(configDir);

    expect(config.palacePath).toBe("/custom/palace");
  });

  test("prefers environment variables over config file values", () => {
    process.env.MEMPALACE_PALACE_PATH = "/env/palace";

    const config = new MempalaceConfig(configDir);

    expect(config.palacePath).toBe("/env/palace");
  });

  test("init creates a default config file", async () => {
    const config = new MempalaceConfig(configDir);
    const configFile = config.init();
    const saved = JSON.parse(await readFile(configFile, "utf-8")) as {
      palace_path: string;
      collection_name: string;
    };

    expect(configFile).toBe(join(configDir, "config.json"));
    expect(saved.palace_path).toContain("palace");
    expect(saved.collection_name).toBe("mempalace_drawers");
  });
});
