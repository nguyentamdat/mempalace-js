type MemoryType = "decision" | "preference" | "milestone" | "problem" | "emotional";
type Sentiment = "positive" | "negative" | "neutral";

export type ExtractedMemory = {
  content: string;
  memory_type: MemoryType;
  chunk_index: number;
};

const DECISION_MARKERS = [
  String.raw`\blet'?s (use|go with|try|pick|choose|switch to)\b`,
  String.raw`\bwe (should|decided|chose|went with|picked|settled on)\b`,
  String.raw`\bi'?m going (to|with)\b`,
  String.raw`\bbetter (to|than|approach|option|choice)\b`,
  String.raw`\binstead of\b`,
  String.raw`\brather than\b`,
  String.raw`\bthe reason (is|was|being)\b`,
  String.raw`\bbecause\b`,
  String.raw`\btrade-?off\b`,
  String.raw`\bpros and cons\b`,
  String.raw`\bover\b.*\bbecause\b`,
  String.raw`\barchitecture\b`,
  String.raw`\bapproach\b`,
  String.raw`\bstrategy\b`,
  String.raw`\bpattern\b`,
  String.raw`\bstack\b`,
  String.raw`\bframework\b`,
  String.raw`\binfrastructure\b`,
  String.raw`\bset (it |this )?to\b`,
  String.raw`\bconfigure\b`,
  String.raw`\bdefault\b`,
] as const;

const PREFERENCE_MARKERS = [
  String.raw`\bi prefer\b`,
  String.raw`\balways use\b`,
  String.raw`\bnever use\b`,
  String.raw`\bdon'?t (ever |like to )?(use|do|mock|stub|import)\b`,
  String.raw`\bi like (to|when|how)\b`,
  String.raw`\bi hate (when|how|it when)\b`,
  String.raw`\bplease (always|never|don'?t)\b`,
  String.raw`\bmy (rule|preference|style|convention) is\b`,
  String.raw`\bwe (always|never)\b`,
  String.raw`\bfunctional\b.*\bstyle\b`,
  String.raw`\bimperative\b`,
  String.raw`\bsnake_?case\b`,
  String.raw`\bcamel_?case\b`,
  String.raw`\btabs\b.*\bspaces\b`,
  String.raw`\bspaces\b.*\btabs\b`,
  String.raw`\buse\b.*\binstead of\b`,
] as const;

const MILESTONE_MARKERS = [
  String.raw`\bit works\b`,
  String.raw`\bit worked\b`,
  String.raw`\bgot it working\b`,
  String.raw`\bfixed\b`,
  String.raw`\bsolved\b`,
  String.raw`\bbreakthrough\b`,
  String.raw`\bfigured (it )?out\b`,
  String.raw`\bnailed it\b`,
  String.raw`\bcracked (it|the)\b`,
  String.raw`\bfinally\b`,
  String.raw`\bfirst time\b`,
  String.raw`\bfirst ever\b`,
  String.raw`\bnever (done|been|had) before\b`,
  String.raw`\bdiscovered\b`,
  String.raw`\brealized\b`,
  String.raw`\bfound (out|that)\b`,
  String.raw`\bturns out\b`,
  String.raw`\bthe key (is|was|insight)\b`,
  String.raw`\bthe trick (is|was)\b`,
  String.raw`\bnow i (understand|see|get it)\b`,
  String.raw`\bbuilt\b`,
  String.raw`\bcreated\b`,
  String.raw`\bimplemented\b`,
  String.raw`\bshipped\b`,
  String.raw`\blaunched\b`,
  String.raw`\bdeployed\b`,
  String.raw`\breleased\b`,
  String.raw`\bprototype\b`,
  String.raw`\bproof of concept\b`,
  String.raw`\bdemo\b`,
  String.raw`\bversion \d`,
  String.raw`\bv\d+\.\d+`,
  String.raw`\d+x (compression|faster|slower|better|improvement|reduction)`,
  String.raw`\d+% (reduction|improvement|faster|better|smaller)`,
] as const;

const PROBLEM_MARKERS = [
  String.raw`\b(bug|error|crash|fail|broke|broken|issue|problem)\b`,
  String.raw`\bdoesn'?t work\b`,
  String.raw`\bnot working\b`,
  String.raw`\bwon'?t\b.*\bwork\b`,
  String.raw`\bkeeps? (failing|crashing|breaking|erroring)\b`,
  String.raw`\broot cause\b`,
  String.raw`\bthe (problem|issue|bug) (is|was)\b`,
  String.raw`\bturns out\b.*\b(was|because|due to)\b`,
  String.raw`\bthe fix (is|was)\b`,
  String.raw`\bworkaround\b`,
  String.raw`\bthat'?s why\b`,
  String.raw`\bthe reason it\b`,
  String.raw`\bfixed (it |the |by )\b`,
  String.raw`\bsolution (is|was)\b`,
  String.raw`\bresolved\b`,
  String.raw`\bpatched\b`,
  String.raw`\bthe answer (is|was)\b`,
  String.raw`\b(had|need) to\b.*\binstead\b`,
] as const;

const EMOTION_MARKERS = [
  String.raw`\blove\b`,
  String.raw`\bscared\b`,
  String.raw`\bafraid\b`,
  String.raw`\bproud\b`,
  String.raw`\bhurt\b`,
  String.raw`\bhappy\b`,
  String.raw`\bsad\b`,
  String.raw`\bcry\b`,
  String.raw`\bcrying\b`,
  String.raw`\bmiss\b`,
  String.raw`\bsorry\b`,
  String.raw`\bgrateful\b`,
  String.raw`\bangry\b`,
  String.raw`\bworried\b`,
  String.raw`\blonely\b`,
  String.raw`\bbeautiful\b`,
  String.raw`\bamazing\b`,
  String.raw`\bwonderful\b`,
  "i feel",
  "i'm scared",
  "i love you",
  "i'm sorry",
  "i can't",
  "i wish",
  "i miss",
  "i need",
  "never told anyone",
  "nobody knows",
  String.raw`\*[^*]+\*`,
] as const;

const ALL_MARKERS: Record<MemoryType, readonly string[]> = {
  decision: DECISION_MARKERS,
  preference: PREFERENCE_MARKERS,
  milestone: MILESTONE_MARKERS,
  problem: PROBLEM_MARKERS,
  emotional: EMOTION_MARKERS,
};

const POSITIVE_WORDS = new Set([
  "pride",
  "proud",
  "joy",
  "happy",
  "love",
  "loving",
  "beautiful",
  "amazing",
  "wonderful",
  "incredible",
  "fantastic",
  "brilliant",
  "perfect",
  "excited",
  "thrilled",
  "grateful",
  "warm",
  "breakthrough",
  "success",
  "works",
  "working",
  "solved",
  "fixed",
  "nailed",
  "heart",
  "hug",
  "precious",
  "adore",
]);

const NEGATIVE_WORDS = new Set([
  "bug",
  "error",
  "crash",
  "crashing",
  "crashed",
  "fail",
  "failed",
  "failing",
  "failure",
  "broken",
  "broke",
  "breaking",
  "breaks",
  "issue",
  "problem",
  "wrong",
  "stuck",
  "blocked",
  "unable",
  "impossible",
  "missing",
  "terrible",
  "horrible",
  "awful",
  "worse",
  "worst",
  "panic",
  "disaster",
  "mess",
]);

const _CODE_LINE_PATTERNS = [
  /^\s*[$#]\s/,
  /^\s*(cd|source|echo|export|pip|npm|git|python|bash|curl|wget|mkdir|rm|cp|mv|ls|cat|grep|find|chmod|sudo|brew|docker)\s/,
  /^\s*```/,
  /^\s*(import|from|def|class|function|const|let|var|return)\s/,
  /^\s*[A-Z_]{2,}=/,
  /^\s*\|/,
  /^\s*[-]{2,}/,
  /^\s*(?:[{}]|[\[\]])\s*$/,
  /^\s*(if|for|while|try|except|elif|else:)\b/,
  /^\s*\w+\.\w+\(/,
  /^\s*\w+ = \w+\.\w+/,
] as const;

function _getSentiment(text: string): Sentiment {
  const words = new Set((text.toLowerCase().match(/\b\w+\b/g) ?? []));
  let pos = 0;
  let neg = 0;

  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) pos += 1;
    if (NEGATIVE_WORDS.has(word)) neg += 1;
  }

  if (pos > neg) {
    return "positive";
  }

  if (neg > pos) {
    return "negative";
  }

  return "neutral";
}

function _hasResolution(text: string): boolean {
  const textLower = text.toLowerCase();
  const patterns = [
    String.raw`\bfixed\b`,
    String.raw`\bsolved\b`,
    String.raw`\bresolved\b`,
    String.raw`\bpatched\b`,
    String.raw`\bgot it working\b`,
    String.raw`\bit works\b`,
    String.raw`\bnailed it\b`,
    String.raw`\bfigured (it )?out\b`,
    String.raw`\bthe (fix|answer|solution)\b`,
  ] as const;

  return patterns.some((pattern) => new RegExp(pattern).test(textLower));
}

function _disambiguate(memoryType: MemoryType, text: string, scores: Partial<Record<MemoryType, number>>): MemoryType {
  const sentiment = _getSentiment(text);

  if (memoryType === "problem" && _hasResolution(text)) {
    if ((scores.emotional ?? 0) > 0 && sentiment === "positive") {
      return "emotional";
    }

    return "milestone";
  }

  if (memoryType === "problem" && sentiment === "positive") {
    if ((scores.milestone ?? 0) > 0) {
      return "milestone";
    }

    if ((scores.emotional ?? 0) > 0) {
      return "emotional";
    }
  }

  return memoryType;
}

function _isCodeLine(line: string): boolean {
  const stripped = line.trim();
  if (!stripped) {
    return false;
  }

  for (const pattern of _CODE_LINE_PATTERNS) {
    if (pattern.test(stripped)) {
      return true;
    }
  }

  let alphaCount = 0;
  for (const char of stripped) {
    if ((char >= "a" && char <= "z") || (char >= "A" && char <= "Z")) {
      alphaCount += 1;
    }
  }

  const alphaRatio = alphaCount / Math.max(stripped.length, 1);
  if (alphaRatio < 0.4 && stripped.length > 10) {
    return true;
  }

  return false;
}

function _extractProse(text: string): string {
  const lines = text.split("\n");
  const prose: string[] = [];
  let inCode = false;

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      inCode = !inCode;
      continue;
    }

    if (inCode) {
      continue;
    }

    if (!_isCodeLine(line)) {
      prose.push(line);
    }
  }

  const result = prose.join("\n").trim();
  return result || text;
}

function _scoreMarkers(text: string, markers: readonly string[]): [number, string[]] {
  const textLower = text.toLowerCase();
  let score = 0;
  const keywords: string[] = [];

  for (const marker of markers) {
    const regex = new RegExp(marker, "g");
    const matches = Array.from(textLower.matchAll(regex));
    if (matches.length > 0) {
      score += matches.length;
      for (const match of matches) {
        if (match.length > 1 && match[1]) {
          keywords.push(match[1]);
        } else if (match[0]) {
          keywords.push(match[0]);
        } else {
          keywords.push(marker);
        }
      }
    }
  }

  return [score, [...new Set(keywords)]];
}

export function extractMemories(text: string, minConfidence = 0.3): ExtractedMemory[] {
  const paragraphs = _splitIntoSegments(text);
  const memories: ExtractedMemory[] = [];

  for (const para of paragraphs) {
    if (para.trim().length < 20) {
      continue;
    }

    const prose = _extractProse(para);
    const scores: Partial<Record<MemoryType, number>> = {};

    for (const [memoryType, markers] of Object.entries(ALL_MARKERS) as [MemoryType, readonly string[]][]) {
      const [score] = _scoreMarkers(prose, markers);
      if (score > 0) {
        scores[memoryType] = score;
      }
    }

    const scoreEntries = Object.entries(scores) as [MemoryType, number][];
    if (scoreEntries.length === 0) {
      continue;
    }

    let lengthBonus = 0;
    if (para.length > 500) {
      lengthBonus = 2;
    } else if (para.length > 200) {
      lengthBonus = 1;
    }

    let maxType = scoreEntries[0][0];
    let maxBaseScore = scoreEntries[0][1];
    for (const [memoryType, score] of scoreEntries.slice(1)) {
      if (score > maxBaseScore) {
        maxType = memoryType;
        maxBaseScore = score;
      }
    }

    const maxScore = maxBaseScore + lengthBonus;
    maxType = _disambiguate(maxType, prose, scores);

    const confidence = Math.min(1.0, maxScore / 5.0);
    if (confidence < minConfidence) {
      continue;
    }

    memories.push({
      content: para.trim(),
      memory_type: maxType,
      chunk_index: memories.length,
    });
  }

  return memories;
}

function _splitIntoSegments(text: string): string[] {
  const lines = text.split("\n");
  const turnPatterns = [
    /^>\s/,
    /^(Human|User|Q)\s*:/i,
    /^(Assistant|AI|A|Claude|ChatGPT)\s*:/i,
  ] as const;

  let turnCount = 0;
  for (const line of lines) {
    const stripped = line.trim();
    for (const pattern of turnPatterns) {
      if (pattern.test(stripped)) {
        turnCount += 1;
        break;
      }
    }
  }

  if (turnCount >= 3) {
    return _splitByTurns(lines, turnPatterns);
  }

  const paragraphs = text
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  if (paragraphs.length <= 1 && lines.length > 20) {
    const segments: string[] = [];
    for (let index = 0; index < lines.length; index += 25) {
      const group = lines.slice(index, index + 25).join("\n").trim();
      if (group) {
        segments.push(group);
      }
    }
    return segments;
  }

  return paragraphs;
}

function _splitByTurns(lines: string[], turnPatterns: readonly RegExp[]): string[] {
  const segments: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    const stripped = line.trim();
    const isTurn = turnPatterns.some((pattern) => pattern.test(stripped));

    if (isTurn && current.length > 0) {
      segments.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }

  if (current.length > 0) {
    segments.push(current.join("\n"));
  }

  return segments;
}
