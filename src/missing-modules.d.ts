declare module "../entity-detector" {
  export type DetectedEntities = {
    people: unknown[];
    projects: unknown[];
    uncertain: unknown[];
  };

  export function scanForDetection(dir: string): string[];
  export function detectEntities(files: string[]): DetectedEntities;
  export function confirmEntities(
    detected: DetectedEntities,
    yes: boolean,
  ): Promise<DetectedEntities>;
}

declare module "../room-detector" {
  export function detectRoomsLocal(dir: string): Promise<void>;
}

declare module "../convo-miner" {
  export type MineConvosOptions = {
    convoDir: string;
    palacePath: string;
    wing?: string;
    agent?: string;
    limit?: number;
    dryRun?: boolean;
    extractMode: "exchange" | "general";
  };

  export function mineConvos(options: MineConvosOptions): Promise<void>;
}

declare module "../split-mega-files" {
  export type SplitMegaFilesOptions = {
    dir: string;
    outputDir?: string;
    dryRun?: boolean;
    minSessions?: number;
  };

  export function splitMegaFiles(options: SplitMegaFilesOptions): void;
}
