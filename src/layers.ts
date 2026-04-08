import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import {
  ChromaClient,
  IncludeEnum,
  type Collection,
  type GetResponse,
  type Metadata,
  type QueryResponse,
  type Where,
} from "chromadb";

import { MempalaceConfig } from "./config";

type DrawerMetadata = Metadata & {
  source_file?: string;
  wing?: string;
  room?: string;
  date?: string;
  importance?: string | number;
  emotional_weight?: string | number;
  weight?: string | number;
};

type SearchHit = {
  text: string;
  wing: string;
  room: string;
  sourceFile: string;
  similarity: number;
  metadata: DrawerMetadata;
};

type DialectLike = {
  compress(text: string, metadata?: Record<string, unknown>): string;
};

type QueryResponseLike = QueryResponse & {
  documents?: Array<Array<string | null>> | null;
  metadatas?: Array<Array<Metadata | null>> | null;
  distances?: number[][] | null;
};

let dialectPromise: Promise<DialectLike> | null = null;

function defaultIdentityPath(): string {
  return join(homedir(), ".mempalace", "identity.txt");
}

function normalizeText(value: string): string {
  return value.trim().replace(/\n/g, " ");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function sourceFileName(metadata: DrawerMetadata): string {
  return metadata.source_file ? basename(metadata.source_file) : "";
}

function buildWhere(wing?: string, room?: string): Where | undefined {
  if (wing && room) {
    return { $and: [{ wing }, { room }] } as Where;
  }

  if (wing) {
    return { wing };
  }

  if (room) {
    return { room };
  }

  return undefined;
}

function getMetadataValue(metadata: DrawerMetadata, key: "importance" | "emotional_weight" | "weight"): number | null {
  const value = metadata[key];
  if (value === undefined || value === null) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizeGetResponse(results: GetResponse): { documents: string[]; metadatas: DrawerMetadata[] } {
  const documents: string[] = [];
  const metadatas: DrawerMetadata[] = [];

  for (const [index, document] of (results.documents ?? []).entries()) {
    if (typeof document !== "string") {
      continue;
    }

    documents.push(document);
    metadatas.push(((results.metadatas ?? [])[index] ?? {}) as DrawerMetadata);
  }

  return { documents, metadatas };
}

function normalizeQueryResponse(results: QueryResponseLike): { documents: string[]; metadatas: DrawerMetadata[]; distances: number[] } {
  const documents: string[] = [];
  const metadatas: DrawerMetadata[] = [];
  const distances: number[] = [];

  for (const [index, document] of (results.documents?.[0] ?? []).entries()) {
    if (typeof document !== "string") {
      continue;
    }

    documents.push(document);
    metadatas.push(((results.metadatas?.[0] ?? [])[index] ?? {}) as DrawerMetadata);
    distances.push((results.distances?.[0] ?? [])[index] ?? 1);
  }

  return { documents, metadatas, distances };
}

async function loadDialect(): Promise<DialectLike> {
  if (!dialectPromise) {
    dialectPromise = (async () => {
      try {
        const dialectModulePath = "./dialect";
        const dialectModule = (await import(dialectModulePath)) as { Dialect?: new () => DialectLike };
        if (dialectModule.Dialect) {
          return new dialectModule.Dialect();
        }
      } catch {}

      return {
        compress(text: string) {
          return text;
        },
      } satisfies DialectLike;
    })();
  }

  return dialectPromise;
}

async function getCollection(palacePath: string, collectionName: string): Promise<Collection> {
  const client = new ChromaClient({ path: palacePath });
  return await client.getCollection({ name: collectionName } as never);
}

export class Layer0 {
  path: string;
  private text: string | null;

  constructor(identityPath?: string) {
    this.path = identityPath ?? defaultIdentityPath();
    this.text = null;
  }

  async render(): Promise<string> {
    if (this.text !== null) {
      return this.text;
    }

    try {
      this.text = (await readFile(this.path, "utf-8")).trim();
    } catch {
      this.text = "## L0 — IDENTITY\nNo identity configured. Create ~/.mempalace/identity.txt";
    }

    return this.text;
  }

  async tokenEstimate(): Promise<number> {
    return Math.floor((await this.render()).length / 4);
  }
}

export class Layer1 {
  static readonly MAX_DRAWERS = 15;
  static readonly MAX_CHARS = 3200;

  palacePath: string;
  collectionName: string;
  wing?: string;

  constructor(palacePath?: string, wing?: string) {
    const config = new MempalaceConfig();
    this.palacePath = palacePath ?? config.palacePath;
    this.collectionName = config.collectionName;
    this.wing = wing;
  }

  async generate(): Promise<string> {
    let collection: Collection;

    try {
      collection = await getCollection(this.palacePath, this.collectionName);
    } catch {
      return "## L1 — No palace found. Run: mempalace mine <dir>";
    }

    const where = this.wing ? ({ wing: this.wing } as Where) : undefined;

    let results: GetResponse;
    try {
      results = await collection.get({
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
        ...(where ? { where } : {}),
      });
    } catch {
      return "## L1 — No drawers found.";
    }

    const { documents, metadatas } = normalizeGetResponse(results);
    if (documents.length === 0) {
      return "## L1 — No memories yet.";
    }

    const scored = documents.map((document, index) => {
      const metadata = metadatas[index] ?? {};
      let importance = 3;

      for (const key of ["importance", "emotional_weight", "weight"] as const) {
        const value = getMetadataValue(metadata, key);
        if (value !== null) {
          importance = value;
          break;
        }
      }

      return { importance, metadata, document };
    });

    scored.sort((left, right) => right.importance - left.importance);
    const top = scored.slice(0, Layer1.MAX_DRAWERS);
    const byRoom = new Map<string, Array<typeof top[number]>>();

    for (const entry of top) {
      const room = entry.metadata.room ?? "general";
      const roomEntries = byRoom.get(room) ?? [];
      roomEntries.push(entry);
      byRoom.set(room, roomEntries);
    }

    const dialect = await loadDialect();
    const lines = ["## L1 — ESSENTIAL STORY"];
    let totalLength = 0;

    for (const room of [...byRoom.keys()].sort()) {
      const roomLine = `\n[${room}]`;
      lines.push(roomLine);
      totalLength += roomLine.length;

      for (const entry of byRoom.get(room) ?? []) {
        const source = sourceFileName(entry.metadata);
        const snippetSource = normalizeText(entry.document);
        const compressed = dialect.compress(entry.document, entry.metadata);
        const snippet = truncateText(snippetSource || normalizeText(compressed), 200);

        let entryLine = `  - ${snippet}`;
        if (source) {
          entryLine += `  (${source})`;
        }

        if (totalLength + entryLine.length > Layer1.MAX_CHARS) {
          lines.push("  ... (more in L3 search)");
          return lines.join("\n");
        }

        lines.push(entryLine);
        totalLength += entryLine.length;
      }
    }

    return lines.join("\n");
  }
}

export class Layer2 {
  palacePath: string;
  collectionName: string;

  constructor(palacePath?: string) {
    const config = new MempalaceConfig();
    this.palacePath = palacePath ?? config.palacePath;
    this.collectionName = config.collectionName;
  }

  async retrieve(wing?: string, room?: string, nResults = 10): Promise<string> {
    let collection: Collection;

    try {
      collection = await getCollection(this.palacePath, this.collectionName);
    } catch {
      return "No palace found.";
    }

    const where = buildWhere(wing, room);

    let results: GetResponse;
    try {
      results = await collection.get({
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
        limit: nResults,
        ...(where ? { where } : {}),
      });
    } catch (error) {
      return `Retrieval error: ${error}`;
    }

    const { documents, metadatas } = normalizeGetResponse(results);
    if (documents.length === 0) {
      let label = wing ? `wing=${wing}` : "";
      if (room) {
        label += label ? ` room=${room}` : `room=${room}`;
      }
      return `No drawers found for ${label}.`;
    }

    const lines = [`## L2 — ON-DEMAND (${documents.length} drawers)`];
    for (const [index, document] of documents.slice(0, nResults).entries()) {
      const metadata = metadatas[index] ?? {};
      const roomName = metadata.room ?? "?";
      const source = sourceFileName(metadata);
      const snippet = truncateText(normalizeText(document), 300);

      let entry = `  [${roomName}] ${snippet}`;
      if (source) {
        entry += `  (${source})`;
      }

      lines.push(entry);
    }

    return lines.join("\n");
  }
}

export class Layer3 {
  palacePath: string;
  collectionName: string;

  constructor(palacePath?: string) {
    const config = new MempalaceConfig();
    this.palacePath = palacePath ?? config.palacePath;
    this.collectionName = config.collectionName;
  }

  async search(query: string, wing?: string, room?: string, nResults = 5): Promise<string> {
    let collection: Collection;

    try {
      collection = await getCollection(this.palacePath, this.collectionName);
    } catch {
      return "No palace found.";
    }

    const where = buildWhere(wing, room);

    let results: QueryResponseLike;
    try {
      results = await collection.query({
        queryTexts: [query],
        nResults,
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
        ...(where ? { where } : {}),
      });
    } catch (error) {
      return `Search error: ${error}`;
    }

    const { documents, metadatas, distances } = normalizeQueryResponse(results);
    if (documents.length === 0) {
      return "No results found.";
    }

    const lines = [`## L3 — SEARCH RESULTS for "${query}"`];
    for (const [index, document] of documents.entries()) {
      const metadata = metadatas[index] ?? {};
      const distance = distances[index] ?? 1;
      const similarity = Math.round((1 - distance) * 1000) / 1000;
      const wingName = metadata.wing ?? "?";
      const roomName = metadata.room ?? "?";
      const source = sourceFileName(metadata);
      const snippet = truncateText(normalizeText(document), 300);

      lines.push(`  [${index + 1}] ${wingName}/${roomName} (sim=${similarity})`);
      lines.push(`      ${snippet}`);
      if (source) {
        lines.push(`      src: ${source}`);
      }
    }

    return lines.join("\n");
  }

  async searchRaw(query: string, wing?: string, room?: string, nResults = 5): Promise<SearchHit[]> {
    let collection: Collection;

    try {
      collection = await getCollection(this.palacePath, this.collectionName);
    } catch {
      return [];
    }

    const where = buildWhere(wing, room);

    let results: QueryResponseLike;
    try {
      results = await collection.query({
        queryTexts: [query],
        nResults,
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas, IncludeEnum.Distances],
        ...(where ? { where } : {}),
      });
    } catch {
      return [];
    }

    const { documents, metadatas, distances } = normalizeQueryResponse(results);
    return documents.map((document, index) => {
      const metadata = metadatas[index] ?? {};
      const distance = distances[index] ?? 1;

      return {
        text: document,
        wing: metadata.wing ?? "unknown",
        room: metadata.room ?? "unknown",
        sourceFile: metadata.source_file ? basename(metadata.source_file) : "?",
        similarity: Math.round((1 - distance) * 1000) / 1000,
        metadata,
      };
    });
  }
}

export class MemoryStack {
  palacePath: string;
  identityPath: string;
  l0: Layer0;
  l1: Layer1;
  l2: Layer2;
  l3: Layer3;

  constructor(palacePath?: string, identityPath?: string) {
    const config = new MempalaceConfig();
    this.palacePath = palacePath ?? config.palacePath;
    this.identityPath = identityPath ?? defaultIdentityPath();

    this.l0 = new Layer0(this.identityPath);
    this.l1 = new Layer1(this.palacePath);
    this.l2 = new Layer2(this.palacePath);
    this.l3 = new Layer3(this.palacePath);
  }

  async wakeUp(wing?: string): Promise<string> {
    const parts: string[] = [];

    parts.push(await this.l0.render());
    parts.push("");

    if (wing) {
      this.l1.wing = wing;
    }

    parts.push(await this.l1.generate());
    return parts.join("\n");
  }

  async recall(wing?: string, room?: string, nResults = 10): Promise<string> {
    return await this.l2.retrieve(wing, room, nResults);
  }

  async search(query: string, wing?: string, room?: string, nResults = 5): Promise<string> {
    return await this.l3.search(query, wing, room, nResults);
  }

  async status(): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {
      palacePath: this.palacePath,
      l0Identity: {
        path: this.identityPath,
        exists: await Bun.file(this.identityPath).exists(),
        tokens: await this.l0.tokenEstimate(),
      },
      l1Essential: {
        description: "Auto-generated from top palace drawers",
      },
      l2OnDemand: {
        description: "Wing/room filtered retrieval",
      },
      l3DeepSearch: {
        description: "Full semantic search via ChromaDB",
      },
    };

    try {
      const collection = await getCollection(this.palacePath, new MempalaceConfig().collectionName);
      result.totalDrawers = await collection.count();
    } catch {
      result.totalDrawers = 0;
    }

    return result;
  }
}

export default MemoryStack;
