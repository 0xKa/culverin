import { expect, test } from "bun:test";
import type { AnalysisResultV2 } from "../../extension/src/counter/result";
import type { ResolutionEnvelope } from "../../extension/src/github/public-protocol";
import { resultView, sizesView } from "../../extension/src/popup/view";

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
  coverage: {
    regularFiles: 3,
    countedFiles: 2,
    analyzedBytes: 20,
    totalBytes: 30,
    skippedFiles: 1,
    skippedByReason: {
      excluded_by_rule: 0,
      unsupported_language: 0,
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
  expect(view.coverage).toContain("1 skipped (0 excluded by Culverin ignore");
  expect(view.warning).toBe(
    "Partial analysis: some source files exceeded the safe size limit.",
  );
});

test("handles zero lines and absent languages without invalid percentages", () => {
  const empty: AnalysisResultV2 = {
    ...result,
    totals: { lines: 0, code: 0, comments: 0, blanks: 0, files: 0 },
    languages: [],
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
