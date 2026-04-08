import { basename } from "node:path";
import { ChromaClient, DefaultEmbeddingFunction } from "chromadb";
import { MempalaceConfig } from "./config";

type SearchOptions = {
  query: string;
  palacePath: string;
  wing?: string;
  room?: string;
  nResults?: number;
};

type SearchHit = {
  text: string;
  wing: string;
  room: string;
  source_file: string;
  similarity: number;
};

type DrawerCollection = Awaited<ReturnType<ChromaClient["getCollection"]>>;
type DrawerQueryParams = Parameters<DrawerCollection["query"]>[0];

function buildWhereFilter(wing?: string, room?: string) {
  let where: Record<string, unknown> = {};

  if (wing && room) {
    where = { $and: [{ wing }, { room }] };
  } else if (wing) {
    where = { wing };
  } else if (room) {
    where = { room };
  }

  return where;
}

async function getDrawerCollection(palacePath: string) {
  const config = new MempalaceConfig();
  const collectionName = config.collectionName;
  const client = new ChromaClient({ path: config.chromaUrl });
  const embeddingFunction = new DefaultEmbeddingFunction();

  try {
    return await client.getCollection({ name: collectionName, embeddingFunction });
  } catch {
    throw new Error(`No palace found at ${palacePath || config.palacePath}`);
  }
}

export async function search({
  query,
  palacePath,
  wing,
  room,
  nResults = 5,
}: SearchOptions): Promise<void> {
  let col: DrawerCollection;

  try {
    col = await getDrawerCollection(palacePath);
  } catch {
    console.log(`\n  No palace found at ${palacePath}`);
    console.log("  Run: mempalace init <dir> then mempalace mine <dir>");
    process.exit(1);
  }

  const where = buildWhereFilter(wing, room);

  try {
    const kwargs = {
      query_texts: [query],
      n_results: nResults,
      include: ["documents", "metadatas", "distances"],
    } as unknown as DrawerQueryParams;

    if (Object.keys(where).length > 0) {
      kwargs.where = where;
    }

    const results = await col.query(kwargs);
    const docs = results.documents?.[0] ?? [];
    const metas = results.metadatas?.[0] ?? [];
    const dists = results.distances?.[0] ?? [];

    if (docs.length === 0) {
      console.log(`\n  No results found for: "${query}"`);
      return;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`  Results for: "${query}"`);
    if (wing) console.log(`  Wing: ${wing}`);
    if (room) console.log(`  Room: ${room}`);
    console.log(`${"=".repeat(60)}\n`);

    for (let i = 0; i < docs.length; i++) {
      const doc = String(docs[i] ?? "");
      const meta = (metas[i] ?? {}) as Record<string, unknown>;
      const dist = Number(dists[i] ?? 0);
      const similarity = Math.round((1 - dist) * 1000) / 1000;
      const source = basename(String(meta.source_file ?? "?"));
      const wingName = String(meta.wing ?? "?");
      const roomName = String(meta.room ?? "?");

      console.log(`  [${i + 1}] ${wingName} / ${roomName}`);
      console.log(`      Source: ${source}`);
      console.log(`      Match:  ${similarity}`);
      console.log();

      for (const line of doc.trim().split("\n")) {
        console.log(`      ${line}`);
      }
      console.log();
      console.log(`  ${"─".repeat(56)}`);
    }

    console.log();
  } catch (error) {
    console.log(`\n  Search error: ${error}`);
    process.exit(1);
  }
}

export async function searchMemories({
  query,
  palacePath,
  wing,
  room,
  nResults = 5,
}: SearchOptions): Promise<{ query?: string; filters?: { wing?: string; room?: string }; results?: SearchHit[]; error?: string }> {
  let col: DrawerCollection;

  try {
    col = await getDrawerCollection(palacePath);
  } catch (error) {
    return { error: `No palace found at ${palacePath}: ${error}` };
  }

  const where = buildWhereFilter(wing, room);

  try {
    const kwargs = {
      query_texts: [query],
      n_results: nResults,
      include: ["documents", "metadatas", "distances"],
    } as unknown as DrawerQueryParams;

    if (Object.keys(where).length > 0) {
      kwargs.where = where;
    }

    const results = await col.query(kwargs);
    const docs = results.documents?.[0] ?? [];
    const metas = results.metadatas?.[0] ?? [];
    const dists = results.distances?.[0] ?? [];

    const hits: SearchHit[] = [];
    for (let i = 0; i < docs.length; i++) {
      const doc = String(docs[i] ?? "");
      const meta = (metas[i] ?? {}) as Record<string, unknown>;
      const dist = Number(dists[i] ?? 0);

      hits.push({
        text: doc,
        wing: String(meta.wing ?? "unknown"),
        room: String(meta.room ?? "unknown"),
        source_file: basename(String(meta.source_file ?? "?")),
        similarity: Math.round((1 - dist) * 1000) / 1000,
      });
    }

    return {
      query,
      filters: { wing, room },
      results: hits,
    };
  } catch (error) {
    return { error: `Search error: ${error}` };
  }
}
