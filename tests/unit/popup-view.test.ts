import { expect, test } from "bun:test";
import type { AnalysisResultV2 } from "../../extension/src/counter/result";
import type { ResolutionEnvelope } from "../../extension/src/github/public-protocol";
import { resultView } from "../../extension/src/popup/view";

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
  const view = resultView(result, resolution);
  expect(view.commit).toBe("aaaaaaaaaaaa");
  expect(view.snapshotSize).toBe("30 B");
  expect(view.sizeTitle).toBe(
    "30 bytes. Total size of the files at commit aaaaaaaaaaaa, as checked out. Doesn't include Git history, so a cloned folder with its .git folder is larger.",
  );
  expect(view.cloneSize).toBe("≈ 2 MiB");
  expect(view.cloneTitle).toBe(
    "Approximately 2,097,182 bytes. The 30 B of files plus the 2 MiB of Git history that GitHub reports. GitHub updates its number only occasionally, so a real clone may differ.",
  );
  expect(view.codeTotal).toBe("3");
  expect(view.fileTotal).toBe("5");
  expect(view.fileLabel).toBe("files");
  expect(view.fileTitle).toBe(
    "All files at this commit, 2 counted as code or text. Other, binary, and ignored files are listed in Analysis details.",
  );
  expect(view.stats).toEqual([
    {
      label: "Text lines",
      value: "4",
      title:
        "Non-blank prose lines in Markdown, MDX, Djot, and plain text files",
      id: "text-lines",
    },
    {
      label: "Physical lines",
      value: "8",
      title: "Physical lines = code + comments + blanks",
    },
    { label: "Comments", value: "4" },
    { label: "Blanks", value: "1" },
  ]);
  expect(view.codeSummary).toEqual(["3 code lines", "1 files"]);
  expect(view.textSummary).toEqual(["4 text lines", "1 files"]);
  expect(view.otherSummary).toEqual(["38 lines", "2 files"]);
  expect(view.codeRows).toEqual([
    {
      label: "TypeScript: 3 code lines (100.0% of code lines), 1 files",
      name: "TypeScript",
      value: "3",
      share: 100,
      files: "1 file",
    },
  ]);
  expect(view.textRows).toEqual([
    {
      label: "Markdown: 4 text lines (100.0% of text lines), 1 files",
      name: "Markdown",
      value: "4",
      share: 100,
      files: "1 file",
    },
  ]);
  expect(view.coverage).toContain(
    "3 skipped (0 excluded by Culverin ignore, 2 other files, 0 binary",
  );
  expect(view.otherRows.map((row) => row.label)).toEqual([
    ".golden: 30 lines, 1 files",
    "No extension: 8 lines, 1 files",
  ]);
  expect(view.otherRows.map((row) => [row.name, row.share])).toEqual([
    [".golden", (30 / 38) * 100],
    ["No extension", (8 / 38) * 100],
  ]);
  expect(view.warning).toBe(
    "1 source file was too large to count and is not included in these totals.",
  );
  expect(view.fileLimit).toBe("The per-file limit is 8 MiB.");
  expect(view.oversizedFiles).toEqual([]);
  expect(view.oversizedNote).toBe(
    "File names aren't available for this saved result. Reanalyze to see them.",
  );
});

test("links oversized paths to the counted commit and formats their sizes", () => {
  const path = "src/large #?%é.rs";
  const view = resultView(
    {
      ...result,
      coverage: {
        ...result.coverage,
        oversizedFiles: [{ path, bytes: 9 * 1024 * 1024 }],
      },
    },
    { ...resolution, sha: "c".repeat(40) },
  );
  expect(view.oversizedFiles).toEqual([
    {
      path,
      size: "9 MiB",
      sizeTitle: "9,437,184 bytes",
      url: `https://github.com/culverin/sample/blob/${result.revision.commitSha}/src/large%20%23%3F%25%C3%A9.rs`,
    },
  ]);
  expect(view.oversizedNote).toBeUndefined();
  const truncated = resultView(
    {
      ...result,
      coverage: {
        ...result.coverage,
        skippedByReason: {
          ...result.coverage.skippedByReason,
          oversized_source: 257,
        },
        oversizedFiles: Array.from({ length: 256 }, (_, index) => ({
          path: `src/${index}.rs`,
          bytes: 9_000_000,
        })),
      },
    },
    resolution,
  );
  expect(truncated.oversizedFiles).toHaveLength(256);
  expect(truncated.oversizedNote).toBe(
    "1 additional oversized file isn't listed.",
  );
});

test("formats every result section without changing exact labels, shares, limits, or source data", () => {
  const source: AnalysisResultV2 = {
    ...result,
    totals: {
      lines: 15_120,
      code: 12_480,
      comments: 2_016,
      blanks: 624,
      files: 1200,
    },
    languages: [
      {
        language: "TypeScript",
        lines: 15_120,
        code: 12_480,
        comments: 2_016,
        blanks: 624,
        files: 1200,
      },
      {
        language: "Markdown",
        lines: 2500,
        code: 0,
        comments: 2500,
        blanks: 0,
        files: 100,
      },
    ],
    otherFiles: {
      files: 1000,
      lines: 10_480,
      extensions: [{ extension: ".golden", files: 1000, lines: 10_480 }],
      moreExtensions: 0,
    },
    coverage: {
      ...result.coverage,
      regularFiles: 2301,
      totalBytes: 1_572_864,
      oversizedFiles: [{ path: "large.ts", bytes: 9_437_184 }],
    },
  };
  const before = JSON.stringify(source);
  const full = resultView(source, resolution);
  const compact = resultView(source, resolution, {
    counts: "abbreviated",
    sizes: "decimal",
  });
  expect(compact.codeTotal).toBe("12.5K");
  expect(compact.codeTitle).toBe("12,480 code lines");
  expect(compact.fileTotal).toBe("2.3K");
  expect(compact.fileTitle).toStartWith("2,301 files.");
  expect(compact.stats.map((stat) => stat.value)).toEqual([
    "2.5K",
    "15.1K",
    "2K",
    "624",
  ]);
  expect(compact.stats[1]?.title).toStartWith("15,120 physical lines.");
  expect(compact.codeSummary).toEqual(["12.5K code lines", "1.2K files"]);
  expect(compact.codeSummaryTitle).toBe("12,480 code lines, 1,200 files");
  expect(compact.textRows[0]?.value).toBe("2.5K");
  expect(compact.otherRows[0]?.value).toBe("10.5K");
  for (const key of ["codeRows", "textRows", "otherRows"] as const) {
    expect(compact[key].map((row) => [row.label, row.share])).toEqual(
      full[key].map((row) => [row.label, row.share]),
    );
    expect(compact[key][0]?.title).toBe(full[key][0]?.label);
  }
  expect(compact.snapshotSize).toBe("1.6 MB");
  expect(full.snapshotSize).toBe("1.5 MiB");
  expect(compact.sizeTitle).toStartWith("1,572,864 bytes.");
  expect(compact.cloneSize).toBe("≈ 3.7 MB");
  expect(compact.oversizedFiles[0]).toMatchObject({
    size: "9.4 MB",
    sizeTitle: "9,437,184 bytes",
    url: full.oversizedFiles[0]?.url,
  });
  expect(compact.fileLimit).toBe(full.fileLimit);
  expect(compact.coverage).toBe(full.coverage);
  expect(JSON.stringify(source)).toBe(before);
});

test("orders languages by lines and retains all other file rows for display", () => {
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
  expect(view.codeSummary).toEqual(["170 code lines", "3 files"]);
  expect(view.textSummary).toEqual(["10 text lines", "2 files"]);
  expect(view.otherSummary).toEqual(["80 lines", "13 files"]);
  expect(view.codeRows.map((row) => row.name)).toEqual(["Rust", "Go", "Shell"]);
  expect(view.textRows.map((row) => row.name)).toEqual([
    "Plain Text",
    "Markdown",
  ]);
  expect(view.otherRows).toHaveLength(13);
  expect(view.otherRows[0]?.label).toBe(".e00: 12 lines, 1 files");
  expect(view.otherRows.slice(10).map((row) => row.label)).toEqual([
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
  expect(view.codeSummary).toEqual(["0 code lines", "0 files"]);
  expect(view.warning).toBeUndefined();
  expect(view.oversizedNote).toBeUndefined();
  expect(JSON.stringify(view)).not.toMatch(/NaN|Infinity/);
  expect(view.cloneSize).toBeUndefined();
  expect(view.cloneTitle).toBeUndefined();
});
