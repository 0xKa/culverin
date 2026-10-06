import { type Auth } from "../auth/connection";
import { type Fetcher } from "../github/client";
import {
  mergeRateLimit,
  RATE_LIMIT_KEY,
  readRateLimit,
  validRateLimit,
  type RateLimit,
} from "../github/rate-limit";

export function createRateLimitTracker(
  chrome: typeof globalThis.chrome,
  fetch: Fetcher,
) {
  let rateLimitTail: Promise<void> = Promise.resolve();
  function record(next: RateLimit): Promise<void> {
    rateLimitTail = rateLimitTail
      .then(async () => {
        const stored = (await chrome.storage.session.get(RATE_LIMIT_KEY))[
          RATE_LIMIT_KEY
        ];
        const current = validRateLimit(stored) ? stored : undefined;
        if (!next.authenticated && current?.authenticated) return;
        await chrome.storage.session.set({
          [RATE_LIMIT_KEY]: mergeRateLimit(current, next),
        });
      })
      .catch(() => undefined);
    return rateLimitTail;
  }
  function trackedFetch(authenticated: boolean): Fetcher {
    return async (input, init) => {
      const response = await fetch(input, init);
      const next = readRateLimit(response.headers, authenticated);
      if (next) void record(next);
      return response;
    };
  }
  const rateLimitedUntil = new Map<string, number>();
  const bucket = (auth: Auth) => (auth.token ? auth.generation : "anonymous");
  const limitedUntil = (key: string) => rateLimitedUntil.get(key) ?? 0;
  function markLimited(key: string, retryAt?: number): void {
    rateLimitedUntil.set(
      key,
      typeof retryAt === "number" ? retryAt : Date.now() + 60_000,
    );
  }

  return {
    trackedFetch,
    record,
    bucket,
    limitedUntil,
    markLimited,
    clear: (generation: string) => rateLimitedUntil.delete(generation),
  };
}
