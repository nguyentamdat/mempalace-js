import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { cancel, confirm, isCancel, select, text } from "@clack/prompts";

export const PERSON_VERB_PATTERNS = [
  String.raw`\b{name}\s+said\b`,
  String.raw`\b{name}\s+asked\b`,
  String.raw`\b{name}\s+told\b`,
  String.raw`\b{name}\s+replied\b`,
  String.raw`\b{name}\s+laughed\b`,
  String.raw`\b{name}\s+smiled\b`,
  String.raw`\b{name}\s+cried\b`,
  String.raw`\b{name}\s+felt\b`,
  String.raw`\b{name}\s+thinks?\b`,
  String.raw`\b{name}\s+wants?\b`,
  String.raw`\b{name}\s+loves?\b`,
  String.raw`\b{name}\s+hates?\b`,
  String.raw`\b{name}\s+knows?\b`,
  String.raw`\b{name}\s+decided\b`,
  String.raw`\b{name}\s+pushed\b`,
  String.raw`\b{name}\s+wrote\b`,
  String.raw`\bhey\s+{name}\b`,
  String.raw`\bthanks?\s+{name}\b`,
  String.raw`\bhi\s+{name}\b`,
  String.raw`\bdear\s+{name}\b`,
] as const;

export const PRONOUN_PATTERNS = [
  String.raw`\bshe\b`,
  String.raw`\bher\b`,
  String.raw`\bhers\b`,
  String.raw`\bhe\b`,
  String.raw`\bhim\b`,
  String.raw`\bhis\b`,
  String.raw`\bthey\b`,
  String.raw`\bthem\b`,
  String.raw`\btheir\b`,
] as const;

export const DIALOGUE_PATTERNS = [
  String.raw`^>\s*{name}[:\s]`,
  String.raw`^{name}:\s`,
  String.raw`^\[{name}\]`,
  String.raw`"{name}\s+said`,
] as const;

export const PROJECT_VERB_PATTERNS = [
  String.raw`\bbuilding\s+{name}\b`,
  String.raw`\bbuilt\s+{name}\b`,
  String.raw`\bship(?:ping|ped)?\s+{name}\b`,
  String.raw`\blaunch(?:ing|ed)?\s+{name}\b`,
  String.raw`\bdeploy(?:ing|ed)?\s+{name}\b`,
  String.raw`\binstall(?:ing|ed)?\s+{name}\b`,
  String.raw`\bthe\s+{name}\s+architecture\b`,
  String.raw`\bthe\s+{name}\s+pipeline\b`,
  String.raw`\bthe\s+{name}\s+system\b`,
  String.raw`\bthe\s+{name}\s+repo\b`,
  String.raw`\b{name}\s+v\d+\b`,
  String.raw`\b{name}\.py\b`,
  String.raw`\b{name}-core\b`,
  String.raw`\b{name}-local\b`,
  String.raw`\bimport\s+{name}\b`,
  String.raw`\bpip\s+install\s+{name}\b`,
] as const;

export const STOPWORDS: ReadonlySet<string> = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
  "from", "as", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had", "do",
  "does", "did", "will", "would", "could", "should", "may", "might", "must", "shall", "can",
  "this", "that", "these", "those", "it", "its", "they", "them", "their", "we", "our", "you",
  "your", "i", "my", "me", "he", "she", "his", "her", "who", "what", "when", "where", "why",
  "how", "which", "if", "then", "so", "not", "no", "yes", "ok", "okay", "just", "very",
  "really", "also", "already", "still", "even", "only", "here", "there", "now", "then", "too",
  "up", "out", "about", "like", "use", "get", "got", "make", "made", "take", "put", "come",
  "go", "see", "know", "think", "true", "false", "none", "null", "new", "old", "all", "any",
  "some", "true", "false", "return", "print", "def", "class", "import", "from", "step", "usage",
  "run", "check", "find", "add", "get", "set", "list", "args", "dict", "str", "int", "bool",
  "path", "file", "type", "name", "note", "example", "option", "result", "error", "warning",
  "info", "every", "each", "more", "less", "next", "last", "first", "second", "stack", "layer",
  "mode", "test", "stop", "start", "copy", "move", "source", "target", "output", "input", "data",
  "item", "key", "value", "returns", "raises", "yields", "none", "self", "cls", "kwargs", "world",
  "well", "want", "topic", "choose", "social", "cars", "phones", "healthcare", "ex", "machina",
  "deus", "human", "humans", "people", "things", "something", "nothing", "everything", "anything",
  "someone", "everyone", "anyone", "way", "time", "day", "life", "place", "thing", "part", "kind",
  "sort", "case", "point", "idea", "fact", "sense", "question", "answer", "reason", "number",
  "version", "system", "hey", "hi", "hello", "thanks", "thank", "right", "let", "ok", "click",
  "hit", "press", "tap", "drag", "drop", "open", "close", "save", "load", "launch", "install",
  "download", "upload", "scroll", "select", "enter", "submit", "cancel", "confirm", "delete", "copy",
  "paste", "type", "write", "read", "search", "find", "show", "hide", "desktop", "documents",
  "downloads", "users", "home", "library", "applications", "system", "preferences", "settings",
  "terminal", "actor", "vector", "remote", "control", "duration", "fetch", "agents", "tools", "others",
  "guards", "ethics", "regulation", "learning", "thinking", "memory", "language", "intelligence",
  "technology", "society", "culture", "future", "history", "science", "model", "models", "network",
  "networks", "training", "inference",
]);

export const PROSE_EXTENSIONS: ReadonlySet<string> = new Set([".txt", ".md", ".rst", ".csv"]);

export const READABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt",
  ".md",
  ".py",
  ".js",
  ".ts",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".rst",
  ".toml",
  ".sh",
  ".rb",
  ".go",
  ".rs",
]);

export const SKIP_DIRS: ReadonlySet<string> = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "dist",
  "build",
  ".next",
  "coverage",
  ".mempalace",
]);

type EntityType = "person" | "project" | "uncertain";
type ConfirmChoice = "accept" | "edit" | "add";
type ClassificationChoice = EntityType | "skip";

export type EntityScores = {
  personScore: number;
  projectScore: number;
  personSignals: string[];
  projectSignals: string[];
};

export type DetectedEntity = {
  name: string;
  type: EntityType;
  confidence: number;
  frequency: number;
  signals: string[];
};

export type EntityDetectionResult = {
  people: DetectedEntity[];
  projects: DetectedEntity[];
  uncertain: DetectedEntity[];
};

export type ConfirmedEntities = {
  people: string[];
  projects: string[];
};

type CompiledPatterns = {
  dialogue: RegExp[];
  personVerbs: RegExp[];
  projectVerbs: RegExp[];
  direct: RegExp;
  versioned: RegExp;
  codeRef: RegExp;
};

const CANDIDATE_WORD_REGEX = /\b([A-Z][a-z]{1,19})\b/g;
const MULTI_WORD_REGEX = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
const MAX_BYTES_PER_FILE = 5_000;

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildPattern(template: string, escapedName: string, flags: string): RegExp {
  return new RegExp(template.replaceAll("{name}", escapedName), flags);
}

function countMatches(regex: RegExp, text: string): number {
  const matches = text.match(regex);
  return matches ? matches.length : 0;
}

function roundConfidence(value: number): number {
  return Math.round(value * 100) / 100;
}

function ensureNotCancelled<T>(value: T): T {
  if (isCancel(value)) {
    cancel("Operation cancelled.");
    process.exit(1);
  }

  return value;
}

async function promptChoice(): Promise<ConfirmChoice> {
  return ensureNotCancelled(
    await select<ConfirmChoice>({
      message: "How do you want to handle detected entities?",
      options: [
        { value: "accept", label: "Accept all detected people and projects" },
        { value: "edit", label: "Review uncertain entries and remove mistakes" },
        { value: "add", label: "Add entities manually" },
      ],
    }),
  ) as ConfirmChoice;
}

async function promptClassification(name: string): Promise<ClassificationChoice> {
  return ensureNotCancelled(
    await select<ClassificationChoice>({
      message: `${name} — how should this be classified?`,
      options: [
        { value: "person", label: "Person" },
        { value: "project", label: "Project" },
        { value: "skip", label: "Skip" },
      ],
    }),
  ) as ClassificationChoice;
}

async function promptText(message: string, placeholder?: string): Promise<string> {
  return ensureNotCancelled(
    await text({
      message,
      placeholder,
    }),
  ) as string;
}

async function promptConfirm(message: string, initialValue = false): Promise<boolean> {
  return ensureNotCancelled(
    await confirm({
      message,
      initialValue,
    }),
  ) as boolean;
}

function parseRemovalInput(input: string): Set<number> {
  const indexes = new Set<number>();
  for (const rawPart of input.split(",")) {
    const trimmed = rawPart.trim();
    if (!trimmed) {
      continue;
    }

    const parsed = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(parsed) && parsed > 0) {
      indexes.add(parsed - 1);
    }
  }

  return indexes;
}

function printNumberedNames(label: string, names: string[]): void {
  console.log(`\n  ${label}:`);
  if (names.length === 0) {
    console.log("    (none)");
    return;
  }

  for (const [index, name] of names.entries()) {
    console.log(`    ${String(index + 1).padStart(2, " ")}. ${name}`);
  }
}

export function extractCandidates(text: string): Record<string, number> {
  const counts = new Map<string, number>();

  for (const match of text.matchAll(CANDIDATE_WORD_REGEX)) {
    const word = match[1];
    if (!word) {
      continue;
    }

    if (!STOPWORDS.has(word.toLowerCase()) && word.length > 1) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  for (const match of text.matchAll(MULTI_WORD_REGEX)) {
    const phrase = match[1];
    if (!phrase) {
      continue;
    }

    const hasStopword = phrase
      .split(/\s+/)
      .some((part) => STOPWORDS.has(part.toLowerCase()));
    if (!hasStopword) {
      counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }

  const candidates: Record<string, number> = {};
  for (const [name, count] of counts.entries()) {
    if (count >= 3) {
      candidates[name] = count;
    }
  }

  return candidates;
}

function _buildPatterns(name: string): CompiledPatterns {
  const escapedName = regexEscape(name);
  return {
    dialogue: DIALOGUE_PATTERNS.map((pattern) => buildPattern(pattern, escapedName, "gim")),
    personVerbs: PERSON_VERB_PATTERNS.map((pattern) => buildPattern(pattern, escapedName, "gi")),
    projectVerbs: PROJECT_VERB_PATTERNS.map((pattern) => buildPattern(pattern, escapedName, "gi")),
    direct: new RegExp(String.raw`\bhey\s+${escapedName}\b|\bthanks?\s+${escapedName}\b|\bhi\s+${escapedName}\b`, "gi"),
    versioned: new RegExp(String.raw`\b${escapedName}[-v]\w+`, "gi"),
    codeRef: new RegExp(String.raw`\b${escapedName}\.(py|js|ts|yaml|yml|json|sh)\b`, "gi"),
  };
}

export function scoreEntity(name: string, text: string, lines: string[]): EntityScores {
  const patterns = _buildPatterns(name);
  let personScore = 0;
  let projectScore = 0;
  const personSignals: string[] = [];
  const projectSignals: string[] = [];

  for (const regex of patterns.dialogue) {
    const matches = countMatches(regex, text);
    if (matches > 0) {
      personScore += matches * 3;
      personSignals.push(`dialogue marker (${matches}x)`);
    }
  }

  for (const regex of patterns.personVerbs) {
    const matches = countMatches(regex, text);
    if (matches > 0) {
      personScore += matches * 2;
      personSignals.push(`'${name} ...' action (${matches}x)`);
    }
  }

  const nameLower = name.toLowerCase();
  const nameLineIndexes = lines.flatMap((line, index) =>
    line.toLowerCase().includes(nameLower) ? [index] : [],
  );

  let pronounHits = 0;
  for (const index of nameLineIndexes) {
    const windowText = lines.slice(Math.max(0, index - 2), index + 3).join(" ").toLowerCase();
    for (const pronounPattern of PRONOUN_PATTERNS) {
      if (new RegExp(pronounPattern, "i").test(windowText)) {
        pronounHits += 1;
        break;
      }
    }
  }

  if (pronounHits > 0) {
    personScore += pronounHits * 2;
    personSignals.push(`pronoun nearby (${pronounHits}x)`);
  }

  const direct = countMatches(patterns.direct, text);
  if (direct > 0) {
    personScore += direct * 4;
    personSignals.push(`addressed directly (${direct}x)`);
  }

  for (const regex of patterns.projectVerbs) {
    const matches = countMatches(regex, text);
    if (matches > 0) {
      projectScore += matches * 2;
      projectSignals.push(`project verb (${matches}x)`);
    }
  }

  const versioned = countMatches(patterns.versioned, text);
  if (versioned > 0) {
    projectScore += versioned * 3;
    projectSignals.push(`versioned/hyphenated (${versioned}x)`);
  }

  const codeRef = countMatches(patterns.codeRef, text);
  if (codeRef > 0) {
    projectScore += codeRef * 3;
    projectSignals.push(`code file reference (${codeRef}x)`);
  }

  return {
    personScore,
    projectScore,
    personSignals: personSignals.slice(0, 3),
    projectSignals: projectSignals.slice(0, 3),
  };
}

export function classifyEntity(name: string, frequency: number, scores: EntityScores): DetectedEntity {
  const personScore = scores.personScore;
  const projectScore = scores.projectScore;
  const total = personScore + projectScore;

  if (total === 0) {
    return {
      name,
      type: "uncertain",
      confidence: roundConfidence(Math.min(0.4, frequency / 50)),
      frequency,
      signals: [`appears ${frequency}x, no strong type signals`],
    };
  }

  const personRatio = total > 0 ? personScore / total : 0;
  const signalCategories = new Set<string>();
  for (const signal of scores.personSignals) {
    if (signal.includes("dialogue")) {
      signalCategories.add("dialogue");
    } else if (signal.includes("action")) {
      signalCategories.add("action");
    } else if (signal.includes("pronoun")) {
      signalCategories.add("pronoun");
    } else if (signal.includes("addressed")) {
      signalCategories.add("addressed");
    }
  }

  const hasTwoSignalTypes = signalCategories.size >= 2;
  if (personRatio >= 0.7 && hasTwoSignalTypes && personScore >= 5) {
    return {
      name,
      type: "person",
      confidence: roundConfidence(Math.min(0.99, 0.5 + personRatio * 0.5)),
      frequency,
      signals: scores.personSignals.length > 0 ? scores.personSignals : [`appears ${frequency}x`],
    };
  }

  if (personRatio >= 0.7 && (!hasTwoSignalTypes || personScore < 5)) {
    return {
      name,
      type: "uncertain",
      confidence: 0.4,
      frequency,
      signals: [...scores.personSignals, `appears ${frequency}x — pronoun-only match`],
    };
  }

  if (personRatio <= 0.3) {
    return {
      name,
      type: "project",
      confidence: roundConfidence(Math.min(0.99, 0.5 + (1 - personRatio) * 0.5)),
      frequency,
      signals: scores.projectSignals.length > 0 ? scores.projectSignals : [`appears ${frequency}x`],
    };
  }

  return {
    name,
    type: "uncertain",
    confidence: 0.5,
    frequency,
    signals: [...scores.personSignals, ...scores.projectSignals].slice(0, 3).concat("mixed signals — needs review"),
  };
}

export function detectEntities(filePaths: string[], maxFiles = 10): EntityDetectionResult {
  const allText: string[] = [];
  const allLines: string[] = [];
  let filesRead = 0;

  for (const filePath of filePaths) {
    if (filesRead >= maxFiles) {
      break;
    }

    try {
      const content = readFileSync(filePath, "utf-8").slice(0, MAX_BYTES_PER_FILE);
      allText.push(content);
      allLines.push(...content.split(/\r?\n/));
      filesRead += 1;
    } catch {}
  }

  const combinedText = allText.join("\n");
  const candidates = extractCandidates(combinedText);
  if (Object.keys(candidates).length === 0) {
    return { people: [], projects: [], uncertain: [] };
  }

  const people: DetectedEntity[] = [];
  const projects: DetectedEntity[] = [];
  const uncertain: DetectedEntity[] = [];

  for (const [name, frequency] of Object.entries(candidates).sort((left, right) => right[1] - left[1])) {
    const scores = scoreEntity(name, combinedText, allLines);
    const entity = classifyEntity(name, frequency, scores);

    if (entity.type === "person") {
      people.push(entity);
    } else if (entity.type === "project") {
      projects.push(entity);
    } else {
      uncertain.push(entity);
    }
  }

  people.sort((left, right) => right.confidence - left.confidence);
  projects.sort((left, right) => right.confidence - left.confidence);
  uncertain.sort((left, right) => right.frequency - left.frequency);

  return {
    people: people.slice(0, 15),
    projects: projects.slice(0, 10),
    uncertain: uncertain.slice(0, 8),
  };
}

function _printEntityList(entities: DetectedEntity[], label: string): void {
  console.log(`\n  ${label}:`);
  if (entities.length === 0) {
    console.log("    (none detected)");
    return;
  }

  for (const [index, entity] of entities.entries()) {
    const filled = Math.floor(entity.confidence * 5);
    const confidenceBar = `${"●".repeat(filled)}${"○".repeat(5 - filled)}`;
    const signals = entity.signals.length > 0 ? entity.signals.slice(0, 2).join(", ") : "";
    console.log(`    ${String(index + 1).padStart(2, " ")}. ${entity.name.padEnd(20, " ")} [${confidenceBar}] ${signals}`);
  }
}

export async function confirmEntities(detected: EntityDetectionResult, yes = false): Promise<ConfirmedEntities> {
  console.log(`\n${"=".repeat(58)}`);
  console.log("  MemPalace — Entity Detection");
  console.log(`${"=".repeat(58)}`);
  console.log("\n  Scanned your files. Here's what we found:\n");

  _printEntityList(detected.people, "PEOPLE");
  _printEntityList(detected.projects, "PROJECTS");
  if (detected.uncertain.length > 0) {
    _printEntityList(detected.uncertain, "UNCERTAIN (need your call)");
  }

  let confirmedPeople = detected.people.map((entity) => entity.name);
  let confirmedProjects = detected.projects.map((entity) => entity.name);

  if (yes) {
    console.log(`\n  Auto-accepting ${confirmedPeople.length} people, ${confirmedProjects.length} projects.`);
    return { people: confirmedPeople, projects: confirmedProjects };
  }

  console.log(`\n${"─".repeat(58)}`);
  console.log("  Options:");
  console.log("    accept  Accept all");
  console.log("    edit    Remove wrong entries or reclassify uncertain");
  console.log("    add     Add missing people or projects");
  console.log();

  const choice = await promptChoice();

  if (choice === "edit") {
    if (detected.uncertain.length > 0) {
      console.log("\n  Uncertain entities — classify each:");
      for (const entity of detected.uncertain) {
        const answer = await promptClassification(entity.name);
        if (answer === "person") {
          confirmedPeople.push(entity.name);
        } else if (answer === "project") {
          confirmedProjects.push(entity.name);
        }
      }
    }

    printNumberedNames("Current people", confirmedPeople);
    const removePeople = await promptText(
      "Numbers to REMOVE from people (comma-separated, or enter to skip)",
      "1,3",
    );
    if (removePeople.trim()) {
      const indexes = parseRemovalInput(removePeople);
      confirmedPeople = confirmedPeople.filter((_, index) => !indexes.has(index));
    }

    printNumberedNames("Current projects", confirmedProjects);
    const removeProjects = await promptText(
      "Numbers to REMOVE from projects (comma-separated, or enter to skip)",
      "1,3",
    );
    if (removeProjects.trim()) {
      const indexes = parseRemovalInput(removeProjects);
      confirmedProjects = confirmedProjects.filter((_, index) => !indexes.has(index));
    }
  }

  if (choice === "add" || (await promptConfirm("Add any missing entities?", false))) {
    while (true) {
      const name = (await promptText("Name (or enter to stop)", "Ada Lovelace")).trim();
      if (!name) {
        break;
      }

      const kind = await ensureNotCancelled(
        await select<"person" | "project">({
          message: `Is '${name}' a person or project?`,
          options: [
            { value: "person", label: "Person" },
            { value: "project", label: "Project" },
          ],
        }),
      );

      if (kind === "person") {
        confirmedPeople.push(name);
      } else {
        confirmedProjects.push(name);
      }
    }
  }

  console.log(`\n${"=".repeat(58)}`);
  console.log("  Confirmed:");
  console.log(`  People:   ${confirmedPeople.join(", ") || "(none)"}`);
  console.log(`  Projects: ${confirmedProjects.join(", ") || "(none)"}`);
  console.log(`${"=".repeat(58)}\n`);

  return {
    people: confirmedPeople,
    projects: confirmedProjects,
  };
}

export function scanForDetection(projectDir: string, maxFiles = 10): string[] {
  const projectPath = resolve(projectDir);
  const proseFiles: string[] = [];
  const allFiles: string[] = [];

  const walk = (currentDir: string): void => {
    for (const entry of readdirSync(currentDir, { withFileTypes: true })) {
      const filePath = resolve(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          walk(filePath);
        }
        continue;
      }

      if (!entry.isFile() && !statSync(filePath).isFile()) {
        continue;
      }

      const extension = extname(entry.name).toLowerCase();
      if (PROSE_EXTENSIONS.has(extension)) {
        proseFiles.push(filePath);
      } else if (READABLE_EXTENSIONS.has(extension)) {
        allFiles.push(filePath);
      }
    }
  };

  try {
    walk(projectPath);
  } catch {
    return [];
  }

  const files = proseFiles.length >= 3 ? proseFiles : [...proseFiles, ...allFiles];
  return files.slice(0, maxFiles);
}
