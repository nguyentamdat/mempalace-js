/**
 * MemPalace configuration system.
 *
 * Priority: env vars > config file (~/.mempalace/config.json) > defaults
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export const DEFAULT_PALACE_PATH = join(homedir(), ".mempalace", "palace");
export const DEFAULT_COLLECTION_NAME = "mempalace_drawers";

export const DEFAULT_TOPIC_WINGS = [
  "emotions",
  "consciousness",
  "memory",
  "technical",
  "identity",
  "family",
  "creative",
];

export const DEFAULT_HALL_KEYWORDS: Record<string, string[]> = {
  emotions: [
    "scared", "afraid", "worried", "happy", "sad",
    "love", "hate", "feel", "cry", "tears",
  ],
  consciousness: [
    "consciousness", "conscious", "aware", "real",
    "genuine", "soul", "exist", "alive",
  ],
  memory: ["memory", "remember", "forget", "recall", "archive", "palace", "store"],
  technical: [
    "code", "python", "script", "bug", "error",
    "function", "api", "database", "server",
  ],
  identity: ["identity", "name", "who am i", "persona", "self"],
  family: ["family", "kids", "children", "daughter", "son", "parent", "mother", "father"],
  creative: ["game", "gameplay", "player", "app", "design", "art", "music", "story"],
};

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {
    // Ignore parse/read errors
  }
  return null;
}

export class MempalaceConfig {
  private configDir: string;
  private configFile: string;
  private peopleMapFile: string;
  private fileConfig: Record<string, unknown>;

  constructor(configDir?: string) {
    this.configDir = configDir ?? join(homedir(), ".mempalace");
    this.configFile = join(this.configDir, "config.json");
    this.peopleMapFile = join(this.configDir, "people_map.json");
    this.fileConfig = readJsonFile(this.configFile) ?? {};
  }

  get palacePath(): string {
    const envVal =
      process.env.MEMPALACE_PALACE_PATH ?? process.env.MEMPAL_PALACE_PATH;
    if (envVal) return envVal;
    return (this.fileConfig.palace_path as string) ?? DEFAULT_PALACE_PATH;
  }

  get collectionName(): string {
    return (this.fileConfig.collection_name as string) ?? DEFAULT_COLLECTION_NAME;
  }

  get peopleMap(): Record<string, string> {
    const fromFile = readJsonFile(this.peopleMapFile);
    if (fromFile) return fromFile as Record<string, string>;
    return (this.fileConfig.people_map as Record<string, string>) ?? {};
  }

  get topicWings(): string[] {
    return (this.fileConfig.topic_wings as string[]) ?? DEFAULT_TOPIC_WINGS;
  }

  get hallKeywords(): Record<string, string[]> {
    return (this.fileConfig.hall_keywords as Record<string, string[]>) ?? DEFAULT_HALL_KEYWORDS;
  }

  init(): string {
    mkdirSync(this.configDir, { recursive: true });
    if (!existsSync(this.configFile)) {
      const defaultConfig = {
        palace_path: DEFAULT_PALACE_PATH,
        collection_name: DEFAULT_COLLECTION_NAME,
        topic_wings: DEFAULT_TOPIC_WINGS,
        hall_keywords: DEFAULT_HALL_KEYWORDS,
      };
      writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2));
    }
    return this.configFile;
  }

  savePeopleMap(peopleMap: Record<string, string>): string {
    mkdirSync(this.configDir, { recursive: true });
    writeFileSync(this.peopleMapFile, JSON.stringify(peopleMap, null, 2));
    return this.peopleMapFile;
  }
}
