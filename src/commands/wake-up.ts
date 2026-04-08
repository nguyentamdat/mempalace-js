import { defineCommand } from "citty";
import { resolvePalacePath } from "../cli";

export default defineCommand({
  meta: { description: "Show L0 + L1 wake-up context (~600-900 tokens)" },
  args: {
    wing: { type: "string", description: "Wake-up for a specific project/wing" },
  },
  async run({ args }) {
    const { MemoryStack } = await import("../layers");
    const palacePath = resolvePalacePath(args.palace as string | undefined);
    const stack = new MemoryStack(palacePath);

    const text = await stack.wakeUp(args.wing);
    const tokens = Math.floor(text.length / 4);
    console.log(`Wake-up text (~${tokens} tokens):`);
    console.log("=".repeat(50));
    console.log(text);
  },
});
