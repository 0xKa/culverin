import type { SettingsRequest } from "../extension/src/protocol/settings";
import assert from "node:assert/strict";
import {
  cpSync,
  createWriteStream,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { chromium, type CDPSession } from "playwright";
import { ARCHIVE_LIMITS } from "../extension/src/archive/limits";
import { checksum, encoder, entry, octal } from "./tar-fixture";

const mib = 1024 * 1024;
const scenarios = [
  { name: "source-8-mib", files: 1, size: 8 * mib, excluded: false },
  { name: "source-32-mib", files: 1, size: 32 * mib, excluded: false },
  { name: "source-64-mib", files: 1, size: 64 * mib, excluded: false },
  { name: "source-total-256-mib", files: 32, size: 8 * mib, excluded: false },
  { name: "source-total-1-gib", files: 128, size: 8 * mib, excluded: false },
  { name: "small-files-100000", files: 100_000, size: 128, excluded: false },
  { name: "excluded-1-gib", files: 1, size: 1024 * mib, excluded: true },
];
const baseline = process.argv.includes("--baseline");
const directory = resolve("extension/dist");
const temporary = mkdtempSync(resolve(tmpdir(), "culverin-benchmark-"));
const packageCopy = resolve(temporary, "extension");
cpSync(directory, packageCopy, { recursive: true });
const chunk = encoder.encode(`${"fn f() {}".padEnd(63)}\n`.repeat(1024));
const sha = "a".repeat(40);

function* tar(scenario: (typeof scenarios)[number]): Generator<Uint8Array> {
  for (let index = 0; index < scenario.files; index++) {
    const path = scenario.excluded
      ? `repo/vendor/blob-${index}.bin`
      : `repo/src/file-${index}.rs`;
    const header = entry(path, new Uint8Array(0));
    octal(header, 124, 12, scenario.size);
    checksum(header);
    yield header;
    for (let offset = 0; offset < scenario.size; offset += chunk.length)
      yield chunk.subarray(0, Math.min(chunk.length, scenario.size - offset));
    yield new Uint8Array((512 - (scenario.size % 512)) % 512);
  }
  yield new Uint8Array(1024);
}

async function heap(session: CDPSession, sessionId: string): Promise<number> {
  const id = 1;
  let listener: (event: { sessionId: string; message: string }) => void;
  let timer: ReturnType<typeof setTimeout>;
  const reply = new Promise<number>((resolve) => {
    timer = setTimeout(() => resolve(0), 1000);
    listener = (event) => {
      const message = JSON.parse(event.message) as {
        id?: number;
        result?: { usedSize?: number };
      };
      if (event.sessionId === sessionId && message.id === id)
        resolve(message.result?.usedSize ?? 0);
    };
    session.on("Target.receivedMessageFromTarget", listener);
  });
  try {
    await session.send("Target.sendMessageToTarget", {
      sessionId,
      message: JSON.stringify({ id, method: "Runtime.getHeapUsage" }),
    });
    return await reply;
  } finally {
    clearTimeout(timer!);
    session.off("Target.receivedMessageFromTarget", listener!);
  }
}

const context = await chromium.launchPersistentContext(
  resolve(temporary, "profile"),
  {
    executablePath: process.env.CHROME_BIN || chromium.executablePath(),
    headless: true,
    args: [
      "--headless=new",
      `--disable-extensions-except=${packageCopy}`,
      `--load-extension=${packageCopy}`,
    ],
  },
);

try {
  let repositoryId = 1;
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/settings.html`,
  );
  const session = await context.newCDPSession(page);
  await session.send("Target.setDiscoverTargets", { discover: true });
  console.log(
    JSON.stringify({
      browser: context.browser()?.version(),
      limits: ARCHIVE_LIMITS,
    }),
  );
  for (const scenario of scenarios) {
    const archivePath = resolve(packageCopy, "benchmark.tar.gz");
    await pipeline(
      Readable.from(tar(scenario)),
      createGzip(),
      createWriteStream(archivePath),
    );
    await worker.evaluate(
      ({ id, sha }) => {
        const scope = globalThis as typeof globalThis & {
          benchmarkFetch?: typeof fetch;
        };
        scope.benchmarkFetch ??= fetch;
        const nativeFetch = scope.benchmarkFetch;
        globalThis.fetch = (async (input, init) => {
          const url = String(input);
          if (url.includes("/tarball/")) {
            const response = await nativeFetch(
              chrome.runtime.getURL("benchmark.tar.gz"),
              {
                signal: init?.signal,
                cache: "no-store",
              },
            );
            Object.defineProperty(response, "url", {
              value: `https://codeload.github.com/benchmark/${sha}`,
            });
            return response;
          }
          const response = new Response(
            JSON.stringify(
              url.includes("/commits/")
                ? { sha }
                : {
                    id,
                    owner: { login: "culverin" },
                    name: `benchmark-${id}`,
                    private: false,
                    default_branch: "main",
                    size: null,
                  },
            ),
            { headers: { "content-type": "application/json" } },
          );
          Object.defineProperty(response, "url", { value: url });
          return response;
        }) as typeof fetch;
      },
      { id: repositoryId, sha },
    );
    let sampling = true;
    let javascriptHeapBytes = 0;
    const sampler = (async () => {
      while (sampling) {
        const { targetInfos } = await session.send("Target.getTargets", {
          filter: [{}],
        });
        const target = targetInfos.find(
          (value) =>
            value.type === "worker" && value.url.includes("/assets/worker-"),
        );
        if (target) {
          const { sessionId } = await session.send("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: false,
          });
          try {
            javascriptHeapBytes = Math.max(
              javascriptHeapBytes,
              await heap(session, sessionId),
            );
          } finally {
            await session
              .send("Target.detachFromTarget", { sessionId })
              .catch(() => undefined);
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    })().catch((error: unknown) => console.error(String(error)));
    const started = performance.now();
    const outcome = await page.evaluate(
      (id) =>
        new Promise<Record<string, unknown>>((resolve) => {
          chrome.runtime.sendMessage(
            {
              protocolVersion: 1,
              type: "analysis.request",
              requestId: crypto.randomUUID(),
              navigationId: crypto.randomUUID(),
              owner: "culverin",
              name: `benchmark-${id}`,
            } satisfies SettingsRequest,
            resolve,
          );
        }),
      repositoryId++,
    );
    const elapsedMs = performance.now() - started;
    sampling = false;
    await sampler;
    const result = outcome.result as
      | {
          totals: { files: number; code: number };
          coverage: { complete: boolean; totalBytes: number };
        }
      | undefined;
    console.log(
      JSON.stringify({
        scenario: scenario.name,
        state: outcome.state,
        code: outcome.code,
        limit: outcome.limit,
        compressedBytes: statSync(archivePath).size,
        elapsedMs: Math.round(elapsedMs),
        javascriptHeapBytes: javascriptHeapBytes || null,
        wasmLinearMemoryBytes: outcome.wasmLinearMemoryBytes,
        transport: outcome.transport,
        coverage: result?.coverage,
      }),
    );
    if (!baseline) assert.equal(outcome.state, "analyzed", scenario.name);
    if (result) {
      const counted =
        !scenario.excluded && scenario.size <= ARCHIVE_LIMITS.file;
      assert.equal(result.totals.files, counted ? scenario.files : 0);
      assert.equal(
        result.totals.code,
        counted ? (scenario.files * scenario.size) / 64 : 0,
      );
      assert.equal(result.coverage.totalBytes, scenario.files * scenario.size);
      assert.equal(result.coverage.complete, scenario.excluded || counted);
    }
    rmSync(archivePath);
  }
} finally {
  await context.close();
  rmSync(temporary, { recursive: true, force: true });
}
