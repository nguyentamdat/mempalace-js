import { defineCommand } from "citty";

export default defineCommand({
  meta: { description: "Split concatenated transcript mega-files into per-session files" },
  args: {
    dir: { type: "positional", description: "Directory containing transcript files", required: true },
    "output-dir": { type: "string", description: "Write split files here (default: same as source)" },
    "dry-run": { type: "boolean", description: "Show what would be split without writing", default: false },
    "min-sessions": { type: "string", description: "Only split files with at least N sessions", default: "2" },
  },
  async run({ args }) {
    const { splitMegaFiles } = await import("../split-mega-files");
    splitMegaFiles({
      dir: args.dir,
      outputDir: args["output-dir"],
      dryRun: args["dry-run"],
      minSessions: parseInt(args["min-sessions"], 10),
    });
  },
});
