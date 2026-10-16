import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  ARCHIVE_LIMITS,
  type ArchiveLimits,
} from "../extension/src/archive/limits";
import { analyzeTar, ArchiveError } from "../extension/src/archive/tar";
import { defaultIgnore } from "../extension/src/counter/rules";
import init, {
  Analyzer,
} from "../extension/src/wasm/instance/culverin_counter.js";

const mib = 1024 * 1024;
const wasmPath = "extension/src/wasm/instance/culverin_counter_bg.wasm";
const defaults = [
  "odoo/odoo",
  "gcc-mirror/gcc",
  "nodejs/node",
  "tensorflow/tensorflow",
  "microsoft/vscode",
  "torvalds/linux",
  "JetBrains/intellij-community",
  "microsoft/winget-pkgs",
  "ClickHouse/ClickHouse",
  "llvm/llvm-project",
  "chromium/chromium",
];

type Tracked =
  "compressed" | "decompressed" | "entries" | "regularFiles" | "retainedPaths";
const thresholds: Record<Tracked, number> = {
  compressed: ARCHIVE_LIMITS.compressed,
  decompressed: ARCHIVE_LIMITS.decompressed,
  entries: ARCHIVE_LIMITS.entries,
  regularFiles: ARCHIVE_LIMITS.regularFiles,
  retainedPaths: ARCHIVE_LIMITS.retainedPaths,
};

function usage(): never {
  console.error(
    "Usage: bun run measure:repos [--stop-after <MiB>] [owner/name[@ref] ...]",
  );
  process.exit(2);
}

function parseArguments(values: string[]): {
  stopAfter: number;
  repositories: { owner: string; name: string; ref: string }[];
} {
  let stopAfter = 4096 * mib;
  const names: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (value === "--stop-after") {
      const next = Number(values[++index]);
      if (!Number.isFinite(next) || next <= 0) usage();
      stopAfter = next * mib;
    } else if (/^[\w.-]+\/[\w.-]+(?:@[^\s]+)?$/.test(value)) names.push(value);
    else usage();
  }
  return {
    stopAfter,
    repositories: (names.length ? names : defaults).map((value) => {
      const [path, ref = "HEAD"] = value.split("@") as [string, string?];
      const [owner, name] = path.split("/") as [string, string];
      return { owner, name, ref };
    }),
  };
}

function format(bytes: number): string {
  return `${(bytes / mib).toLocaleString("en-US", { maximumFractionDigits: 1 })} MiB`;
}

async function measure(
  memory: WebAssembly.Memory,
  repository: { owner: string; name: string; ref: string },
  stopAfter: number,
): Promise<Record<string, unknown>> {
  const label = `${repository.owner}/${repository.name}@${repository.ref}`;
  const started = performance.now();
  const response = await fetch(
    `https://github.com/${repository.owner}/${repository.name}/archive/${encodeURIComponent(repository.ref)}.tar.gz`,
    { redirect: "follow" },
  );
  if (!response.ok || !response.body)
    return {
      repository: label,
      error: `${response.status}: ${(await response.text()).slice(0, 120)}`,
    };
  const crossed: { limit: Tracked; atUnpacked: number }[] = [];
  let unpacked = 0;
  const cross = (limit: Tracked, value: number) => {
    if (
      value > thresholds[limit] &&
      !crossed.some((item) => item.limit === limit)
    )
      crossed.push({ limit, atUnpacked: unpacked });
  };
  let compressed = 0;
  let stopped = false;
  const counting = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      compressed += chunk.byteLength;
      cross("compressed", compressed);
      if (compressed > stopAfter) {
        stopped = true;
        controller.error(new Error("stopped"));
        return;
      }
      controller.enqueue(chunk);
    },
  });
  const observed = { entries: 0, regularFiles: 0 };
  const limits: ArchiveLimits = {
    ...ARCHIVE_LIMITS,
    compressed: Number.MAX_SAFE_INTEGER,
    decompressed: Number.MAX_SAFE_INTEGER,
    retainedPaths: Number.MAX_SAFE_INTEGER,
    paxTotal: Number.MAX_SAFE_INTEGER,
    get entries() {
      cross("entries", ++observed.entries);
      return Number.MAX_SAFE_INTEGER;
    },
    get regularFiles() {
      cross("regularFiles", ++observed.regularFiles);
      return Number.MAX_SAFE_INTEGER;
    },
  };
  const analyzer = new Analyzer(
    JSON.stringify({
      repositoryId: "1",
      commitSha: "0".repeat(40),
      ...defaultIgnore,
    }),
  );
  let countedBytes = 0;
  let oversizedFiles = 0;
  let wasmPeak = memory.buffer.byteLength;
  try {
    const metrics = await analyzeTar(
      response.body
        .pipeThrough(counting)
        .pipeThrough(
          new DecompressionStream("gzip") as unknown as ReadableWritablePair<
            Uint8Array,
            Uint8Array
          >,
        ),
      {
        classify: (path, prefix) =>
          (JSON.parse(analyzer.classify_path(path, prefix)) as { kind: string })
            .kind,
        addFile: (path, bytes) => {
          analyzer.add_file(path, bytes);
          countedBytes += bytes.byteLength;
          wasmPeak = Math.max(wasmPeak, memory.buffer.byteLength);
        },
        skipFile: (path, prefix, reason, size) => {
          if (reason === "oversized_source") oversizedFiles++;
          analyzer.skip_file(path, prefix, reason, BigInt(size));
        },
        skipOther: (path, prefix, size, lines, binary) => {
          analyzer.skip_other(
            path,
            prefix,
            BigInt(size),
            BigInt(lines),
            binary,
          );
        },
      },
      undefined,
      (bytes) => {
        unpacked = bytes;
        cross("decompressed", bytes);
      },
      limits,
    );
    cross("retainedPaths", metrics.retainedPathBytes);
    return {
      repository: label,
      download: format(compressed),
      unpacked: format(metrics.decompressedBytes),
      entries: metrics.entries,
      files: metrics.regularFiles,
      counted: format(countedBytes),
      paths: format(metrics.retainedPathBytes),
      oversizedFiles,
      wasmMemory: format(wasmPeak),
      seconds: Math.round((performance.now() - started) / 100) / 10,
      crosses: crossed.map((item) => item.limit),
    };
  } catch (error) {
    return {
      repository: label,
      download: `${stopped ? ">" : ""}${format(compressed)}`,
      unpacked: `>${format(unpacked)}`,
      entries: `>${observed.entries}`,
      files: `>${observed.regularFiles}`,
      counted: `>${format(countedBytes)}`,
      seconds: Math.round((performance.now() - started) / 100) / 10,
      crosses: crossed.map((item) => item.limit),
      error: stopped
        ? `stopped after ${format(stopAfter)} downloaded`
        : error instanceof ArchiveError
          ? `${error.code}${error.limit ? ` (${error.limit})` : ""}`
          : String(error),
    };
  } finally {
    analyzer.free();
  }
}

const { stopAfter, repositories } = parseArguments(process.argv.slice(2));
if (!existsSync(wasmPath)) {
  console.error("Run `bun run build:wasm` first.");
  process.exit(1);
}
const { memory } = await init({ module_or_path: readFileSync(wasmPath) });
console.log(
  `Limits: ${Object.entries(thresholds)
    .map(([key, value]) => `${key} ${value.toLocaleString("en-US")}`)
    .join(", ")}`,
);
for (const repository of repositories)
  console.log(JSON.stringify(await measure(memory, repository, stopAfter)));
