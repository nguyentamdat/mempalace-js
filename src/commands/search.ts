import { defineCommand } from "citty";
import { resolvePalacePath } from "../cli";

export default defineCommand({
  meta: { description: "Find anything, exact words" },
  args: {
    query: { type: "positional", description: "What to search for", required: true },
    wing: { type: "string", description: "Limit to one project" },
    room: { type: "string", description: "Limit to one room" },
    results: { type: "string", description: "Number of results", default: "5" },
  },
  async run({ args }) {
    const { search } = await import("../searcher");
    const palacePath = resolvePalacePath(args.palace as string | undefined);
    await search({
      query: args.query,
      palacePath,
      wing: args.wing,
      room: args.room,
      nResults: parseInt(args.results, 10),
    });
  },
});
