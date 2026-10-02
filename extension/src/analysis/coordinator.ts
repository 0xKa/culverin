import { offscreen } from "../background/offscreen";
import {
  JOB_DEADLINE_MS,
  MAX_FILE_BYTES,
  MAX_TRANSFER_BYTES,
  PROTOCOL_VERSION,
  type JobOutcome,
} from "./protocol";
import { archiveBridgeActive } from "../archive/bridge";

const MARKER = "feasibility.active";
const LAST = "feasibility.last";
type Active = {
  id: string;
  owner: string;
  navigationId: string;
  timer: ReturnType<typeof setInterval>;
  deadline: ReturnType<typeof setTimeout>;
  finish: (outcome: JobOutcome) => void;
  release: () => void;
};
let active: Active | undefined;

const command = (type: string, jobId?: string, input?: unknown) => ({
  target: "analysis.host",
  protocolVersion: PROTOCOL_VERSION,
  type,
  jobId,
  input,
});

async function sendHost(
  type: string,
  jobId?: string,
  input?: unknown,
): Promise<unknown> {
  return chrome.runtime.sendMessage(command(type, jobId, input));
}

async function reconcile(): Promise<void> {
  const stored = await chrome.storage.session.get(MARKER);
  if (stored[MARKER]) {
    if (await offscreen.exists())
      await sendHost("host.reconcile").catch(() => undefined);
    await chrome.storage.session.remove(MARKER);
    const marker = stored[MARKER] as {
      owner?: unknown;
      navigationId?: unknown;
    };
    await chrome.storage.session.set({
      [LAST]: {
        owner: marker.owner,
        navigationId: marker.navigationId,
        state: "interrupted",
      },
    });
  } else if ((await offscreen.exists()) && !archiveBridgeActive()) {
    await sendHost("host.reconcile").catch(() => undefined);
  }
}

const ready = reconcile();

function validRequest(message: unknown): message is Record<string, unknown> {
  if (!message || typeof message !== "object") return false;
  const m = message as Record<string, unknown>;
  return (
    m.protocolVersion === PROTOCOL_VERSION &&
    typeof m.requestId === "string" &&
    /^[0-9a-f-]{36}$/.test(m.requestId) &&
    typeof m.navigationId === "string" &&
    m.navigationId.length > 0 &&
    m.navigationId.length <= 80
  );
}

function validateWireInput(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  if (
    !input.rules ||
    typeof input.rules !== "object" ||
    !Array.isArray(input.files) ||
    input.files.length > 100
  )
    return false;
  if (input.slowCall !== undefined && typeof input.slowCall !== "boolean")
    return false;
  if (
    input.blockMs !== undefined &&
    (!Number.isInteger(input.blockMs) ||
      (input.blockMs as number) < 0 ||
      (input.blockMs as number) > 10_000)
  )
    return false;
  if (
    input.fixtureDelayMs !== undefined &&
    (!Number.isInteger(input.fixtureDelayMs) ||
      (input.fixtureDelayMs as number) < 0 ||
      (input.fixtureDelayMs as number) > 5_000)
  )
    return false;
  let bytes = 0;
  for (const entry of input.files) {
    if (!entry || typeof entry !== "object") return false;
    const file = entry as Record<string, unknown>;
    if (
      typeof file.path !== "string" ||
      new TextEncoder().encode(file.path).length > 4096 ||
      !Array.isArray(file.bytes) ||
      file.bytes.length > MAX_FILE_BYTES ||
      !file.bytes.every(
        (n: unknown) =>
          Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255,
      )
    )
      return false;
    bytes += file.bytes.length;
    if (bytes > MAX_TRANSFER_BYTES) return false;
  }
  return true;
}

export function handleFeasibility(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  respond: (value: unknown) => void,
): boolean {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("test-harness.html") ||
    !validRequest(message)
  )
    return false;
  const request = message;
  const reply = (
    outcome:
      JobOutcome | { state: "idle" | "running" | "busy" | "invalid_input" },
  ) =>
    respond({
      protocolVersion: PROTOCOL_VERSION,
      requestId: request.requestId,
      navigationId: request.navigationId,
      ...outcome,
    });
  if (request.type === "feasibility.status") {
    void ready.then(async () => {
      const stored = await chrome.storage.session.get(LAST);
      const last = stored[LAST] as
        (JobOutcome & { owner?: string; navigationId?: string }) | undefined;
      const current = active;
      reply(
        current &&
          current.owner === sender.documentId &&
          current.navigationId === request.navigationId
          ? { state: "running" }
          : last &&
              last.owner === sender.documentId &&
              last.navigationId === request.navigationId
            ? last
            : { state: "idle" },
      );
    });
    return true;
  }
  if (request.type === "feasibility.cancel") {
    void ready.then(async () => {
      if (
        !active ||
        active.owner !== sender.documentId ||
        active.navigationId !== request.navigationId ||
        request.targetRequestId !== active.id
      ) {
        reply({ state: "idle" });
        return;
      }
      const id = active.id;
      clearInterval(active.timer);
      clearTimeout(active.deadline);
      active.finish({ state: "canceled" });
      active.release();
      active = undefined;
      await sendHost("host.cancel", id).catch(() => undefined);
      await chrome.storage.session.remove(MARKER);
      await chrome.storage.session.set({
        [LAST]: {
          owner: sender.documentId,
          navigationId: request.navigationId,
          state: "canceled",
        },
      });
      reply({ state: "canceled" });
    });
    return true;
  }
  if (request.type === "feasibility.start") {
    if (!validateWireInput(request.input)) {
      reply({ state: "invalid_input" });
      return false;
    }
    const id = request.requestId as string;
    const input = request.input;
    void ready.then(async () => {
      if (active) {
        reply({ state: "busy" });
        return;
      }
      const host = offscreen.acquire();
      const job: Active = {
        release: host.release,
        id,
        owner: sender.documentId ?? "",
        navigationId: request.navigationId as string,
        finish: reply,
        timer: setInterval(() => {
          void sendHost("host.renew", id).catch(() => undefined);
        }, 500),
        deadline: setTimeout(() => {
          if (active?.id !== id) return;
          clearInterval(job.timer);
          job.release();
          active = undefined;
          void sendHost("host.cancel", id).catch(() => undefined);
          void chrome.storage.session.remove(MARKER);
          void chrome.storage.session.set({
            [LAST]: {
              owner: job.owner,
              navigationId: job.navigationId,
              state: "failed",
              error: "deadline_exceeded",
            },
          });
          job.finish({ state: "failed", error: "deadline_exceeded" });
        }, JOB_DEADLINE_MS),
      };
      active = job;
      try {
        await chrome.storage.session.set({
          [MARKER]: {
            id,
            owner: job.owner,
            navigationId: request.navigationId,
            startedAt: Date.now(),
          },
        });
        const fixtureDelayMs = (input as Record<string, unknown>)
          .fixtureDelayMs as number | undefined;
        if (fixtureDelayMs)
          await new Promise((resolve) => setTimeout(resolve, fixtureDelayMs));
        if (active?.id !== id) return;
        await host.ready;
        if (active?.id !== id) return;
        const outcome = (await sendHost("host.start", id, input)) as JobOutcome;
        if (active?.id !== id) return;
        clearInterval(job.timer);
        clearTimeout(job.deadline);
        job.release();
        active = undefined;
        await chrome.storage.session.remove(MARKER);
        await chrome.storage.session.set({
          [LAST]: {
            owner: job.owner,
            navigationId: job.navigationId,
            state: outcome?.state ?? "interrupted",
          },
        });
        reply(outcome);
      } catch {
        if (active?.id !== id) return;
        clearInterval(job.timer);
        clearTimeout(job.deadline);
        job.release();
        active = undefined;
        await chrome.storage.session.remove(MARKER);
        await chrome.storage.session.set({
          [LAST]: {
            owner: job.owner,
            navigationId: job.navigationId,
            state: "interrupted",
          },
        });
        reply({ state: "interrupted" });
      }
    });
    return true;
  }
  return false;
}
