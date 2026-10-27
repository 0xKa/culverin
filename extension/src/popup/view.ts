import type { AnalysisResultV2 } from "../counter/result";
import { ARCHIVE_LIMITS } from "../archive/limits";
import type { ResolutionEnvelope } from "../github/public-protocol";
import { currentRemaining, type RateLimit } from "../github/rate-limit";
import {
  defaultNumberFormats,
  exactBytes,
  formatBytes,
  formatClockTime,
  formatCount,
  type NumberFormats,
} from "../ui/format";
import { refUrl, refView, type RefView } from "../ui/ref";
import { isTextLanguage, textLines } from "./text-lines";

export type ApiLimitView = {
  text: string;
  reset?: string;
  title: string;
  value: RateLimit;
  now: number;
};

export type BreakdownRow = {
  label: string;
  title?: string;
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

export type CoveragePart = {
  text: string;
  link?: "ignore";
};

export type ResultView = {
  codeTotal: string;
  codeTitle?: string;
  fileTotal: string;
  fileLabel: string;
  fileTitle: string;
  stats: StatView[];
  commit: string;
  snapshotSize: string;
  sizeTitle: string;
  cloneSize?: string;
  cloneTitle?: string;
  revision: RefView;
  url: string;
  codeSummary: string[];
  codeSummaryTitle?: string;
  codeRows: BreakdownRow[];
  textSummary: string[];
  textSummaryTitle?: string;
  textRows: BreakdownRow[];
  otherSummary: string[];
  otherSummaryTitle?: string;
  otherRows: BreakdownRow[];
  noLanguages?: string;
  coverage: string;
  notCounted?: CoveragePart[];
  warning?: string;
  oversizedFiles: {
    path: string;
    size: string;
    sizeTitle: string;
    url: string;
  }[];
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

export const TEXT_LINES_TITLE =
  "Non-blank prose lines in Markdown, MDX, Djot, and plain text files";

function coverageText(
  coverage: AnalysisResultV2["coverage"],
): Pick<ResultView, "coverage" | "notCounted"> {
  const total = coverage.regularFiles.toLocaleString();
  if (coverage.regularFiles === 0) return { coverage: "No files to count." };
  const skipped = coverage.skippedByReason;
  const counted = coverage.countedFiles + skipped.unsupported_language;
  if (counted === coverage.regularFiles)
    return {
      coverage: `Counted all ${total} ${coverage.regularFiles === 1 ? "file" : "files"}.`,
    };
  const rules = skipped.excluded_by_rule;
  const reasons: [number, CoveragePart[]][] = [
    [skipped.binary_content, [{ text: "binary" }]],
    [
      rules,
      [
        { text: rules === 1 ? "matched an " : "matched " },
        { text: rules === 1 ? "ignore rule" : "ignore rules", link: "ignore" },
      ],
    ],
    [
      skipped.unsupported_notebook,
      [
        {
          text:
            skipped.unsupported_notebook === 1
              ? "unsupported notebook"
              : "unsupported notebooks",
        },
      ],
    ],
    [skipped.oversized_source, [{ text: "oversized" }]],
  ];
  const parts: CoveragePart[] = [
    { text: "Not counted: " },
    ...reasons
      .filter(([value]) => value > 0)
      .flatMap(([value, label], index) => [
        { text: `${index > 0 ? ", " : ""}${value.toLocaleString()} ` },
        ...label,
      ]),
    { text: "." },
  ];
  return {
    coverage: `Counted ${counted.toLocaleString()} of ${total} files.`,
    notCounted: parts.reduce<CoveragePart[]>((merged, part) => {
      const last = merged.at(-1);
      if (last && !last.link && !part.link) last.text += part.text;
      else merged.push({ ...part });
      return merged;
    }, []),
  };
}

const share = (part: number, whole: number) =>
  whole === 0 ? 0 : (part / whole) * 100;

export function resultView(
  result: AnalysisResultV2,
  resolution: ResolutionEnvelope,
  formats: NumberFormats = defaultNumberFormats,
): ResultView {
  const { totals, coverage } = result;
  const count = (value: number) => formatCount(value, formats.counts);
  const bytes = (value: number) => formatBytes(value, undefined, formats.sizes);
  const exact = (text: string) =>
    formats.counts === "abbreviated" ? text : undefined;
  const fileCount = (value: number) =>
    `${count(value)} ${value === 1 ? "file" : "files"}`;
  const stat = (
    label: string,
    value: number,
    title?: string,
    id?: string,
  ): StatView => ({
    label,
    value: count(value),
    ...(title || formats.counts === "abbreviated"
      ? {
          title:
            formats.counts === "abbreviated"
              ? `${value.toLocaleString()} ${label.toLowerCase()}.${title ? ` ${title}` : ""}`
              : title,
        }
      : {}),
    ...(id ? { id } : {}),
  });
  const text = textLines(result.languages);
  const files = (rows: { files: number }[]) =>
    rows.reduce((sum, row) => sum + row.files, 0);
  const codeLanguages = result.languages
    .filter((row) => !isTextLanguage(row.language))
    .sort(bySize((row) => row.code));
  const textLanguages = result.languages
    .filter((row) => isTextLanguage(row.language))
    .sort(bySize((row) => row.comments));
  const codeRows = codeLanguages.map((row): BreakdownRow => {
    const percent = share(row.code, totals.code);
    const label = `${row.language}: ${row.code.toLocaleString()} code lines (${percent.toFixed(1)}% of code lines), ${row.files.toLocaleString()} files`;
    return {
      label,
      ...(exact(label) ? { title: label } : {}),
      name: row.language,
      value: count(row.code),
      share: percent,
      files: fileCount(row.files),
    };
  });
  const textRows = textLanguages.map((row): BreakdownRow => {
    const percent = share(row.comments, text);
    const label = `${row.language}: ${row.comments.toLocaleString()} text lines (${percent.toFixed(1)}% of text lines), ${row.files.toLocaleString()} files`;
    return {
      label,
      ...(exact(label) ? { title: label } : {}),
      name: row.language,
      value: count(row.comments),
      share: percent,
      files: fileCount(row.files),
    };
  });
  const other = result.otherFiles;
  const otherRow = (name: string, lines: number, files: number) => {
    const label = `${name}: ${lines.toLocaleString()} lines, ${files.toLocaleString()} files`;
    return {
      label,
      ...(exact(label) ? { title: label } : {}),
      name,
      value: count(lines),
      share: share(lines, other.lines),
      files: fileCount(files),
    };
  };
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
    size: bytes(file.bytes),
    sizeTitle: exactBytes(file.bytes),
    url: `https://github.com/${encodeURIComponent(resolution.owner)}/${encodeURIComponent(resolution.name)}/blob/${result.revision.commitSha}/${file.path.split("/").map(encodeURIComponent).join("/")}`,
  }));
  const unlisted = skipped.oversized_source - oversizedFiles.length;
  const commit = resolution.sha.slice(0, 12);
  const snapshotSize = bytes(coverage.totalBytes);
  const historyBytes =
    resolution.sizeKb === null ? undefined : resolution.sizeKb * 1024;
  return {
    codeTotal: count(totals.code),
    codeTitle: exact(`${totals.code.toLocaleString()} code lines`),
    fileTotal: count(coverage.regularFiles),
    fileLabel: coverage.regularFiles === 1 ? "file" : "files",
    fileTitle: `${formats.counts === "abbreviated" ? `${coverage.regularFiles.toLocaleString()} ${coverage.regularFiles === 1 ? "file" : "files"}. ` : ""}All files at this commit, ${other.files > 0 ? `${(coverage.countedFiles + other.files).toLocaleString()} counted: ${coverage.countedFiles.toLocaleString()} as code or text, ${other.files.toLocaleString()} as other files.` : `${coverage.countedFiles.toLocaleString()} counted as code or text.`}`,
    stats: [
      stat("Text lines", text, TEXT_LINES_TITLE, "text-lines"),
      stat(
        "Physical lines",
        totals.lines,
        "Physical lines = code + comments + blanks",
      ),
      stat("Comments", totals.comments),
      stat("Blanks", totals.blanks),
    ],
    commit,
    snapshotSize,
    sizeTitle: `${exactBytes(coverage.totalBytes)}. Total size of the files at commit ${commit}, as checked out. Doesn't include Git history, so a cloned folder with its .git folder is larger.`,
    cloneSize:
      historyBytes === undefined
        ? undefined
        : `≈ ${bytes(coverage.totalBytes + historyBytes)}`,
    cloneTitle:
      historyBytes === undefined
        ? undefined
        : `Approximately ${exactBytes(coverage.totalBytes + historyBytes)}. The ${snapshotSize} of files plus the ${bytes(historyBytes)} of Git history that GitHub reports. GitHub updates its number only occasionally, so a real clone may differ.`,
    revision: refView(resolution),
    url: refUrl(resolution),
    codeSummary: [
      `${count(codeLanguages.reduce((sum, row) => sum + row.code, 0))} code lines`,
      `${count(files(codeLanguages))} files`,
    ],
    codeSummaryTitle: exact(
      `${codeLanguages.reduce((sum, row) => sum + row.code, 0).toLocaleString()} code lines, ${files(codeLanguages).toLocaleString()} files`,
    ),
    codeRows,
    textSummary: [
      `${count(text)} text lines`,
      `${count(files(textLanguages))} files`,
    ],
    textSummaryTitle: exact(
      `${text.toLocaleString()} text lines, ${files(textLanguages).toLocaleString()} files`,
    ),
    textRows,
    otherSummary: [
      `${count(other.lines)} lines`,
      `${count(other.files)} files`,
    ],
    otherSummaryTitle: exact(
      `${other.lines.toLocaleString()} lines, ${other.files.toLocaleString()} files`,
    ),
    otherRows,
    noLanguages:
      result.languages.length === 0 ? "No language totals." : undefined,
    ...coverageText(coverage),
    warning: skipped.oversized_source
      ? `${skipped.oversized_source.toLocaleString()} source ${skipped.oversized_source === 1 ? "file was" : "files were"} over the ${ARCHIVE_LIMITS.file / 1024 ** 2} MiB file limit and ${skipped.oversized_source === 1 ? "isn't" : "aren't"} included in these totals.`
      : undefined,
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
