import { defineCommand } from "citty";
import { resolvePalacePath } from "../cli";

export default defineCommand({
  meta: { description: "Compress drawers using AAAK Dialect (~30x reduction)" },
  args: {
    wing: { type: "string", description: "Wing to compress (default: all wings)" },
    "dry-run": { type: "boolean", description: "Preview compression without storing", default: false },
    config: { type: "string", description: "Entity config JSON (e.g. entities.json)" },
  },
  async run({ args }) {
    const { existsSync } = await import("node:fs");
    const { join, basename } = await import("node:path");
    const { ChromaClient, DefaultEmbeddingFunction, IncludeEnum } = await import("chromadb");
    const { Dialect } = await import("../dialect");

    const palacePath = resolvePalacePath(args.palace as string | undefined);
    const dryRun = args["dry-run"];

    // Load dialect (with optional entity config)
    let configPath = args.config;
    if (!configPath) {
      for (const candidate of ["entities.json", join(palacePath, "entities.json")]) {
        if (existsSync(candidate)) {
          configPath = candidate;
          break;
        }
      }
    }

    let dialect: InstanceType<typeof Dialect>;
    if (configPath && existsSync(configPath)) {
      dialect = Dialect.fromConfig(configPath);
      console.log(`  Loaded entity config: ${configPath}`);
    } else {
      dialect = new Dialect();
    }

    // Connect to palace
    let client: InstanceType<typeof ChromaClient>;
    let col: Awaited<ReturnType<InstanceType<typeof ChromaClient>["getCollection"]>>;
    try {
      client = new ChromaClient({ path: palacePath });
      col = await client.getCollection({
        name: "mempalace_drawers",
        embeddingFunction: new DefaultEmbeddingFunction(),
      });
    } catch {
      console.log(`\n  No palace found at ${palacePath}`);
      console.log("  Run: mempalace init <dir> then mempalace mine <dir>");
      process.exit(1);
    }

    // Query drawers in the wing
    const where = args.wing ? { wing: args.wing } : undefined;
    let results: Awaited<ReturnType<typeof col.get>>;
    try {
      results = await col.get({
        where,
        include: [IncludeEnum.Documents, IncludeEnum.Metadatas],
      });
    } catch (e) {
      console.log(`\n  Error reading drawers: ${e}`);
      process.exit(1);
    }

    const docs = results.documents ?? [];
    const metas = results.metadatas ?? [];
    const ids = results.ids;

    if (docs.length === 0) {
      const wingLabel = args.wing ? ` in wing '${args.wing}'` : "";
      console.log(`\n  No drawers found${wingLabel}.`);
      return;
    }

    console.log(
      `\n  Compressing ${docs.length} drawers` +
        (args.wing ? ` in wing '${args.wing}'` : "") +
        "..."
    );
    console.log();

    let totalOriginal = 0;
    let totalCompressed = 0;
    const compressedEntries: Array<{
      id: string;
      compressed: string;
      meta: Record<string, unknown>;
      stats: ReturnType<typeof Dialect.prototype.compressionStats>;
    }> = [];

    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      if (doc === null || doc === undefined) {
        continue;
      }

      const meta = (metas[i] ?? {}) as Record<string, unknown>;
      const docId = ids[i];

      const compressed = dialect.compress(doc, meta);
      const stats = dialect.compressionStats(doc, compressed);

      totalOriginal += stats.originalChars;
      totalCompressed += stats.compressedChars;
      compressedEntries.push({ id: docId, compressed, meta, stats });

      if (dryRun) {
        const wingName = (meta.wing as string) ?? "?";
        const roomName = (meta.room as string) ?? "?";
        const source = basename((meta.source_file as string) ?? "?");
        console.log(`  [${wingName}/${roomName}] ${source}`);
        console.log(
          `    ${stats.originalTokens}t -> ${stats.compressedTokens}t (${stats.ratio.toFixed(1)}x)`
        );
        console.log(`    ${compressed}`);
        console.log();
      }
    }

    // Store compressed versions (unless dry-run)
    if (!dryRun) {
      try {
        const compCol = await client.getOrCreateCollection({
          name: "mempalace_compressed",
          embeddingFunction: new DefaultEmbeddingFunction(),
        });
        for (const { id, compressed, meta, stats } of compressedEntries) {
          const compMeta = {
            ...meta,
            compression_ratio: Math.round(stats.ratio * 10) / 10,
            original_tokens: stats.originalTokens,
          };
          await compCol.upsert({
            ids: [id],
            documents: [compressed],
            metadatas: [compMeta as Record<string, string | number | boolean>],
          });
        }
        console.log(
          `  Stored ${compressedEntries.length} compressed drawers in 'mempalace_compressed' collection.`
        );
      } catch (e) {
        console.log(`  Error storing compressed drawers: ${e}`);
        process.exit(1);
      }
    }

    // Summary
    const ratio = totalOriginal / Math.max(totalCompressed, 1);
    const origTokens = Dialect.countTokens("x".repeat(totalOriginal));
    const compTokens = Dialect.countTokens("x".repeat(totalCompressed));
    console.log(
      `  Total: ${origTokens.toLocaleString()}t -> ${compTokens.toLocaleString()}t (${ratio.toFixed(1)}x compression)`
    );
    if (dryRun) {
      console.log("  (dry run -- nothing stored)");
    }
  },
});
