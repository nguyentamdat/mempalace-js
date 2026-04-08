import { defineCommand } from "citty";
import { MempalaceConfig } from "../config";

export default defineCommand({
  meta: { description: "Detect rooms from your folder structure" },
  args: {
    dir: { type: "positional", description: "Project directory to set up", required: true },
    yes: { type: "boolean", description: "Auto-accept all detected entities", default: false },
  },
  async run({ args }) {
    const { scanForDetection, detectEntities, confirmEntities } = await import("../entity-detector");
    const { detectRoomsLocal } = await import("../room-detector");
    const { writeFileSync } = await import("fs");
    const { resolve } = await import("path");

    // Pass 1: auto-detect people and projects from file content
    console.log(`\n  Scanning for entities in: ${args.dir}`);
    const files = scanForDetection(args.dir);
    if (files.length > 0) {
      console.log(`  Reading ${files.length} files...`);
      const detected = detectEntities(files);
      const total =
        detected.people.length + detected.projects.length + detected.uncertain.length;
      if (total > 0) {
        const confirmed = await confirmEntities(detected, args.yes);
        if (confirmed.people.length > 0 || confirmed.projects.length > 0) {
          const entitiesPath = resolve(args.dir, "entities.json");
          writeFileSync(entitiesPath, JSON.stringify(confirmed, null, 2));
          console.log(`  Entities saved: ${entitiesPath}`);
        }
      } else {
        console.log("  No entities detected — proceeding with directory-based rooms.");
      }
    }

    // Pass 2: detect rooms from folder structure
    await detectRoomsLocal(args.dir);
    new MempalaceConfig().init();
  },
});
