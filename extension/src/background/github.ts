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
  resolveRepository,
  safeFailure,
  validRepository,
} from "../github/client";
import { analyzeArchive } from "../archive/bridge";
import { ArchiveError } from "../archive/tar";
import {
  PUBLIC_PORT,
  publicFailure,
  validPublicRequest,
  type PublicPayload,
  type PublicReply,
  type PublicRequest,
} from "../github/public-protocol";
import { pageRepository } from "../content/repository";

const VERSION = 1;
const OPTIONS_URL = chrome.runtime.getURL("options.html");
const MARKER = "github.job";
const LAST = "github.last";
const ready = initializeSession().then(async () => {
  const state = await chrome.storage.session.get(MARKER);
  const marker = state[MARKER] as
    | { documentId?: unknown; navigationId?: unknown; tabId?: unknown }
    | undefined;
  if (marker) {
    await chrome.storage.session.remove(MARKER);
    await chrome.storage.session.set({
      [LAST]: {
        state: "interrupted",
        documentId: marker.documentId,
        navigationId: marker.navigationId,
        tabId: marker.tabId,
      },
    });
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

type Active = {
  id: string;
  documentId: string;
  navigationId: string;
  generation: string;
  controller: AbortController;
  tabId?: number;
  repository?: { owner: string; name: string };
  public?: boolean;
  detached?: boolean;
  cancelReason?: "cancel" | "navigation";
};

let active: Active | undefined;
let validating = false;
const seen = new Map<string, number>();
const publicPorts = new Map<string, chrome.runtime.Port>();
let publicRateLimitedUntil = 0;

function senderRepository(
  sender: chrome.runtime.MessageSender,
): { owner: string; name: string } | undefined {
  if (
    sender.id !== chrome.runtime.id ||
    sender.frameId !== 0 ||
    !Number.isSafeInteger(sender.tab?.id) ||
    (sender.tab?.id ?? -1) < 0 ||
    typeof sender.documentId !== "string" ||
    !sender.url
  )
    return undefined;
  return pageRepository(sender.url);
}

function portKey(tabId: number, documentId: string): string {
  return `${tabId}:${documentId}`;
}

chrome.runtime.onConnect.addListener((port) => {
  const sender = port.sender;
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
  if (
    publicPorts.has(key) &&
    active?.public &&
    active.tabId === sender.tab.id &&
    active.documentId === sender.documentId
  ) {
    active.detached = true;
    active.cancelReason ??= "navigation";
    active.controller.abort("navigation");
  }
  publicPorts.set(key, port);
  port.onDisconnect.addListener(() => {
    if (publicPorts.get(key) !== port) return;
    publicPorts.delete(key);
    if (
      active?.public &&
      active.tabId === sender.tab?.id &&
      active.documentId === sender.documentId
    ) {
      active.detached = true;
      active.cancelReason ??= "navigation";
      active.controller.abort("navigation");
    }
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
  job: Active,
  phase: "resolving" | "downloading" | "decompressing" | "counting",
  processedBytes?: number,
): void {
  if (
    !job.public ||
    job.detached ||
    job.controller.signal.aborted ||
    active !== job ||
    job.tabId === undefined
  )
    return;
  const message: PublicReply = {
    protocolVersion: 1,
    type: "analysis.progress",
    requestId: job.id,
    navigationId: job.navigationId,
    phase,
    ...(processedBytes === undefined ? {} : { processedBytes }),
  };
  void chrome.tabs
    .sendMessage(job.tabId, message, { documentId: job.documentId })
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
  if (value.type !== "archive.counting" || value.requestId !== active?.id)
    return false;
  if (active) publicProgress(active, "counting");
  return true;
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
  const reply = (payload: PublicPayload) =>
    respond(publicReply(request, payload));
  void (async () => {
    await ready;
    if (!publicPorts.has(key)) {
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
      if (
        active?.public &&
        active.tabId === tabId &&
        active.documentId === documentId &&
        active.navigationId === request.navigationId
      ) {
        reply({ type: "analysis.status", state: "running" });
        return;
      }
      const stored = await chrome.storage.session.get(LAST);
      const last = stored[LAST] as
        | {
            state?: unknown;
            tabId?: unknown;
            documentId?: unknown;
            navigationId?: unknown;
          }
        | undefined;
      reply({
        type: "analysis.status",
        state:
          last?.state === "interrupted" &&
          last.tabId === tabId &&
          last.documentId === documentId &&
          last.navigationId === request.navigationId
            ? "interrupted"
            : "idle",
      });
      return;
    }
    if (request.type === "analysis.cancel") {
      const job = active;
      if (
        job?.public &&
        job.tabId === tabId &&
        job.documentId === documentId &&
        job.navigationId === request.navigationId &&
        job.id === request.targetRequestId
      ) {
        job.detached = true;
        job.cancelReason = "cancel";
        job.controller.abort("cancel");
        reply({
          type: "analysis.canceled",
          targetRequestId: request.targetRequestId!,
        });
      } else {
        reply({ type: "analysis.failed", code: "analysis_interrupted" });
      }
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
    if (active) {
      reply({ type: "analysis.failed", code: "analysis_busy" });
      return;
    }
    if (Date.now() < publicRateLimitedUntil) {
      reply({
        type: "analysis.failed",
        code: "rate_limited",
        retryAt: publicRateLimitedUntil,
      });
      return;
    }
    const controller = new AbortController();
    const job: Active = {
      id: request.requestId,
      documentId,
      navigationId: request.navigationId,
      generation: "",
      controller,
      tabId,
      repository,
      public: true,
    };
    active = job;
    const timer = withDeadline(
      controller,
      request.type === "analysis.request" ? 25_000 : 10_000,
    );
    try {
      await chrome.storage.session.set({
        [MARKER]: { tabId, documentId, navigationId: request.navigationId },
      });
      publicProgress(job, "resolving");
      const resolution = await resolveRepository(
        fetch,
        repository.owner,
        repository.name,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted || job.detached || active !== job) return;
      if (resolution.visibility !== "public") {
        reply({ type: "analysis.failed", code: "repository_unavailable" });
        return;
      }
      const envelope = { ...resolution, resolvedAt: Date.now() };
      if (request.type === "repository.lookup") {
        reply({ type: "repository.cache_miss", resolution: envelope });
        return;
      }
      let lastUpdate = 0;
      const analysis = await analyzeArchive(
        resolution,
        undefined,
        controller.signal,
        request.requestId,
        (phase, processedBytes) => {
          const now = Date.now();
          if (
            phase !== "downloading" ||
            processedBytes === 0 ||
            now - lastUpdate >= 150
          ) {
            lastUpdate = now;
            publicProgress(job, phase, processedBytes);
          }
        },
      );
      if (controller.signal.aborted || job.detached || active !== job) return;
      if (
        analysis.result.repository.id !== envelope.repositoryId ||
        analysis.result.revision.commitSha !== envelope.sha
      )
        throw new ArchiveError("counter_failed");
      reply({
        type: "analysis.completed",
        resolution: envelope,
        result: analysis.result,
        fromCache: false,
      });
    } catch (error) {
      if (!job.detached && active === job) {
        const failure = controller.signal.aborted
          ? safeFailure(error, controller.signal)
          : error instanceof ArchiveError
            ? { code: error.code, limit: error.limit }
            : safeFailure(error, controller.signal);
        if (failure.code === "rate_limited")
          publicRateLimitedUntil =
            "retryAt" in failure &&
            typeof failure.retryAt === "number" &&
            failure.retryAt > Date.now()
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
      }
    } finally {
      clearTimeout(timer);
      if (active === job) active = undefined;
      await chrome.storage.session.remove(MARKER);
      if (job.cancelReason === "navigation")
        await chrome.storage.session.set({
          [LAST]: {
            state: "interrupted",
            tabId,
            documentId,
            navigationId: job.navigationId,
          },
        });
      else await chrome.storage.session.remove(LAST);
    }
  })().catch(() => reply({ type: "analysis.failed", code: "internal_error" }));
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

function withDeadline(
  controller: AbortController,
  ms: number,
): ReturnType<typeof setTimeout> {
  return setTimeout(() => controller.abort("deadline"), ms);
}

export function handleGithub(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
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
    if (request.type === "auth.disconnect") {
      const generation = await disconnect();
      active?.controller.abort("disconnect");
      await chrome.storage.session.remove(LAST);
      reply({ state: "disconnected", generation });
      return;
    }
    if (request.type === "auth.clear-private-session") {
      const generation = await clearPrivateSession();
      active?.controller.abort("disconnect");
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
        const result = await activatePending(request.submissionId, fetch);
        if (result.connected) active?.controller.abort("disconnect");
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
    if (request.type === "analysis.cancel") {
      const job = active;
      if (
        job &&
        request.targetRequestId === job.id &&
        request.navigationId === job.navigationId &&
        sender.documentId === job.documentId
      ) {
        job.controller.abort("cancel");
        reply({ state: "canceled" });
      } else reply({ state: "idle" });
      return;
    }
    if (request.type === "analysis.status") {
      const job = active;
      if (
        job &&
        job.documentId === documentId &&
        job.navigationId === request.navigationId
      ) {
        reply({ state: "running" });
        return;
      }
      const state = await chrome.storage.session.get(LAST);
      const last = state[LAST] as
        | { state?: unknown; documentId?: unknown; navigationId?: unknown }
        | undefined;
      reply({
        state:
          last?.documentId === documentId &&
          last?.navigationId === request.navigationId &&
          last.state === "interrupted"
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
      if (active) {
        reply({ state: "busy" });
        return;
      }
      const controller = new AbortController();
      const job: Active = {
        id: request.requestId,
        documentId,
        navigationId: request.navigationId,
        generation: "",
        controller,
      };
      active = job;
      const timer = withDeadline(
        controller,
        request.type === "analysis.request" ? 25_000 : 10_000,
      );
      try {
        await chrome.storage.session.set({
          [MARKER]: { documentId, navigationId: request.navigationId },
        });
        const auth = await activeToken();
        job.generation = auth.generation;
        const resolution = await resolveRepository(
          fetch,
          request.owner,
          request.name,
          auth.token,
          controller.signal,
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        if ((await authStatus()).generation !== auth.generation) {
          reply({ state: "stale" });
          return;
        }
        if (request.type === "repository.lookup") {
          reply({ state: "resolved", resolution });
          return;
        }
        const analysis = await analyzeArchive(
          resolution,
          auth.token,
          controller.signal,
          request.requestId,
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        if ((await authStatus()).generation !== auth.generation) {
          reply({ state: "stale" });
          return;
        }
        reply({ state: "analyzed", resolution, ...analysis });
      } catch (error) {
        reply({
          state: "failed",
          ...(controller.signal.aborted
            ? safeFailure(error, controller.signal)
            : error instanceof ArchiveError
              ? { code: error.code, limit: error.limit }
              : safeFailure(error, controller.signal)),
        });
      } finally {
        clearTimeout(timer);
        await chrome.storage.session.remove(MARKER);
        if (active === job) active = undefined;
      }
      return;
    }
    reply({ state: "failed", code: "invalid_repository" });
  })().catch(() => reply({ state: "failed", code: "network_unavailable" }));
  return true;
}
