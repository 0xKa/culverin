import {
  activatePending,
  activeToken,
  authStatus,
  clearPrivateSession,
  disconnect,
  initializeSession,
  removePending,
} from "../auth/session";
import {
  AcquisitionError,
  resolveRepository,
  safeFailure,
  validRepository,
} from "../github/client";
import { analyzeArchive } from "../archive/bridge";
import { ArchiveError } from "../archive/tar";
import {
  POPUP_PORT,
  PUBLIC_PORT,
  publicFailure,
  validId,
  validPopupPublicRequest,
  validPublicRequest,
  type PublicPayload,
  type PublicReply,
  type PublicRequest,
  type SummaryUpdate,
} from "../github/public-protocol";
import type { AnalysisResultV1 } from "../counter/result";
import { pageRepository } from "../content/repository";
import {
  PublicResultCache,
  ResolutionCache,
  resolutionIdentity,
} from "../github/cache";
import { AnalysisCoordinator, type Marker } from "../github/coordinator";
import { effectiveRulesHash } from "../counter/rules";

const VERSION = 1;
const OPTIONS_URL = chrome.runtime.getURL("options.html");
const POPUP_URL = chrome.runtime.getURL("popup.html");
const MARKER = "github.job";
const LAST = "github.last";
const cache = new PublicResultCache(chrome.storage.local);
const refs = new ResolutionCache();
const rulesHash = effectiveRulesHash([]);
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
const coordinator = new AnalysisCoordinator(
  (job, progress) =>
    analyzeArchive(job.resolution, job.token, job.signal, job.id, progress),
  saveMarkers,
);
const ready = Promise.all([
  initializeSession(),
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
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
  submissionId?: string;
  targetRequestId?: string;
};

let validating = false;
const seen = new Map<string, number>();
const publicPorts = new Map<string, chrome.runtime.Port>();
const popupPorts = new Map<string, chrome.runtime.Port>();
type PopupViewer = {
  port: chrome.runtime.Port;
  request: PublicRequest;
  respond?: (value: unknown) => void;
};
type PopupJob = {
  owner: string;
  requestId: string;
  repository: { owner: string; name: string };
  viewer?: PopupViewer;
};
const popupJobs = new Map<number, PopupJob>();
let publicRateLimitedUntil = 0;
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
      sender.frameId !== 0 ||
      !sender.documentId
    ) {
      port.disconnect();
      return;
    }
    const documentId = sender.documentId;
    popupPorts.set(documentId, port);
    port.onDisconnect.addListener(() => {
      if (popupPorts.get(documentId) !== port) return;
      popupPorts.delete(documentId);
      for (const job of popupJobs.values())
        if (job.viewer?.port === port) job.viewer = undefined;
    });
    return;
  }
  if (port.name === "culverin.options") {
    if (
      sender?.id !== chrome.runtime.id ||
      sender.url !== OPTIONS_URL ||
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
    const controller = new AbortController();
    const startedAt = Date.now();
    if (request.type === "analysis.request")
      pending.set(owner, { requestId: request.requestId, controller });
    try {
      const key = `public:${repository.owner.toLowerCase()}/${repository.name.toLowerCase()}`;
      const resolved = await refs.resolveWithStatus(key, async () => {
        if (Date.now() < publicRateLimitedUntil)
          throw new Error("rate_limited");
        const resolved = await resolveRepository(
          fetch,
          repository.owner,
          repository.name,
          undefined,
          AbortSignal.timeout(10_000),
        );
        return { ...resolved, resolvedAt: Date.now() };
      });
      const envelope = resolved.envelope;
      if (
        controller.signal.aborted ||
        !client.isAlive() ||
        (request.type === "analysis.request" &&
          pending.get(owner)?.requestId !== request.requestId)
      )
        return;
      if (envelope.visibility !== "public") {
        await cache.purgeRepository(envelope.repositoryId);
        refs.invalidateRepository(envelope.repositoryId);
        coordinator.abortPublicRepository(envelope.repositoryId);
        reply({ type: "analysis.failed", code: "repository_unavailable" });
        return;
      }
      if (resolved.fresh && refs.isCurrent(resolved.epoch))
        cache.allowRepository(envelope);
      const cached = await cache.get(envelope).catch(() => undefined);
      if (controller.signal.aborted || !client.isAlive()) return;
      if (cache.isRevoked(envelope.repositoryId)) {
        reply({ type: "analysis.failed", code: "repository_unavailable" });
        return;
      }
      if (cached) {
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
        reply({ type: "repository.cache_miss", resolution: envelope });
        return;
      }
      if (pending.get(owner)?.requestId !== request.requestId) return;
      pending.delete(owner);
      await clearInterrupted(owner);
      const identity = resolutionIdentity(envelope, await rulesHash);
      if (controller.signal.aborted || !client.isAlive()) return;
      if (cache.isRevoked(envelope.repositoryId)) {
        reply({ type: "analysis.failed", code: "repository_unavailable" });
        return;
      }
      const accepted = coordinator.subscribe(
        identity,
        envelope,
        undefined,
        "",
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
            await cache.put(current, output.result).catch(() => undefined);
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
                : error instanceof Error && error.message === "analysis_busy"
                  ? { code: "analysis_busy" as const }
                  : error instanceof Error &&
                      error.message === "analysis_canceled"
                    ? { code: "analysis_canceled" as const }
                    : error instanceof ArchiveError
                      ? { code: error.code, limit: error.limit }
                      : safeFailure(error, signal);
            if (failure.code === "rate_limited")
              publicRateLimitedUntil =
                "retryAt" in failure && typeof failure.retryAt === "number"
                  ? failure.retryAt
                  : Date.now() + 60_000;
            reply({
              type: "analysis.failed",
              ...publicFailure(
                failure.code,
                "retryAt" in failure ? failure.retryAt : undefined,
                "limit" in failure ? failure.limit : undefined,
              ),
            });
          },
        },
        Math.max(1, 25_000 - (Date.now() - startedAt)),
      );
      if (!accepted) reply({ type: "analysis.failed", code: "analysis_busy" });
    } catch (error) {
      if (!controller.signal.aborted && client.isAlive()) {
        const failure =
          error instanceof Error &&
          !(error instanceof AcquisitionError) &&
          (error.message === "rate_limited" ||
            error.message === "analysis_busy")
            ? {
                code: error.message as "rate_limited" | "analysis_busy",
                retryAt: publicRateLimitedUntil,
              }
            : safeFailure(error, controller.signal);
        if (failure.code === "rate_limited")
          publicRateLimitedUntil =
            "retryAt" in failure && typeof failure.retryAt === "number"
              ? failure.retryAt
              : Date.now() + 60_000;
        reply({
          type: "analysis.failed",
          ...publicFailure(
            failure.code,
            "retryAt" in failure ? failure.retryAt : undefined,
          ),
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
  const key = portKey(tabId, documentId);
  const prefix = `p:${tabId}:${documentId}:`;
  runPublicRequest(request, {
    repository,
    owner: publicOwner(tabId, documentId, request.navigationId),
    prefix,
    isAlive: () => publicPorts.has(key),
    reply: (current, payload) => respond(publicReply(current, payload)),
    progress: (current, phase, processedBytes) =>
      publicProgress(tabId, documentId, current, phase, processedBytes),
  });
  return true;
}

function sameRepository(
  current: { owner: string; name: string } | undefined,
  expected: { owner: string; name: string },
): boolean {
  return (
    current !== undefined &&
    current.owner.toLowerCase() === expected.owner.toLowerCase() &&
    current.name.toLowerCase() === expected.name.toLowerCase()
  );
}

async function updateSummary(
  tabId: number,
  repository: { owner: string; name: string },
  result: AnalysisResultV1,
): Promise<void> {
  if (
    !result.coverage.complete ||
    result.engine.rulesHash !== (await rulesHash)
  )
    return;
  const update: SummaryUpdate = {
    protocolVersion: 1,
    type: "summary.update",
    repository,
    totalCodeLines: result.totals.code,
  };
  await chrome.tabs
    .sendMessage(tabId, update, { frameId: 0 })
    .catch(() => undefined);
}

function settlePopupJob(
  tabId: number,
  job: PopupJob,
  payload: PublicPayload,
): void {
  if (popupJobs.get(tabId) !== job) return;
  popupJobs.delete(tabId);
  const viewer = job.viewer;
  if (viewer?.respond) viewer.respond(publicReply(viewer.request, payload));
  else viewer?.port.postMessage(publicReply(viewer.request, payload));
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

function handlePopupPublic(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== POPUP_URL ||
    sender.frameId !== 0 ||
    typeof sender.documentId !== "string" ||
    !validPopupPublicRequest(value)
  )
    return false;
  const request = value;
  const documentId = sender.documentId;
  const port = popupPorts.get(documentId);
  if (!port) return false;
  const { tabId, ...publicRequest } = request;
  const reply = (payload: PublicPayload) =>
    respond(publicReply(publicRequest, payload));
  void (async () => {
    const [activeTab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = await chrome.tabs.get(tabId);
    const repository = pageRepository(tab.url ?? "");
    const isCancel = publicRequest.type === "analysis.cancel";
    const repositoryMatches =
      isCancel ||
      (repository !== undefined &&
        (!publicRequest.repository ||
          sameRepository(publicRequest.repository, repository)));
    if (activeTab?.id !== tabId || !repositoryMatches) {
      reply({ type: "analysis.failed", code: "invalid_repository" });
      return;
    }
    const job = popupJobs.get(tabId);
    if (publicRequest.type === "analysis.cancel") {
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
    if (!repository) {
      reply({ type: "analysis.failed", code: "invalid_repository" });
      return;
    }
    if (publicRequest.type === "analysis.status") {
      if (!job || !sameRepository(repository, job.repository)) {
        reply({ type: "analysis.status", state: "idle" });
        return;
      }
      job.viewer = { port, request: publicRequest };
      reply({
        type: "analysis.status",
        state:
          coordinator.status(job.owner) === "queued" ? "queued" : "running",
      });
      return;
    }
    const owner = popupOwner(tabId, publicRequest.navigationId);
    if (publicRequest.type === "repository.lookup") {
      runPublicRequest(publicRequest, {
        repository,
        owner,
        prefix: `u:${tabId}:`,
        isAlive: () => popupPorts.get(documentId) === port,
        reply: (current, payload) => {
          respond(publicReply(current, payload));
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
      viewer: { port, request: publicRequest, respond },
    };
    popupJobs.set(tabId, next);
    runPublicRequest(publicRequest, {
      repository,
      owner,
      prefix: `u:${tabId}:`,
      isAlive: () => popupJobs.get(tabId) === next,
      reply: (_current, payload) => settlePopupJob(tabId, next, payload),
      progress: (_current, phase, processedBytes) => {
        const viewer = next.viewer;
        if (popupJobs.get(tabId) !== next || !viewer) return;
        viewer.port.postMessage(
          publicReply(viewer.request, {
            type: "analysis.progress",
            phase,
            ...(processedBytes === undefined ? {} : { processedBytes }),
          }),
        );
      },
    });
  })().catch(() =>
    reply({ type: "analysis.failed", code: "invalid_repository" }),
  );
  return true;
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
      "auth.disconnect",
      "auth.clear-private-session",
      "cache.clear-public",
      "repository.lookup",
      "analysis.request",
      "analysis.cancel",
      "analysis.status",
    ].includes(request.type) &&
    typeof request.requestId === "string" &&
    /^[0-9a-f-]{36}$/.test(request.requestId) &&
    typeof request.navigationId === "string" &&
    /^[0-9a-f-]{36}$/.test(request.navigationId)
  );
}

export function handleGithub(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
  if (handlePopupPublic(value, sender, respond)) return true;
  if (handlePublic(value, sender, respond)) return true;
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== OPTIONS_URL ||
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
      reply({ state: "ok", ...(await authStatus()) });
      return;
    }
    if (request.type === "cache.clear-public") {
      await cache.clear();
      refs.clear();
      reply({ state: "public-cache-cleared" });
      return;
    }
    if (request.type === "auth.disconnect") {
      const previous = (await authStatus()).generation;
      const generation = await disconnect();
      coordinator.abortGeneration(previous);
      await chrome.storage.session.remove(LAST);
      reply({ state: "disconnected", generation });
      return;
    }
    if (request.type === "auth.clear-private-session") {
      const previous = (await authStatus()).generation;
      const generation = await clearPrivateSession();
      coordinator.abortGeneration(previous);
      await chrome.storage.session.remove(LAST);
      reply({ state: "cleared", generation });
      return;
    }
    if (request.type === "auth.submit") {
      if (
        typeof request.submissionId !== "string" ||
        !/^[0-9a-f-]{36}$/.test(request.submissionId)
      ) {
        reply({ state: "failed", code: "invalid_repository" });
        return;
      }
      if (validating) {
        await removePending(request.submissionId);
        reply({ state: "busy" });
        return;
      }
      validating = true;
      let payload: Record<string, unknown>;
      try {
        const previous = (await authStatus()).generation;
        const result = await activatePending(request.submissionId, fetch);
        if (result.connected) {
          try {
            await cache.purgeRepository(result.resolution.repositoryId);
          } catch (error) {
            await disconnect();
            throw error;
          }
          refs.invalidateRepository(result.resolution.repositoryId);
          coordinator.abortPublicRepository(result.resolution.repositoryId);
          coordinator.abortGeneration(previous);
        }
        payload = result.connected
          ? { state: "connected" }
          : { state: "stale" };
      } catch (error) {
        const code = safeFailure(error, new AbortController().signal).code;
        payload = { state: "failed", code };
      } finally {
        try {
          await removePending(request.submissionId);
        } finally {
          validating = false;
        }
      }
      reply(payload);
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
      const startedAt = Date.now();
      if (request.type === "analysis.request")
        pending.set(owner, { requestId: request.requestId, controller });
      try {
        const auth = await activeToken();
        const key = `options:${auth.generation}:${request.owner.toLowerCase()}/${request.name.toLowerCase()}`;
        const resolved = await refs.resolveWithStatus(key, async () => ({
          ...(await resolveRepository(
            fetch,
            request.owner!,
            request.name!,
            auth.token,
            AbortSignal.timeout(10_000),
          )),
          resolvedAt: Date.now(),
        }));
        const envelope = resolved.envelope;
        if (controller.signal.aborted) return;
        if ((await authStatus()).generation !== auth.generation) {
          reply({ state: "stale" });
          return;
        }
        if (envelope.visibility === "private") {
          await cache.purgeRepository(envelope.repositoryId);
          refs.invalidateRepository(envelope.repositoryId);
          coordinator.abortPublicRepository(envelope.repositoryId);
        }
        if (
          envelope.visibility === "public" &&
          resolved.fresh &&
          refs.isCurrent(resolved.epoch)
        )
          cache.allowRepository(envelope);
        if (request.type === "repository.lookup") {
          reply({ state: "resolved", resolution: envelope });
          return;
        }
        if (pending.get(owner)?.requestId !== request.requestId) return;
        pending.delete(owner);
        await clearInterrupted(owner);
        const semantic = resolutionIdentity(envelope, await rulesHash);
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
              if ((await authStatus()).generation !== auth.generation) {
                if (coordinator.isSubscribed(owner, request.requestId))
                  reply({ state: "stale" });
                return;
              }
              if (current.visibility === "public")
                await cache
                  .put(current, analysis.result)
                  .catch(() => undefined);
              if ((await authStatus()).generation !== auth.generation) {
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
          Math.max(1, 25_000 - (Date.now() - startedAt)),
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
