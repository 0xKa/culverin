import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  analyzeTar,
  ARCHIVE_LIMITS,
  ArchiveError,
  type ArchiveErrorCode,
} from "../../extension/src/archive/tar";

const encoder = new TextEncoder();

function put(
  block: Uint8Array,
  offset: number,
  width: number,
  value: string,
): void {
  const bytes = encoder.encode(value);
  if (bytes.length > width) throw new Error("field overflow");
  block.set(bytes, offset);
}

function octal(
  block: Uint8Array,
  offset: number,
  width: number,
  value: number,
): void {
  put(block, offset, width, value.toString(8).padStart(width - 1, "0") + "\0");
}

function checksum(block: Uint8Array): void {
  block.fill(32, 148, 156);
  const sum = block.subarray(0, 512).reduce((value, byte) => value + byte, 0);
  octal(block, 148, 8, sum);
}

function entry(path: string, body: Uint8Array, type = "0"): Uint8Array {
  const block = new Uint8Array(512);
  put(block, 0, 100, path);
  octal(block, 100, 8, 0o644);
  octal(block, 108, 8, 0);
  octal(block, 116, 8, 0);
  octal(block, 124, 12, body.length);
  octal(block, 136, 12, 0);
  put(block, 156, 1, type);
  put(block, 257, 6, "ustar\0");
  put(block, 263, 2, "00");
  checksum(block);
  return join(block, body, new Uint8Array((512 - (body.length % 512)) % 512));
}

function join(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((size, part) => size + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function archive(...entries: Uint8Array[]): Uint8Array {
  return join(...entries, new Uint8Array(1024));
}

function stream(
  bytes: Uint8Array,
  chunkSize: number,
): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream({
    pull(controller) {
      if (position >= bytes.length) controller.close();
      else {
        controller.enqueue(bytes.subarray(position, position + chunkSize));
        position += chunkSize;
      }
    },
  });
}

function generatedEntries(
  count: number,
  make: (index: number) => Uint8Array,
): ReadableStream<Uint8Array> {
  let position = 0;
  return new ReadableStream({
    pull(controller) {
      if (position < count) controller.enqueue(make(position++));
      else if (position === count) {
        controller.enqueue(new Uint8Array(1024));
        position++;
      } else controller.close();
    },
  });
}

function sink() {
  const counted: string[] = [];
  const skipped: string[] = [];
  return {
    counted,
    skipped,
    classify(path: string) {
      return path.endsWith(".rs") ? "counted" : "unsupported_language";
    },
    addFile(path: string) {
      counted.push(path);
    },
    skipFile(path: string, _prefix: Uint8Array, reason: string) {
      skipped.push(`${path}:${reason}`);
    },
  };
}

async function rejects(
  bytes: Uint8Array,
  code: ArchiveErrorCode,
): Promise<void> {
  try {
    await analyzeTar(stream(bytes, 1), sink());
    throw new Error("expected rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(ArchiveError);
    expect((error as ArchiveError).code).toBe(code);
  }
}

function pax(key: string, value: string): Uint8Array {
  const payload = `${key}=${value}\n`;
  let length = payload.length + 3;
  while (`${length} ${payload}`.length !== length)
    length = `${length} ${payload}`.length;
  return encoder.encode(`${length} ${payload}`);
}

describe("incremental tar parser", () => {
  test("counts regular files and metadata across one-byte chunks", async () => {
    const bytes = archive(
      entry("repo/", new Uint8Array(0), "5"),
      entry("repo/src/main.rs", encoder.encode("fn main() {}\n")),
      entry("repo/README", encoder.encode("text")),
    );
    const target = sink();
    const metrics = await analyzeTar(stream(bytes, 1), target);
    expect(target.counted).toEqual(["src/main.rs"]);
    expect(target.skipped).toEqual(["README:unsupported_language"]);
    expect(metrics.decompressedBytes).toBe(bytes.length);
    expect(metrics.regularFiles).toBe(2);
    expect(metrics.specialEntries).toBe(1);
  });

  test("accepts a real GitHub tarball", async () => {
    const compressed = readFileSync("tests/fixtures/github-hello-world.tar.gz");
    const decompressed = stream(compressed, 7).pipeThrough(
      new DecompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );
    const target = sink();
    const metrics = await analyzeTar(decompressed, target);
    expect(metrics.regularFiles).toBe(1);
    expect(target.skipped).toEqual(["README:unsupported_language"]);
  });

  test("stops a gzip bomb at the decompressed limit", async () => {
    const compressed = readFileSync("tests/fixtures/gzip-bomb.tar.gz");
    const decompressed = stream(compressed, 8192).pipeThrough(
      new DecompressionStream("gzip") as unknown as ReadableWritablePair<
        Uint8Array,
        Uint8Array
      >,
    );
    try {
      await analyzeTar(decompressed, sink());
      throw new Error("expected decompressed limit");
    } catch (error) {
      expect((error as ArchiveError).code).toBe("decompressed_limit_exceeded");
      expect((error as ArchiveError).limit).toBe("decompressed");
    }
  });

  test("applies local PAX path once", async () => {
    const bytes = archive(
      entry("repo/", new Uint8Array(0), "5"),
      entry("PaxHeader", pax("path", "repo/long.rs"), "x"),
      entry("repo/short", encoder.encode("x")),
      entry("repo/next.rs", encoder.encode("y")),
    );
    const target = sink();
    const metrics = await analyzeTar(stream(bytes, 17), target);
    expect(target.counted).toEqual(["long.rs", "next.rs"]);
    expect(metrics.entries).toBe(4);
  });

  test("applies global and local PAX precedence and empty deletion", async () => {
    const bytes = archive(
      entry("repo/", new Uint8Array(0), "5"),
      entry("Global", pax("path", "repo/global.rs"), "g"),
      entry("Local", pax("path", ""), "x"),
      entry("repo/header.rs", encoder.encode("x")),
      entry("Local", pax("path", "repo/local.rs"), "x"),
      entry("repo/header2", encoder.encode("y")),
    );
    const target = sink();
    await analyzeTar(stream(bytes, 37), target);
    expect(target.counted).toEqual(["header.rs", "local.rs"]);
  });

  test("uses an effective PAX size and supports positive base-256", async () => {
    const altered = entry("repo/pax.rs", encoder.encode("abc"));
    altered.fill(0, 124, 136);
    octal(altered, 124, 12, 1);
    checksum(altered);
    const base256 = entry("repo/base.rs", encoder.encode("z"));
    base256.fill(0, 124, 136);
    base256[124] = 0x80;
    base256[135] = 1;
    checksum(base256);
    const target = sink();
    await analyzeTar(
      stream(
        archive(entry("Local", pax("size", "3"), "x"), altered, base256),
        19,
      ),
      target,
    );
    expect(target.counted).toEqual(["pax.rs", "base.rs"]);
  });

  test("rejects traversal, duplicate normalization, and wrapper changes", async () => {
    await rejects(
      archive(entry("repo/../escape.rs", encoder.encode("x"))),
      "archive_invalid",
    );
    await rejects(
      archive(
        entry("repo/a/./b.rs", encoder.encode("x")),
        entry("repo/a/b.rs", encoder.encode("y")),
      ),
      "archive_invalid",
    );
    await rejects(
      archive(
        entry("repo/a.rs", encoder.encode("x")),
        entry("other/b.rs", encoder.encode("y")),
      ),
      "archive_invalid",
    );
    for (const path of [
      "/repo/a.rs",
      "C:/repo/a.rs",
      "repo/a\\b.rs",
      "//repo/a.rs",
      "repo/../../a.rs",
    ]) {
      await rejects(
        archive(
          entry("PaxHeader", pax("path", path), "x"),
          entry("repo/a.rs", encoder.encode("x")),
        ),
        "archive_invalid",
      );
    }
    await rejects(
      archive(
        entry("PaxHeader", pax("path", `repo/${"a/".repeat(101)}x.rs`), "x"),
        entry("repo/a.rs", encoder.encode("x")),
      ),
      "archive_invalid",
    );
  });

  test("rejects checksum, padding, truncation, and missing EOF", async () => {
    const valid = archive(entry("repo/a.rs", encoder.encode("x")));
    const corrupt = valid.slice();
    corrupt[0] = corrupt[0]! ^ 1;
    await rejects(corrupt, "archive_invalid");
    const padded = valid.slice();
    padded[513] = 1;
    await rejects(padded, "archive_invalid");
    await rejects(valid.subarray(0, 512), "archive_invalid");
    await rejects(valid.subarray(0, valid.length - 512), "archive_invalid");
    const hiddenName = valid.slice();
    hiddenName[20] = 0;
    hiddenName[21] = 65;
    checksum(hiddenName);
    await rejects(hiddenName, "archive_invalid");
    const hiddenSize = valid.slice();
    hiddenSize[130] = 0;
    hiddenSize[131] = 49;
    checksum(hiddenSize);
    await rejects(hiddenSize, "archive_invalid");
  });

  test("rejects unknown and oversized PAX metadata", async () => {
    await rejects(
      archive(entry("PaxHeader", pax("GNU.sparse.map", "0,1"), "x")),
      "archive_unsupported",
    );
    await rejects(
      archive(
        entry("PaxHeader", new Uint8Array(ARCHIVE_LIMITS.paxBody + 1), "x"),
      ),
      "metadata_limit_exceeded",
    );
    await rejects(
      archive(
        entry(
          "PaxHeader",
          join(pax("path", "repo/a.rs"), pax("path", "repo/b.rs")),
          "x",
        ),
      ),
      "archive_invalid",
    );
    await rejects(
      archive(
        ...Array.from({ length: 33 }, () =>
          entry("Global", pax("comment", "x".repeat(65_500)), "g"),
        ),
      ),
      "metadata_limit_exceeded",
    );
  });

  test("rejects a countable file after the buffered size limit", async () => {
    const target = sink();
    const bytes = archive(
      entry("repo/big.rs", new Uint8Array(ARCHIVE_LIMITS.file + 1)),
    );
    const metrics = await analyzeTar(stream(bytes, 8192), target);
    expect(metrics.wasmBytes).toBe(0);
    expect(target.skipped).toEqual(["big.rs:oversized_source"]);
  });

  test("enforces the regular-file count while streaming", async () => {
    const input = generatedEntries(ARCHIVE_LIMITS.regularFiles + 1, (index) =>
      entry(`repo/${index}.rs`, new Uint8Array(0)),
    );
    try {
      await analyzeTar(input, {
        classify: () => "counted",
        addFile: () => undefined,
        skipFile: () => undefined,
      });
      throw new Error("expected file limit");
    } catch (error) {
      expect((error as ArchiveError).code).toBe("file_limit_exceeded");
      expect((error as ArchiveError).limit).toBe("regularFiles");
    }
  });

  test("bounds retained names before inserting many long paths", async () => {
    const input = generatedEntries(40_000, (index) => {
      const block = entry(
        `${index.toString().padStart(5, "0")}${"x".repeat(90)}`,
        new Uint8Array(0),
        "5",
      );
      put(block, 345, 155, `repo/${"p".repeat(149)}`);
      checksum(block);
      return block;
    });
    try {
      await analyzeTar(input, sink());
      throw new Error("expected retained-path limit");
    } catch (error) {
      expect((error as ArchiveError).code).toBe("metadata_limit_exceeded");
      expect((error as ArchiveError).limit).toBe("retainedPaths");
    }
  });
});
