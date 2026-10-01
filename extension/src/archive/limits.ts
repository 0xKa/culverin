export const ARCHIVE_LIMITS = {
  compressed: 50 * 1024 * 1024,
  decompressed: 250 * 1024 * 1024,
  entries: 50_000,
  regularFiles: 40_000,
  file: 8 * 1024 * 1024,
  wasmBytes: 200 * 1024 * 1024,
  pathBytes: 4096,
  pathComponents: 100,
  paxBody: 64 * 1024,
  paxTotal: 2 * 1024 * 1024,
  retainedPaths: 8 * 1024 * 1024,
  chunk: 64 * 1024,
} as const;
