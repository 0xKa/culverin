import type { AnalysisResultV2 } from "../counter/result";
import { ARCHIVE_LIMITS } from "../archive/limits";
import type { ResolutionEnvelope } from "../github/public-protocol";
import { currentRemaining, type RateLimit } from "../github/rate-limit";
import { formatBytes } from "./size";
import { isTextLanguage, textLines } from "./text-lines";

export type SizesView = {
  repositorySize: string;
  snapshotLabel: string;
};

export type ApiLimitView = {
  text: string;
  title: string;
  value: RateLimit;
  now: number;
};

export type ResultView = {
  codeLines: string;
  textLines: string;
  metrics: string;
  snapshotSize: string;
  intro: string[];
  codeSummary: string;
  codeRows: string[];
  textSummary: string;
  textRows: string[];
  otherSummary: string;
  otherRows: string[];
  moreOtherRows: string[];
  noLanguages?: string;
  coverage: string;
  warning?: string;
  fileLimit: string;
  oversizedFiles: { path: string; size: string; url: string }[];
  oversizedNote?: string;
};

export const VISIBLE_OTHER_ROWS = 10;

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

export function resultView(
  result: AnalysisResultV2,
  resolution: ResolutionEnvelope,
): ResultView {
  const { totals, coverage, engine } = result;
  const text = textLines(result.languages);
  const files = (rows: { files: number }[]) =>
    rows.reduce((sum, row) => sum + row.files, 0).toLocaleString();
  const codeLanguages = result.languages
    .filter((row) => !isTextLanguage(row.language))
    .sort(bySize((row) => row.code));
  const textLanguages = result.languages
    .filter((row) => isTextLanguage(row.language))
    .sort(bySize((row) => row.comments));
  const codeRows = codeLanguages.map((row) => {
    const percent = totals.code === 0 ? 0 : (row.code / totals.code) * 100;
    return `${row.language}: ${row.code.toLocaleString()} code lines (${percent.toFixed(1)}% of code lines), ${row.files.toLocaleString()} files`;
  });
  const textRows = textLanguages.map((row) => {
    const percent = text === 0 ? 0 : (row.comments / text) * 100;
    return `${row.language}: ${row.comments.toLocaleString()} text lines (${percent.toFixed(1)}% of text lines), ${row.files.toLocaleString()} files`;
  });
  const other = result.otherFiles;
  const otherRows = other.extensions.map(
    (row) =>
      `${row.extension || "No extension"}: ${row.lines.toLocaleString()} lines, ${row.files.toLocaleString()} files`,
  );
  const restFiles =
    other.files - other.extensions.reduce((sum, row) => sum + row.files, 0);
  const restLines =
    other.lines - other.extensions.reduce((sum, row) => sum + row.lines, 0);
  if (other.moreExtensions > 0)
    otherRows.push(
      `${other.moreExtensions.toLocaleString()} more ${other.moreExtensions === 1 ? "extension" : "extensions"}: ${restLines.toLocaleString()} lines, ${restFiles.toLocaleString()} files`,
    );
  const skipped = coverage.skippedByReason;
  const oversizedFiles = (coverage.oversizedFiles ?? []).map((file) => ({
    path: file.path,
    size: formatBytes(file.bytes),
    url: `https://github.com/${encodeURIComponent(resolution.owner)}/${encodeURIComponent(resolution.name)}/blob/${result.revision.commitSha}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
  }));
  const unlisted = skipped.oversized_source - oversizedFiles.length;
  return {
    codeLines: `${totals.code.toLocaleString()} code lines`,
    textLines: `${text.toLocaleString()} text lines`,
    metrics: `${totals.files.toLocaleString()} files · ${totals.lines.toLocaleString()} physical lines · ${totals.comments.toLocaleString()} comments · ${totals.blanks.toLocaleString()} blanks`,
    snapshotSize: formatBytes(coverage.totalBytes),
    intro: [
      `Default branch ${resolution.defaultBranch} · commit ${resolution.sha.slice(0, 12)}`,
      `${engine.name} ${engine.version} · ${engine.rulesProfile} profile, rules ${engine.rulesVersion} · wrapper ${engine.wrapperVersion}`,
      "Repository source was downloaded directly from GitHub and analyzed in your browser.",
    ],
    codeSummary: `${codeLanguages.reduce((sum, row) => sum + row.code, 0).toLocaleString()} code lines · ${files(codeLanguages)} files`,
    codeRows,
    textSummary: `${text.toLocaleString()} text lines · ${files(textLanguages)} files`,
    textRows,
    otherSummary: `${other.lines.toLocaleString()} lines · ${other.files.toLocaleString()} files`,
    otherRows: otherRows.slice(0, VISIBLE_OTHER_ROWS),
    moreOtherRows: otherRows.slice(VISIBLE_OTHER_ROWS),
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
    ? "GitHub API requests left for your connected GitHub account. Each repository lookup uses up to 2."
    : "Unauthenticated GitHub API requests left for your network. Each repository lookup uses up to 2.";
  return {
    text: `API ${currentRemaining(value, now).toLocaleString()}/${value.limit.toLocaleString()}`,
    title:
      now >= value.reset
        ? title
        : `${title} Resets at ${new Date(value.reset).toLocaleTimeString()}.`,
    value,
    now,
  };
}
