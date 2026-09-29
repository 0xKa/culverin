import type { AnalysisResultV2 } from "../counter/result";
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
  codeRows: string[];
  textRows: string[];
  noLanguages?: string;
  coverage: string;
  warning?: string;
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
  const codeRows = result.languages
    .filter((row) => !isTextLanguage(row.language))
    .map((row) => {
      const percent = totals.code === 0 ? 0 : (row.code / totals.code) * 100;
      return `${row.language}: ${row.code.toLocaleString()} code lines (${percent.toFixed(1)}% of code lines), ${row.files.toLocaleString()} files`;
    });
  const textRows = result.languages
    .filter((row) => isTextLanguage(row.language))
    .map((row) => {
      const percent = text === 0 ? 0 : (row.comments / text) * 100;
      return `${row.language}: ${row.comments.toLocaleString()} text lines (${percent.toFixed(1)}% of text lines), ${row.files.toLocaleString()} files`;
    });
  const skipped = coverage.skippedByReason;
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
    codeRows,
    textRows,
    noLanguages:
      result.languages.length === 0 ? "No language totals." : undefined,
    coverage: `Source profile coverage: ${coverage.countedFiles.toLocaleString()} of ${coverage.regularFiles.toLocaleString()} regular files counted; ${coverage.skippedFiles.toLocaleString()} skipped (${skipped.excluded_by_rule.toLocaleString()} excluded by Culverin ignore, ${skipped.unsupported_language.toLocaleString()} unsupported language, ${skipped.binary_content.toLocaleString()} binary, ${skipped.oversized_source.toLocaleString()} oversized).`,
    warning: coverage.complete
      ? undefined
      : `Partial analysis: ${coverage.incompleteReasons.map((reason) => (reason === "oversized_source" ? "some source files exceeded the safe size limit" : "some source counts may be inaccurate")).join("; ")}.`,
  };
}

export function apiLimitView(value: RateLimit, now: number): ApiLimitView {
  const title =
    "Unauthenticated GitHub API requests left for your network. Each repository lookup uses up to 2.";
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
