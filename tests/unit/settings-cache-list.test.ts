import { expect, test } from "bun:test";
import type { CachedResultSummary } from "../../extension/src/github/cache";
import {
  cacheSummary,
  relativeTime,
} from "../../extension/src/settings/cache-list";

const now = Date.UTC(2026, 8, 29, 12);

test("describes timestamps relative to now", () => {
  expect(relativeTime(now - 10_000, now)).toBe("just now");
  expect(relativeTime(now - 25 * 60_000, now)).toBe("25 minutes ago");
  expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 hours ago");
  expect(relativeTime(now - 26 * 3_600_000, now)).toBe("yesterday");
  expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 days ago");
  expect(relativeTime(now - 400 * 86_400_000, now)).toBe("last year");
});

test("summarizes results and distinct repositories", () => {
  const entry = (owner: string, name: string) =>
    ({ owner, name }) as CachedResultSummary;
  expect(cacheSummary([])).toBe("No saved results.");
  expect(cacheSummary([entry("a", "b")])).toBe("1 result for 1 repository");
  expect(
    cacheSummary([entry("a", "b"), entry("A", "B"), entry("c", "d")]),
  ).toBe("3 results for 2 repositories");
});
