import {
  coveragePolicyVersion,
  engineVersion,
  rulesVersion,
  wrapperVersion,
} from "./rules";
export type LineCounts = {
  lines: number;
  code: number;
  comments: number;
  blanks: number;
};
export type LanguageCounts = LineCounts & { language: string; files: number };
export type SkippedReason =
  | "excluded_by_rule"
  | "unsupported_language"
  | "binary_content"
  | "oversized_source"
  | "unsupported_notebook";
export type OtherExtension = {
  extension: string;
  files: number;
  lines: number;
};
export type AnalysisResultV2 = {
  schemaVersion: 2;
  repository: { id: string };
  revision: { commitSha: string };
  engine: {
    name: "tokei";
    version: string;
    wrapperVersion: string;
    rulesProfile: "source-v1";
    rulesVersion: string;
    rulesHash: string;
    coveragePolicyVersion: string;
  };
  totals: LineCounts & { files: number };
  languages: LanguageCounts[];
  otherFiles: { files: number; lines: number; extensions: OtherExtension[] };
  coverage: {
    regularFiles: number;
    countedFiles: number;
    analyzedBytes: number;
    totalBytes: number;
    skippedFiles: number;
    skippedByReason: Record<SkippedReason, number>;
    complete: boolean;
    incompleteReasons: "oversized_source"[];
  };
};

const reasons: SkippedReason[] = [
  "excluded_by_rule",
  "unsupported_language",
  "binary_content",
  "oversized_source",
  "unsupported_notebook",
];
const incomplete = ["oversized_source"];
export const MAX_OTHER_EXTENSIONS = 100;
const integer = (x: unknown): x is number =>
  Number.isSafeInteger(x) && (x as number) >= 0;
const record = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);
const keys = (x: Record<string, unknown>, expected: string[]) =>
  Object.keys(x).sort().join("|") === expected.sort().join("|");
const counts = (x: unknown): x is LineCounts =>
  record(x) &&
  [x.lines, x.code, x.comments, x.blanks].every(integer) &&
  x.lines ===
    (x.code as number) + (x.comments as number) + (x.blanks as number);

export function validateResult(value: unknown): value is AnalysisResultV2 {
  if (
    !record(value) ||
    !keys(value, [
      "schemaVersion",
      "repository",
      "revision",
      "engine",
      "totals",
      "languages",
      "otherFiles",
      "coverage",
    ]) ||
    value.schemaVersion !== 2
  )
    return false;
  const {
    repository,
    revision,
    engine,
    totals,
    languages,
    otherFiles,
    coverage,
  } = value;
  if (
    !record(repository) ||
    !keys(repository, ["id"]) ||
    typeof repository.id !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(repository.id)
  )
    return false;
  if (
    !record(revision) ||
    !keys(revision, ["commitSha"]) ||
    typeof revision.commitSha !== "string" ||
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision.commitSha)
  )
    return false;
  if (
    !record(engine) ||
    !keys(engine, [
      "name",
      "version",
      "wrapperVersion",
      "rulesProfile",
      "rulesVersion",
      "rulesHash",
      "coveragePolicyVersion",
    ]) ||
    engine.name !== "tokei" ||
    engine.rulesProfile !== "source-v1" ||
    engine.version !== engineVersion ||
    engine.wrapperVersion !== wrapperVersion ||
    engine.rulesVersion !== rulesVersion ||
    engine.coveragePolicyVersion !== coveragePolicyVersion ||
    typeof engine.rulesHash !== "string" ||
    !/^[0-9a-f]{64}$/.test(engine.rulesHash)
  )
    return false;
  if (
    !counts(totals) ||
    !record(totals) ||
    !keys(totals, ["lines", "code", "comments", "blanks", "files"]) ||
    !integer((totals as Record<string, unknown>).files)
  )
    return false;
  const total = totals as LineCounts & { files: number };
  if (!Array.isArray(languages)) return false;
  const sums = { lines: 0, code: 0, comments: 0, blanks: 0, files: 0 };
  let previous = "";
  for (const candidate of languages) {
    const row = candidate as LanguageCounts;
    if (
      !counts(row) ||
      !keys(row, [
        "language",
        "files",
        "lines",
        "code",
        "comments",
        "blanks",
      ]) ||
      typeof row.language !== "string" ||
      !row.language ||
      row.language <= previous ||
      !integer(row.files)
    )
      return false;
    previous = row.language;
    for (const key of [
      "lines",
      "code",
      "comments",
      "blanks",
      "files",
    ] as const) {
      sums[key] += row[key];
      if (!integer(sums[key])) return false;
    }
  }
  for (const key of ["lines", "code", "comments", "blanks", "files"] as const)
    if (sums[key] !== total[key]) return false;
  if (
    !record(coverage) ||
    !keys(coverage, [
      "regularFiles",
      "countedFiles",
      "analyzedBytes",
      "totalBytes",
      "skippedFiles",
      "skippedByReason",
      "complete",
      "incompleteReasons",
    ]) ||
    !integer(coverage.regularFiles) ||
    !integer(coverage.countedFiles) ||
    !integer(coverage.analyzedBytes) ||
    !integer(coverage.totalBytes) ||
    coverage.totalBytes < coverage.analyzedBytes ||
    (coverage.skippedFiles === 0 &&
      coverage.totalBytes !== coverage.analyzedBytes) ||
    !integer(coverage.skippedFiles) ||
    coverage.countedFiles !== total.files ||
    coverage.regularFiles !== coverage.countedFiles + coverage.skippedFiles ||
    typeof coverage.complete !== "boolean"
  )
    return false;
  if (
    !record(coverage.skippedByReason) ||
    !keys(coverage.skippedByReason, reasons) ||
    !reasons.every((x) =>
      integer((coverage.skippedByReason as Record<string, unknown>)[x]),
    ) ||
    reasons.reduce(
      (n, x) => n + (coverage.skippedByReason as Record<string, number>)[x]!,
      0,
    ) !== coverage.skippedFiles
  )
    return false;
  if (
    !Array.isArray(coverage.incompleteReasons) ||
    !coverage.incompleteReasons.every(
      (x) => typeof x === "string" && incomplete.includes(x),
    ) ||
    [...coverage.incompleteReasons].sort().join("|") !==
      coverage.incompleteReasons.join("|") ||
    new Set(coverage.incompleteReasons).size !==
      coverage.incompleteReasons.length ||
    coverage.complete !== (coverage.incompleteReasons.length === 0) ||
    coverage.complete !==
      ((coverage.skippedByReason as Record<string, number>).oversized_source ===
        0)
  )
    return false;
  return validOtherFiles(
    otherFiles,
    (coverage.skippedByReason as Record<string, number>).unsupported_language!,
  );
}

function validOtherFiles(value: unknown, files: number): boolean {
  if (
    !record(value) ||
    !keys(value, ["files", "lines", "extensions"]) ||
    value.files !== files ||
    !integer(value.lines) ||
    !Array.isArray(value.extensions) ||
    value.extensions.length > MAX_OTHER_EXTENSIONS
  )
    return false;
  let previous: OtherExtension | undefined;
  let sumFiles = 0;
  let sumLines = 0;
  for (const candidate of value.extensions as unknown[]) {
    if (
      !record(candidate) ||
      !keys(candidate, ["extension", "files", "lines"]) ||
      typeof candidate.extension !== "string" ||
      !/^(?:|\.[a-z0-9_+-]{1,16})$/.test(candidate.extension) ||
      !integer(candidate.files) ||
      candidate.files === 0 ||
      !integer(candidate.lines)
    )
      return false;
    const row = candidate as OtherExtension;
    if (
      previous &&
      (previous.lines < row.lines ||
        (previous.lines === row.lines &&
          (previous.files < row.files ||
            (previous.files === row.files &&
              previous.extension >= row.extension))))
    )
      return false;
    previous = row;
    sumFiles += row.files;
    sumLines += row.lines;
  }
  return sumFiles <= value.files && sumLines <= value.lines;
}
