import type { AnalysisResultV2 } from "../counter/result";
import { ARCHIVE_LIMITS } from "../archive/limits";
import type { ResolutionEnvelope } from "../github/public-protocol";
import { currentRemaining, type RateLimit } from "../github/rate-limit";
import { formatBytes, formatClockTime } from "../ui/format";
import { isTextLanguage, textLines } from "./text-lines";

export type SizesView = {
  repositorySize: string;
  snapshotLabel: string;
};

export type ApiLimitView = {
  text: string;
  reset?: string;
  title: string;
  value: RateLimit;
  now: number;
};

export type BreakdownRow = {
  label: string;
  name: string;
  value: string;
  share: number;
  files: string;
};

export type StatView = {
  label: string;
  value: string;
  title?: string;
  id?: string;
};

export type ResultView = {
  codeTotal: string;
  fileTotal: string;
  fileLabel: string;
  stats: StatView[];
  snapshotSize: string;
  intro: string[][];
  codeSummary: string[];
  codeRows: BreakdownRow[];
  textSummary: string[];
  textRows: BreakdownRow[];
  otherSummary: string[];
  otherRows: BreakdownRow[];
  noLanguages?: string;
  coverage: string;
  warning?: string;
  fileLimit: string;
  oversizedFiles: { path: string; size: string; url: string }[];
  oversizedNote?: string;
};

const bySize = <T extends { files: number; language: string }>(
  size: (row: T) => number,
) => {
  return (a: T, b: T) =>
    size(b) - size(a) ||
    b.files - a.files ||
    (a.language < b.language ? -1 : a.language > b.language ? 1 : 0);
};

export function sizesView(resolution: ResolutionEnvelope): SizesView {
  return {
    repositorySize:
      resolution.sizeKb === null
        ? "Not reported"
        : formatBytes(resolution.sizeKb * 1024),
    snapshotLabel: `Files at ${resolution.sha.slice(0, 12)}`,
  };
}

const fileCount = (files: number) =>
  `${files.toLocaleString()} ${files === 1 ? "file" : "files"}`;

const share = (part: number, whole: number) =>
  whole === 0 ? 0 : (part / whole) * 100;

export function resultView(
  result: AnalysisResultV2,
  resolution: ResolutionEnvelope,
): ResultView {
  const { totals, coverage } = result;
  const text = textLines(result.languages);
  const files = (rows: { files: number }[]) =>
    rows.reduce((sum, row) => sum + row.files, 0).toLocaleString();
  const codeLanguages = result.languages
    .filter((row) => !isTextLanguage(row.language))
    .sort(bySize((row) => row.code));
  const textLanguages = result.languages
    .filter((row) => isTextLanguage(row.language))
    .sort(bySize((row) => row.comments));
  const codeRows = codeLanguages.map((row): BreakdownRow => {
    const percent = share(row.code, totals.code);
    return {
      label: `${row.language}: ${row.code.toLocaleString()} code lines (${percent.toFixed(1)}% of code lines), ${row.files.toLocaleString()} files`,
      name: row.language,
      value: row.code.toLocaleString(),
      share: percent,
      files: fileCount(row.files),
    };
  });
  const textRows = textLanguages.map((row): BreakdownRow => {
    const percent = share(row.comments, text);
    return {
      label: `${row.language}: ${row.comments.toLocaleString()} text lines (${percent.toFixed(1)}% of text lines), ${row.files.toLocaleString()} files`,
      name: row.language,
      value: row.comments.toLocaleString(),
      share: percent,
      files: fileCount(row.files),
    };
  });
  const other = result.otherFiles;
  const otherRow = (name: string, lines: number, files: number) => ({
    label: `${name}: ${lines.toLocaleString()} lines, ${files.toLocaleString()} files`,
    name,
    value: lines.toLocaleString(),
    share: share(lines, other.lines),
    files: fileCount(files),
  });
  const otherRows = other.extensions.map((row) =>
    otherRow(row.extension || "No extension", row.lines, row.files),
  );
  const restFiles =
    other.files - other.extensions.reduce((sum, row) => sum + row.files, 0);
  const restLines =
    other.lines - other.extensions.reduce((sum, row) => sum + row.lines, 0);
  if (other.moreExtensions > 0)
    otherRows.push(
      otherRow(
        `${other.moreExtensions.toLocaleString()} more ${other.moreExtensions === 1 ? "extension" : "extensions"}`,
        restLines,
        restFiles,
      ),
    );
  const skipped = coverage.skippedByReason;
  const oversizedFiles = (coverage.oversizedFiles ?? []).map((file) => ({
    path: file.path,
    size: formatBytes(file.bytes),
    url: `https://github.com/${encodeURIComponent(resolution.owner)}/${encodeURIComponent(resolution.name)}/blob/${result.revision.commitSha}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
  }));
  const unlisted = skipped.oversized_source - oversizedFiles.length;
  return {
    codeTotal: totals.code.toLocaleString(),
    fileTotal: totals.files.toLocaleString(),
    fileLabel: totals.files === 1 ? "file" : "files",
    stats: [
      {
        label: "Text lines",
        value: text.toLocaleString(),
        title:
          "Non-blank prose lines in Markdown, MDX, Djot, and plain text files",
        id: "text-lines",
      },
      {
        label: "Physical lines",
        value: totals.lines.toLocaleString(),
        title: "Physical lines = code + comments + blanks",
      },
      { label: "Comments", value: totals.comments.toLocaleString() },
      { label: "Blanks", value: totals.blanks.toLocaleString() },
    ],
    snapshotSize: formatBytes(coverage.totalBytes),
    intro: [
      [
        `Default branch ${resolution.defaultBranch}`,
        `commit ${resolution.sha.slice(0, 12)}`,
      ],
      [
        "Repository source was downloaded directly from GitHub and analyzed in your browser.",
      ],
    ],
    codeSummary: [
      `${codeLanguages.reduce((sum, row) => sum + row.code, 0).toLocaleString()} code lines`,
      `${files(codeLanguages)} files`,
    ],
    codeRows,
    textSummary: [
      `${text.toLocaleString()} text lines`,
      `${files(textLanguages)} files`,
    ],
    textRows,
    otherSummary: [
      `${other.lines.toLocaleString()} lines`,
      `${other.files.toLocaleString()} files`,
    ],
    otherRows,
    noLanguages:
      result.languages.length === 0 ? "No language totals." : undefined,
    coverage: `Source profile coverage: ${coverage.countedFiles.toLocaleString()} of ${coverage.regularFiles.toLocaleString()} regular files counted; ${coverage.skippedFiles.toLocaleString()} skipped (${skipped.excluded_by_rule.toLocaleString()} excluded by Culverin ignore, ${skipped.unsupported_language.toLocaleString()} other files, ${skipped.binary_content.toLocaleString()} binary, ${skipped.unsupported_notebook.toLocaleString()} unsupported notebook, ${skipped.oversized_source.toLocaleString()} oversized).`,
    warning: skipped.oversized_source
      ? `${skipped.oversized_source.toLocaleString()} source ${skipped.oversized_source === 1 ? "file was" : "files were"} too large to count and ${skipped.oversized_source === 1 ? "is" : "are"} not included in these totals.`
      : undefined,
    fileLimit: `The per-file limit is ${ARCHIVE_LIMITS.file / 1024 ** 2} MiB.`,
    oversizedFiles,
    oversizedNote:
      skipped.oversized_source && coverage.oversizedFiles === undefined
        ? "File names aren't available for this saved result. Reanalyze to see them."
        : unlisted > 0
          ? `${unlisted.toLocaleString()} additional oversized ${unlisted === 1 ? "file isn't" : "files aren't"} listed.`
          : undefined,
  };
}

export function apiLimitView(value: RateLimit, now: number): ApiLimitView {
  const title = value.authenticated
    ? "GitHub API requests left for your connected GitHub account, shared with your other GitHub apps and tokens. Each repository lookup uses up to 2."
    : "Unauthenticated GitHub API requests left for your network, shared with everything on it that uses GitHub without signing in. Each repository lookup uses up to 2.";
  return {
    text: `API ${currentRemaining(value, now).toLocaleString()}/${value.limit.toLocaleString()}`,
    ...(now < value.reset
      ? { reset: `Resets at ${formatClockTime(value.reset)}` }
      : {}),
    title,
    value,
    now,
  };
}
