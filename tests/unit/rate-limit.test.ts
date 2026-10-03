import { expect, test } from "bun:test";
import {
  currentRemaining,
  currentUsed,
  remainingPercent,
  usageLevel,
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

test("tags signed-in limits and replaces a value from the other kind", () => {
  expect(
    readRateLimit(
      headers({
        "x-ratelimit-limit": "5000",
        "x-ratelimit-remaining": "4990",
        "x-ratelimit-reset": "1790684233",
        "x-ratelimit-resource": "core",
      }),
      true,
    ),
  ).toEqual({
    limit: 5000,
    remaining: 4990,
    reset: 1790684233000,
    authenticated: true,
  });
  const anonymous = { limit: 60, remaining: 10, reset: 3000 };
  const account = {
    limit: 5000,
    remaining: 4990,
    reset: 2000,
    authenticated: true as const,
  };
  expect(mergeRateLimit(anonymous, account)).toEqual(account);
  expect(mergeRateLimit(account, anonymous)).toEqual(anonymous);
  expect(
    mergeRateLimit(account, { ...account, remaining: 4980 }).remaining,
  ).toBe(4980);
  expect(apiLimitView(account, 0).title).toContain("GitHub account");
  expect(apiLimitView(account, 0).title).toContain("shared with your other");
  expect(apiLimitView(anonymous, 0).title).toContain("Unauthenticated");
});

test("validates stored values", () => {
  expect(
    validRateLimit({
      limit: 5000,
      remaining: 0,
      reset: 1,
      authenticated: true,
    }),
  ).toBe(true);
  expect(
    validRateLimit({ limit: 60, remaining: 0, reset: 1, authenticated: false }),
  ).toBe(false);
  expect(validRateLimit({ limit: 60, remaining: 0, reset: 1 })).toBe(true);
  expect(validRateLimit({ limit: 60, remaining: 0 })).toBe(false);
  expect(validRateLimit({ limit: 60, remaining: 0, reset: 1, x: 1 })).toBe(
    false,
  );
  expect(validRateLimit({ limit: 60, remaining: "1", reset: 1 })).toBe(false);
  expect(validRateLimit(null)).toBe(false);
});

test("grades usage by the share of the limit already used", () => {
  const at = (remaining: number) => ({ limit: 60, remaining, reset: 5000 });
  expect(usageLevel(at(60), 0)).toBe("low");
  expect(usageLevel(at(31), 0)).toBe("low");
  expect(usageLevel(at(30), 0)).toBe("medium");
  expect(usageLevel(at(13), 0)).toBe("medium");
  expect(usageLevel(at(12), 0)).toBe("high");
  expect(usageLevel(at(0), 0)).toBe("high");
  expect(usageLevel(at(0), 5000)).toBe("low");
  expect(remainingPercent(at(46), 0)).toBe(77);
  expect(remainingPercent(at(0), 0)).toBe(0);
  expect(remainingPercent(at(0), 5000)).toBe(100);
});

test("treats a passed reset time as a full allowance", () => {
  const value = { limit: 60, remaining: 3, reset: 5000 };
  expect(currentRemaining(value, 4999)).toBe(3);
  expect(currentRemaining(value, 5000)).toBe(60);
  expect(currentUsed(value, 4999)).toBe(57);
  expect(currentUsed(value, 5000)).toBe(0);
  const pending = apiLimitView(value, 4999);
  expect(pending.text).toBe("API 3/60");
  expect(pending.reset).toStartWith("Resets at ");
  expect(pending.title).not.toContain("Resets at");
  const reset = apiLimitView(value, 5000);
  expect(reset.text).toBe("API 60/60");
  expect(reset.reset).toBeUndefined();
});
