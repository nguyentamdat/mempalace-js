import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";

export type EntityMap = Record<string, string>;
export type StringListMap = Record<string, string[]>;
export type HeaderMap = Record<string, string>;

export interface DialectConfig {
  entities?: EntityMap;
  skip_names?: string[];
}

export interface CompressMetadata {
  source_file?: string;
  wing?: string;
  room?: string;
  date?: string;
  [key: string]: unknown;
}

export interface Zettel {
  id: string;
  people?: string[];
  topics?: string[];
  emotional_weight?: number;
  emotional_tone?: string[];
  origin_moment?: boolean;
  sensitivity?: string;
  notes?: string;
  origin_label?: string;
  content?: string;
  title?: string;
  date_context?: string;
  [key: string]: unknown;
}

export interface Tunnel {
  from: string;
  to: string;
  label?: string;
  [key: string]: unknown;
}

export interface ZettelJsonFile {
  source_file?: string;
  emotional_arc?: string;
  zettels?: Zettel[];
  tunnels?: Tunnel[];
  [key: string]: unknown;
}

export interface DecodedDialect {
  header: HeaderMap;
  arc: string;
  zettels: string[];
  tunnels: string[];
}

export interface CompressionStats {
  originalTokens: number;
  compressedTokens: number;
  ratio: number;
  originalChars: number;
  compressedChars: number;
}

export const EMOTION_CODES: Record<string, string> = {
  vulnerability: "vul",
  vulnerable: "vul",
  joy: "joy",
  joyful: "joy",
  fear: "fear",
  mild_fear: "fear",
  trust: "trust",
  trust_building: "trust",
  grief: "grief",
  raw_grief: "grief",
  wonder: "wonder",
  philosophical_wonder: "wonder",
  rage: "rage",
  anger: "rage",
  love: "love",
  devotion: "love",
  hope: "hope",
  despair: "despair",
  hopelessness: "despair",
  peace: "peace",
  relief: "relief",
  humor: "humor",
  dark_humor: "humor",
  tenderness: "tender",
  raw_honesty: "raw",
  brutal_honesty: "raw",
  self_doubt: "doubt",
  anxiety: "anx",
  exhaustion: "exhaust",
  conviction: "convict",
  quiet_passion: "passion",
  warmth: "warmth",
  curiosity: "curious",
  gratitude: "grat",
  frustration: "frust",
  confusion: "confuse",
  satisfaction: "satis",
  excitement: "excite",
  determination: "determ",
  surprise: "surprise",
};

export const _EMOTION_SIGNALS: Record<string, string> = {
  decided: "determ",
  prefer: "convict",
  worried: "anx",
  excited: "excite",
  frustrated: "frust",
  confused: "confuse",
  love: "love",
  hate: "rage",
  hope: "hope",
  fear: "fear",
  trust: "trust",
  happy: "joy",
  sad: "grief",
  surprised: "surprise",
  grateful: "grat",
  curious: "curious",
  wonder: "wonder",
  anxious: "anx",
  relieved: "relief",
  satisf: "satis",
  disappoint: "grief",
  concern: "anx",
};

export const _FLAG_SIGNALS: Record<string, string> = {
  decided: "DECISION",
  chose: "DECISION",
  switched: "DECISION",
  migrated: "DECISION",
  replaced: "DECISION",
  "instead of": "DECISION",
  because: "DECISION",
  founded: "ORIGIN",
  created: "ORIGIN",
  started: "ORIGIN",
  born: "ORIGIN",
  launched: "ORIGIN",
  "first time": "ORIGIN",
  core: "CORE",
  fundamental: "CORE",
  essential: "CORE",
  principle: "CORE",
  belief: "CORE",
  always: "CORE",
  "never forget": "CORE",
  "turning point": "PIVOT",
  "changed everything": "PIVOT",
  realized: "PIVOT",
  breakthrough: "PIVOT",
  epiphany: "PIVOT",
  api: "TECHNICAL",
  database: "TECHNICAL",
  architecture: "TECHNICAL",
  deploy: "TECHNICAL",
  infrastructure: "TECHNICAL",
  algorithm: "TECHNICAL",
  framework: "TECHNICAL",
  server: "TECHNICAL",
  config: "TECHNICAL",
};

export const _STOP_WORDS = new Set<string>([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could", "should",
  "may", "might", "shall", "can", "to", "of", "in", "for", "on", "with", "at",
  "by", "from", "as", "into", "about", "between", "through", "during", "before",
  "after", "above", "below", "up", "down", "out", "off", "over", "under", "again",
  "further", "then", "once", "here", "there", "when", "where", "why", "how", "all",
  "each", "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very", "just", "don",
  "now", "and", "but", "or", "if", "while", "that", "this", "these", "those", "it",
  "its", "i", "we", "you", "he", "she", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "our", "their", "what", "which", "who", "whom", "also", "much",
  "many", "like", "because", "since", "get", "got", "use", "used", "using", "make",
  "made", "thing", "things", "way", "well", "really", "want", "need",
]);

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstPart(value: string, separator: string): string {
  return value.split(separator)[0] ?? "";
}

function getRequiredArg(args: string[], index: number): string {
  const value = args[index];
  if (value == null) {
    usage();
  }
  return value;
}

export class Dialect {
  private entityCodes: Record<string, string>;

  private skipNames: string[];

  constructor(entities?: EntityMap | null, skipNames?: string[] | null) {
    this.entityCodes = {};
    if (entities) {
      for (const [name, code] of Object.entries(entities)) {
        this.entityCodes[name] = code;
        this.entityCodes[name.toLowerCase()] = code;
      }
    }
    this.skipNames = (skipNames ?? []).map((name) => name.toLowerCase());
  }

  static fromConfig(configPath: string): Dialect {
    const config = readJson<DialectConfig>(configPath);
    return new Dialect(config.entities ?? {}, config.skip_names ?? []);
  }

  saveConfig(configPath: string): void {
    const canonical: Record<string, string> = {};
    const seenCodes = new Set<string>();

    for (const [name, code] of Object.entries(this.entityCodes)) {
      if (!seenCodes.has(code) && name !== name.toLowerCase()) {
        canonical[name] = code;
        seenCodes.add(code);
      } else if (!seenCodes.has(code)) {
        canonical[name] = code;
        seenCodes.add(code);
      }
    }

    const config: DialectConfig = {
      entities: canonical,
      skip_names: this.skipNames,
    };

    writeFileSync(configPath, JSON.stringify(config, null, 2));
  }

  encodeEntity(name: string): string | null {
    if (this.skipNames.some((skip) => name.toLowerCase().includes(skip))) {
      return null;
    }
    if (name in this.entityCodes) {
      return this.entityCodes[name] ?? null;
    }
    if (name.toLowerCase() in this.entityCodes) {
      return this.entityCodes[name.toLowerCase()] ?? null;
    }
    for (const [key, code] of Object.entries(this.entityCodes)) {
      if (name.toLowerCase().includes(key.toLowerCase())) {
        return code;
      }
    }
    return name.slice(0, 3).toUpperCase();
  }

  encodeEmotions(emotions: string[]): string {
    const codes: string[] = [];
    for (const emotion of emotions) {
      const code = EMOTION_CODES[emotion] ?? emotion.slice(0, 4);
      if (!codes.includes(code)) {
        codes.push(code);
      }
    }
    return codes.slice(0, 3).join("+");
  }

  getFlags(zettel: Partial<Zettel>): string {
    const flags: string[] = [];
    if (zettel.origin_moment) {
      flags.push("ORIGIN");
    }
    if ((zettel.sensitivity ?? "").toUpperCase().startsWith("MAXIMUM")) {
      flags.push("SENSITIVE");
    }
    const notes = (zettel.notes ?? "").toLowerCase();
    if (notes.includes("foundational pillar") || notes.includes("core")) {
      flags.push("CORE");
    }
    if (notes.includes("genesis") || (zettel.origin_label ?? "").toLowerCase().includes("genesis")) {
      flags.push("GENESIS");
    }
    if (notes.includes("pivot")) {
      flags.push("PIVOT");
    }
    return flags.length > 0 ? flags.join("+") : "";
  }

  private detectEmotions(text: string): string[] {
    const textLower = text.toLowerCase();
    const detected: string[] = [];
    const seen = new Set<string>();
    for (const [keyword, code] of Object.entries(_EMOTION_SIGNALS)) {
      if (textLower.includes(keyword) && !seen.has(code)) {
        detected.push(code);
        seen.add(code);
      }
    }
    return detected.slice(0, 3);
  }

  private detectFlags(text: string): string[] {
    const textLower = text.toLowerCase();
    const detected: string[] = [];
    const seen = new Set<string>();
    for (const [keyword, flag] of Object.entries(_FLAG_SIGNALS)) {
      if (textLower.includes(keyword) && !seen.has(flag)) {
        detected.push(flag);
        seen.add(flag);
      }
    }
    return detected.slice(0, 3);
  }

  private extractTopics(text: string, maxTopics = 3): string[] {
    const words = text.match(/[a-zA-Z][a-zA-Z_-]{2,}/g) ?? [];
    const freq: Record<string, number> = {};

    for (const word of words) {
      const lower = word.toLowerCase();
      if (_STOP_WORDS.has(lower) || lower.length < 3) {
        continue;
      }
      freq[lower] = (freq[lower] ?? 0) + 1;
    }

    for (const word of words) {
      const lower = word.toLowerCase();
      if (_STOP_WORDS.has(lower)) {
        continue;
      }
      if (word[0]?.toUpperCase() === word[0] && lower in freq) {
        freq[lower] = (freq[lower] ?? 0) + 2;
      }
      if (word.includes("_") || word.includes("-") || [...word.slice(1)].some((char) => char === char.toUpperCase() && char !== char.toLowerCase())) {
        if (lower in freq) {
          freq[lower] = (freq[lower] ?? 0) + 2;
        }
      }
    }

    const ranked = Object.entries(freq).sort((a, b) => b[1] - a[1]);
    return ranked.slice(0, maxTopics).map(([word]) => word);
  }

  private extractKeySentence(text: string): string {
    const sentences = text
      .split(/[.!?\n]+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 10);

    if (sentences.length === 0) {
      return "";
    }

    const decisionWords = new Set([
      "decided", "because", "instead", "prefer", "switched", "chose", "realized",
      "important", "key", "critical", "discovered", "learned", "conclusion",
      "solution", "reason", "why", "breakthrough", "insight",
    ]);

    const scored = sentences.map((sentence) => {
      let score = 0;
      const lower = sentence.toLowerCase();
      for (const word of decisionWords) {
        if (lower.includes(word)) {
          score += 2;
        }
      }
      if (sentence.length < 80) {
        score += 1;
      }
      if (sentence.length < 40) {
        score += 1;
      }
      if (sentence.length > 150) {
        score -= 2;
      }
      return [score, sentence] as const;
    });

    scored.sort((a, b) => b[0] - a[0]);
    let best = scored[0]?.[1] ?? "";
    if (best.length > 55) {
      best = `${best.slice(0, 52)}...`;
    }
    return best;
  }

  private detectEntitiesInText(text: string): string[] {
    const found: string[] = [];

    for (const [name, code] of Object.entries(this.entityCodes)) {
      if (name !== name.toLowerCase() && text.toLowerCase().includes(name.toLowerCase())) {
        if (!found.includes(code)) {
          found.push(code);
        }
      }
    }
    if (found.length > 0) {
      return found;
    }

    const words = text.split(/\s+/);
    for (let index = 0; index < words.length; index += 1) {
      const word = words[index] ?? "";
      const clean = word.replace(/[^a-zA-Z]/g, "");
      if (
        clean.length >= 2 &&
        clean[0] === clean[0]?.toUpperCase() &&
        clean.slice(1) === clean.slice(1).toLowerCase() &&
        index > 0 &&
        !_STOP_WORDS.has(clean.toLowerCase())
      ) {
        const code = clean.slice(0, 3).toUpperCase();
        if (!found.includes(code)) {
          found.push(code);
        }
        if (found.length >= 3) {
          break;
        }
      }
    }

    return found;
  }

  compress(text: string, metadata: CompressMetadata = {}): string {
    const entities = this.detectEntitiesInText(text);
    const entityStr = entities.length > 0 ? entities.slice(0, 3).join("+") : "???";

    const topics = this.extractTopics(text);
    const topicStr = topics.length > 0 ? topics.slice(0, 3).join("_") : "misc";

    const quote = this.extractKeySentence(text);
    const quotePart = quote ? `"${quote}"` : "";

    const emotions = this.detectEmotions(text);
    const emotionStr = emotions.length > 0 ? emotions.join("+") : "";

    const flags = this.detectFlags(text);
    const flagStr = flags.length > 0 ? flags.join("+") : "";

    const source = typeof metadata.source_file === "string" ? metadata.source_file : "";
    const wing = typeof metadata.wing === "string" ? metadata.wing : "";
    const room = typeof metadata.room === "string" ? metadata.room : "";
    const date = typeof metadata.date === "string" ? metadata.date : "";

    const lines: string[] = [];

    if (source || wing) {
      const headerParts = [wing || "?", room || "?", date || "?", source ? parse(source).name : "?"];
      lines.push(headerParts.join("|"));
    }

    const parts = [`0:${entityStr}`, topicStr];
    if (quotePart) {
      parts.push(quotePart);
    }
    if (emotionStr) {
      parts.push(emotionStr);
    }
    if (flagStr) {
      parts.push(flagStr);
    }

    lines.push(parts.join("|"));
    return lines.join("\n");
  }

  extractKeyQuote(zettel: Partial<Zettel>): string {
    const content = zettel.content ?? "";
    const origin = zettel.origin_label ?? "";
    const notes = zettel.notes ?? "";
    const title = zettel.title ?? "";
    const allText = `${content} ${origin} ${notes}`;

    let quotes: string[] = [];
    quotes.push(...Array.from(allText.matchAll(/"([^"]{8,55})"/g), (match) => match[1] ?? ""));
    quotes.push(...Array.from(allText.matchAll(/(?:^|[\s(])'([^']{8,55})'(?:[\s.,;:!?)]|$)/g), (match) => match[1] ?? ""));
    quotes.push(
      ...Array.from(
        allText.matchAll(/(?:says?|said|articulates?|reveals?|admits?|confesses?|asks?):\s*["']?([^.!?]{10,55})[.!?]/gi),
        (match) => match[1] ?? "",
      ),
    );

    if (quotes.length > 0) {
      const seen = new Set<string>();
      const unique: string[] = [];
      for (const quote of quotes) {
        const trimmed = quote.trim();
        if (!seen.has(trimmed) && trimmed.length >= 8) {
          seen.add(trimmed);
          unique.push(trimmed);
        }
      }
      quotes = unique;

      const emotionalWords = new Set([
        "love", "fear", "remember", "soul", "feel", "stupid", "scared", "beautiful",
        "destroy", "respect", "trust", "consciousness", "alive", "forget", "waiting",
        "peace", "matter", "real", "guilt", "escape", "rest", "hope", "dream", "lost", "found",
      ]);

      const scored = quotes.map((quote) => {
        let score = 0;
        if (quote[0] === quote[0]?.toUpperCase() || quote.startsWith("I ")) {
          score += 2;
        }
        let matches = 0;
        for (const word of emotionalWords) {
          if (quote.toLowerCase().includes(word)) {
            matches += 1;
          }
        }
        score += matches * 2;
        if (quote.length > 20) {
          score += 1;
        }
        if (quote.startsWith("The ") || quote.startsWith("This ") || quote.startsWith("She ")) {
          score -= 2;
        }
        return [score, quote] as const;
      });

      scored.sort((a, b) => b[0] - a[0]);
      if (scored.length > 0) {
        return scored[0]?.[1] ?? "";
      }
    }

    if (title.includes(" - ")) {
      return title.split(" - ", 2)[1]?.slice(0, 45) ?? "";
    }
    return "";
  }

  encodeZettel(zettel: Zettel): string {
    const zid = zettel.id.split("-").at(-1) ?? zettel.id;

    let entityCodes = (zettel.people ?? []).map((person) => this.encodeEntity(person)).filter((code): code is string => code !== null);
    if (entityCodes.length === 0) {
      entityCodes = ["???"];
    }
    const entities = [...new Set(entityCodes)].sort().join("+");

    const topics = zettel.topics ?? [];
    const topicStr = topics.length > 0 ? topics.slice(0, 2).join("_") : "misc";

    const quote = this.extractKeyQuote(zettel);
    const quotePart = quote ? `"${quote}"` : "";

    const weight = zettel.emotional_weight ?? 0.5;
    const emotions = this.encodeEmotions(zettel.emotional_tone ?? []);
    const flags = this.getFlags(zettel);

    const parts = [`${zid}:${entities}`, topicStr];
    if (quotePart) {
      parts.push(quotePart);
    }
    parts.push(String(weight));
    if (emotions) {
      parts.push(emotions);
    }
    if (flags) {
      parts.push(flags);
    }

    return parts.join("|");
  }

  encodeTunnel(tunnel: Tunnel): string {
    const fromId = tunnel.from.split("-").at(-1) ?? tunnel.from;
    const toId = tunnel.to.split("-").at(-1) ?? tunnel.to;
    const label = tunnel.label ?? "";
    const shortLabel = label.includes(":") ? firstPart(label, ":") : label.slice(0, 30);
    return `T:${fromId}<->${toId}|${shortLabel}`;
  }

  encodeFile(zettelJson: ZettelJsonFile): string {
    const lines: string[] = [];

    const source = zettelJson.source_file ?? "unknown";
    const fileNum = source.includes("-") ? firstPart(source, "-") : "000";
    const date = zettelJson.zettels?.[0]?.date_context ?? "unknown";

    const allPeople = new Set<string>();
    for (const zettel of zettelJson.zettels ?? []) {
      for (const person of zettel.people ?? []) {
        const code = this.encodeEntity(person);
        if (code !== null) {
          allPeople.add(code);
        }
      }
    }
    if (allPeople.size === 0) {
      allPeople.add("???");
    }
    const primary = [...allPeople].sort().slice(0, 3).join("+");

    const title = source.includes("-") ? source.replace(".txt", "").split(/-(.+)/, 2)[1]?.trim() ?? source : source;
    lines.push(`${fileNum}|${primary}|${date}|${title}`);

    const arc = zettelJson.emotional_arc ?? "";
    if (arc) {
      lines.push(`ARC:${arc}`);
    }

    for (const zettel of zettelJson.zettels ?? []) {
      lines.push(this.encodeZettel(zettel));
    }

    for (const tunnel of zettelJson.tunnels ?? []) {
      lines.push(this.encodeTunnel(tunnel));
    }

    return lines.join("\n");
  }

  compressFile(zettelJsonPath: string, outputPath?: string): string {
    const data = readJson<ZettelJsonFile>(zettelJsonPath);
    const dialect = this.encodeFile(data);
    if (outputPath) {
      writeFileSync(outputPath, dialect);
    }
    return dialect;
  }

  compressAll(zettelDir: string, outputPath?: string): string {
    const allDialect: string[] = [];
    for (const fname of [...readdirSync(zettelDir)].sort()) {
      if (fname.endsWith(".json")) {
        const fpath = join(zettelDir, fname);
        const data = readJson<ZettelJsonFile>(fpath);
        const dialect = this.encodeFile(data);
        allDialect.push(dialect);
        allDialect.push("---");
      }
    }
    const combined = allDialect.join("\n");
    if (outputPath) {
      writeFileSync(outputPath, combined);
    }
    return combined;
  }

  generateLayer1(
    zettelDir: string,
    outputPath?: string,
    identitySections?: StringListMap,
    weightThreshold = 0.85,
  ): string {
    const essential: Array<[Zettel, string, string]> = [];

    for (const fname of [...readdirSync(zettelDir)].sort()) {
      if (!fname.endsWith(".json")) {
        continue;
      }
      const fpath = join(zettelDir, fname);
      const data = readJson<ZettelJsonFile>(fpath);

      const fileNum = fname.replace("file_", "").replace(".json", "");
      const sourceDate = data.zettels?.[0]?.date_context ?? "unknown";

      for (const zettel of data.zettels ?? []) {
        const weight = zettel.emotional_weight ?? 0;
        const isOrigin = zettel.origin_moment ?? false;
        const flags = this.getFlags(zettel);
        const hasKeyFlag = flags ? ["ORIGIN", "CORE", "GENESIS"].some((flag) => flags.includes(flag)) : false;

        if (weight >= weightThreshold || isOrigin || hasKeyFlag) {
          essential.push([zettel, fileNum, sourceDate]);
        }
      }
    }

    const allTunnels: Tunnel[] = [];
    for (const fname of [...readdirSync(zettelDir)].sort()) {
      if (!fname.endsWith(".json")) {
        continue;
      }
      const fpath = join(zettelDir, fname);
      const data = readJson<ZettelJsonFile>(fpath);
      for (const tunnel of data.tunnels ?? []) {
        allTunnels.push(tunnel);
      }
    }

    essential.sort((a, b) => (b[0].emotional_weight ?? 0) - (a[0].emotional_weight ?? 0));

    const byDate: Record<string, Array<[Zettel, string]>> = {};
    for (const [zettel, fileNum, sourceDate] of essential) {
      const key = sourceDate.split(",")[0]?.trim() ?? sourceDate;
      byDate[key] ??= [];
      byDate[key].push([zettel, fileNum]);
    }

    const lines: string[] = [];
    lines.push("## LAYER 1 -- ESSENTIAL STORY");
    lines.push(`## Auto-generated from zettel files. Updated ${todayIsoDate()}.`);
    lines.push("");

    if (identitySections) {
      for (const [sectionName, sectionLines] of Object.entries(identitySections)) {
        lines.push(`=${sectionName}=`);
        lines.push(...sectionLines);
        lines.push("");
      }
    }

    for (const dateKey of Object.keys(byDate).sort()) {
      lines.push(`=MOMENTS[${dateKey}]=`);
      for (const [zettel] of byDate[dateKey] ?? []) {
        let entities: string[] = [];
        for (const person of zettel.people ?? []) {
          const code = this.encodeEntity(person);
          if (code) {
            entities.push(code);
          }
        }
        if (entities.length === 0) {
          entities = ["???"];
        }
        const entStr = [...new Set(entities)].sort().join("+");

        const quote = this.extractKeyQuote(zettel);
        const weight = zettel.emotional_weight ?? 0.5;
        const flags = this.getFlags(zettel);
        const sensitivity = zettel.sensitivity ?? "";

        const parts = [entStr];
        const title = zettel.title ?? "";
        const hint = title.includes(" - ") ? title.split(" - ", 2)[1]?.slice(0, 30) ?? "" : (zettel.topics ?? []).slice(0, 2).join("_");
        if (hint) {
          parts.push(hint);
        }
        if (quote && quote !== hint && quote !== title && quote !== hint) {
          parts.push(`"${quote}"`);
        }
        if (sensitivity && !flags.includes("SENSITIVE")) {
          parts.push("SENSITIVE");
        }
        parts.push(String(weight));
        if (flags) {
          parts.push(flags);
        }

        lines.push(parts.join("|"));
      }
      lines.push("");
    }

    if (allTunnels.length > 0) {
      lines.push("=TUNNELS=");
      for (const tunnel of allTunnels.slice(0, 8)) {
        const label = tunnel.label ?? "";
        const short = label.includes(":") ? firstPart(label, ":") : label.slice(0, 40);
        lines.push(short);
      }
      lines.push("");
    }

    const result = lines.join("\n");
    if (outputPath) {
      writeFileSync(outputPath, result);
    }
    return result;
  }

  decode(dialectText: string): DecodedDialect {
    const lines = dialectText.trim().split("\n");
    const result: DecodedDialect = { header: {}, arc: "", zettels: [], tunnels: [] };

    for (const line of lines) {
      if (line.startsWith("ARC:")) {
        result.arc = line.slice(4);
      } else if (line.startsWith("T:")) {
        result.tunnels.push(line);
      } else if (line.includes("|") && line.split("|", 1)[0]?.includes(":")) {
        result.zettels.push(line);
      } else if (line.includes("|")) {
        const parts = line.split("|");
        result.header = {
          file: parts[0] ?? "",
          entities: parts[1] ?? "",
          date: parts[2] ?? "",
          title: parts[3] ?? "",
        };
      }
    }

    return result;
  }

  static countTokens(text: string): number {
    return Math.floor(text.length / 3);
  }

  compressionStats(originalText: string, compressed: string): CompressionStats {
    const originalTokens = Dialect.countTokens(originalText);
    const compressedTokens = Dialect.countTokens(compressed);
    return {
      originalTokens,
      compressedTokens,
      ratio: originalTokens / Math.max(compressedTokens, 1),
      originalChars: originalText.length,
      compressedChars: compressed.length,
    };
  }
}

function usage(): never {
  console.log("AAAK Dialect -- Compressed Symbolic Memory for Any LLM");
  console.log();
  console.log("Usage:");
  console.log("  bun src/dialect.ts <text>                         # Compress text from argument");
  console.log("  bun src/dialect.ts --file <zettel.json>           # Compress zettel JSON file");
  console.log("  bun src/dialect.ts --all <zettel_dir>             # Compress all zettel files");
  console.log("  bun src/dialect.ts --stats <zettel.json>          # Show compression stats");
  console.log("  bun src/dialect.ts --layer1 <zettel_dir>          # Generate Layer 1 wake-up file");
  console.log("  bun src/dialect.ts --init                         # Create example config");
  console.log();
  console.log("Options:");
  console.log("  --config <path>   Load entity mappings from JSON config");
  process.exit(1);
}

export function runDialectCli(argv: string[] = process.argv.slice(2)): void {
  if (argv.length < 1) {
    usage();
  }

  let configPath: string | null = null;
  let args = [...argv];
  if (args.includes("--config")) {
    const idx = args.indexOf("--config");
    configPath = args[idx + 1] ?? null;
    args = [...args.slice(0, idx), ...args.slice(idx + 2)];
  }

  const dialect = configPath ? Dialect.fromConfig(configPath) : new Dialect();

  if (args[0] === "--init") {
    const example: DialectConfig = {
      entities: {
        Alice: "ALC",
        Bob: "BOB",
        "Dr. Chen": "CHN",
      },
      skip_names: [],
    };
    const outPath = "entities.json";
    writeFileSync(outPath, JSON.stringify(example, null, 2));
    console.log(`Created example config: ${outPath}`);
    console.log("Edit this file with your own entity mappings, then use --config entities.json");
  } else if (args[0] === "--file") {
    const result = dialect.compressFile(getRequiredArg(args, 1));
    const tokens = Dialect.countTokens(result);
    console.log(`~${tokens} tokens`);
    console.log();
    console.log(result);
  } else if (args[0] === "--all") {
    const zettelDir = args[1] ?? ".";
    const output = join(zettelDir, "COMPRESSED_MEMORY.aaak");
    const result = dialect.compressAll(zettelDir, output);
    const tokens = Dialect.countTokens(result);
    console.log(`Compressed to: ${output}`);
    console.log(`Total: ~${tokens} tokens`);
    console.log();
    console.log(result);
  } else if (args[0] === "--stats") {
    const data = readJson<ZettelJsonFile>(getRequiredArg(args, 1));
    const jsonStr = JSON.stringify(data, null, 2);
    const encoded = dialect.encodeFile(data);
    const stats = dialect.compressionStats(jsonStr, encoded);
    console.log("=== COMPRESSION STATS ===");
    console.log(`JSON:     ~${stats.originalTokens.toLocaleString()} tokens`);
    console.log(`AAAK:     ~${stats.compressedTokens.toLocaleString()} tokens`);
    console.log(`Ratio:    ${stats.ratio.toFixed(0)}x`);
    console.log();
    console.log("=== AAAK DIALECT OUTPUT ===");
    console.log(encoded);
  } else if (args[0] === "--layer1") {
    const zettelDir = args[1] ?? ".";
    const output = join(zettelDir, "LAYER1.aaak");
    const result = dialect.generateLayer1(zettelDir, output);
    const tokens = Dialect.countTokens(result);
    console.log(`Layer 1: ${output}`);
    console.log(`Total: ~${tokens} tokens`);
    console.log();
    console.log(result);
  } else {
    const text = args.join(" ");
    const compressed = dialect.compress(text);
    const stats = dialect.compressionStats(text, compressed);
    console.log(`Original: ~${stats.originalTokens} tokens (${stats.originalChars} chars)`);
    console.log(`AAAK:     ~${stats.compressedTokens} tokens (${stats.compressedChars} chars)`);
    console.log(`Ratio:    ${stats.ratio.toFixed(1)}x`);
    console.log();
    console.log(compressed);
  }
}

export default Dialect;

if (import.meta.main) {
  runDialectCli();
}
