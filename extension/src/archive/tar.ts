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

export type ArchiveErrorCode =
  | "compressed_limit_exceeded"
  | "decompressed_limit_exceeded"
  | "entry_limit_exceeded"
  | "file_limit_exceeded"
  | "metadata_limit_exceeded"
  | "archive_invalid"
  | "archive_unsupported"
  | "analysis_canceled"
  | "analysis_timeout"
  | "analysis_interrupted"
  | "analysis_busy"
  | "counter_failed";

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    readonly limit?: keyof typeof ARCHIVE_LIMITS,
  ) {
    super(code);
  }
}

export type ArchiveMetrics = {
  decompressedBytes: number;
  entries: number;
  regularFiles: number;
  specialEntries: number;
  wasmBytes: number;
  retainedPathBytes: number;
};

export type ArchiveSink = {
  classify(path: string, prefix: Uint8Array): Promise<string> | string;
  addFile(path: string, bytes: Uint8Array): Promise<void> | void;
  skipFile(
    path: string,
    prefix: Uint8Array,
    reason: string,
  ): Promise<void> | void;
};

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();
const metadataKeys = new Set([
  "mtime",
  "atime",
  "ctime",
  "uid",
  "gid",
  "uname",
  "gname",
  "comment",
  "charset",
  "SCHILY.dev",
  "SCHILY.ino",
  "LIBARCHIVE.creationtime",
]);
const effectiveKeys = new Set(["path", "linkpath", "size"]);

function invalid(): never {
  throw new ArchiveError("archive_invalid");
}

function decode(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    return invalid();
  }
}

function field(block: Uint8Array, start: number, length: number): Uint8Array {
  const bytes = block.subarray(start, start + length);
  const end = bytes.indexOf(0);
  if (end >= 0 && bytes.subarray(end + 1).some((byte) => byte !== 0))
    return invalid();
  return end < 0 ? bytes : bytes.subarray(0, end);
}

function numberField(bytes: Uint8Array): number {
  if (bytes.length === 0) return 0;
  if (bytes[0]! & 0x80) {
    if (bytes[0]! & 0x40) return invalid();
    let value = bytes[0]! & 0x3f;
    for (let i = 1; i < bytes.length; i++) {
      value = value * 256 + bytes[i]!;
      if (!Number.isSafeInteger(value)) return invalid();
    }
    return value;
  }
  const raw = decode(bytes);
  const end = raw.indexOf("\0");
  if (end >= 0 && !/^[\0 ]*$/.test(raw.slice(end))) return invalid();
  const value = (end >= 0 ? raw.slice(0, end) : raw).trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) return invalid();
  const parsed = Number.parseInt(value, 8);
  return Number.isSafeInteger(parsed) ? parsed : invalid();
}

function header(block: Uint8Array): {
  path: string;
  linkpath: string;
  size: number;
  type: string;
} {
  const expected = numberField(block.subarray(148, 156));
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i]!;
  if (sum !== expected) return invalid();
  const magic = decode(field(block, 257, 6));
  if (magic !== "ustar") throw new ArchiveError("archive_unsupported");
  const name = decode(field(block, 0, 100));
  const prefix = decode(field(block, 345, 155));
  return {
    path: prefix ? `${prefix}/${name}` : name,
    linkpath: decode(field(block, 157, 100)),
    size: numberField(block.subarray(124, 136)),
    type: String.fromCharCode(block[156] || 48),
  };
}

function parsePax(body: Uint8Array): Map<string, string> {
  const values = new Map<string, string>();
  let position = 0;
  while (position < body.length) {
    const space = body.indexOf(32, position);
    if (space < 0 || space - position > 10) return invalid();
    const decimal = decode(body.subarray(position, space));
    if (!/^[1-9][0-9]*$/.test(decimal)) return invalid();
    const length = Number(decimal);
    if (
      !Number.isSafeInteger(length) ||
      length < space - position + 4 ||
      position + length > body.length
    )
      return invalid();
    const end = position + length;
    if (body[end - 1] !== 10) return invalid();
    const equals = body.indexOf(61, space + 1);
    if (equals < 0 || equals >= end - 1) return invalid();
    const key = decode(body.subarray(space + 1, equals));
    if (!effectiveKeys.has(key) && !metadataKeys.has(key))
      throw new ArchiveError("archive_unsupported");
    if (values.has(key)) return invalid();
    values.set(key, decode(body.subarray(equals + 1, end - 1)));
    position = end;
  }
  return values;
}

function normalizedPath(value: string): string {
  if (
    !value ||
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value) ||
    encoder.encode(value).length > ARCHIVE_LIMITS.pathBytes
  )
    return invalid();
  const raw = value.split("/");
  if (raw.includes("..")) return invalid();
  const parts = raw.filter((part) => part && part !== ".");
  if (parts.length === 0 || parts.length > ARCHIVE_LIMITS.pathComponents)
    return invalid();
  const path = parts.join("/");
  if (encoder.encode(path).length > ARCHIVE_LIMITS.pathBytes) return invalid();
  return path;
}

class ByteReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private chunk: Uint8Array = new Uint8Array(0);
  private offset = 0;
  bytes = 0;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  async fill(): Promise<boolean> {
    while (this.offset === this.chunk.length) {
      const { value, done } = await this.reader.read();
      if (done) return false;
      if (!(value instanceof Uint8Array)) return invalid();
      this.bytes += value.byteLength;
      if (this.bytes > ARCHIVE_LIMITS.decompressed)
        throw new ArchiveError("decompressed_limit_exceeded", "decompressed");
      if (value.byteLength > 1024 * 1024)
        throw new ArchiveError("metadata_limit_exceeded", "chunk");
      this.chunk = value;
      this.offset = 0;
    }
    return true;
  }

  async take(target: Uint8Array): Promise<void> {
    let position = 0;
    while (position < target.length) {
      if (!(await this.fill())) return invalid();
      const count = Math.min(
        target.length - position,
        this.chunk.length - this.offset,
      );
      target.set(
        this.chunk.subarray(this.offset, this.offset + count),
        position,
      );
      this.offset += count;
      position += count;
    }
  }

  async discard(length: number, zero = false): Promise<void> {
    while (length > 0) {
      if (!(await this.fill())) return invalid();
      const count = Math.min(length, this.chunk.length - this.offset);
      if (zero)
        for (let i = this.offset; i < this.offset + count; i++)
          if (this.chunk[i] !== 0) return invalid();
      this.offset += count;
      length -= count;
    }
  }

  async endZeros(): Promise<void> {
    while (await this.fill()) {
      const length = this.chunk.length - this.offset;
      await this.discard(length, true);
    }
  }

  async cancel(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
    this.reader.releaseLock();
  }
}

export async function analyzeTar(
  stream: ReadableStream<Uint8Array>,
  sink: ArchiveSink,
  signal?: AbortSignal,
): Promise<ArchiveMetrics> {
  const input = new ByteReader(stream);
  const metrics: ArchiveMetrics = {
    decompressedBytes: 0,
    entries: 0,
    regularFiles: 0,
    specialEntries: 0,
    wasmBytes: 0,
    retainedPathBytes: 0,
  };
  const seen = new Set<string>();
  const global = new Map<string, string>();
  let local: Map<string, string> | undefined;
  let wrapper: string | undefined;
  let zeroBlocks = 0;
  let paxBytes = 0;
  try {
    for (;;) {
      if (signal?.aborted) throw new ArchiveError("analysis_canceled");
      const block = new Uint8Array(512);
      await input.take(block);
      if (block.every((byte) => byte === 0)) {
        zeroBlocks++;
        if (zeroBlocks === 2) {
          await input.endZeros();
          if (local || !wrapper) return invalid();
          break;
        }
        continue;
      }
      if (zeroBlocks) return invalid();
      metrics.entries++;
      if (metrics.entries > ARCHIVE_LIMITS.entries)
        throw new ArchiveError("entry_limit_exceeded", "entries");
      const raw = header(block);
      const padding = (512 - (raw.size % 512)) % 512;
      if (raw.type === "x" || raw.type === "g") {
        if (raw.size > ARCHIVE_LIMITS.paxBody)
          throw new ArchiveError("metadata_limit_exceeded", "paxBody");
        paxBytes += raw.size;
        if (paxBytes > ARCHIVE_LIMITS.paxTotal)
          throw new ArchiveError("metadata_limit_exceeded", "paxTotal");
        const body = new Uint8Array(raw.size);
        await input.take(body);
        await input.discard(padding, true);
        const parsed = parsePax(body);
        if (raw.type === "g") {
          for (const [key, value] of parsed) {
            if (!effectiveKeys.has(key)) continue;
            if (value === "") global.delete(key);
            else global.set(key, value);
          }
        } else {
          local ??= new Map();
          for (const [key, value] of parsed) {
            if (!effectiveKeys.has(key)) continue;
            if (local.has(key)) return invalid();
            local.set(key, value);
          }
        }
        metrics.specialEntries++;
        continue;
      }
      const selected = (key: string, fallback: string): string => {
        if (local?.has(key)) return local.get(key) || fallback;
        return global.get(key) || fallback;
      };
      const sizeValue = selected("size", String(raw.size));
      if (!/^(0|[1-9][0-9]*)$/.test(sizeValue)) return invalid();
      const effective = {
        ...raw,
        path: selected("path", raw.path),
        linkpath: selected("linkpath", raw.linkpath),
        size: Number(sizeValue),
      };
      if (!Number.isSafeInteger(effective.size)) return invalid();
      local = undefined;
      if (effective.size !== raw.size && raw.type !== "0" && raw.type !== "\0")
        throw new ArchiveError("archive_unsupported");
      const path = normalizedPath(effective.path);
      const first = path.split("/", 1)[0]!;
      wrapper ??= first;
      if (first !== wrapper) return invalid();
      const logical = path === wrapper ? "" : path.slice(wrapper.length + 1);
      const isDirectory = raw.type === "5";
      if (!logical && !isDirectory) return invalid();
      if (logical) {
        const bytes = encoder.encode(logical).length;
        if (metrics.retainedPathBytes + bytes > ARCHIVE_LIMITS.retainedPaths)
          throw new ArchiveError("metadata_limit_exceeded", "retainedPaths");
        if (seen.has(logical)) return invalid();
        seen.add(logical);
        metrics.retainedPathBytes += bytes;
      }
      const size = effective.size;
      const bodyPadding = (512 - (size % 512)) % 512;
      if (raw.type === "0" || raw.type === "\0") {
        metrics.regularFiles++;
        if (metrics.regularFiles > ARCHIVE_LIMITS.regularFiles)
          throw new ArchiveError("file_limit_exceeded", "regularFiles");
        const prefix = new Uint8Array(Math.min(size, 128));
        await input.take(prefix);
        const classification = await sink.classify(logical, prefix);
        if (
          ![
            "counted",
            "excluded_by_rule",
            "unsupported_language",
            "binary_content",
          ].includes(classification)
        )
          throw new ArchiveError("counter_failed");
        if (classification !== "counted" || size > ARCHIVE_LIMITS.file) {
          await input.discard(size - prefix.length);
          await sink.skipFile(
            logical,
            prefix,
            classification === "counted" ? "oversized_source" : classification,
          );
        } else {
          if (metrics.wasmBytes + size > ARCHIVE_LIMITS.wasmBytes)
            throw new ArchiveError("file_limit_exceeded", "wasmBytes");
          const body = new Uint8Array(size);
          body.set(prefix);
          await input.take(body.subarray(prefix.length));
          await sink.addFile(logical, body);
          metrics.wasmBytes += size;
        }
      } else {
        metrics.specialEntries++;
        if (!["5", "1", "2", "3", "4", "6", "7"].includes(raw.type))
          throw new ArchiveError("archive_unsupported");
        if (raw.type === "1" || raw.type === "2")
          normalizedPath(effective.linkpath);
        await input.discard(size);
      }
      await input.discard(bodyPadding, true);
    }
    metrics.decompressedBytes = input.bytes;
    return metrics;
  } catch (error) {
    await input.cancel();
    throw error;
  }
}
