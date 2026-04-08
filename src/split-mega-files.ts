import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, parse } from "node:path";

const HOME = homedir();
const LUMI_DIR = process.env.MEMPALACE_SOURCE_DIR ?? join(HOME, "Desktop/transcripts");
const KNOWN_NAMES_PATH = join(HOME, ".mempalace", "known_names.json");
const FALLBACK_PEOPLE = ["Alice", "Ben", "Riley", "Max", "Sam", "Devon", "Jordan"];
const TIMESTAMP_PATTERN = /⏺\s+(\d{1,2}:\d{2}\s+[AP]M)\s+\w+,\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/;
const MONTHS: Record<string, string> = {
  January: "01",
  February: "02",
  March: "03",
  April: "04",
  May: "05",
  June: "06",
  July: "07",
  August: "08",
  September: "09",
  October: "10",
  November: "11",
  December: "12",
};
const SUBJECT_SKIP_PATTERN = /^(\.\/|cd |ls |python|bash|git |cat |source |export |claude|\.\/activate)/;

type KnownNamesConfig = {
  names?: unknown;
  username_map?: unknown;
};

type SplitMegaFilesOptions = {
  dir?: string;
  outputDir?: string;
  dryRun?: boolean;
  minSessions?: number;
  file?: string;
};

function readKnownNamesConfig(): unknown {
  if (!existsSync(KNOWN_NAMES_PATH)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(KNOWN_NAMES_PATH, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === "string")
  );
}

function _loadKnownPeople(): string[] {
  const data = readKnownNamesConfig();
  if (isStringArray(data)) {
    return data;
  }

  if (typeof data === "object" && data !== null) {
    const config = data as KnownNamesConfig;
    if (isStringArray(config.names)) {
      return config.names;
    }
  }

  return FALLBACK_PEOPLE;
}

function _loadUsernameMap(): Record<string, string> {
  const data = readKnownNamesConfig();
  if (typeof data === "object" && data !== null && !Array.isArray(data)) {
    const config = data as KnownNamesConfig;
    if (isStringRecord(config.username_map)) {
      return config.username_map;
    }
  }

  return {};
}

const KNOWN_PEOPLE = _loadKnownPeople();

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeFileComponent(text: string): string {
  return text.replace(/[^\w.-]/g, "_").replace(/_+/g, "_");
}

export function isTrueSessionStart(lines: string[], idx: number): boolean {
  const nearby = lines.slice(idx, idx + 6).join("");
  return !nearby.includes("Ctrl+E") && !nearby.includes("previous messages");
}

export function findSessionBoundaries(lines: string[]): number[] {
  const boundaries: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (line.includes("Claude Code v") && isTrueSessionStart(lines, index)) {
      boundaries.push(index);
    }
  }
  return boundaries;
}

export function extractTimestamp(lines: string[]): [string | null, string | null] {
  for (const line of lines.slice(0, 50)) {
    const match = TIMESTAMP_PATTERN.exec(line);
    if (!match) {
      continue;
    }

    const [, timeStr, month, day, year] = match;
    const monthValue = MONTHS[month] ?? "00";
    const dayValue = day.padStart(2, "0");
    const timeSafe = timeStr.replace(":", "").replace(" ", "");
    const iso = `${year}-${monthValue}-${dayValue}`;
    const human = `${year}-${monthValue}-${dayValue}_${timeSafe}`;
    return [human, iso];
  }

  return [null, null];
}

export function extractPeople(lines: string[]): string[] {
  const found = new Set<string>();
  const text = lines.slice(0, 100).join("");

  for (const person of KNOWN_PEOPLE) {
    const pattern = new RegExp(`\\b${escapeRegex(person)}\\b`, "i");
    if (pattern.test(text)) {
      found.add(person);
    }
  }

  const dirMatch = /\/Users\/(\w+)\//.exec(text);
  if (dirMatch) {
    const usernameMap = _loadUsernameMap();
    const username = dirMatch[1];
    const mappedName = usernameMap[username];
    if (mappedName) {
      found.add(mappedName);
    }
  }

  return Array.from(found).sort((a, b) => a.localeCompare(b));
}

export function extractSubject(lines: string[]): string {
  for (const line of lines) {
    if (!line.startsWith("> ")) {
      continue;
    }

    const prompt = line.slice(2).trim();
    if (!prompt || SUBJECT_SKIP_PATTERN.test(prompt) || prompt.length <= 5) {
      continue;
    }

    const subject = prompt.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").trim();
    return subject.slice(0, 60) || "session";
  }

  return "session";
}

export function splitFile(filepath: string, outputDir?: string, dryRun = false): string[] {
  const content = readFileSync(filepath, "utf-8");
  const lines = content.split(/(?<=\n)/u);
  const boundaries = findSessionBoundaries(lines);

  if (boundaries.length < 2) {
    return [];
  }

  boundaries.push(lines.length);
  const outDir = outputDir ?? parse(filepath).dir;
  const written: string[] = [];

  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
  }

  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const chunk = lines.slice(start, end);

    if (chunk.length < 10) {
      continue;
    }

    const [timestampHuman] = extractTimestamp(chunk);
    const people = extractPeople(chunk);
    const subject = extractSubject(chunk);
    const timestampPart = timestampHuman ?? `part${String(index + 1).padStart(2, "0")}`;
    const peoplePart = people.length > 0 ? people.slice(0, 3).join("-") : "unknown";
    const sourceStem = parse(filepath).name.replace(/[^\w-]/g, "_").slice(0, 40);
    const filename = sanitizeFileComponent(
      `${sourceStem}__${timestampPart}_${peoplePart}_${subject}.txt`,
    );
    const outPath = join(outDir, filename);

    if (dryRun) {
      console.log(`  [${index + 1}/${boundaries.length - 1}] ${filename}  (${chunk.length} lines)`);
    } else {
      writeFileSync(outPath, chunk.join(""));
      console.log(`  ✓ ${filename}  (${chunk.length} lines)`);
    }

    written.push(outPath);
  }

  return written;
}

export function splitMegaFiles(options: SplitMegaFilesOptions): string[] {
  const srcDir = options.dir ?? LUMI_DIR;
  const outputDir = options.outputDir;
  const dryRun = options.dryRun ?? false;
  const minSessions = options.minSessions ?? 2;
  const files = options.file
    ? [options.file]
    : readdirSync(srcDir)
      .filter((name) => name.endsWith(".txt"))
      .sort((a, b) => a.localeCompare(b))
      .map((name) => join(srcDir, name));

  const megaFiles: Array<{ file: string; sessions: number }> = [];

  for (const file of files) {
    const lines = readFileSync(file, "utf-8").split(/(?<=\n)/u);
    const boundaries = findSessionBoundaries(lines);
    if (boundaries.length >= minSessions) {
      megaFiles.push({ file, sessions: boundaries.length });
    }
  }

  if (megaFiles.length === 0) {
    console.log(`No mega-files found in ${srcDir} (min ${minSessions} sessions).`);
    return [];
  }

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Mega-file splitter — ${dryRun ? "DRY RUN" : "SPLITTING"}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  Source:      ${srcDir}`);
  console.log(`  Output:      ${outputDir ?? "same dir as source"}`);
  console.log(`  Mega-files:  ${megaFiles.length}`);
  console.log(`${"─".repeat(60)}\n`);

  const allWritten: string[] = [];

  for (const megaFile of megaFiles) {
    const sizeKb = Math.floor(statSync(megaFile.file).size / 1024);
    console.log(`  ${basename(megaFile.file)}  (${megaFile.sessions} sessions, ${sizeKb}KB)`);
    const written = splitFile(megaFile.file, outputDir, dryRun);
    allWritten.push(...written);

    if (!dryRun && written.length > 0) {
      const backup = join(parse(megaFile.file).dir, `${parse(megaFile.file).name}.mega_backup`);
      renameSync(megaFile.file, backup);
      console.log(`  → Original renamed to ${basename(backup)}\n`);
    } else {
      console.log("");
    }
  }

  console.log(`${"─".repeat(60)}`);
  if (dryRun) {
    console.log(`  DRY RUN — would create ${allWritten.length} files from ${megaFiles.length} mega-files`);
  } else {
    console.log(`  Done — created ${allWritten.length} files from ${megaFiles.length} mega-files`);
  }
  console.log("");

  return allWritten;
}
