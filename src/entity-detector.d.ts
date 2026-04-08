export type EntityDetectionResult = {
  people: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
  uncertain: Array<Record<string, unknown>>;
};

export type ConfirmedEntities = {
  people: Array<Record<string, unknown>>;
  projects: Array<Record<string, unknown>>;
};

export declare function scanForDetection(dir: string): string[];
export declare function detectEntities(files: string[]): EntityDetectionResult;
export declare function confirmEntities(
  detected: EntityDetectionResult,
  autoAccept?: boolean,
): Promise<ConfirmedEntities>;

export declare function extractCandidates(text: string): Record<string, number>;
export declare function scoreEntity(name: string, text: string, lines: string[]): Record<string, number>;
export declare function classifyEntity(
  name: string,
  frequency: number,
  scores: Record<string, number>,
): Record<string, string | number | boolean | null | undefined>;
