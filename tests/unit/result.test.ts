import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateResult } from "../../extension/src/counter/result";
import {
  coverageIdentity,
  effectiveRulesHash,
  normalizeExclusions,
} from "../../extension/src/counter/rules";

const fixture = JSON.parse(readFileSync("tests/fixtures/core.json", "utf8"));
const native = spawnSync(
  "cargo",
  ["run", "--quiet", "--locked", "-p", "culverin-counter", "--bin", "parity"],
  { input: JSON.stringify(fixture), encoding: "utf8" },
);
if (native.status !== 0) throw new Error(native.stderr);
const result = JSON.parse(native.stdout);
const schema = JSON.parse(
  readFileSync("schemas/analysis-result-v2.schema.json", "utf8"),
);

describe("analysis result contract", () => {
  test("native result matches the TypeScript validator and canonical hash", async () => {
    expect(validateResult(result)).toBe(true);
    expect(result.engine.rulesHash).toBe(
      await effectiveRulesHash(["custom", "custom"]),
    );
    expect(coverageIdentity("15.0.0", "1", result.engine.rulesHash)).toContain(
      result.engine.rulesHash,
    );
  });
  test("schema keys match Rust output", () => {
    expect(schema.required.sort()).toEqual(Object.keys(result).sort());
    expect(schema.properties.engine.required.sort()).toEqual(
      Object.keys(result.engine).sort(),
    );
    expect(schema.properties.coverage.required.sort()).toEqual(
      Object.keys(result.coverage).sort(),
    );
    expect(schema.properties.languages.items.required.sort()).toEqual(
      Object.keys(result.languages[0]).sort(),
    );
  });
  test("rejects broken sums, file attribution, and identity", () => {
    expect(
      validateResult({ ...result, totals: { ...result.totals, lines: 5 } }),
    ).toBe(false);
    expect(
      validateResult({
        ...result,
        coverage: { ...result.coverage, countedFiles: 5 },
      }),
    ).toBe(false);
    expect(
      validateResult({
        ...result,
        engine: { ...result.engine, rulesHash: "bad" },
      }),
    ).toBe(false);
    expect(
      validateResult({ ...result, languages: [...result.languages].reverse() }),
    ).toBe(false);
  });
  test("totals every regular file size and checks it against counted bytes", () => {
    const bytes = fixture.files.reduce(
      (sum: number, file: { bytes: number[] }) => sum + file.bytes.length,
      0,
    );
    expect(result.coverage.totalBytes).toBe(bytes);
    expect(result.coverage.totalBytes).toBeGreaterThan(
      result.coverage.analyzedBytes,
    );
    expect(
      validateResult({
        ...result,
        coverage: {
          ...result.coverage,
          totalBytes: result.coverage.analyzedBytes - 1,
        },
      }),
    ).toBe(false);
    expect(
      validateResult({
        ...result,
        coverage: {
          ...result.coverage,
          skippedFiles: 0,
          regularFiles: result.coverage.countedFiles,
          skippedByReason: {
            excluded_by_rule: 0,
            unsupported_language: 0,
            binary_content: 0,
            oversized_source: 0,
          },
        },
      }),
    ).toBe(false);
    expect(validateResult({ ...result, schemaVersion: 1 })).toBe(false);
  });
  test("normalizes exclusions and rejects unsafe patterns", () => {
    expect(normalizeExclusions(["b", "a", "b"])).toEqual(["a", "b"]);
    expect(() => normalizeExclusions(["../a"])).toThrow();
    expect(() => normalizeExclusions(["a/*"])).toThrow();
  });
});
