import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const wasm = readFileSync(
  "extension/src/wasm/generated/culverin_counter_bg.wasm",
);
const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm));
assert.equal(
  imports.some(
    (item) => item.module.startsWith("wasi_") || item.name.includes("fetch"),
  ),
  false,
);
const before = process.memoryUsage().rss;
const started = performance.now();
const {
  default: init,
  Analyzer,
  counter_metadata,
} = await import("../extension/src/wasm/generated/culverin_counter.js");
const instance = await init({ module_or_path: wasm });
const initialPages = instance.memory.buffer.byteLength;
const initMs = performance.now() - started;
assert.deepEqual(JSON.parse(counter_metadata()), {
  name: "tokei",
  version: "15.0.0",
  wrapperVersion: "3",
});
const cases = ["core", "embedded", "encodings"];
for (const name of cases) {
  const fixture = JSON.parse(
    readFileSync(`tests/fixtures/${name}.json`, "utf8"),
  ) as { rules: unknown; files: { path: string; bytes: number[] }[] };
  const native = spawnSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "culverin-counter", "--bin", "parity"],
    { input: JSON.stringify(fixture), encoding: "utf8" },
  );
  assert.equal(native.status, 0, native.stderr);
  const counter = new Analyzer(JSON.stringify(fixture.rules));
  const began = performance.now();
  try {
    for (const file of fixture.files)
      counter.add_file(file.path, Uint8Array.from(file.bytes));
    const result = JSON.parse(counter.finish());
    assert.deepEqual(result, JSON.parse(native.stdout));
    if (name === "core") {
      assert.deepEqual(result.totals, {
        files: 4,
        lines: 6,
        code: 4,
        comments: 1,
        blanks: 1,
      });
      assert.equal(result.coverage.skippedByReason.excluded_by_rule, 2);
      assert.equal(result.coverage.skippedByReason.unsupported_language, 1);
      assert.equal(
        result.coverage.totalBytes,
        fixture.files.reduce((sum, file) => sum + file.bytes.length, 0),
      );
    }
    if (name === "embedded") {
      assert.equal(result.totals.files, 6);
      assert.equal(result.totals.lines, 19);
      assert.equal(result.coverage.skippedByReason.unsupported_notebook, 1);
      assert.equal(
        result.languages.find(
          (x: { language: string }) => x.language === "JavaScript",
        ).files,
        0,
      );
    }
    if (name === "encodings") {
      assert.equal(result.coverage.complete, true);
      assert.deepEqual(result.coverage.incompleteReasons, []);
      assert.equal(result.coverage.skippedByReason.binary_content, 2);
    }
  } finally {
    counter.free();
  }
  console.log(
    `${name}: native/WASM parity, ${(performance.now() - began).toFixed(2)} ms`,
  );
}
{
  const fixture = JSON.parse(
    readFileSync("tests/fixtures/core.json", "utf8"),
  ) as { rules: unknown };
  const counter = new Analyzer(JSON.stringify(fixture.rules));
  try {
    counter.skip_file(
      "large.rs",
      new TextEncoder().encode("fn "),
      "oversized_source",
      9_000_000n,
    );
    const result = JSON.parse(counter.finish());
    assert.equal(result.coverage.totalBytes, 9_000_000);
    assert.equal(result.coverage.analyzedBytes, 0);
  } finally {
    counter.free();
  }
}
console.log(
  `WASM ${wasm.byteLength} bytes, ${imports.length} imports, init ${initMs.toFixed(2)} ms, memory ${initialPages} -> ${instance.memory.buffer.byteLength} bytes, RSS ${before} -> ${process.memoryUsage().rss} bytes`,
);
