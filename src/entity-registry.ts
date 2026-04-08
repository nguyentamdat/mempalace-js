import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const COMMON_ENGLISH_WORDS = new Set<string>([
  "ever",
  "grace",
  "will",
  "bill",
  "mark",
  "april",
  "may",
  "june",
  "joy",
  "hope",
  "faith",
  "chance",
  "chase",
  "hunter",
  "dash",
  "flash",
  "star",
  "sky",
  "river",
  "brook",
  "lane",
  "art",
  "clay",
  "gil",
  "nat",
  "max",
  "rex",
  "ray",
  "jay",
  "rose",
  "violet",
  "lily",
  "ivy",
  "ash",
  "reed",
  "sage",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

const PERSON_CONTEXT_PATTERNS = [
  String.raw`\b{name}\s+said\b`,
  String.raw`\b{name}\s+told\b`,
  String.raw`\b{name}\s+asked\b`,
  String.raw`\b{name}\s+laughed\b`,
  String.raw`\b{name}\s+smiled\b`,
  String.raw`\b{name}\s+was\b`,
  String.raw`\b{name}\s+is\b`,
  String.raw`\b{name}\s+called\b`,
  String.raw`\b{name}\s+texted\b`,
  String.raw`\bwith\s+{name}\b`,
  String.raw`\bsaw\s+{name}\b`,
  String.raw`\bcalled\s+{name}\b`,
  String.raw`\btook\s+{name}\b`,
  String.raw`\bpicked\s+up\s+{name}\b`,
  String.raw`\bdrop(?:ped)?\s+(?:off\s+)?{name}\b`,
  String.raw`\b{name}(?:'s|s')\b`,
  String.raw`\bhey\s+{name}\b`,
  String.raw`\bthanks?\s+{name}\b`,
  String.raw`^{name}[:\s]`,
  String.raw`\bmy\s+(?:son|daughter|kid|child|brother|sister|friend|partner|colleague|coworker)\s+{name}\b`,
] as const;

const CONCEPT_CONTEXT_PATTERNS = [
  String.raw`\bhave\s+you\s+{name}\b`,
  String.raw`\bif\s+you\s+{name}\b`,
  String.raw`\b{name}\s+since\b`,
  String.raw`\b{name}\s+again\b`,
  String.raw`\bnot\s+{name}\b`,
  String.raw`\b{name}\s+more\b`,
  String.raw`\bwould\s+{name}\b`,
  String.raw`\bcould\s+{name}\b`,
  String.raw`\bwill\s+{name}\b`,
  String.raw`(?:the\s+)?{name}\s+(?:of|in|at|for|to)\b`,
] as const;

const NAME_INDICATOR_PHRASES = [
  "given name",
  "personal name",
  "first name",
  "forename",
  "masculine name",
  "feminine name",
  "boy's name",
  "girl's name",
  "male name",
  "female name",
  "irish name",
  "welsh name",
  "scottish name",
  "gaelic name",
  "hebrew name",
  "arabic name",
  "norse name",
  "old english name",
  "is a name",
  "as a name",
  "name meaning",
  "name derived from",
  "legendary irish",
  "legendary welsh",
  "legendary scottish",
] as const;

const PLACE_INDICATOR_PHRASES = [
  "city in",
  "town in",
  "village in",
  "municipality",
  "capital of",
  "district of",
  "county",
  "province",
  "region of",
  "island of",
  "mountain in",
  "river in",
] as const;

type RegistryEntityType = "person" | "project" | "concept" | "place" | "ambiguous" | "unknown";

interface PersonInfo {
  source: string;
  contexts: string[];
  aliases: string[];
  relationship: string;
  confidence: number;
  canonical?: string;
  seen_count?: number;
}

interface WikiCacheEntry {
  inferred_type: RegistryEntityType;
  confidence: number;
  wiki_summary: string | null;
  wiki_title?: string | null;
  note?: string;
  word?: string;
  confirmed?: boolean;
  confirmed_type?: string;
}

interface RegistryData {
  version: number;
  mode: string;
  people: Record<string, PersonInfo>;
  projects: string[];
  ambiguous_flags: string[];
  wiki_cache: Record<string, WikiCacheEntry>;
}

interface SeedPersonEntry {
  name: string;
  relationship?: string;
  context?: string;
}

interface LookupResult {
  type: RegistryEntityType;
  confidence: number;
  source: string;
  name: string;
  needs_disambiguation: boolean;
  context?: string[];
  disambiguated_by?: string;
}

interface DetectorModule {
  extractCandidates: (text: string) => Record<string, number>;
  scoreEntity: (name: string, text: string, lines: string[]) => Record<string, number>;
  classifyEntity: (name: string, frequency: number, scores: Record<string, number>) => LearnedEntity;
}

interface LearnedEntity {
  type: string;
  confidence: number;
  [key: string]: string | number | boolean | null | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry): entry is string => typeof entry === "string");
}

function toPersonInfo(value: unknown): PersonInfo {
  const record = isRecord(value) ? value : {};
  const result: PersonInfo = {
    source: readString(record.source),
    contexts: readStringArray(record.contexts),
    aliases: readStringArray(record.aliases),
    relationship: readString(record.relationship),
    confidence: readNumber(record.confidence),
  };

  const canonical = readString(record.canonical);
  if (canonical) {
    result.canonical = canonical;
  }

  if (typeof record.seen_count === "number" && Number.isFinite(record.seen_count)) {
    result.seen_count = record.seen_count;
  }

  return result;
}

function toWikiCacheEntry(value: unknown): WikiCacheEntry {
  const record = isRecord(value) ? value : {};
  const inferredType = readString(record.inferred_type, "unknown");
  const result: WikiCacheEntry = {
    inferred_type: isRegistryEntityType(inferredType) ? inferredType : "unknown",
    confidence: readNumber(record.confidence),
    wiki_summary: typeof record.wiki_summary === "string" ? record.wiki_summary : null,
  };

  if (typeof record.wiki_title === "string" || record.wiki_title === null) {
    result.wiki_title = record.wiki_title;
  }
  if (typeof record.note === "string") {
    result.note = record.note;
  }
  if (typeof record.word === "string") {
    result.word = record.word;
  }
  if (typeof record.confirmed === "boolean") {
    result.confirmed = record.confirmed;
  }
  if (typeof record.confirmed_type === "string") {
    result.confirmed_type = record.confirmed_type;
  }

  return result;
}

function normalizeRegistryData(value: unknown): RegistryData {
  const record = isRecord(value) ? value : {};
  const peopleRecord = isRecord(record.people) ? record.people : {};
  const wikiCacheRecord = isRecord(record.wiki_cache) ? record.wiki_cache : {};

  const people: Record<string, PersonInfo> = {};
  for (const [key, entry] of Object.entries(peopleRecord)) {
    people[key] = toPersonInfo(entry);
  }

  const wikiCache: Record<string, WikiCacheEntry> = {};
  for (const [key, entry] of Object.entries(wikiCacheRecord)) {
    wikiCache[key] = toWikiCacheEntry(entry);
  }

  return {
    version: readNumber(record.version, 1),
    mode: readString(record.mode, "personal"),
    people,
    projects: readStringArray(record.projects),
    ambiguous_flags: readStringArray(record.ambiguous_flags),
    wiki_cache: wikiCache,
  };
}

function isRegistryEntityType(value: string): value is RegistryEntityType {
  return ["person", "project", "concept", "place", "ambiguous", "unknown"].includes(value);
}

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function truncateSummary(value: string): string {
  return value.slice(0, 200);
}

function extractDetectorModule(value: unknown): DetectorModule {
  if (!isRecord(value)) {
    throw new Error("entity-detector module did not load correctly");
  }

  const extractCandidates = value.extractCandidates ?? value.extract_candidates;
  const scoreEntity = value.scoreEntity ?? value.score_entity;
  const classifyEntity = value.classifyEntity ?? value.classify_entity;

  if (
    typeof extractCandidates !== "function" ||
    typeof scoreEntity !== "function" ||
    typeof classifyEntity !== "function"
  ) {
    throw new Error("entity-detector module is missing required exports");
  }

  return {
    extractCandidates: (text: string) => {
      const result = extractCandidates(text);
      if (!isRecord(result)) {
        throw new Error("entity-detector extractCandidates() returned invalid data");
      }

      const normalized: Record<string, number> = {};
      for (const [key, entry] of Object.entries(result)) {
        if (typeof entry === "number" && Number.isFinite(entry)) {
          normalized[key] = entry;
        }
      }
      return normalized;
    },
    scoreEntity: (name: string, text: string, lines: string[]) => {
      const result = scoreEntity(name, text, lines);
      if (!isRecord(result)) {
        throw new Error("entity-detector scoreEntity() returned invalid data");
      }

      const normalized: Record<string, number> = {};
      for (const [key, entry] of Object.entries(result)) {
        if (typeof entry === "number" && Number.isFinite(entry)) {
          normalized[key] = entry;
        }
      }
      return normalized;
    },
    classifyEntity: (name: string, frequency: number, scores: Record<string, number>) => {
      const result = classifyEntity(name, frequency, scores);
      if (!isRecord(result)) {
        throw new Error("entity-detector classifyEntity() returned invalid data");
      }

      const learnedEntity: LearnedEntity = {
        type: readString(result.type),
        confidence: readNumber(result.confidence),
      };

      for (const [key, entry] of Object.entries(result)) {
        if (key === "type" || key === "confidence") {
          continue;
        }
        if (
          typeof entry === "string" ||
          typeof entry === "number" ||
          typeof entry === "boolean" ||
          entry === null ||
          typeof entry === "undefined"
        ) {
          learnedEntity[key] = entry;
        }
      }

      return learnedEntity;
    },
  };
}

async function _wikipediaLookup(word: string): Promise<WikiCacheEntry> {
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(word)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "MemPalace/1.0",
      },
    });

    if (response.status === 404) {
      return {
        inferred_type: "person",
        confidence: 0.7,
        wiki_summary: null,
        wiki_title: null,
        note: "not found in Wikipedia — likely a proper noun or unusual name",
      };
    }

    if (!response.ok) {
      return { inferred_type: "unknown", confidence: 0, wiki_summary: null };
    }

    const payload: unknown = await response.json();
    const data = isRecord(payload) ? payload : {};
    const pageType = readString(data.type);
    const extract = readString(data.extract).toLowerCase();
    const title = readString(data.title, word);

    if (pageType === "disambiguation") {
      const description = readString(data.description).toLowerCase();
      if (["name", "given name"].some((phrase) => description.includes(phrase))) {
        return {
          inferred_type: "person",
          confidence: 0.65,
          wiki_summary: truncateSummary(extract),
          wiki_title: title,
          note: "disambiguation page with name entries",
        };
      }

      return {
        inferred_type: "ambiguous",
        confidence: 0.4,
        wiki_summary: truncateSummary(extract),
        wiki_title: title,
      };
    }

    if (NAME_INDICATOR_PHRASES.some((phrase) => extract.includes(phrase))) {
      const lowerWord = word.toLowerCase();
      const confidence =
        extract.includes(`${lowerWord} is a`) || extract.includes(`${lowerWord} (name`)
          ? 0.9
          : 0.8;

      return {
        inferred_type: "person",
        confidence,
        wiki_summary: truncateSummary(extract),
        wiki_title: title,
      };
    }

    if (PLACE_INDICATOR_PHRASES.some((phrase) => extract.includes(phrase))) {
      return {
        inferred_type: "place",
        confidence: 0.8,
        wiki_summary: truncateSummary(extract),
        wiki_title: title,
      };
    }

    return {
      inferred_type: "concept",
      confidence: 0.6,
      wiki_summary: truncateSummary(extract),
      wiki_title: title,
    };
  } catch {
    return { inferred_type: "unknown", confidence: 0, wiki_summary: null };
  }
}

export class EntityRegistry {
  static readonly DEFAULT_PATH = join(homedir(), ".mempalace", "entity_registry.json");

  private readonly data: RegistryData;
  private readonly filePath: string;

  constructor(data: RegistryData, filePath: string) {
    this.data = data;
    this.filePath = filePath;
  }

  static load(configDir?: string): EntityRegistry {
    const filePath = configDir ? join(configDir, "entity_registry.json") : EntityRegistry.DEFAULT_PATH;
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
        return new EntityRegistry(normalizeRegistryData(data), filePath);
      } catch {}
    }

    return new EntityRegistry(EntityRegistry.empty(), filePath);
  }

  save(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  private static empty(): RegistryData {
    return {
      version: 1,
      mode: "personal",
      people: {},
      projects: [],
      ambiguous_flags: [],
      wiki_cache: {},
    };
  }

  get mode(): string {
    return this.data.mode;
  }

  get people(): Record<string, PersonInfo> {
    return this.data.people;
  }

  get projects(): string[] {
    return this.data.projects;
  }

  get ambiguousFlags(): string[] {
    return this.data.ambiguous_flags;
  }

  seed(mode: string, people: SeedPersonEntry[], projects: string[], aliases: Record<string, string> = {}): void {
    this.data.mode = mode;
    this.data.projects = [...projects];

    const reverseAliases: Record<string, string> = {};
    for (const [alias, canonical] of Object.entries(aliases)) {
      reverseAliases[canonical] = alias;
    }

    for (const entry of people) {
      const name = entry.name.trim();
      if (!name) {
        continue;
      }

      const context = entry.context ?? "personal";
      const relationship = entry.relationship ?? "";

      this.data.people[name] = {
        source: "onboarding",
        contexts: [context],
        aliases: name in reverseAliases ? [reverseAliases[name]] : [],
        relationship,
        confidence: 1,
      };

      if (name in reverseAliases) {
        const alias = reverseAliases[name];
        this.data.people[alias] = {
          source: "onboarding",
          contexts: [context],
          aliases: [name],
          relationship,
          confidence: 1,
          canonical: name,
        };
      }
    }

    const ambiguous: string[] = [];
    for (const name of Object.keys(this.data.people)) {
      const lower = name.toLowerCase();
      if (COMMON_ENGLISH_WORDS.has(lower)) {
        ambiguous.push(lower);
      }
    }
    this.data.ambiguous_flags = ambiguous;

    this.save();
  }

  lookup(word: string, context = ""): LookupResult {
    for (const [canonical, info] of Object.entries(this.people)) {
      const aliases = info.aliases.map((alias) => alias.toLowerCase());
      if (word.toLowerCase() === canonical.toLowerCase() || aliases.includes(word.toLowerCase())) {
        if (this.ambiguousFlags.includes(word.toLowerCase()) && context) {
          const resolved = this._disambiguate(word, context, info);
          if (resolved !== null) {
            return resolved;
          }
        }

        return {
          type: "person",
          confidence: info.confidence,
          source: info.source,
          name: canonical,
          context: info.contexts.length > 0 ? info.contexts : ["personal"],
          needs_disambiguation: false,
        };
      }
    }

    for (const project of this.projects) {
      if (word.toLowerCase() === project.toLowerCase()) {
        return {
          type: "project",
          confidence: 1,
          source: "onboarding",
          name: project,
          needs_disambiguation: false,
        };
      }
    }

    for (const [cachedWord, cachedResult] of Object.entries(this.data.wiki_cache)) {
      if (word.toLowerCase() === cachedWord.toLowerCase() && cachedResult.confirmed) {
        return {
          type: cachedResult.inferred_type,
          confidence: cachedResult.confidence,
          source: "wiki",
          name: word,
          needs_disambiguation: false,
        };
      }
    }

    return {
      type: "unknown",
      confidence: 0,
      source: "none",
      name: word,
      needs_disambiguation: false,
    };
  }

  private _disambiguate(word: string, context: string, personInfo: PersonInfo): LookupResult | null {
    const nameLower = word.toLowerCase();
    const contextLower = context.toLowerCase();
    const escapedName = regexEscape(nameLower);

    let personScore = 0;
    for (const pattern of PERSON_CONTEXT_PATTERNS) {
      if (new RegExp(pattern.replaceAll("{name}", escapedName)).test(contextLower)) {
        personScore += 1;
      }
    }

    let conceptScore = 0;
    for (const pattern of CONCEPT_CONTEXT_PATTERNS) {
      if (new RegExp(pattern.replaceAll("{name}", escapedName)).test(contextLower)) {
        conceptScore += 1;
      }
    }

    if (personScore > conceptScore) {
      return {
        type: "person",
        confidence: Math.min(0.95, 0.7 + personScore * 0.1),
        source: personInfo.source,
        name: word,
        context: personInfo.contexts.length > 0 ? personInfo.contexts : ["personal"],
        needs_disambiguation: false,
        disambiguated_by: "context_patterns",
      };
    }

    if (conceptScore > personScore) {
      return {
        type: "concept",
        confidence: Math.min(0.9, 0.7 + conceptScore * 0.1),
        source: "context_disambiguated",
        name: word,
        needs_disambiguation: false,
        disambiguated_by: "context_patterns",
      };
    }

    return null;
  }

  async research(word: string, autoConfirm = false): Promise<WikiCacheEntry> {
    if (word in this.data.wiki_cache) {
      return this.data.wiki_cache[word];
    }

    const result = await _wikipediaLookup(word);
    result.word = word;
    result.confirmed = autoConfirm;

    this.data.wiki_cache[word] = result;
    this.save();
    return result;
  }

  confirmResearch(word: string, entityType: string, relationship = "", context = "personal"): void {
    const cache = this.data.wiki_cache;
    if (word in cache) {
      cache[word].confirmed = true;
      cache[word].confirmed_type = entityType;
    }

    if (entityType === "person") {
      this.data.people[word] = {
        source: "wiki",
        contexts: [context],
        aliases: [],
        relationship,
        confidence: 0.9,
      };

      if (COMMON_ENGLISH_WORDS.has(word.toLowerCase())) {
        if (!this.data.ambiguous_flags.includes(word.toLowerCase())) {
          this.data.ambiguous_flags.push(word.toLowerCase());
        }
      }
    }

    this.save();
  }

  async learnFromText(text: string, minConfidence = 0.75): Promise<LearnedEntity[]> {
    const modulePath = "./entity-detector";
    const detectorModule = extractDetectorModule(await import(modulePath));

    const lines = text.split(/\r?\n/);
    const candidates = detectorModule.extractCandidates(text);
    const newCandidates: LearnedEntity[] = [];

    for (const [name, frequency] of Object.entries(candidates)) {
      if (name in this.people || this.projects.includes(name)) {
        continue;
      }

      const scores = detectorModule.scoreEntity(name, text, lines);
      const entity = detectorModule.classifyEntity(name, frequency, scores);

      if (entity.type === "person" && entity.confidence >= minConfidence) {
        this.data.people[name] = {
          source: "learned",
          contexts: [this.mode !== "combo" ? this.mode : "personal"],
          aliases: [],
          relationship: "",
          confidence: entity.confidence,
          seen_count: frequency,
        };

        if (COMMON_ENGLISH_WORDS.has(name.toLowerCase()) && !this.data.ambiguous_flags.includes(name.toLowerCase())) {
          this.data.ambiguous_flags.push(name.toLowerCase());
        }

        newCandidates.push(entity);
      }
    }

    if (newCandidates.length > 0) {
      this.save();
    }

    return newCandidates;
  }

  extractPeopleFromQuery(query: string): string[] {
    const found: string[] = [];

    for (const [canonical, info] of Object.entries(this.people)) {
      const namesToCheck = [canonical, ...info.aliases];
      for (const name of namesToCheck) {
        if (new RegExp(`\\b${regexEscape(name)}\\b`, "i").test(query)) {
          if (this.ambiguousFlags.includes(name.toLowerCase())) {
            const result = this._disambiguate(name, query, info);
            if (result && result.type === "person" && !found.includes(canonical)) {
              found.push(canonical);
            }
          } else if (!found.includes(canonical)) {
            found.push(canonical);
          }
        }
      }
    }

    return found;
  }

  extractUnknownCandidates(query: string): string[] {
    const candidates = query.match(/\b[A-Z][a-z]{2,15}\b/g) ?? [];
    const unknown: string[] = [];

    for (const word of new Set(candidates)) {
      if (COMMON_ENGLISH_WORDS.has(word.toLowerCase())) {
        continue;
      }

      const result = this.lookup(word);
      if (result.type === "unknown") {
        unknown.push(word);
      }
    }

    return unknown;
  }

  summary(): string {
    const peopleNames = Object.keys(this.people);
    const visiblePeople = peopleNames.slice(0, 8).join(", ");
    const suffix = peopleNames.length > 8 ? "..." : "";

    return [
      `Mode: ${this.mode}`,
      `People: ${peopleNames.length} (${visiblePeople}${suffix})`,
      `Projects: ${this.projects.join(", ") || "(none)"}`,
      `Ambiguous flags: ${this.ambiguousFlags.join(", ") || "(none)"}`,
      `Wiki cache: ${Object.keys(this.data.wiki_cache).length} entries`,
    ].join("\n");
  }
}
