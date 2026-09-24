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
  | "oversized_source";
export type AnalysisResultV1 = {
  schemaVersion: 1;
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
  coverage: {
    regularFiles: number;
    countedFiles: number;
    analyzedBytes: number;
    skippedFiles: number;
    skippedByReason: Record<SkippedReason, number>;
    complete: boolean;
    incompleteReasons: ("oversized_source" | "counter_inaccurate")[];
  };
};

const reasons: SkippedReason[] = [
  "excluded_by_rule",
  "unsupported_language",
  "binary_content",
  "oversized_source",
];
const incomplete = ["counter_inaccurate", "oversized_source"];
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

export function validateResult(value: unknown): value is AnalysisResultV1 {
  if (
    !record(value) ||
    !keys(value, [
      "schemaVersion",
      "repository",
      "revision",
      "engine",
      "totals",
      "languages",
      "coverage",
    ]) ||
    value.schemaVersion !== 1
  )
    return false;
  const { repository, revision, engine, totals, languages, coverage } = value;
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
    engine.version !== "15.0.0" ||
    engine.wrapperVersion !== "1" ||
    engine.rulesVersion !== "1" ||
    engine.coveragePolicyVersion !== "1" ||
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
      "skippedFiles",
      "skippedByReason",
      "complete",
      "incompleteReasons",
    ]) ||
    !integer(coverage.regularFiles) ||
    !integer(coverage.countedFiles) ||
    !integer(coverage.analyzedBytes) ||
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
    coverage.complete !== (coverage.incompleteReasons.length === 0)
  )
    return false;
  return true;
}
