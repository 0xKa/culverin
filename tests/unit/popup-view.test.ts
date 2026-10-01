import { expect, test } from "bun:test";
import type { AnalysisResultV2 } from "../../extension/src/counter/result";
import type { ResolutionEnvelope } from "../../extension/src/github/public-protocol";
import {
  resultView,
  sizesView,
  VISIBLE_OTHER_ROWS,
} from "../../extension/src/popup/view";

const resolution: ResolutionEnvelope = {
  repositoryId: "1",
  owner: "culverin",
  name: "sample",
  defaultBranch: "main",
  visibility: "public",
  sha: "a".repeat(40),
  sizeKb: 2048,
  resolvedAt: Date.now(),
};
const result: AnalysisResultV2 = {
  schemaVersion: 2,
  repository: { id: "1" },
  revision: { commitSha: resolution.sha },
  engine: {
    name: "tokei",
    version: "15.0.0",
    wrapperVersion: "3",
    rulesProfile: "source-v1",
    rulesVersion: "2",
    rulesHash: "b".repeat(64),
    coveragePolicyVersion: "2",
  },
  totals: { lines: 8, code: 3, comments: 4, blanks: 1, files: 2 },
  languages: [
    {
      language: "Markdown",
      lines: 4,
      code: 0,
      comments: 4,
      blanks: 0,
      files: 1,
    },
    {
      language: "TypeScript",
      lines: 4,
      code: 3,
      comments: 0,
      blanks: 1,
      files: 1,
    },
  ],
  otherFiles: {
    files: 2,
    lines: 38,
    extensions: [
      { extension: ".golden", files: 1, lines: 30 },
      { extension: "", files: 1, lines: 8 },
    ],
    moreExtensions: 0,
  },
  coverage: {
    regularFiles: 5,
    countedFiles: 2,
    analyzedBytes: 20,
    totalBytes: 30,
    skippedFiles: 3,
    skippedByReason: {
      excluded_by_rule: 0,
      unsupported_language: 2,
      binary_content: 0,
      oversized_source: 1,
      unsupported_notebook: 0,
    },
    complete: false,
    incompleteReasons: ["oversized_source"],
  },
};

test("formats repository and result details", () => {
  expect(sizesView(resolution)).toEqual({
    repositorySize: "2 MB",
    snapshotLabel: "Files at aaaaaaaaaaaa",
  });
  const view = resultView(result, resolution);
  expect(view.codeLines).toBe("3 code lines");
  expect(view.textLines).toBe("4 text lines");
  expect(view.metrics).toBe(
    "2 files · 8 physical lines · 4 comments · 1 blanks",
  );
  expect(view.codeRows).toEqual([
    "TypeScript: 3 code lines (100.0% of code lines), 1 files",
  ]);
  expect(view.textRows).toEqual([
    "Markdown: 4 text lines (100.0% of text lines), 1 files",
  ]);
  expect(view.coverage).toContain(
    "3 skipped (0 excluded by Culverin ignore, 2 other files, 0 binary",
  );
  expect(view.otherRows).toEqual([
    ".golden: 30 lines, 1 files",
    "No extension: 8 lines, 1 files",
  ]);
  expect(view.moreOtherRows).toEqual([]);
  expect(view.warning).toBe(
    "1 source file was too large to count and is not included in these totals.",
  );
});

test("orders languages by lines and folds other files after the first rows", () => {
  const row = (language: string, code: number, comments: number) => ({
    language,
    files: 1,
    lines: code + comments,
    code,
    comments,
    blanks: 0,
  });
  const extensions = Array.from({ length: 12 }, (_, index) => ({
    extension: `.e${String(index).padStart(2, "0")}`,
    files: 1,
    lines: 12 - index,
  }));
  const view = resultView(
    {
      ...result,
      languages: [
        row("Go", 50, 0),
        row("Markdown", 0, 1),
        row("Plain Text", 0, 9),
        row("Rust", 70, 0),
        row("Shell", 50, 0),
      ],
      otherFiles: { files: 13, lines: 80, extensions, moreExtensions: 1 },
    },
    resolution,
  );
  expect(view.codeRows.map((line) => line.split(":")[0])).toEqual([
    "Rust",
    "Go",
    "Shell",
  ]);
  expect(view.textRows.map((line) => line.split(":")[0])).toEqual([
    "Plain Text",
    "Markdown",
  ]);
  expect(view.otherRows).toHaveLength(VISIBLE_OTHER_ROWS);
  expect(view.otherRows[0]).toBe(".e00: 12 lines, 1 files");
  expect(view.moreOtherRows).toEqual([
    ".e10: 2 lines, 1 files",
    ".e11: 1 lines, 1 files",
    "1 more extension: 2 lines, 1 files",
  ]);
});

test("handles zero lines and absent languages without invalid percentages", () => {
  const empty: AnalysisResultV2 = {
    ...result,
    totals: { lines: 0, code: 0, comments: 0, blanks: 0, files: 0 },
    languages: [],
    otherFiles: { files: 0, lines: 0, extensions: [], moreExtensions: 0 },
    coverage: {
      ...result.coverage,
      countedFiles: 0,
      regularFiles: 0,
      skippedFiles: 0,
      skippedByReason: {
        excluded_by_rule: 0,
        unsupported_language: 0,
        binary_content: 0,
        oversized_source: 0,
        unsupported_notebook: 0,
      },
      complete: true,
      incompleteReasons: [],
    },
  };
  const view = resultView(empty, { ...resolution, sizeKb: null });
  expect(view.noLanguages).toBe("No language totals.");
  expect(view.codeRows).toEqual([]);
  expect(view.textRows).toEqual([]);
  expect(view.warning).toBeUndefined();
  expect(JSON.stringify(view)).not.toMatch(/NaN|Infinity/);
  expect(sizesView({ ...resolution, sizeKb: null }).repositorySize).toBe(
    "Not reported",
  );
});
