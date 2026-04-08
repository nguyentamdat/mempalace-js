import { defineCommand } from "citty";
import { resolvePalacePath } from "../cli";

export default defineCommand({
  meta: { description: "Show what's been filed" },
  args: {},
  async run({ args }) {
    const { status } = await import("../miner");
    const palacePath = resolvePalacePath(args.palace as string | undefined);
    await status(palacePath);
  },
});
