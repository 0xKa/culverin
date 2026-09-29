export const RATE_LIMIT_KEY = "github.rateLimit";

export type RateLimit = { limit: number; remaining: number; reset: number };

function count(headers: Headers, name: string): number {
  const value = headers.get(name);
  return value !== null && /^\d{1,15}$/.test(value) ? Number(value) : NaN;
}

export function validRateLimit(value: unknown): value is RateLimit {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const { limit, remaining, reset } = value as Record<string, unknown>;
  return (
    Object.keys(value).length === 3 &&
    Number.isSafeInteger(limit) &&
    (limit as number) > 0 &&
    Number.isSafeInteger(remaining) &&
    (remaining as number) >= 0 &&
    (remaining as number) <= (limit as number) &&
    Number.isSafeInteger(reset) &&
    (reset as number) > 0
  );
}

export function readRateLimit(headers: Headers): RateLimit | undefined {
  const resource = headers.get("x-ratelimit-resource");
  if (resource !== null && resource !== "core") return undefined;
  const value = {
    limit: count(headers, "x-ratelimit-limit"),
    remaining: count(headers, "x-ratelimit-remaining"),
    reset: count(headers, "x-ratelimit-reset") * 1000,
  };
  return validRateLimit(value) ? value : undefined;
}

export function mergeRateLimit(
  current: RateLimit | undefined,
  next: RateLimit,
): RateLimit {
  if (!current || next.reset > current.reset) return next;
  if (next.reset < current.reset) return current;
  return { ...next, remaining: Math.min(current.remaining, next.remaining) };
}

export function currentRemaining(value: RateLimit, now: number): number {
  return now >= value.reset ? value.limit : value.remaining;
}

export function currentUsed(value: RateLimit, now: number): number {
  return value.limit - currentRemaining(value, now);
}
