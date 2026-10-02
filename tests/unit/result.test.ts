import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import {
  MAX_OTHER_EXTENSIONS,
  MAX_OVERSIZED_FILES,
  validateResult,
} from "../../extension/src/counter/result";
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
      await effectiveRulesHash({
        disabledGroups: [],
        exclusions: ["custom", "custom"],
      }),
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
    expect(Object.keys(schema.properties.coverage.properties).sort()).toEqual(
      Object.keys(result.coverage).sort(),
    );
    expect(schema.properties.coverage.required).not.toContain("oversizedFiles");
    expect(schema.properties.languages.items.required.sort()).toEqual(
      Object.keys(result.languages[0]).sort(),
    );
    expect(schema.properties.otherFiles.required.sort()).toEqual(
      Object.keys(result.otherFiles).sort(),
    );
    expect(
      schema.properties.otherFiles.properties.extensions.items.required.sort(),
    ).toEqual(Object.keys(result.otherFiles.extensions[0]).sort());
  });
  test("validates oversized paths, sizes, ordering, and bounds while accepting old results", () => {
    const max = MAX_OVERSIZED_FILES;
    const row = { path: "src/large.rs", bytes: 9_000_000 };
    const check = (rows: unknown, files = 1, bytes = 9_000_000) =>
      validateResult({
        ...result,
        coverage: {
          ...result.coverage,
          regularFiles: result.coverage.regularFiles + files,
          skippedFiles: result.coverage.skippedFiles + files,
          totalBytes: result.coverage.totalBytes + bytes,
          skippedByReason: {
            ...result.coverage.skippedByReason,
            oversized_source: files,
          },
          complete: files === 0,
          incompleteReasons: files ? ["oversized_source"] : [],
          oversizedFiles: rows,
        },
      });
    expect(check([row])).toBe(true);
    const legacy = structuredClone(result);
    delete legacy.coverage.oversizedFiles;
    expect(validateResult(legacy)).toBe(true);
    expect(check(undefined)).toBe(false);
    for (const path of [
      "",
      "/a.rs",
      "../a.rs",
      "src/./a.rs",
      "a//b.rs",
      "a\\b.rs",
      "a\0b.rs",
      "a\uD800.rs",
      "é".repeat(2049) + ".rs",
    ])
      expect(check([{ ...row, path }])).toBe(false);
    expect(check([{ ...row, path: "src/hello #?%é.rs" }])).toBe(true);
    expect(check([{ ...row, bytes: 8 * 1024 * 1024 }])).toBe(false);
    expect(check([{ ...row, bytes: Number.MAX_SAFE_INTEGER }])).toBe(false);
    expect(check([{ ...row, extra: true }])).toBe(false);
    expect(check([row], 0)).toBe(false);
    expect(check([])).toBe(false);
    expect(check([row, row], 2, 18_000_000)).toBe(false);
    const bmp = { ...row, path: "\uFF00.rs" };
    const astral = { ...row, path: "\u{10000}.rs" };
    expect(check([bmp, astral], 2, 18_000_000)).toBe(true);
    expect(check([astral, bmp], 2, 18_000_000)).toBe(false);
    const smaller = { ...row, path: "other.rs", bytes: row.bytes - 1 };
    expect(check([row, smaller], 2, 18_000_000)).toBe(true);
    expect(check([smaller, row], 2, 18_000_000)).toBe(false);
    const rows = Array.from({ length: max }, (_, index) => ({
      ...row,
      path: `src/${String(index).padStart(3, "0")}.rs`,
    }));
    expect(check(rows, max, max * row.bytes)).toBe(true);
    expect(check(rows, max + 1, (max + 1) * row.bytes)).toBe(true);
    expect(check(rows.slice(1), max, max * row.bytes)).toBe(false);
    expect(
      check(
        [...rows, { ...row, path: "src/extra.rs" }],
        max + 1,
        (max + 1) * row.bytes,
      ),
    ).toBe(false);
  });
  test("checks other files against the skipped count and their order", () => {
    expect(result.otherFiles.files).toBe(
      result.coverage.skippedByReason.unsupported_language,
    );
    const row = { extension: ".golden", files: 1, lines: 2 };
    const other = (
      extensions: unknown[],
      files = 2,
      lines = 4,
      moreExtensions = 0,
      skipped = files,
    ) =>
      validateResult({
        ...result,
        otherFiles: { files, lines, extensions, moreExtensions },
        coverage: {
          ...result.coverage,
          regularFiles:
            result.coverage.regularFiles + skipped - result.otherFiles.files,
          skippedFiles:
            result.coverage.skippedFiles + skipped - result.otherFiles.files,
          skippedByReason: {
            ...result.coverage.skippedByReason,
            unsupported_language: skipped,
          },
        },
      });
    const empty = { ...row, extension: "" };
    expect(other([empty, row])).toBe(true);
    expect(other([row, empty])).toBe(false);
    expect(other([row, { ...row, extension: ".yml~" }])).toBe(true);
    expect(other([row, { ...row, extension: ".\u00e9t\u00e9" }])).toBe(true);
    expect(other([row, { ...row, extension: ".a b" }])).toBe(false);
    expect(other([row, { ...row, extension: ".a\u0085" }])).toBe(false);
    expect(other([row, { ...row, extension: `.${"x".repeat(17)}` }])).toBe(
      false,
    );
    const bmp = { ...row, extension: ".\uff00" };
    const astral = { ...row, extension: ".\u{10000}" };
    expect(other([bmp, astral])).toBe(true);
    expect(other([astral, bmp])).toBe(false);
    expect(other([row, row])).toBe(false);
    expect(other([row], 3, 4, 0, 2)).toBe(false);
    expect(other([row])).toBe(false);
    expect(other([{ ...row, lines: 5 }], 1)).toBe(false);
    expect(other([{ ...row, files: 0 }])).toBe(false);
    const rows = (length: number) =>
      Array.from({ length }, (_, index) => ({
        extension: `.e${String(index).padStart(3, "0")}`,
        files: 1,
        lines: 0,
      }));
    const max = MAX_OTHER_EXTENSIONS;
    expect(other(rows(max), max, 0)).toBe(true);
    expect(other(rows(max), max + 2, 0, 2)).toBe(true);
    expect(other(rows(max), max + 1, 0, 2)).toBe(false);
    expect(other(rows(max), max + 1, 0)).toBe(false);
    expect(other(rows(max - 1), max, 0, 1)).toBe(false);
    expect(other(rows(max + 1), max + 1, 0)).toBe(false);
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
            unsupported_notebook: 0,
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
