#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { createInterface } from "node:readline";
import {
  ChromaClient,
  type Collection,
  DefaultEmbeddingFunction,
  type GetParams,
  IncludeEnum,
  type Metadata,
  type QueryResponse,
} from "chromadb";
import { MempalaceConfig } from "./config";
import { KnowledgeGraph } from "./knowledge-graph";
import { findTunnels, graphStats, traverse } from "./palace-graph";
import { searchMemories } from "./searcher";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

interface JsonObject {
  [key: string]: JsonValue;
}

interface JsonSchemaProperty {
  type: "string" | "number" | "integer" | "boolean" | "object" | "array";
  description?: string;
}

interface InputSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

type ToolHandler = (args: Record<string, unknown>) => Promise<JsonObject>;

interface ToolDefinition {
  description: string;
  input_schema: InputSchema;
  handler: ToolHandler;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonValue;
  method?: string;
  params?: Record<string, unknown>;
}

interface JsonRpcSuccessResponse {
  jsonrpc: "2.0";
  id?: JsonValue;
  result: JsonObject;
}

interface JsonRpcErrorResponse {
  jsonrpc: "2.0";
  id?: JsonValue;
  error: {
    code: number;
    message: string;
  };
}

type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
type DrawerCollection = Collection;
type DiaryEntry = { date: string; timestamp: string; topic: string; content: string };
type KgDirection = "outgoing" | "incoming" | "both";

interface PalaceGraphCollection {
  count: () => Promise<number>;
  get: (args: {
    limit: number;
    offset: number;
    include: string[];
  }) => Promise<{
    metadatas?: Array<Record<string, unknown> | null>;
    ids?: string[];
  }>;
}

const kg = new KnowledgeGraph();
const config = new MempalaceConfig();
const embeddingFunction = new DefaultEmbeddingFunction();

export const PALACE_PROTOCOL = `IMPORTANT — MemPalace Memory Protocol:
1. ON WAKE-UP: Call mempalace_status to load palace overview + AAAK spec.
2. BEFORE RESPONDING about any person, project, or past event: call mempalace_kg_query or mempalace_search FIRST. Never guess — verify.
3. IF UNSURE about a fact (name, gender, age, relationship): say "let me check" and query the palace. Wrong is worse than slow.
4. AFTER EACH SESSION: call mempalace_diary_write to record what happened, what you learned, what matters.
5. WHEN FACTS CHANGE: call mempalace_kg_invalidate on the old fact, mempalace_kg_add for the new one.

This protocol ensures the AI KNOWS before it speaks. Storage is not memory — but storage + this protocol = memory.`;

export const AAAK_SPEC = `AAAK is a compressed memory dialect that MemPalace uses for efficient storage.
It is designed to be readable by both humans and LLMs without decoding.

FORMAT:
  ENTITIES: 3-letter uppercase codes. ALC=Alice, JOR=Jordan, RIL=Riley, MAX=Max, BEN=Ben.
  EMOTIONS: *action markers* before/during text. *warm*=joy, *fierce*=determined, *raw*=vulnerable, *bloom*=tenderness.
  STRUCTURE: Pipe-separated fields. FAM: family | PROJ: projects | ⚠: warnings/reminders.
  DATES: ISO format (2026-03-31). COUNTS: Nx = N mentions (e.g., 570x).
  IMPORTANCE: ★ to ★★★★★ (1-5 scale).
  HALLS: hall_facts, hall_events, hall_discoveries, hall_preferences, hall_advice.
  WINGS: wing_user, wing_agent, wing_team, wing_code, wing_myproject, wing_hardware, wing_ue5, wing_ai_research.
  ROOMS: Hyphenated slugs representing named ideas (e.g., chromadb-setup, gpu-pricing).

EXAMPLE:
  FAM: ALC→♡JOR | 2D(kids): RIL(18,sports) MAX(11,chess+swimming) | BEN(contributor)

Read AAAK naturally — expand codes mentally, treat *markers* as emotional context.
When WRITING AAAK: use entity codes, mark emotions, keep structure tight.`;

function logInfo(message: string): void {
  process.stderr.write(`${message}\n`);
}

function logError(message: string): void {
  process.stderr.write(`${message}\n`);
}

function noPalace(): JsonObject {
  return {
    error: "No palace found",
    palace_path: config.palacePath,
    hint: "Run: mempalace init <dir> && mempalace mine <dir>",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toOptionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`Expected '${name}' to be a string`);
  }
  return value;
}

function toInteger(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("Expected an integer value");
  }
  return value;
}

function toNumber(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error("Expected a numeric value");
  }
  return value;
}

function toDirection(value: unknown): KgDirection {
  if (value === undefined) {
    return "both";
  }
  if (value === "outgoing" || value === "incoming" || value === "both") {
    return value;
  }
  throw new Error("Expected direction to be 'outgoing', 'incoming', or 'both'");
}

async function getCollection(create = false): Promise<DrawerCollection | null> {
  try {
    const client = new ChromaClient();
    if (create) {
      return await client.getOrCreateCollection({
        name: config.collectionName,
        embeddingFunction,
      });
    }
    return await client.getCollection({
      name: config.collectionName,
      embeddingFunction,
    });
  } catch {
    return null;
  }
}

async function getAllMetadatas(col: DrawerCollection): Promise<Metadata[]> {
  const total = await col.count();
  if (total === 0) {
    return [];
  }

  const metadatas: Metadata[] = [];
  let offset = 0;

  while (offset < total) {
    const batch = await col.get({
      limit: Math.min(1000, total - offset),
      offset,
      include: [IncludeEnum.Metadatas],
    });
    for (const meta of batch.metadatas) {
      if (meta) {
        metadatas.push(meta);
      }
    }
    if (batch.ids.length === 0) {
      break;
    }
    offset += batch.ids.length;
  }

  return metadatas;
}

function isMultiQueryResponse(response: QueryResponse): response is QueryResponse & {
  ids: string[][];
  documents: (string | null)[][] | null;
  metadatas: (Metadata | null)[][] | null;
  distances: number[][] | null;
} {
  return Array.isArray(response.ids[0]);
}

function toPalaceGraphCollection(col: DrawerCollection): PalaceGraphCollection {
  return {
    count: async () => col.count(),
    get: async ({ limit, offset, include }) => {
      const mappedInclude = include.flatMap((value) => {
        if (value === IncludeEnum.Metadatas) {
          return [IncludeEnum.Metadatas];
        }
        if (value === IncludeEnum.Documents) {
          return [IncludeEnum.Documents];
        }
        if (value === IncludeEnum.Distances) {
          return [IncludeEnum.Distances];
        }
        return [];
      });
      const response = await col.get({ limit, offset, include: mappedInclude });
      return {
        metadatas: response.metadatas.map((meta) => (meta ? { ...meta } : null)),
        ids: response.ids,
      };
    },
  };
}

async function toolStatus(): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  const count = await col.count();
  const wings: Record<string, number> = {};
  const rooms: Record<string, number> = {};

  try {
    const allMeta = await getAllMetadatas(col);
    for (const meta of allMeta) {
      const wing = String(meta.wing ?? "unknown");
      const room = String(meta.room ?? "unknown");
      wings[wing] = (wings[wing] ?? 0) + 1;
      rooms[room] = (rooms[room] ?? 0) + 1;
    }
  } catch {
  }

  return {
    total_drawers: count,
    wings,
    rooms,
    palace_path: config.palacePath,
    protocol: PALACE_PROTOCOL,
    aaak_dialect: AAAK_SPEC,
  };
}

async function toolListWings(): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  const wings: Record<string, number> = {};
  try {
    const allMeta = await getAllMetadatas(col);
    for (const meta of allMeta) {
      const wing = String(meta.wing ?? "unknown");
      wings[wing] = (wings[wing] ?? 0) + 1;
    }
  } catch {
  }

  return { wings };
}

async function toolListRooms(wing: string | null = null): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  const rooms: Record<string, number> = {};

  try {
    const params: GetParams = {
      include: [IncludeEnum.Metadatas],
    };
    if (wing) {
      params.where = { wing };
    }
    const results = await col.get(params);
    for (const meta of results.metadatas) {
      if (!meta) {
        continue;
      }
      const room = String(meta.room ?? "unknown");
      rooms[room] = (rooms[room] ?? 0) + 1;
    }
  } catch {
  }

  return { wing: wing ?? "all", rooms };
}

async function toolGetTaxonomy(): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  const taxonomy: Record<string, Record<string, number>> = {};
  try {
    const allMeta = await getAllMetadatas(col);
    for (const meta of allMeta) {
      const wing = String(meta.wing ?? "unknown");
      const room = String(meta.room ?? "unknown");
      taxonomy[wing] ??= {};
      taxonomy[wing][room] = (taxonomy[wing][room] ?? 0) + 1;
    }
  } catch {
  }

  return { taxonomy };
}

async function toolSearch(
  query: string,
  limit = 5,
  wing: string | null = null,
  room: string | null = null,
): Promise<JsonObject> {
  const result = await searchMemories({
    query,
    palacePath: config.palacePath,
    wing: wing ?? undefined,
    room: room ?? undefined,
    nResults: limit,
  });
  return result as unknown as JsonObject;
}

async function toolCheckDuplicate(content: string, threshold = 0.9): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  try {
    const results = await col.query({
      queryTexts: [content],
      nResults: 5,
      include: [IncludeEnum.Metadatas, IncludeEnum.Documents, IncludeEnum.Distances],
    });

    if (!isMultiQueryResponse(results)) {
      return { is_duplicate: false, matches: [] };
    }

    const ids = results.ids[0] ?? [];
    const distances = results.distances?.[0] ?? [];
    const metadatas = results.metadatas?.[0] ?? [];
    const documents = results.documents?.[0] ?? [];

    const duplicates: JsonObject[] = [];
    for (let index = 0; index < ids.length; index += 1) {
      const drawerId = ids[index];
      const distance = distances[index] ?? 1;
      const similarity = Math.round((1 - distance) * 1000) / 1000;
      if (similarity < threshold) {
        continue;
      }

      const meta = metadatas[index] ?? {};
      const document = String(documents[index] ?? "");
      duplicates.push({
        id: drawerId,
        wing: String(meta.wing ?? "?"),
        room: String(meta.room ?? "?"),
        similarity,
        content: document.length > 200 ? `${document.slice(0, 200)}...` : document,
      });
    }

    return {
      is_duplicate: duplicates.length > 0,
      matches: duplicates,
    };
  } catch (error) {
    return { error: String(error) };
  }
}

async function toolGetAaakSpec(): Promise<JsonObject> {
  return { aaak_spec: AAAK_SPEC };
}

async function toolTraverseGraph(startRoom: string, maxHops = 2): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }
  return (await traverse(startRoom, toPalaceGraphCollection(col), undefined, maxHops)) as unknown as JsonObject;
}

async function toolFindTunnels(wingA: string | null = null, wingB: string | null = null): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }
  return {
    tunnels: await findTunnels(wingA, wingB, toPalaceGraphCollection(col)),
  };
}

async function toolGraphStats(): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }
  return (await graphStats(toPalaceGraphCollection(col))) as unknown as JsonObject;
}

async function toolAddDrawer(
  wing: string,
  room: string,
  content: string,
  sourceFile: string | null = null,
  addedBy = "mcp",
): Promise<JsonObject> {
  const col = await getCollection(true);
  if (!col) {
    return noPalace();
  }

  const dup = await toolCheckDuplicate(content, 0.9);
  if (dup.is_duplicate === true) {
    return {
      success: false,
      reason: "duplicate",
      matches: Array.isArray(dup.matches) ? dup.matches : [],
    };
  }

  const now = new Date();
  const hash = createHash("md5")
    .update(`${content.slice(0, 100)}${now.toISOString()}`)
    .digest("hex")
    .slice(0, 16);
  const drawerId = `drawer_${wing}_${room}_${hash}`;

  try {
    await col.add({
      ids: [drawerId],
      documents: [content],
      metadatas: [
        {
          wing,
          room,
          source_file: sourceFile ?? "",
          chunk_index: 0,
          added_by: addedBy,
          filed_at: now.toISOString(),
        },
      ],
    });
    logInfo(`Filed drawer: ${drawerId} → ${wing}/${room}`);
    return { success: true, drawer_id: drawerId, wing, room };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function toolDeleteDrawer(drawerId: string): Promise<JsonObject> {
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  const existing = await col.get({ ids: [drawerId] });
  if (existing.ids.length === 0) {
    return { success: false, error: `Drawer not found: ${drawerId}` };
  }

  try {
    await col.delete({ ids: [drawerId] });
    logInfo(`Deleted drawer: ${drawerId}`);
    return { success: true, drawer_id: drawerId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function toolKgQuery(
  entity: string,
  asOf: string | null = null,
  direction: KgDirection = "both",
): Promise<JsonObject> {
  const facts = kg.queryEntity(entity, asOf, direction);
  return {
    entity,
    as_of: asOf,
    facts: facts as unknown as JsonValue[],
    count: facts.length,
  };
}

async function toolKgAdd(
  subject: string,
  predicate: string,
  object: string,
  validFrom: string | null = null,
  sourceCloset: string | null = null,
): Promise<JsonObject> {
  const tripleId = kg.addTriple(subject, predicate, object, validFrom, null, 1.0, sourceCloset, null);
  return {
    success: true,
    triple_id: tripleId,
    fact: `${subject} → ${predicate} → ${object}`,
  };
}

async function toolKgInvalidate(
  subject: string,
  predicate: string,
  object: string,
  ended: string | null = null,
): Promise<JsonObject> {
  kg.invalidateTriple(subject, predicate, object, ended);
  return {
    success: true,
    fact: `${subject} → ${predicate} → ${object}`,
    ended: ended ?? "today",
  };
}

async function toolKgTimeline(entity: string | null = null): Promise<JsonObject> {
  const timeline = kg.getTimeline(entity);
  return {
    entity: entity ?? "all",
    timeline: timeline as unknown as JsonValue[],
    count: timeline.length,
  };
}

async function toolKgStats(): Promise<JsonObject> {
  return kg.getStats() as unknown as JsonObject;
}

async function toolDiaryWrite(agentName: string, entry: string, topic = "general"): Promise<JsonObject> {
  const wing = `wing_${agentName.toLowerCase().replaceAll(" ", "_")}`;
  const room = "diary";
  const col = await getCollection(true);
  if (!col) {
    return noPalace();
  }

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replaceAll("-", "");
  const timeStamp = now.toISOString().slice(11, 19).replaceAll(":", "");
  const hash = createHash("md5").update(entry.slice(0, 50)).digest("hex").slice(0, 8);
  const entryId = `diary_${wing}_${dateStamp}_${timeStamp}_${hash}`;

  try {
    await col.add({
      ids: [entryId],
      documents: [entry],
      metadatas: [
        {
          wing,
          room,
          hall: "hall_diary",
          topic,
          type: "diary_entry",
          agent: agentName,
          filed_at: now.toISOString(),
          date: now.toISOString().slice(0, 10),
        },
      ],
    });
    logInfo(`Diary entry: ${entryId} → ${wing}/diary/${topic}`);
    return {
      success: true,
      entry_id: entryId,
      agent: agentName,
      topic,
      timestamp: now.toISOString(),
    };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function toolDiaryRead(agentName: string, lastN = 10): Promise<JsonObject> {
  const wing = `wing_${agentName.toLowerCase().replaceAll(" ", "_")}`;
  const col = await getCollection();
  if (!col) {
    return noPalace();
  }

  try {
    const results = await col.get({
      where: { $and: [{ wing }, { room: "diary" }] },
      include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
    });

    if (results.ids.length === 0) {
      return { agent: agentName, entries: [], message: "No diary entries yet." };
    }

    const entries: DiaryEntry[] = [];
    for (let index = 0; index < results.ids.length; index += 1) {
      const meta = results.metadatas[index];
      const document = results.documents[index];
      entries.push({
        date: String(meta?.date ?? ""),
        timestamp: String(meta?.filed_at ?? ""),
        topic: String(meta?.topic ?? ""),
        content: String(document ?? ""),
      });
    }

    entries.sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    const sliced = entries.slice(0, lastN);

    return {
      agent: agentName,
      entries: sliced as unknown as JsonValue[],
      total: results.ids.length,
      showing: sliced.length,
    };
  } catch (error) {
    return { error: String(error) };
  }
}

export const TOOLS: Record<string, ToolDefinition> = {
  mempalace_status: {
    description: "Palace overview — total drawers, wing and room counts",
    input_schema: { type: "object", properties: {} },
    handler: async () => toolStatus(),
  },
  mempalace_list_wings: {
    description: "List all wings with drawer counts",
    input_schema: { type: "object", properties: {} },
    handler: async () => toolListWings(),
  },
  mempalace_list_rooms: {
    description: "List rooms within a wing (or all rooms if no wing given)",
    input_schema: {
      type: "object",
      properties: {
        wing: { type: "string", description: "Wing to list rooms for (optional)" },
      },
    },
    handler: async (args) => toolListRooms(toOptionalString(args.wing)),
  },
  mempalace_get_taxonomy: {
    description: "Full taxonomy: wing → room → drawer count",
    input_schema: { type: "object", properties: {} },
    handler: async () => toolGetTaxonomy(),
  },
  mempalace_get_aaak_spec: {
    description:
      "Get the AAAK dialect specification — the compressed memory format MemPalace uses. Call this if you need to read or write AAAK-compressed memories.",
    input_schema: { type: "object", properties: {} },
    handler: async () => toolGetAaakSpec(),
  },
  mempalace_kg_query: {
    description:
      "Query the knowledge graph for an entity's relationships. Returns typed facts with temporal validity. E.g. 'Max' → child_of Alice, loves chess, does swimming. Filter by date with as_of to see what was true at a point in time.",
    input_schema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity to query (e.g. 'Max', 'MyProject', 'Alice')" },
        as_of: {
          type: "string",
          description: "Date filter — only facts valid at this date (YYYY-MM-DD, optional)",
        },
        direction: {
          type: "string",
          description: "outgoing (entity→?), incoming (?→entity), or both (default: both)",
        },
      },
      required: ["entity"],
    },
    handler: async (args) =>
      toolKgQuery(requireString(args.entity, "entity"), toOptionalString(args.as_of), toDirection(args.direction)),
  },
  mempalace_kg_add: {
    description:
      "Add a fact to the knowledge graph. Subject → predicate → object with optional time window. E.g. ('Max', 'started_school', 'Year 7', valid_from='2026-09-01').",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "The entity doing/being something" },
        predicate: {
          type: "string",
          description: "The relationship type (e.g. 'loves', 'works_on', 'daughter_of')",
        },
        object: { type: "string", description: "The entity being connected to" },
        valid_from: { type: "string", description: "When this became true (YYYY-MM-DD, optional)" },
        source_closet: { type: "string", description: "Closet ID where this fact appears (optional)" },
      },
      required: ["subject", "predicate", "object"],
    },
    handler: async (args) =>
      toolKgAdd(
        requireString(args.subject, "subject"),
        requireString(args.predicate, "predicate"),
        requireString(args.object, "object"),
        toOptionalString(args.valid_from),
        toOptionalString(args.source_closet),
      ),
  },
  mempalace_kg_invalidate: {
    description: "Mark a fact as no longer true. E.g. ankle injury resolved, job ended, moved house.",
    input_schema: {
      type: "object",
      properties: {
        subject: { type: "string", description: "Entity" },
        predicate: { type: "string", description: "Relationship" },
        object: { type: "string", description: "Connected entity" },
        ended: { type: "string", description: "When it stopped being true (YYYY-MM-DD, default: today)" },
      },
      required: ["subject", "predicate", "object"],
    },
    handler: async (args) =>
      toolKgInvalidate(
        requireString(args.subject, "subject"),
        requireString(args.predicate, "predicate"),
        requireString(args.object, "object"),
        toOptionalString(args.ended),
      ),
  },
  mempalace_kg_timeline: {
    description: "Chronological timeline of facts. Shows the story of an entity (or everything) in order.",
    input_schema: {
      type: "object",
      properties: {
        entity: { type: "string", description: "Entity to get timeline for (optional — omit for full timeline)" },
      },
    },
    handler: async (args) => toolKgTimeline(toOptionalString(args.entity)),
  },
  mempalace_kg_stats: {
    description: "Knowledge graph overview: entities, triples, current vs expired facts, relationship types.",
    input_schema: { type: "object", properties: {} },
    handler: async () => toolKgStats(),
  },
  mempalace_traverse: {
    description:
      "Walk the palace graph from a room. Shows connected ideas across wings — the tunnels. Like following a thread through the palace: start at 'chromadb-setup' in wing_code, discover it connects to wing_myproject (planning) and wing_user (feelings about it).",
    input_schema: {
      type: "object",
      properties: {
        start_room: {
          type: "string",
          description: "Room to start from (e.g. 'chromadb-setup', 'riley-school')",
        },
        max_hops: { type: "integer", description: "How many connections to follow (default: 2)" },
      },
      required: ["start_room"],
    },
    handler: async (args) => toolTraverseGraph(requireString(args.start_room, "start_room"), toInteger(args.max_hops, 2)),
  },
  mempalace_find_tunnels: {
    description:
      "Find rooms that bridge two wings — the hallways connecting different domains. E.g. what topics connect wing_code to wing_team?",
    input_schema: {
      type: "object",
      properties: {
        wing_a: { type: "string", description: "First wing (optional)" },
        wing_b: { type: "string", description: "Second wing (optional)" },
      },
    },
    handler: async (args) => toolFindTunnels(toOptionalString(args.wing_a), toOptionalString(args.wing_b)),
  },
  mempalace_graph_stats: {
    description: "Palace graph overview: total rooms, tunnel connections, edges between wings.",
    input_schema: { type: "object", properties: {} },
    handler: async () => toolGraphStats(),
  },
  mempalace_search: {
    description: "Semantic search. Returns verbatim drawer content with similarity scores.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for" },
        limit: { type: "integer", description: "Max results (default 5)" },
        wing: { type: "string", description: "Filter by wing (optional)" },
        room: { type: "string", description: "Filter by room (optional)" },
      },
      required: ["query"],
    },
    handler: async (args) =>
      toolSearch(
        requireString(args.query, "query"),
        toInteger(args.limit, 5),
        toOptionalString(args.wing),
        toOptionalString(args.room),
      ),
  },
  mempalace_check_duplicate: {
    description: "Check if content already exists in the palace before filing",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Content to check" },
        threshold: { type: "number", description: "Similarity threshold 0-1 (default 0.9)" },
      },
      required: ["content"],
    },
    handler: async (args) => toolCheckDuplicate(requireString(args.content, "content"), toNumber(args.threshold, 0.9)),
  },
  mempalace_add_drawer: {
    description: "File verbatim content into the palace. Checks for duplicates first.",
    input_schema: {
      type: "object",
      properties: {
        wing: { type: "string", description: "Wing (project name)" },
        room: { type: "string", description: "Room (aspect: backend, decisions, meetings...)" },
        content: {
          type: "string",
          description: "Verbatim content to store — exact words, never summarized",
        },
        source_file: { type: "string", description: "Where this came from (optional)" },
        added_by: { type: "string", description: "Who is filing this (default: mcp)" },
      },
      required: ["wing", "room", "content"],
    },
    handler: async (args) =>
      toolAddDrawer(
        requireString(args.wing, "wing"),
        requireString(args.room, "room"),
        requireString(args.content, "content"),
        toOptionalString(args.source_file),
        toOptionalString(args.added_by) ?? "mcp",
      ),
  },
  mempalace_delete_drawer: {
    description: "Delete a drawer by ID. Irreversible.",
    input_schema: {
      type: "object",
      properties: {
        drawer_id: { type: "string", description: "ID of the drawer to delete" },
      },
      required: ["drawer_id"],
    },
    handler: async (args) => toolDeleteDrawer(requireString(args.drawer_id, "drawer_id")),
  },
  mempalace_diary_write: {
    description:
      "Write to your personal agent diary in AAAK format. Your observations, thoughts, what you worked on, what matters. Each agent has their own diary with full history. Write in AAAK for compression — e.g. 'SESSION:2026-04-04|built.palace.graph+diary.tools|ALC.req:agent.diaries.in.aaak|★★★'. Use entity codes from the AAAK spec.",
    input_schema: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "Your name — each agent gets their own diary wing" },
        entry: {
          type: "string",
          description: "Your diary entry in AAAK format — compressed, entity-coded, emotion-marked",
        },
        topic: { type: "string", description: "Topic tag (optional, default: general)" },
      },
      required: ["agent_name", "entry"],
    },
    handler: async (args) =>
      toolDiaryWrite(
        requireString(args.agent_name, "agent_name"),
        requireString(args.entry, "entry"),
        toOptionalString(args.topic) ?? "general",
      ),
  },
  mempalace_diary_read: {
    description:
      "Read your recent diary entries (in AAAK). See what past versions of yourself recorded — your journal across sessions.",
    input_schema: {
      type: "object",
      properties: {
        agent_name: { type: "string", description: "Your name — each agent gets their own diary wing" },
        last_n: { type: "integer", description: "Number of recent entries to read (default: 10)" },
      },
      required: ["agent_name"],
    },
    handler: async (args) => toolDiaryRead(requireString(args.agent_name, "agent_name"), toInteger(args.last_n, 10)),
  },
};

export async function handleRequest(rawRequest: unknown): Promise<JsonRpcResponse | null> {
  const request = isRecord(rawRequest) ? (rawRequest as JsonRpcRequest) : {};
  const method = typeof request.method === "string" ? request.method : "";
  const params = isRecord(request.params) ? request.params : {};
  const reqId = request.id;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: reqId,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "mempalace", version: "2.0.0" },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id: reqId,
      result: {
        tools: Object.entries(TOOLS).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.input_schema as unknown as JsonValue,
        })) as JsonValue[],
      },
    };
  }

  if (method === "tools/call") {
    const toolName = typeof params.name === "string" ? params.name : "";
    const toolArgs = isRecord(params.arguments) ? params.arguments : {};

    if (!(toolName in TOOLS)) {
      return {
        jsonrpc: "2.0",
        id: reqId,
        error: { code: -32601, message: `Unknown tool: ${toolName}` },
      };
    }

    try {
      const result = await TOOLS[toolName].handler(toolArgs);
      return {
        jsonrpc: "2.0",
        id: reqId,
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        },
      };
    } catch (error) {
      logError(`Tool error in ${toolName}: ${String(error)}`);
      return {
        jsonrpc: "2.0",
        id: reqId,
        error: { code: -32000, message: String(error) },
      };
    }
  }

  return {
    jsonrpc: "2.0",
    id: reqId,
    error: { code: -32601, message: `Unknown method: ${method}` },
  };
}

export async function main(): Promise<void> {
  logInfo("MemPalace MCP Server starting...");
  const rl = createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
    terminal: false,
  });

  try {
    for await (const rawLine of rl) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      try {
        const request = JSON.parse(line) as unknown;
        const response = await handleRequest(request);
        if (response !== null) {
          process.stdout.write(`${JSON.stringify(response)}\n`);
        }
      } catch (error) {
        logError(`Server error: ${String(error)}`);
      }
    }
  } finally {
    rl.close();
    kg.close();
  }
}

if (import.meta.main) {
  void main();
}

export default main;
