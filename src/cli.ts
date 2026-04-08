#!/usr/bin/env bun
/**
 * MemPalace — Give your AI a memory. No API key required.
 *
 * Two ways to ingest:
 *   Projects:      mempalace mine ~/projects/my_app          (code, docs, notes)
 *   Conversations: mempalace mine ~/chats/ --mode convos     (Claude, ChatGPT, Slack)
 *
 * Commands:
 *   mempalace init <dir>                  Detect rooms from folder structure
 *   mempalace split <dir>                 Split concatenated mega-files
 *   mempalace mine <dir>                  Mine project files (default)
 *   mempalace mine <dir> --mode convos    Mine conversation exports
 *   mempalace search "query"              Find anything, exact words
 *   mempalace wake-up                     Show L0 + L1 wake-up context
 *   mempalace status                      Show what's been filed
 */

import { defineCommand, runMain } from "citty";
import { MempalaceConfig } from "./config";

const mainCommand = defineCommand({
  meta: {
    name: "mempalace",
    version: "1.0.0",
    description: "Give your AI a memory. No API key required.",
  },
  args: {
    palace: {
      type: "string",
      description: "Where the palace lives (default: from config or ~/.mempalace/palace)",
    },
  },
  subCommands: {
    init: () => import("./commands/init").then((m) => m.default),
    mine: () => import("./commands/mine").then((m) => m.default),
    search: () => import("./commands/search").then((m) => m.default),
    compress: () => import("./commands/compress").then((m) => m.default),
    "wake-up": () => import("./commands/wake-up").then((m) => m.default),
    split: () => import("./commands/split").then((m) => m.default),
    status: () => import("./commands/status").then((m) => m.default),
  },
});

export function resolvePalacePath(palaceArg?: string): string {
  if (palaceArg) return palaceArg.replace(/^~/, process.env.HOME ?? "~");
  return new MempalaceConfig().palacePath;
}

export default mainCommand;
