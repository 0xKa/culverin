export const RATE_LIMIT_KEY = "github.rateLimit";

export type RateLimit = {
  limit: number;
  remaining: number;
  reset: number;
  authenticated?: true;
};

function count(headers: Headers, name: string): number {
  const value = headers.get(name);
  return value !== null && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
}

export function validRateLimit(value: unknown): value is RateLimit {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const { limit, remaining, reset, authenticated } = value as Record<
    string,
    unknown
  >;
  return (
    Object.keys(value).length === (authenticated === undefined ? 3 : 4) &&
    (authenticated === undefined || authenticated === true) &&
    Number.isSafeInteger(limit) &&
    (limit as number) > 0 &&
    Number.isSafeInteger(remaining) &&
    (remaining as number) >= 0 &&
    (remaining as number) <= (limit as number) &&
    Number.isSafeInteger(reset) &&
    (reset as number) > 0
  );
}

export function readRateLimit(
  headers: Headers,
  authenticated = false,
): RateLimit | undefined {
  const resource = headers.get("x-ratelimit-resource");
  if (resource !== null && resource !== "core") return undefined;
  const value = {
    limit: count(headers, "x-ratelimit-limit"),
    remaining: count(headers, "x-ratelimit-remaining"),
    reset: count(headers, "x-ratelimit-reset") * 1000,
    ...(authenticated ? { authenticated: true as const } : {}),
  };
  return validRateLimit(value) ? value : undefined;
}

function member(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function readRateLimitBody(
  body: unknown,
  authenticated = false,
): RateLimit | undefined {
  const core = member(member(body, "resources"), "core");
  const reset = member(core, "reset");
  const value = {
    limit: member(core, "limit"),
    remaining: member(core, "remaining"),
    reset: Number.isSafeInteger(reset) ? (reset as number) * 1000 : NaN,
    ...(authenticated ? { authenticated: true as const } : {}),
  };
  return validRateLimit(value) ? value : undefined;
}

export function mergeRateLimit(
  current: RateLimit | undefined,
  next: RateLimit,
): RateLimit {
  if (
    !current ||
    current.authenticated !== next.authenticated ||
    next.reset > current.reset
  )
    return next;
  if (next.reset < current.reset) return current;
  return { ...next, remaining: Math.min(current.remaining, next.remaining) };
}

export function currentRemaining(value: RateLimit, now: number): number {
  return now >= value.reset ? value.limit : value.remaining;
}

export function currentUsed(value: RateLimit, now: number): number {
  return value.limit - currentRemaining(value, now);
}

export type UsageLevel = "low" | "medium" | "high";

export function usageLevel(value: RateLimit, now: number): UsageLevel {
  const used = (currentUsed(value, now) / value.limit) * 100;
  return used >= 80 ? "high" : used >= 50 ? "medium" : "low";
}

export function remainingPercent(value: RateLimit, now: number): number {
  return Math.round((currentRemaining(value, now) / value.limit) * 100);
}
