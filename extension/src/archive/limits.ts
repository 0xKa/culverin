export const ARCHIVE_LIMITS = {
  compressed: 256 * 1024 * 1024,
  decompressed: 2 * 1024 * 1024 * 1024,
  entries: 250_000,
  regularFiles: 200_000,
  file: 8 * 1024 * 1024,
  wasmBytes: 1024 * 1024 * 1024,
  pathBytes: 4096,
  pathComponents: 100,
  paxBody: 64 * 1024,
  paxTotal: 2 * 1024 * 1024,
  retainedPaths: 32 * 1024 * 1024,
  chunk: 64 * 1024,
} as const;

export const ARCHIVE_TIMEOUTS = {
  job: 5 * 60 * 1000,
  queue: 5 * 60 * 1000,
  networkIdle: 30 * 1000,
  workerIdle: 60 * 1000,
  lease: 3 * 1000,
  renew: 500,
} as const;

export type ArchiveLimits = {
  readonly [Key in keyof typeof ARCHIVE_LIMITS]: number;
};
