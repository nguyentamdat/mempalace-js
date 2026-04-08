import { defineCommand } from "citty";
import { resolvePalacePath } from "../cli";

export default defineCommand({
  meta: { description: "Mine files into the palace" },
  args: {
    dir: { type: "positional", description: "Directory to mine", required: true },
    mode: {
      type: "string",
      description: "Ingest mode: 'projects' for code/docs, 'convos' for chat exports",
      default: "projects",
    },
    wing: { type: "string", description: "Wing name (default: directory name)" },
    agent: { type: "string", description: "Your name — recorded on every drawer", default: "mempalace" },
    limit: { type: "string", description: "Max files to process (0 = all)", default: "0" },
    "dry-run": { type: "boolean", description: "Show what would be filed without filing", default: false },
    extract: {
      type: "string",
      description: "Extraction strategy for convos: 'exchange' or 'general'",
      default: "exchange",
    },
  },
  async run({ args }) {
    const palacePath = resolvePalacePath(args.palace as string | undefined);
    const limit = parseInt(args.limit, 10);
    const dryRun = args["dry-run"];

    if (args.mode === "convos") {
      const { mineConvos } = await import("../convo-miner");
      await mineConvos({
        convoDir: args.dir,
        palacePath,
        wing: args.wing,
        agent: args.agent,
        limit,
        dryRun,
        extractMode: args.extract as "exchange" | "general",
      });
    } else {
      const { mine } = await import("../miner");
      await mine({
        projectDir: args.dir,
        palacePath,
        wingOverride: args.wing,
        agent: args.agent,
        limit,
        dryRun,
      });
    }
  },
});
