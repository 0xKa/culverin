import {
  activatePending,
  activeToken,
  authStatus,
  disconnect,
  initializeSession,
  removePending,
} from "../auth/session";
import {
  downloadArchive,
  resolveRepository,
  safeFailure,
  validRepository,
} from "../github/client";

const VERSION = 1;
const OPTIONS_URL = chrome.runtime.getURL("options.html");
const ready = initializeSession();

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
};

let active: Active | undefined;
const seen = new Map<string, number>();

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
      "repository.lookup",
      "analysis.request",
      "analysis.cancel",
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
      reply({ state: "disconnected", generation });
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
        await removePending(request.submissionId);
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
        const archive = await downloadArchive(
          fetch,
          resolution,
          auth.token,
          controller.signal,
        );
        if (controller.signal.aborted) throw controller.signal.reason;
        if ((await authStatus()).generation !== auth.generation) {
          reply({ state: "stale" });
          return;
        }
        reply({ state: "downloaded", resolution, archive });
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, controller.signal) });
      } finally {
        clearTimeout(timer);
        if (active === job) active = undefined;
      }
      return;
    }
    reply({ state: "failed", code: "invalid_repository" });
  })().catch(() => reply({ state: "failed", code: "network_unavailable" }));
  return true;
}
