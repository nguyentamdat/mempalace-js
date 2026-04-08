export type SplitMegaFilesOptions = {
  dir: string;
  outputDir?: string;
  dryRun?: boolean;
  minSessions: number;
};

export declare function splitMegaFiles(options: SplitMegaFilesOptions): void;
