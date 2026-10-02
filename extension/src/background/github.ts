import { validRepository } from "../github/repository";
import { ConnectionStore, type Auth } from "../auth/connection";
import {
  pollDeviceCode,
  refreshGrant,
  requestDeviceCode,
  type DeviceCode,
} from "../auth/device";
import { DEVICE_URL } from "../auth/github-app";
import { pendingKey, validPending } from "../auth/pending";
import {
  AcquisitionError,
  fetchLogin,
  resolveRepository,
  safeFailure,
  type Fetcher,
  type Resolution,
} from "../github/client";
import {
  mergeRateLimit,
  RATE_LIMIT_KEY,
  readRateLimit,
  validRateLimit,
} from "../github/rate-limit";
import { analyzeArchive } from "../archive/bridge";
import { ARCHIVE_TIMEOUTS } from "../archive/limits";
import { ArchiveError } from "../archive/tar";
import {
  POPUP_PORT,
  PUBLIC_PORT,
  publicFailure,
  validId,
  validPopupPublicRequest,
  validPublicRequest,
  type PublicErrorCode,
  type PublicPayload,
  type PublicReply,
  type PublicRequest,
  type SummaryUpdate,
} from "../github/public-protocol";
import type { AnalysisResultV2 } from "../counter/result";
import { pageRepository, sameRepository } from "../github/repository";
import {
  PrivateResultCache,
  PUBLIC_RESOLUTION_TTL,
  PublicResultCache,
  ResolutionCache,
  resolutionIdentity,
  type ResultCache,
  type Visibility,
} from "../github/cache";
import { AnalysisCoordinator, type Marker } from "../github/coordinator";
import {
  defaultIgnore,
  effectiveRulesHash,
  type IgnoreSettings,
} from "../counter/rules";
import { readIgnore } from "../ignore/settings";
import { readCountTrigger } from "../counting/trigger";
import { AUTO_COUNT_KEY, autoCountClaims } from "../counting/claims";
import { isPageUrl } from "./page-url";

const VERSION = 1;
const SETTINGS_URL = chrome.runtime.getURL("settings.html");
const POPUP_URL = chrome.runtime.getURL("popup.html");
const MARKER = "github.job";
const LAST = "github.last";
const DEVICE = "github.device";
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
  const ignore = await readIgnore();
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
let rateLimitTail: Promise<void> = Promise.resolve();
function trackedFetch(authenticated: boolean): Fetcher {
  return async (input, init) => {
    const response = await fetch(input, init);
    const next = readRateLimit(response.headers, authenticated);
    if (next)
      rateLimitTail = rateLimitTail
        .then(async () => {
          const stored = (await chrome.storage.session.get(RATE_LIMIT_KEY))[
            RATE_LIMIT_KEY
          ];
          const current = validRateLimit(stored) ? stored : undefined;
          if (!authenticated && current?.authenticated) return;
          await chrome.storage.session.set({
            [RATE_LIMIT_KEY]: mergeRateLimit(current, next),
          });
        })
        .catch(() => undefined);
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
async function connectionChanged(
  previous: string,
  options: { clearPrivate: boolean; clearRefs: boolean },
): Promise<void> {
  coordinator.abortGeneration(previous);
  rateLimitedUntil.delete(previous);
  await Promise.all([
    chrome.storage.session.remove([LAST, RATE_LIMIT_KEY]),
    ...(options.clearRefs ? [refs.clear(), optionRefs.clear()] : []),
    ...(options.clearPrivate ? [privateResults.clear()] : []),
  ]);
}
async function resolveFor(
  repository: { owner: string; name: string },
  auth: Auth,
): Promise<Resolution> {
  const anonymous = () =>
    resolveRepository(
      trackedFetch(false),
      repository.owner,
      repository.name,
      undefined,
      AbortSignal.timeout(10_000),
    );
  if (!auth.token) return anonymous();
  try {
    return await resolveRepository(
      trackedFetch(true),
      repository.owner,
      repository.name,
      auth.token,
      AbortSignal.timeout(10_000),
    );
  } catch (error) {
    if (!(error instanceof AcquisitionError)) throw error;
    if (error.code === "authentication_invalid") {
      if (await connection.expire(auth.generation))
        await connectionChanged(auth.generation, {
          clearPrivate: false,
          clearRefs: false,
        });
      return anonymous();
    }
    if (error.code !== "repository_unavailable") throw error;
    try {
      return await anonymous();
    } catch {
      throw error;
    }
  }
}
async function accessFailure(
  code: PublicErrorCode,
  auth: Auth,
  repository: { owner: string; name: string },
  resolving: boolean,
): Promise<PublicErrorCode> {
  if (code === "authentication_invalid" && auth.token) {
    if (await connection.expire(auth.generation))
      await connectionChanged(auth.generation, {
        clearPrivate: false,
        clearRefs: false,
      });
    return code;
  }
  if (code !== "repository_unavailable" && code !== "repository_forbidden")
    return code;
  if (!auth.token) return resolving ? "authentication_required" : code;
  await privateResults.purgeName(repository).catch(() => undefined);
  return "access_not_granted";
}
const coordinator = new AnalysisCoordinator(
  (job, progress) =>
    analyzeArchive(
      job.resolution,
      job.token,
      job.signal,
      job.id,
      progress,
      job.ignore,
    ),
  saveMarkers,
);
const ready = Promise.all([
  connection.initialize(),
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.sync
    .setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
    .catch(() => undefined),
]).then(async () => {
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

type Request = {
  protocolVersion: 1;
  type: string;
  requestId: string;
  navigationId: string;
  owner?: string;
  name?: string;
  targetRequestId?: string;
  submissionId?: string;
};

type DeviceState = DeviceCode & { generation: string; nextPollAt: number };
let device: DeviceState | undefined;

function validDevice(value: unknown): value is DeviceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  return (
    typeof state.deviceCode === "string" &&
    typeof state.userCode === "string" &&
    typeof state.generation === "string" &&
    [state.expiresAt, state.interval, state.nextPollAt].every(
      (item) => Number.isSafeInteger(item) && (item as number) > 0,
    )
  );
}

async function readDevice(): Promise<DeviceState | undefined> {
  if (device) return device;
  const stored: unknown = (await chrome.storage.session.get(DEVICE))[DEVICE];
  if (validDevice(stored)) device = stored;
  return device;
}

async function saveDevice(next?: DeviceState): Promise<void> {
  device = next;
  if (next) await chrome.storage.session.set({ [DEVICE]: next });
  else await chrome.storage.session.remove(DEVICE);
}

async function statusReply(): Promise<Record<string, unknown>> {
  const current = await readDevice();
  const active =
    current && Date.now() < current.expiresAt ? current : undefined;
  return {
    ...(await connection.status()),
    ...(active
      ? {
          device: {
            userCode: active.userCode,
            verificationUri: DEVICE_URL,
            expiresAt: active.expiresAt,
            interval: active.interval,
          },
        }
      : {}),
  };
}

const seen = new Map<string, number>();
const publicPorts = new Map<string, chrome.runtime.Port>();
const popupPorts = new Set<chrome.runtime.Port>();
type PopupViewer = {
  port: chrome.runtime.Port;
  request: PublicRequest;
};
type PopupJob = {
  owner: string;
  requestId: string;
  repository: { owner: string; name: string };
  viewer?: PopupViewer;
};
const popupJobs = new Map<number, PopupJob>();
const pending = new Map<
  string,
  { requestId: string; controller: AbortController }
>();

function publicOwner(
  tabId: number,
  documentId: string,
  navigationId: string,
): string {
  return `p:${tabId}:${documentId}:${navigationId}`;
}

function optionsOwner(documentId: string, navigationId: string): string {
  return `o:${documentId}:${navigationId}`;
}

function popupOwner(tabId: number, navigationId: string): string {
  return `u:${tabId}:${navigationId}`;
}

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
  if (remaining.length) await chrome.storage.session.set({ [LAST]: remaining });
  else await chrome.storage.session.remove(LAST);
}

function senderRepository(
  sender: chrome.runtime.MessageSender,
): { owner: string; name: string } | undefined {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !Number.isSafeInteger(sender.tab?.id) ||
    (sender.tab?.id ?? -1) < 0 ||
    typeof sender.documentId !== "string" ||
    !sender.url ||
    !sender.tab?.url
  )
    return undefined;
  let source: URL;
  try {
    source = new URL(sender.url);
  } catch {
    return undefined;
  }
  if (
    source.origin !== "https://github.com" ||
    source.username ||
    source.password
  )
    return undefined;
  return pageRepository(sender.tab.url);
}

function portKey(tabId: number, documentId: string): string {
  return `${tabId}:${documentId}`;
}

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
  if (port.name === POPUP_PORT) {
    if (
      sender?.id !== chrome.runtime.id ||
      sender.url !== POPUP_URL ||
      (sender.tab !== undefined && sender.frameId !== 0)
    ) {
      port.disconnect();
      return;
    }
    popupPorts.add(port);
    port.onMessage.addListener((value: unknown) =>
      handlePopupMessage(port, value),
    );
    port.onDisconnect.addListener(() => {
      popupPorts.delete(port);
      for (const job of popupJobs.values())
        if (job.viewer?.port === port) job.viewer = undefined;
    });
    return;
  }
  if (port.name === "culverin.options") {
    if (
      sender?.id !== chrome.runtime.id ||
      !isPageUrl(sender.url, SETTINGS_URL) ||
      sender.frameId !== 0 ||
      !sender.documentId
    ) {
      port.disconnect();
      return;
    }
    const prefix = `o:${sender.documentId}:`;
    port.onDisconnect.addListener(() => {
      coordinator.detachDocument(prefix);
      detachPending(prefix);
    });
    return;
  }
  if (
    port.name !== PUBLIC_PORT ||
    !sender ||
    !senderRepository(sender) ||
    sender.tab?.id === undefined ||
    !sender.documentId
  ) {
    port.disconnect();
    return;
  }
  const key = portKey(sender.tab.id, sender.documentId);
  if (publicPorts.has(key)) {
    coordinator.detachDocument(`p:${sender.tab.id}:${sender.documentId}:`);
    detachPending(`p:${sender.tab.id}:${sender.documentId}:`);
  }
  publicPorts.set(key, port);
  port.onDisconnect.addListener(() => {
    if (publicPorts.get(key) !== port) return;
    publicPorts.delete(key);
    coordinator.detachDocument(`p:${sender.tab?.id}:${sender.documentId}:`);
    detachPending(`p:${sender.tab?.id}:${sender.documentId}:`);
  });
});

function publicReply(
  request: PublicRequest,
  payload: PublicPayload,
): PublicReply {
  return {
    protocolVersion: 1,
    requestId: request.requestId,
    navigationId: request.navigationId,
    ...payload,
  } as PublicReply;
}

function publicProgress(
  tabId: number,
  documentId: string,
  request: PublicRequest,
  phase: "resolving" | "queued" | "downloading" | "decompressing" | "counting",
  processedBytes?: number,
): void {
  const message: PublicReply = {
    protocolVersion: 1,
    type: "analysis.progress",
    requestId: request.requestId,
    navigationId: request.navigationId,
    phase,
    ...(processedBytes === undefined ? {} : { processedBytes }),
  };
  void chrome.tabs
    .sendMessage(tabId, message, { documentId })
    .catch(() => undefined);
}

export function handleArchiveCounting(
  message: unknown,
  sender: chrome.runtime.MessageSender,
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("offscreen.html") ||
    !message ||
    typeof message !== "object"
  )
    return false;
  const value = message as Record<string, unknown>;
  if (value.type !== "archive.counting" || typeof value.requestId !== "string")
    return false;
  return coordinator.reportCounting(value.requestId);
}

type PublicClient = {
  repository: { owner: string; name: string };
  owner: string;
  prefix: string;
  page: boolean;
  force?: boolean;
  isAlive: () => boolean;
  reply: (request: PublicRequest, payload: PublicPayload) => void;
  progress: (
    request: PublicRequest,
    phase:
      "resolving" | "queued" | "downloading" | "decompressing" | "counting",
    processedBytes?: number,
  ) => void;
};

function runPublicRequest(request: PublicRequest, client: PublicClient): void {
  const { repository, owner } = client;
  const reply = (payload: PublicPayload) => client.reply(request, payload);
  void (async () => {
    await ready;
    if (!client.isAlive()) {
      reply({ type: "analysis.failed", code: "analysis_interrupted" });
      return;
    }
    const now = Date.now();
    for (const [id, at] of seen) if (now - at > 60_000) seen.delete(id);
    if (seen.has(request.requestId)) {
      reply({ type: "analysis.failed", code: "invalid_repository" });
      return;
    }
    if (seen.size >= 100) seen.delete(seen.keys().next().value!);
    seen.set(request.requestId, now);
    if (request.type === "analysis.status") {
      const state = coordinator.status(owner);
      reply({
        type: "analysis.status",
        state:
          state !== "idle"
            ? state
            : (await interrupted(owner))
              ? "interrupted"
              : "idle",
      });
      return;
    }
    if (request.type === "analysis.cancel") {
      const target = request.targetRequestId!;
      const resolving = pending.get(owner);
      if (resolving?.requestId === target) {
        resolving.controller.abort("cancel");
        pending.delete(owner);
        reply({ type: "analysis.canceled", targetRequestId: target });
      } else if (coordinator.detach(owner, target))
        reply({ type: "analysis.canceled", targetRequestId: target });
      else reply({ type: "analysis.failed", code: "analysis_interrupted" });
      return;
    }
    if (
      !request.repository ||
      request.repository.owner.toLowerCase() !==
        repository.owner.toLowerCase() ||
      request.repository.name.toLowerCase() !== repository.name.toLowerCase()
    ) {
      reply({ type: "analysis.failed", code: "invalid_repository" });
      return;
    }
    if (request.type === "analysis.request") {
      const old = pending.get(owner);
      old?.controller.abort("navigation");
      pending.delete(owner);
      coordinator.detachDocument(client.prefix);
      detachPending(client.prefix);
      if (pending.size + coordinator.subscriptionCount() >= 32) {
        reply({ type: "analysis.failed", code: "analysis_busy" });
        return;
      }
    }
    const pageLookup = client.page && request.type === "repository.lookup";
    const trigger = pageLookup ? await readCountTrigger() : "manual";
    const auth = await connection.auth();
    const limit = bucket(auth);
    const limited = (): PublicPayload | undefined =>
      Date.now() < limitedUntil(limit)
        ? {
            type: "analysis.failed",
            ...publicFailure("rate_limited", limitedUntil(limit)),
          }
        : undefined;
    if (pageLookup && trigger === "manual") {
      const hash = (await currentRules()).hash;
      const known =
        (await cache.hasRepository(repository, hash).catch(() => true)) ||
        (auth.token !== undefined &&
          (await privateResults
            .hasRepository(repository, hash)
            .catch(() => true)));
      if (!known) {
        if (!client.isAlive()) return;
        reply(limited() ?? { type: "repository.not_cached" });
        return;
      }
    }
    const controller = new AbortController();
    if (request.type === "analysis.request")
      pending.set(owner, { requestId: request.requestId, controller });
    try {
      const key = `${auth.token ? auth.generation : "anonymous"}:${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
      const resolved =
        !client.page && request.type === "repository.lookup"
          ? await refs.peek(key)
          : await refs.resolveWithStatus(
              key,
              async () => {
                if (Date.now() < limitedUntil(limit))
                  throw new Error("rate_limited");
                return {
                  ...(await resolveFor(repository, auth)),
                  resolvedAt: Date.now(),
                };
              },
              client.force,
            );
      if (!resolved) {
        if (client.isAlive())
          reply(limited() ?? { type: "repository.not_cached" });
        return;
      }
      const envelope = resolved.envelope;
      if (
        controller.signal.aborted ||
        !client.isAlive() ||
        (request.type === "analysis.request" &&
          pending.get(owner)?.requestId !== request.requestId)
      )
        return;
      const privateJob = envelope.visibility === "private";
      if (privateJob) {
        await cache.purgeRepository(envelope.repositoryId);
        await invalidateResolutions(envelope.repositoryId, "public");
        coordinator.abortPublicRepository(envelope.repositoryId);
        if (!auth.token) {
          reply({ type: "analysis.failed", code: "authentication_required" });
          return;
        }
      }
      const results: ResultCache = privateJob ? privateResults : cache;
      if (resolved.fresh && refs.isCurrent(resolved.epoch))
        results.allowRepository(envelope);
      const rules = await currentRules();
      const cached = await results
        .get(envelope, rules.hash)
        .catch(() => undefined);
      if (controller.signal.aborted || !client.isAlive()) return;
      if (results.isRevoked(envelope.repositoryId)) {
        reply({ type: "analysis.failed", code: "repository_unavailable" });
        return;
      }
      if (
        cached &&
        !(
          request.type === "analysis.request" &&
          client.force &&
          cached.coverage.skippedByReason.oversized_source > 0 &&
          cached.coverage.oversizedFiles === undefined
        )
      ) {
        if (request.type === "repository.lookup")
          reply({
            type: "repository.cache_hit",
            resolution: envelope,
            result: cached,
          });
        else
          reply({
            type: "analysis.completed",
            resolution: envelope,
            result: cached,
            fromCache: true,
          });
        return;
      }
      if (request.type === "repository.lookup") {
        const rulesChanged = await results
          .hasOtherRules(envelope, rules.hash)
          .catch(() => false);
        const autoCount =
          trigger === "open" &&
          client.isAlive() &&
          (await claimAutoCount(resolutionIdentity(envelope, rules.hash)));
        if (controller.signal.aborted || !client.isAlive()) return;
        reply({
          type: "repository.cache_miss",
          resolution: envelope,
          ...(rulesChanged ? { rulesChanged: true as const } : {}),
          ...(autoCount ? { autoCount: true as const } : {}),
        });
        return;
      }
      if (pending.get(owner)?.requestId !== request.requestId) return;
      pending.delete(owner);
      await clearInterrupted(owner);
      const semantic = resolutionIdentity(envelope, rules.hash);
      if (controller.signal.aborted || !client.isAlive()) return;
      if (results.isRevoked(envelope.repositoryId)) {
        reply({ type: "analysis.failed", code: "repository_unavailable" });
        return;
      }
      const accepted = coordinator.subscribe(
        privateJob ? `private:${auth.generation}:${semantic}` : semantic,
        envelope,
        privateJob ? auth.token : undefined,
        privateJob ? auth.generation : "",
        {
          requestId: request.requestId,
          owner,
          public: true,
          onProgress: (phase, processedBytes) =>
            client.progress(request, phase, processedBytes),
          onComplete: async (output, current) => {
            if (
              !coordinator.isSubscribed(owner, request.requestId) ||
              !client.isAlive()
            )
              return;
            if (
              output.result.repository.id !== current.repositoryId ||
              output.result.revision.commitSha !== current.sha
            ) {
              reply({ type: "analysis.failed", code: "counter_failed" });
              return;
            }
            if (
              privateJob &&
              (await connection.generation()) !== auth.generation
            ) {
              reply({ type: "analysis.failed", code: "analysis_interrupted" });
              return;
            }
            await results.put(current, output.result).catch(() => undefined);
            if (
              coordinator.isSubscribed(owner, request.requestId) &&
              client.isAlive()
            )
              reply({
                type: "analysis.completed",
                resolution: current,
                result: output.result,
                fromCache: false,
              });
          },
          onFailure: (error, signal) => {
            if (!client.isAlive()) return;
            const failure =
              signal.aborted && signal.reason === "visibility"
                ? { code: "repository_unavailable" as const }
                : signal.aborted && signal.reason === "disconnect"
                  ? { code: "analysis_interrupted" as const }
                  : error instanceof Error && error.message === "analysis_busy"
                    ? { code: "analysis_busy" as const }
                    : error instanceof Error &&
                        error.message === "analysis_canceled"
                      ? { code: "analysis_canceled" as const }
                      : error instanceof ArchiveError
                        ? { code: error.code, limit: error.limit }
                        : safeFailure(error, signal);
            if (failure.code === "rate_limited")
              markLimited(
                limit,
                "retryAt" in failure ? failure.retryAt : undefined,
              );
            void accessFailure(failure.code, auth, repository, false).then(
              (code) =>
                reply({
                  type: "analysis.failed",
                  ...publicFailure(
                    code,
                    "retryAt" in failure ? failure.retryAt : undefined,
                    "limit" in failure ? failure.limit : undefined,
                  ),
                }),
            );
          },
        },
        ARCHIVE_TIMEOUTS.job,
        rules.ignore,
      );
      if (!accepted) reply({ type: "analysis.failed", code: "analysis_busy" });
    } catch (error) {
      if (!controller.signal.aborted && client.isAlive()) {
        const failure =
          error instanceof Error &&
          !(error instanceof AcquisitionError) &&
          (error.message === "rate_limited" ||
            error.message === "analysis_busy" ||
            error.message === "analysis_interrupted")
            ? {
                code: error.message as
                  "rate_limited" | "analysis_busy" | "analysis_interrupted",
                retryAt:
                  error.message === "rate_limited"
                    ? limitedUntil(limit)
                    : undefined,
              }
            : safeFailure(error, controller.signal);
        if (failure.code === "rate_limited")
          markLimited(limit, failure.retryAt);
        const code = await accessFailure(failure.code, auth, repository, true);
        if (client.isAlive())
          reply({
            type: "analysis.failed",
            ...publicFailure(code, failure.retryAt),
          });
      }
    } finally {
      if (pending.get(owner)?.requestId === request.requestId)
        pending.delete(owner);
    }
  })().catch(() => reply({ type: "analysis.failed", code: "internal_error" }));
}

function handlePublic(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
  const repository = senderRepository(sender);
  if (
    !repository ||
    !validPublicRequest(value) ||
    sender.tab?.id === undefined ||
    !sender.documentId
  )
    return false;
  const request = value;
  const tabId = sender.tab.id;
  const documentId = sender.documentId;
  if (request.type === "popup.open") {
    const windowId = sender.tab.windowId;
    const opened = (value: boolean) =>
      respond(publicReply(request, { type: "popup.opened", opened: value }));
    if (!sender.tab.active || windowId === undefined) opened(false);
    else
      void chrome.action.openPopup({ windowId }).then(
        () => opened(true),
        () => opened(false),
      );
    return true;
  }
  if (request.type === "settings.open") {
    void chrome.tabs
      .create({ url: `${SETTINGS_URL}#github`, openerTabId: tabId })
      .then(
        () =>
          respond(
            publicReply(request, { type: "settings.opened", opened: true }),
          ),
        () =>
          respond(
            publicReply(request, { type: "settings.opened", opened: false }),
          ),
      );
    return true;
  }
  const key = portKey(tabId, documentId);
  const prefix = `p:${tabId}:${documentId}:`;
  runPublicRequest(request, {
    repository,
    owner: publicOwner(tabId, documentId, request.navigationId),
    prefix,
    page: true,
    isAlive: () => publicPorts.has(key),
    reply: (current, payload) => respond(publicReply(current, payload)),
    progress: (current, phase, processedBytes) =>
      publicProgress(tabId, documentId, current, phase, processedBytes),
  });
  return true;
}

async function updateSummary(
  tabId: number,
  repository: { owner: string; name: string },
  result: AnalysisResultV2,
): Promise<void> {
  if (result.engine.rulesHash !== (await currentRules()).hash) return;
  const update: SummaryUpdate = {
    protocolVersion: 1,
    type: "summary.update",
    repository,
    totalCodeLines: result.totals.code,
    uncountedFiles: result.coverage.skippedByReason.oversized_source,
    customIgnore: result.engine.rulesHash !== (await defaultRulesHash),
  };
  await chrome.tabs
    .sendMessage(tabId, update, { frameId: 0 })
    .catch(() => undefined);
}

function postToPopup(
  port: chrome.runtime.Port,
  request: PublicRequest,
  payload: PublicPayload,
): void {
  if (popupPorts.has(port)) port.postMessage(publicReply(request, payload));
}

function settlePopupJob(
  tabId: number,
  job: PopupJob,
  payload: PublicPayload,
): void {
  if (popupJobs.get(tabId) !== job) return;
  popupJobs.delete(tabId);
  if (job.viewer) postToPopup(job.viewer.port, job.viewer.request, payload);
  if (payload.type === "analysis.completed")
    void updateSummary(tabId, job.repository, payload.result);
}

function endPopupJob(tabId: number, reason: string): void {
  const job = popupJobs.get(tabId);
  if (!job) return;
  settlePopupJob(tabId, job, {
    type: "analysis.failed",
    code: "analysis_canceled",
  });
  const resolving = pending.get(job.owner);
  if (resolving?.requestId === job.requestId) {
    resolving.controller.abort(reason);
    pending.delete(job.owner);
  }
  coordinator.detach(job.owner, job.requestId);
}

chrome.tabs.onRemoved.addListener((tabId) => endPopupJob(tabId, "navigation"));
chrome.tabs.onUpdated.addListener((tabId, _change, tab) => {
  const job = popupJobs.get(tabId);
  if (job && !sameRepository(pageRepository(tab.url ?? ""), job.repository))
    endPopupJob(tabId, "navigation");
});

function handlePopupMessage(port: chrome.runtime.Port, value: unknown): void {
  if (!validPopupPublicRequest(value)) return;
  const { tabId, reanalyze, ...publicRequest } = value;
  const reply = (payload: PublicPayload) =>
    postToPopup(port, publicRequest, payload);
  if (publicRequest.type === "analysis.cancel") {
    const job = popupJobs.get(tabId);
    const targetRequestId = publicRequest.targetRequestId!;
    if (
      !job ||
      (targetRequestId !== job.requestId &&
        targetRequestId !== job.viewer?.request.requestId)
    ) {
      reply({ type: "analysis.failed", code: "analysis_interrupted" });
      return;
    }
    endPopupJob(tabId, "cancel");
    reply({ type: "analysis.canceled", targetRequestId });
    return;
  }
  void (async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = await chrome.tabs.get(tabId);
    const repository = pageRepository(tab.url ?? "");
    if (
      activeTab?.id !== tabId ||
      !repository ||
      (publicRequest.repository &&
        !sameRepository(publicRequest.repository, repository))
    ) {
      reply({ type: "analysis.failed", code: "invalid_repository" });
      return;
    }
    if (publicRequest.type === "analysis.status") {
      const running = popupJobs.get(tabId);
      if (!running || !sameRepository(repository, running.repository)) {
        reply({ type: "analysis.status", state: "idle" });
        return;
      }
      running.viewer = { port, request: publicRequest };
      reply({
        type: "analysis.status",
        state:
          coordinator.status(running.owner) === "queued" ? "queued" : "running",
      });
      return;
    }
    const owner = popupOwner(tabId, publicRequest.navigationId);
    if (publicRequest.type === "repository.lookup") {
      runPublicRequest(publicRequest, {
        repository,
        owner,
        prefix: `u:${tabId}:`,
        page: false,
        isAlive: () => popupPorts.has(port),
        reply: (current, payload) => {
          postToPopup(port, current, payload);
          if (payload.type === "repository.cache_hit")
            void updateSummary(tabId, repository, payload.result);
        },
        progress: () => undefined,
      });
      return;
    }
    const next: PopupJob = {
      owner,
      requestId: publicRequest.requestId,
      repository,
      viewer: { port, request: publicRequest },
    };
    popupJobs.set(tabId, next);
    runPublicRequest(publicRequest, {
      repository,
      owner,
      prefix: `u:${tabId}:`,
      page: false,
      force: reanalyze === true,
      isAlive: () => popupJobs.get(tabId) === next,
      reply: (_current, payload) => settlePopupJob(tabId, next, payload),
      progress: (_current, phase, processedBytes) => {
        const viewer = next.viewer;
        if (popupJobs.get(tabId) !== next || !viewer) return;
        postToPopup(viewer.port, viewer.request, {
          type: "analysis.progress",
          phase,
          ...(processedBytes === undefined ? {} : { processedBytes }),
        });
      },
    });
  })().catch(() =>
    reply({ type: "analysis.failed", code: "invalid_repository" }),
  );
}

function validRequest(value: unknown): value is Request {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<Request>;
  return (
    request.protocolVersion === VERSION &&
    typeof request.type === "string" &&
    [
      "auth.status",
      "auth.submit",
      "auth.device.start",
      "auth.device.poll",
      "auth.device.cancel",
      "auth.disconnect",
      "auth.clear-private-session",
      "cache.clear-public",
      "cache.clear-all",
      "repository.lookup",
      "analysis.request",
      "analysis.cancel",
      "analysis.status",
    ].includes(request.type) &&
    typeof request.requestId === "string" &&
    /^[0-9a-f-]{36}$/.test(request.requestId) &&
    typeof request.navigationId === "string" &&
    /^[0-9a-f-]{36}$/.test(request.navigationId) &&
    (request.submissionId === undefined ||
      (typeof request.submissionId === "string" &&
        /^[0-9a-f-]{36}$/.test(request.submissionId)))
  );
}

export function handleGithub(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
  if (handlePublic(value, sender, respond)) return true;
  if (
    sender.id !== chrome.runtime.id ||
    !isPageUrl(sender.url, SETTINGS_URL) ||
    typeof sender.documentId !== "string" ||
    sender.frameId !== 0 ||
    !validRequest(value)
  )
    return false;
  const request = value;
  const documentId = sender.documentId;
  const reply = (payload: Record<string, unknown>) =>
    respond({
      protocolVersion: VERSION,
      requestId: request.requestId,
      navigationId: request.navigationId,
      ...payload,
    });
  void (async () => {
    await ready;
    const now = Date.now();
    for (const [id, at] of seen) if (now - at > 60_000) seen.delete(id);
    if (seen.has(request.requestId)) {
      reply({ state: "failed", code: "invalid_repository" });
      return;
    }
    if (seen.size >= 100) seen.delete(seen.keys().next().value!);
    seen.set(request.requestId, now);
    if (request.type === "auth.status") {
      reply({ state: "ok", ...(await statusReply()) });
      return;
    }
    if (request.type === "auth.submit") {
      const stored: unknown = (await chrome.storage.session.get(pendingKey))[
        pendingKey
      ];
      await chrome.storage.session.remove(pendingKey);
      if (
        !validPending(stored) ||
        stored.submissionId !== request.submissionId
      ) {
        reply({ state: "failed", code: "authentication_invalid" });
        return;
      }
      const generation = await connection.generation();
      const signal = AbortSignal.timeout(10_000);
      let login: string;
      try {
        login = await fetchLogin(trackedFetch(true), stored.token, signal);
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
        return;
      }
      const result = await connection.connect(
        { method: "token", login, token: stored.token },
        generation,
      );
      if (!result.connected) {
        reply({ state: "stale" });
        return;
      }
      await saveDevice();
      await connectionChanged(result.previous, {
        clearPrivate: result.accountChanged,
        clearRefs: true,
      });
      reply({ state: "connected", ...(await statusReply()) });
      return;
    }
    if (request.type === "auth.device.start") {
      const signal = AbortSignal.timeout(10_000);
      try {
        const code = await requestDeviceCode(fetch, signal);
        await saveDevice({
          ...code,
          generation: await connection.generation(),
          nextPollAt: Date.now() + code.interval * 1000,
        });
        reply({ state: "ok", ...(await statusReply()) });
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
      }
      return;
    }
    if (request.type === "auth.device.cancel") {
      await saveDevice();
      reply({ state: "ok", ...(await statusReply()) });
      return;
    }
    if (request.type === "auth.device.poll") {
      const current = await readDevice();
      const now = Date.now();
      if (!current || now >= current.expiresAt) {
        await saveDevice();
        reply({ state: current ? "device-expired" : "device-missing" });
        return;
      }
      if (now < current.nextPollAt) {
        reply({ state: "pending", retryIn: current.nextPollAt - now });
        return;
      }
      await saveDevice({
        ...current,
        nextPollAt: now + current.interval * 1000,
      });
      const signal = AbortSignal.timeout(10_000);
      let outcome: Awaited<ReturnType<typeof pollDeviceCode>>;
      try {
        outcome = await pollDeviceCode(fetch, current.deviceCode, signal);
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
        return;
      }
      if (outcome.state === "pending") {
        const interval = outcome.interval ?? current.interval;
        if (device?.deviceCode === current.deviceCode)
          await saveDevice({
            ...device,
            interval,
            nextPollAt: Date.now() + interval * 1000,
          });
        reply({ state: "pending", retryIn: interval * 1000 });
        return;
      }
      if (outcome.state !== "granted") {
        if (device?.deviceCode === current.deviceCode) await saveDevice();
        reply({
          state:
            outcome.state === "expired" ? "device-expired" : "device-denied",
        });
        return;
      }
      let login: string;
      try {
        login = await fetchLogin(
          trackedFetch(true),
          outcome.grant.token,
          signal,
        );
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
        return;
      }
      if (device?.deviceCode !== current.deviceCode) {
        reply({ state: "device-missing" });
        return;
      }
      await saveDevice();
      const result = await connection.connect(
        { method: "app", login, ...outcome.grant },
        current.generation,
      );
      if (!result.connected) {
        reply({ state: "stale" });
        return;
      }
      await connectionChanged(result.previous, {
        clearPrivate: result.accountChanged,
        clearRefs: true,
      });
      reply({ state: "connected", ...(await statusReply()) });
      return;
    }
    if (
      request.type === "cache.clear-public" ||
      request.type === "cache.clear-all"
    ) {
      if (request.type === "cache.clear-all") {
        const { previous } = await connection.rotate();
        await connectionChanged(previous, {
          clearPrivate: true,
          clearRefs: true,
        });
      }
      await cache.clear();
      await Promise.all([refs.clear(), optionRefs.clear()]);
      await chrome.storage.session.remove(AUTO_COUNT_KEY);
      reply({
        state:
          request.type === "cache.clear-all"
            ? "all-results-cleared"
            : "public-cache-cleared",
      });
      return;
    }
    if (request.type === "auth.disconnect") {
      await saveDevice();
      const { previous, generation } = await connection.disconnect();
      await connectionChanged(previous, {
        clearPrivate: true,
        clearRefs: true,
      });
      reply({ state: "disconnected", generation });
      return;
    }
    if (request.type === "auth.clear-private-session") {
      const { previous, generation } = await connection.rotate();
      await connectionChanged(previous, {
        clearPrivate: true,
        clearRefs: true,
      });
      reply({ state: "cleared", generation });
      return;
    }
    const owner = optionsOwner(documentId, request.navigationId);
    if (request.type === "analysis.cancel") {
      const resolving = pending.get(owner);
      if (resolving && resolving.requestId === request.targetRequestId) {
        resolving.controller.abort("cancel");
        pending.delete(owner);
        reply({ state: "canceled" });
      } else
        reply({
          state: coordinator.detach(owner, request.targetRequestId ?? "")
            ? "canceled"
            : "idle",
        });
      return;
    }
    if (request.type === "analysis.status") {
      const state = coordinator.status(owner);
      reply({
        state:
          state !== "idle"
            ? state
            : (await interrupted(owner))
              ? "interrupted"
              : "idle",
      });
      return;
    }
    if (
      (request.type === "repository.lookup" ||
        request.type === "analysis.request") &&
      typeof request.owner === "string" &&
      typeof request.name === "string" &&
      validRepository(request.owner, request.name)
    ) {
      if (request.type === "analysis.request") {
        pending.get(owner)?.controller.abort("navigation");
        pending.delete(owner);
        coordinator.detachOwner(owner);
        if (pending.size + coordinator.subscriptionCount() >= 32) {
          reply({ state: "busy" });
          return;
        }
      }
      const controller = new AbortController();
      if (request.type === "analysis.request")
        pending.set(owner, { requestId: request.requestId, controller });
      try {
        const auth = await connection.auth();
        const key = `options:${auth.generation}:${request.owner.toLowerCase()}/${request.name.toLowerCase()}`;
        const resolved = await optionRefs.resolveWithStatus(key, async () => ({
          ...(await resolveRepository(
            trackedFetch(auth.token !== undefined),
            request.owner!,
            request.name!,
            auth.token,
            AbortSignal.timeout(10_000),
          )),
          resolvedAt: Date.now(),
        }));
        const envelope = resolved.envelope;
        if (controller.signal.aborted) return;
        if ((await connection.generation()) !== auth.generation) {
          reply({ state: "stale" });
          return;
        }
        if (envelope.visibility === "private") {
          await cache.purgeRepository(envelope.repositoryId);
          await invalidateResolutions(envelope.repositoryId, "public");
          coordinator.abortPublicRepository(envelope.repositoryId);
        }
        if (
          envelope.visibility === "public" &&
          resolved.fresh &&
          optionRefs.isCurrent(resolved.epoch)
        )
          cache.allowRepository(envelope);
        if (request.type === "repository.lookup") {
          reply({ state: "resolved", resolution: envelope });
          return;
        }
        if (pending.get(owner)?.requestId !== request.requestId) return;
        pending.delete(owner);
        await clearInterrupted(owner);
        const rules = await currentRules();
        const semantic = resolutionIdentity(envelope, rules.hash);
        if (controller.signal.aborted) return;
        const identity = auth.token
          ? `authorized:${auth.generation}:${semantic}`
          : semantic;
        const accepted = coordinator.subscribe(
          identity,
          envelope,
          auth.token,
          auth.generation,
          {
            requestId: request.requestId,
            owner,
            public: false,
            onProgress: () => undefined,
            onComplete: async (analysis, current) => {
              if (!coordinator.isSubscribed(owner, request.requestId)) return;
              if ((await connection.generation()) !== auth.generation) {
                if (coordinator.isSubscribed(owner, request.requestId))
                  reply({ state: "stale" });
                return;
              }
              if (current.visibility === "public")
                await cache
                  .put(current, analysis.result)
                  .catch(() => undefined);
              if ((await connection.generation()) !== auth.generation) {
                if (coordinator.isSubscribed(owner, request.requestId))
                  reply({ state: "stale" });
                return;
              }
              if (coordinator.isSubscribed(owner, request.requestId))
                reply({ state: "analyzed", resolution: current, ...analysis });
            },
            onFailure: (error, signal) =>
              reply({
                state: "failed",
                ...(signal.aborted && signal.reason === "visibility"
                  ? { code: "repository_unavailable" }
                  : error instanceof Error &&
                      error.message === "analysis_canceled"
                    ? { code: "analysis_canceled" }
                    : error instanceof ArchiveError
                      ? { code: error.code, limit: error.limit }
                      : safeFailure(error, signal)),
              }),
          },
          ARCHIVE_TIMEOUTS.job,
          rules.ignore,
        );
        if (!accepted) reply({ state: "busy" });
      } catch (error) {
        if (!controller.signal.aborted)
          reply({ state: "failed", ...safeFailure(error, controller.signal) });
      } finally {
        if (pending.get(owner)?.requestId === request.requestId)
          pending.delete(owner);
      }
      return;
    }
    reply({ state: "failed", code: "invalid_repository" });
  })().catch(() => reply({ state: "failed", code: "network_unavailable" }));
  return true;
}
