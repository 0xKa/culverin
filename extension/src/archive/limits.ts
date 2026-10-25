const MIB = 1024 * 1024;

export const DOWNLOAD_LIMITS = {
  choices: [256 * MIB, 512 * MIB, 1024 * MIB, 2048 * MIB, 4096 * MIB],
  automatic: 256 * MIB,
  fallback: 512 * MIB,
  maximum: 4096 * MIB,
  unpackedRatio: 8,
} as const;

export type JobLimits = { compressed: number; decompressed: number };

export function jobLimits(compressed: number): JobLimits {
  return {
    compressed,
    decompressed: compressed * DOWNLOAD_LIMITS.unpackedRatio,
  };
}

export const ARCHIVE_LIMITS = {
  compressed: DOWNLOAD_LIMITS.automatic,
  decompressed: DOWNLOAD_LIMITS.automatic * DOWNLOAD_LIMITS.unpackedRatio,
  entries: 2_000_000,
  regularFiles: 1_000_000,
  file: 8 * 1024 * 1024,
  pathBytes: 4096,
  pathComponents: 100,
  paxBody: 64 * 1024,
  paxTotal: 2 * 1024 * 1024,
  retainedPaths: 128 * 1024 * 1024,
  chunk: 1024 * 1024,
} as const;

export const validFileCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) &&
  (value as number) >= 0 &&
  (value as number) <= ARCHIVE_LIMITS.regularFiles;

export const ARCHIVE_TIMEOUTS = {
  job: 60 * 60 * 1000,
  queue: 60 * 60 * 1000,
  networkIdle: 30 * 1000,
  workerIdle: 60 * 1000,
  lease: 3 * 1000,
  renew: 500,
} as const;

export type ArchiveLimits = {
  readonly [Key in keyof typeof ARCHIVE_LIMITS]: number;
};
