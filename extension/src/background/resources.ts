import { reconcileArchiveHost } from "./offscreen";
import { analyzeArchive } from "../archive/bridge";
import { ArchiveError } from "../archive/tar";
import { ConnectionStore } from "../auth/connection";
import { refreshGrant } from "../auth/device";
import {
  defaultIgnore,
  effectiveRulesHash,
  type IgnoreSettings,
} from "../counter/rules";
import { autoCountClaims } from "../counting/claims";
import {
  PrivateResultCache,
  PUBLIC_RESOLUTION_TTL,
  PublicResultCache,
  ResolutionCache,
  type Visibility,
} from "../github/cache";
import { safeFailure, type Fetcher } from "../github/client";
import { AnalysisCoordinator, type Marker } from "../github/coordinator";
import type { ResolutionEnvelope } from "../github/public-protocol";
import { validId } from "../github/public-protocol";
import { readIgnore } from "../ignore/settings";
import { createRateLimitTracker } from "./rate-limits";

export function createBackgroundResources(
  chrome: typeof globalThis.chrome,
  fetch: Fetcher,
  execute?: ConstructorParameters<typeof AnalysisCoordinator>[0],
) {
  const MARKER = "github.job";
  const LAST = "github.last";
  const rates = createRateLimitTracker(chrome, fetch);
  const cache = new PublicResultCache(chrome.storage.local);
  const privateResults = new PrivateResultCache(chrome.storage.local);
  const connection = new ConnectionStore(chrome.storage.local, (refreshToken) =>
    refreshGrant(fetch, refreshToken, AbortSignal.timeout(10_000)),
  );
  const refs = new ResolutionCache(
    Date.now,
    PUBLIC_RESOLUTION_TTL,
    chrome.storage.session,
  );
  const optionRefs = new ResolutionCache();
  async function invalidateResolutions(
    repositoryId: string,
    visibility?: Visibility,
  ): Promise<void> {
    await Promise.all([
      refs.invalidateRepository(repositoryId, visibility),
      optionRefs.invalidateRepository(repositoryId, visibility),
    ]);
  }
  const defaultRulesHash = effectiveRulesHash(defaultIgnore);
  async function currentRules(): Promise<{
    ignore: IgnoreSettings;
    hash: string;
  }> {
    const ignore = await readIgnore(chrome.storage.sync);
    return { ignore, hash: await effectiveRulesHash(ignore) };
  }
  let markerTail: Promise<void> = Promise.resolve();
  function saveMarkers(markers: Marker[]): void {
    markerTail = markerTail
      .then(async () => {
        if (markers.length)
          await chrome.storage.session.set({ [MARKER]: markers });
        else await chrome.storage.session.remove(MARKER);
      })
      .catch(() => undefined);
  }
  const claimAutoCount = autoCountClaims(chrome.storage.session);
  const coordinator = new AnalysisCoordinator(
    execute ??
      ((job, progress) =>
        analyzeArchive(
          job.resolution,
          job.token,
          job.signal,
          job.id,
          progress,
          job.ignore,
        )),
    saveMarkers,
  );
  const ready = Promise.all([
    connection.initialize(),
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
    chrome.storage.sync
      .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
      .catch(() => undefined),
  ]).then(async () => {
    await reconcileArchiveHost(chrome);
    const state = await chrome.storage.session.get(MARKER);
    const marker = state[MARKER];
    if (Array.isArray(marker)) {
      const interrupted = marker
        .filter(
          (value): value is Marker =>
            typeof value === "object" &&
            value !== null &&
            validId(value.requestId) &&
            typeof value.owner === "string" &&
            value.owner.length <= 200 &&
            /^(?:p:[0-9]+:[^:]+:|o:[^:]+:|u:[0-9]+:)[0-9a-f-]{36}$/i.test(
              value.owner,
            ) &&
            typeof value.public === "boolean" &&
            value.public ===
              (value.owner.startsWith("p:") || value.owner.startsWith("u:")),
        )
        .slice(0, 32);
      await chrome.storage.session.remove(MARKER);
      await chrome.storage.session.set({ [LAST]: interrupted });
    } else if (marker) {
      await chrome.storage.session.remove(MARKER);
    }
  });

  const pending = new Map<
    string,
    { requestId: string; controller: AbortController }
  >();

  function detachPending(prefix: string): void {
    for (const [owner, value] of pending)
      if (owner.startsWith(prefix)) {
        value.controller.abort("navigation");
        pending.delete(owner);
      }
  }

  async function interrupted(owner: string): Promise<boolean> {
    const state = await chrome.storage.session.get(LAST);
    return (
      Array.isArray(state[LAST]) &&
      state[LAST].some(
        (item: unknown) =>
          typeof item === "object" &&
          item !== null &&
          "owner" in item &&
          item.owner === owner,
      )
    );
  }

  async function clearInterrupted(owner: string): Promise<void> {
    const state = await chrome.storage.session.get(LAST);
    if (!Array.isArray(state[LAST])) return;
    const remaining = state[LAST].filter(
      (item: unknown) =>
        typeof item !== "object" ||
        item === null ||
        !("owner" in item) ||
        item.owner !== owner,
    );
    if (remaining.length)
      await chrome.storage.session.set({ [LAST]: remaining });
    else await chrome.storage.session.remove(LAST);
  }

  const seen = new Map<string, number>();
  function acceptRequest(requestId: string): boolean {
    const now = Date.now();
    for (const [id, at] of seen) if (now - at > 60_000) seen.delete(id);
    if (seen.has(requestId)) return false;
    if (seen.size >= 100) seen.delete(seen.keys().next().value!);
    seen.set(requestId, now);
    return true;
  }
  function cancelRequest(
    owner: string,
    target: string,
    reason = "cancel",
  ): boolean {
    const resolving = pending.get(owner);
    if (resolving?.requestId === target) {
      resolving.controller.abort(reason);
      pending.delete(owner);
      return true;
    }
    return coordinator.detach(owner, target);
  }
  function finishPending(owner: string, requestId: string): void {
    if (pending.get(owner)?.requestId === requestId) pending.delete(owner);
  }
  async function confirmPrivate(envelope: ResolutionEnvelope): Promise<void> {
    await cache.purgeRepository(envelope.repositoryId);
    await invalidateResolutions(envelope.repositoryId, "public");
    coordinator.abortPublicRepository(envelope.repositoryId);
  }
  function analysisFailure(
    error: unknown,
    signal: AbortSignal,
    publicSurface = false,
  ) {
    return signal.aborted && signal.reason === "visibility"
      ? { code: "repository_unavailable" as const }
      : signal.aborted && signal.reason === "disconnect"
        ? { code: "analysis_interrupted" as const }
        : publicSurface &&
            error instanceof Error &&
            error.message === "analysis_busy"
          ? { code: "analysis_busy" as const }
          : error instanceof Error && error.message === "analysis_canceled"
            ? { code: "analysis_canceled" as const }
            : error instanceof ArchiveError
              ? { code: error.code, limit: error.limit }
              : safeFailure(error, signal);
  }

  return {
    chrome,
    fetch,
    cache,
    privateResults,
    connection,
    refs,
    optionRefs,
    invalidateResolutions,
    defaultRulesHash,
    currentRules,
    claimAutoCount,
    coordinator,
    ready,
    pending,
    detachPending,
    interrupted,
    clearInterrupted,
    acceptRequest,
    cancelRequest,
    finishPending,
    confirmPrivate,
    analysisFailure,
    rates,
  };
}

export type BackgroundResources = ReturnType<typeof createBackgroundResources>;
