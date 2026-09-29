import { expect, test } from "bun:test";
import {
  currentRemaining,
  mergeRateLimit,
  readRateLimit,
  validRateLimit,
} from "../../extension/src/github/rate-limit";
import { apiLimitView } from "../../extension/src/popup/view";

function headers(values: Record<string, string>): Headers {
  return new Headers(values);
}

test("reads the core rate limit from GitHub response headers", () => {
  expect(
    readRateLimit(
      headers({
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "57",
        "x-ratelimit-reset": "1790684233",
        "x-ratelimit-resource": "core",
      }),
    ),
  ).toEqual({ limit: 60, remaining: 57, reset: 1790684233000 });
  expect(
    readRateLimit(
      headers({
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1790684233",
      }),
    ),
  ).toEqual({ limit: 60, remaining: 0, reset: 1790684233000 });
});

test("ignores other resources and malformed headers", () => {
  const base = {
    "x-ratelimit-limit": "60",
    "x-ratelimit-remaining": "57",
    "x-ratelimit-reset": "1790684233",
  };
  expect(
    readRateLimit(headers({ ...base, "x-ratelimit-resource": "search" })),
  ).toBeUndefined();
  expect(readRateLimit(headers({}))).toBeUndefined();
  expect(
    readRateLimit(headers({ ...base, "x-ratelimit-remaining": "-1" })),
  ).toBeUndefined();
  expect(
    readRateLimit(headers({ ...base, "x-ratelimit-remaining": "61" })),
  ).toBeUndefined();
  expect(
    readRateLimit(headers({ ...base, "x-ratelimit-limit": "0" })),
  ).toBeUndefined();
  expect(
    readRateLimit(headers({ ...base, "x-ratelimit-reset": "1.5" })),
  ).toBeUndefined();
});

test("keeps the newest window and the lowest count within a window", () => {
  const first = { limit: 60, remaining: 40, reset: 2000 };
  expect(mergeRateLimit(undefined, first)).toEqual(first);
  expect(mergeRateLimit(first, { ...first, remaining: 45 })).toEqual(first);
  expect(mergeRateLimit(first, { ...first, remaining: 38 })).toEqual({
    ...first,
    remaining: 38,
  });
  expect(mergeRateLimit(first, { ...first, reset: 1000 })).toEqual(first);
  const next = { limit: 60, remaining: 59, reset: 3000 };
  expect(mergeRateLimit(first, next)).toEqual(next);
});

test("validates stored values", () => {
  expect(validRateLimit({ limit: 60, remaining: 0, reset: 1 })).toBe(true);
  expect(validRateLimit({ limit: 60, remaining: 0 })).toBe(false);
  expect(validRateLimit({ limit: 60, remaining: 0, reset: 1, x: 1 })).toBe(
    false,
  );
  expect(validRateLimit({ limit: 60, remaining: "1", reset: 1 })).toBe(false);
  expect(validRateLimit(null)).toBe(false);
});

test("treats a passed reset time as a full allowance", () => {
  const value = { limit: 60, remaining: 3, reset: 5000 };
  expect(currentRemaining(value, 4999)).toBe(3);
  expect(currentRemaining(value, 5000)).toBe(60);
  const pending = apiLimitView(value, 4999);
  expect(pending.text).toBe("API 3/60");
  expect(pending.title).toContain("Resets at");
  const reset = apiLimitView(value, 5000);
  expect(reset.text).toBe("API 60/60");
  expect(reset.title).not.toContain("Resets at");
});
