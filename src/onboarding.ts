import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { cancel, confirm, isCancel, select, text } from "@clack/prompts";

import { type DetectedEntity, detectEntities, scanForDetection } from "./entity-detector";
import { COMMON_ENGLISH_WORDS, EntityRegistry } from "./entity-registry";

export const DEFAULT_WINGS = {
  work: ["projects", "clients", "team", "decisions", "research"],
  personal: ["family", "health", "creative", "reflections", "relationships"],
  combo: ["family", "work", "health", "creative", "projects", "reflections"],
} as const;

type OnboardingMode = keyof typeof DEFAULT_WINGS;
type PersonContext = "personal" | "work";

type OnboardingPerson = {
  name: string;
  relationship: string;
  context: PersonContext;
};

type BootstrapOptions = {
  people: OnboardingPerson[];
  projects: string[];
  wings: string[];
  mode: OnboardingMode;
  configDir?: string;
};

function ensureNotCancelled<T>(value: T): T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return value;
}

function hr(): void {
  console.log(`\n${"─".repeat(58)}`);
}

function header(message: string): void {
  console.log(`\n${"=".repeat(58)}`);
  console.log(`  ${message}`);
  console.log(`${"=".repeat(58)}`);
}

async function promptText(message: string, placeholder?: string, defaultValue?: string): Promise<string> {
  const value = ensureNotCancelled(
    await text({
      message,
      placeholder,
      defaultValue,
    }),
  );

  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

async function promptConfirm(message: string, initialValue = false): Promise<boolean> {
  return ensureNotCancelled(
    await confirm({
      message,
      initialValue,
    }),
  ) as boolean;
}

function parsePersonEntry(entry: string): { name: string; relationship: string } {
  const [namePart, relationshipPart] = entry.split(",", 2).map((part) => part.trim());
  return {
    name: namePart ?? "",
    relationship: relationshipPart ?? "",
  };
}

export async function askMode(): Promise<OnboardingMode> {
  header("Welcome to MemPalace");
  console.log(`
  MemPalace is a personal memory system. To work well, it needs to know
  a little about your world — who the people are, what the projects
  are, and how you want your memory organized.

  This takes about 2 minutes. You can always update it later.
`);

  return ensureNotCancelled(
    await select<OnboardingMode>({
      message: "How are you using MemPalace?",
      options: [
        { value: "work", label: "Work", hint: "notes, projects, clients, colleagues, decisions" },
        { value: "personal", label: "Personal", hint: "diary, family, health, relationships, reflections" },
        { value: "combo", label: "Both", hint: "personal and professional mixed" },
      ],
    }),
  ) as OnboardingMode;
}

export async function askPeople(mode: OnboardingMode): Promise<[OnboardingPerson[], Record<string, string>]> {
  const people: OnboardingPerson[] = [];
  const aliases: Record<string, string> = {};

  if (mode === "personal" || mode === "combo") {
    hr();
    console.log(`
  Personal world — who are the important people in your life?

  Format: name, relationship (e.g. "Riley, daughter" or just "Devon")
  For nicknames, you'll be asked separately.
  Leave blank or type 'done' when finished.
`);

    while (true) {
      const entry = await promptText("Person", "Riley, daughter");
      if (!entry || entry.toLowerCase() === "done") {
        break;
      }

      const { name, relationship } = parsePersonEntry(entry);
      if (!name) {
        continue;
      }

      const nickname = await promptText(`Nickname for ${name}?`, "leave blank to skip");
      if (nickname) {
        aliases[nickname] = name;
      }

      people.push({ name, relationship, context: "personal" });
    }
  }

  if (mode === "work" || mode === "combo") {
    hr();
    console.log(`
  Work world — who are the colleagues, clients, or collaborators
  you'd want to find in your notes?

  Format: name, role (e.g. "Ben, co-founder" or just "Sarah")
  Leave blank or type 'done' when finished.
`);

    while (true) {
      const entry = await promptText("Person", "Ben, co-founder");
      if (!entry || entry.toLowerCase() === "done") {
        break;
      }

      const { name, relationship } = parsePersonEntry(entry);
      if (!name) {
        continue;
      }

      people.push({ name, relationship, context: "work" });
    }
  }

  return [people, aliases];
}

export async function askProjects(mode: OnboardingMode): Promise<string[]> {
  if (mode === "personal") {
    return [];
  }

  hr();
  console.log(`
  What are your main projects? (These help MemPalace distinguish project
  names from person names — e.g. "Lantern" the project vs. "Lantern" the word.)

  Leave blank or type 'done' when finished.
`);

  const projects: string[] = [];
  while (true) {
    const project = await promptText("Project", "Lantern");
    if (!project || project.toLowerCase() === "done") {
      break;
    }

    projects.push(project);
  }

  return projects;
}

export async function askWings(mode: OnboardingMode): Promise<string[]> {
  const defaults = [...DEFAULT_WINGS[mode]];
  hr();
  console.log(`
  Wings are the top-level categories in your memory palace.

  Suggested wings for ${mode} mode:
    ${defaults.join(", ")}
`);

  const keepDefaults = await promptConfirm("Use these suggested wings?", true);
  if (keepDefaults) {
    return defaults;
  }

  const custom = await promptText("Custom wings (comma-separated)", "family, work, health");
  const wings = custom
    .split(",")
    .map((wing) => wing.trim())
    .filter((wing) => wing.length > 0);

  return wings.length > 0 ? wings : defaults;
}

export function autoDetect(directory: string, knownPeople: OnboardingPerson[]): DetectedEntity[] {
  const knownNames = new Set(knownPeople.map((person) => person.name.toLowerCase()));

  try {
    const files = scanForDetection(directory);
    if (files.length === 0) {
      return [];
    }

    return detectEntities(files).people.filter(
      (entity) => entity.confidence >= 0.7 && !knownNames.has(entity.name.toLowerCase()),
    );
  } catch {
    return [];
  }
}

export function warnAmbiguous(people: OnboardingPerson[]): string[] {
  return people
    .map((person) => person.name)
    .filter((name) => COMMON_ENGLISH_WORDS.has(name.toLowerCase()));
}

function makeEntityCode(name: string, usedCodes: Set<string>, prefixLength: number): string {
  const compactName = name.replace(/\s+/g, "");
  const upper = compactName.toUpperCase();

  for (let length = Math.min(prefixLength, upper.length); length <= upper.length; length += 1) {
    const candidate = upper.slice(0, length);
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
  }

  let counter = 2;
  const base = upper.slice(0, Math.max(prefixLength, 1));
  while (true) {
    const candidate = `${base}${counter}`;
    if (!usedCodes.has(candidate)) {
      usedCodes.add(candidate);
      return candidate;
    }
    counter += 1;
  }
}

export function generateAaakBootstrap({ people, projects, wings, mode, configDir }: BootstrapOptions): void {
  const mempalaceDir = configDir ? resolve(configDir) : join(homedir(), ".mempalace");
  mkdirSync(mempalaceDir, { recursive: true });

  const entityCodes = new Map<string, string>();
  const usedCodes = new Set<string>();
  for (const person of people) {
    entityCodes.set(person.name, makeEntityCode(person.name, usedCodes, 3));
  }

  const registryLines = [
    "# AAAK Entity Registry",
    "# Auto-generated by mempalace init. Update as needed.",
    "",
    "## People",
  ];

  for (const person of people) {
    const code = entityCodes.get(person.name);
    if (!code) {
      continue;
    }

    registryLines.push(
      person.relationship ? `  ${code}=${person.name} (${person.relationship})` : `  ${code}=${person.name}`,
    );
  }

  if (projects.length > 0) {
    registryLines.push("", "## Projects");
    for (const project of projects) {
      registryLines.push(`  ${makeEntityCode(project, usedCodes, 4)}=${project}`);
    }
  }

  registryLines.push(
    "",
    "## AAAK Quick Reference",
    "  Symbols: ♡=love ★=importance ⚠=warning →=relationship |=separator",
    "  Structure: KEY:value | GROUP(details) | entity.attribute",
    "  Read naturally — expand codes, treat *markers* as emotional context.",
  );

  writeFileSync(join(mempalaceDir, "aaak_entities.md"), registryLines.join("\n"));

  const factsLines = [
    "# Critical Facts (bootstrap — will be enriched after mining)",
    "",
  ];

  const personalPeople = people.filter((person) => person.context === "personal");
  const workPeople = people.filter((person) => person.context === "work");

  if (personalPeople.length > 0) {
    factsLines.push("## People (personal)");
    for (const person of personalPeople) {
      const code = entityCodes.get(person.name);
      if (!code) {
        continue;
      }

      factsLines.push(
        person.relationship
          ? `- **${person.name}** (${code}) — ${person.relationship}`
          : `- **${person.name}** (${code})`,
      );
    }
    factsLines.push("");
  }

  if (workPeople.length > 0) {
    factsLines.push("## People (work)");
    for (const person of workPeople) {
      const code = entityCodes.get(person.name);
      if (!code) {
        continue;
      }

      factsLines.push(
        person.relationship
          ? `- **${person.name}** (${code}) — ${person.relationship}`
          : `- **${person.name}** (${code})`,
      );
    }
    factsLines.push("");
  }

  if (projects.length > 0) {
    factsLines.push("## Projects");
    for (const project of projects) {
      factsLines.push(`- **${project}**`);
    }
    factsLines.push("");
  }

  factsLines.push(
    "## Palace",
    `Wings: ${wings.join(", ")}`,
    `Mode: ${mode}`,
    "",
    "*This file will be enriched by palace_facts.py after mining.*",
  );

  writeFileSync(join(mempalaceDir, "critical_facts.md"), factsLines.join("\n"));
}

export async function runOnboarding(
  directory = ".",
  configDir?: string,
  autoDetectEnabled = true,
): Promise<EntityRegistry> {
  const mode = await askMode();
  const [people, aliases] = await askPeople(mode);
  const projects = await askProjects(mode);
  const wings = await askWings(mode);

  if (autoDetectEnabled && (await promptConfirm("Scan your files for additional names we might have missed?", true))) {
    const scanDirectoryInput = await promptText("Directory to scan", directory, directory);
    const scanDirectory = scanDirectoryInput || directory;
    const detected = autoDetect(scanDirectory, people);

    if (detected.length > 0) {
      hr();
      console.log(`\n  Found ${detected.length} additional name candidates:\n`);
      for (const entity of detected) {
        console.log(
          `    ${entity.name.padEnd(20, " ")} confidence=${(entity.confidence * 100).toFixed(0)}%  (${entity.signals[0] ?? "detected from files"})`,
        );
      }

      if (await promptConfirm("Review and add any of these to your registry?", true)) {
        for (const entity of detected) {
          const choice = ensureNotCancelled(
            await select<"person" | "skip">({
              message: `${entity.name} — add to your registry?`,
              options: [
                { value: "person", label: "Add as person" },
                { value: "skip", label: "Skip" },
              ],
            }),
          ) as "person" | "skip";

          if (choice === "skip") {
            continue;
          }

          const relationship = await promptText(`Relationship/role for ${entity.name}?`, "friend, client, collaborator");
          const context =
            mode === "personal"
              ? "personal"
              : mode === "work"
                ? "work"
                : (ensureNotCancelled(
                    await select<PersonContext>({
                      message: `${entity.name} — which context fits best?`,
                      options: [
                        { value: "personal", label: "Personal" },
                        { value: "work", label: "Work" },
                      ],
                    }),
                  ) as PersonContext);

          people.push({
            name: entity.name,
            relationship,
            context,
          });
        }
      }
    }
  }

  const ambiguous = warnAmbiguous(people);
  if (ambiguous.length > 0) {
    hr();
    console.log(`
  Heads up — these names are also common English words:
    ${ambiguous.join(", ")}

  MemPalace will check the context before treating them as person names.
  For example: "I picked up Riley" → person.
               "Have you ever tried" → adverb.
`);
  }

  const registry = EntityRegistry.load(configDir);
  registry.seed(mode, people, projects, aliases);

  generateAaakBootstrap({
    people,
    projects,
    wings,
    mode,
    configDir,
  });

  header("Setup Complete");
  console.log();
  console.log(`  ${registry.summary().replaceAll("\n", "\n  ")}`);
  console.log(`\n  Wings: ${wings.join(", ")}`);
  console.log(`\n  Registry saved to: ${join(configDir ?? join(homedir(), ".mempalace"), "entity_registry.json")}`);
  console.log(`\n  AAAK entity registry: ${join(configDir ?? join(homedir(), ".mempalace"), "aaak_entities.md")}`);
  console.log(`  Critical facts bootstrap: ${join(configDir ?? join(homedir(), ".mempalace"), "critical_facts.md")}`);
  console.log("\n  Your AI will know your world from the first session.");
  console.log();

  return registry;
}

export function quickSetup(
  mode: OnboardingMode,
  people: OnboardingPerson[],
  projects: string[] = [],
  aliases: Record<string, string> = {},
  configDir?: string,
): EntityRegistry {
  const registry = EntityRegistry.load(configDir);
  registry.seed(mode, people, projects, aliases);
  return registry;
}
