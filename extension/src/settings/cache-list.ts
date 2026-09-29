import type { CachedResultSummary } from "../github/cache";

const steps: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Infinity],
];

export function relativeTime(then: number, now: number): string {
  let value = (then - now) / 1000;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size || unit === "year") {
      if (unit === "second" && Math.abs(value) < 45) return "just now";
      return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
        Math.round(value),
        unit,
      );
    }
    value /= size;
  }
  return "";
}

export function cacheSummary(entries: CachedResultSummary[]): string {
  if (!entries.length) return "No saved results.";
  const repositories = new Set(
    entries.map((entry) => `${entry.owner}/${entry.name}`.toLowerCase()),
  ).size;
  return `${entries.length.toLocaleString()} ${entries.length === 1 ? "result" : "results"} for ${repositories.toLocaleString()} ${repositories === 1 ? "repository" : "repositories"}`;
}
