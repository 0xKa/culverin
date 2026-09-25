import { validateResult } from "../counter/result";
import {
  archiveHostActive,
  handleArchiveHost,
  stopArchive,
} from "../archive/host";
import {
  HOST_LEASE_MS,
  JOB_DEADLINE_MS,
  PROTOCOL_VERSION,
  validInput,
  type JobOutcome,
} from "./protocol";

type Active = {
  id: string;
  worker: Worker;
  finish: (outcome: JobOutcome) => void;
  lease: ReturnType<typeof setTimeout>;
  deadline: ReturnType<typeof setTimeout>;
};
let active: Active | undefined;
const probe = new BroadcastChannel("culverin-feasibility-probe");
probe.onmessage = (event: MessageEvent<unknown>) => {
  const value = event.data as { type?: unknown; id?: unknown };
  if (value?.type === "probe" && typeof value.id === "string")
    probe.postMessage({
      type: "probe.reply",
      id: value.id,
      active: Boolean(active) || archiveHostActive(),
    });
};

function stop(outcome: JobOutcome): void {
  const job = active;
  if (!job) return;
  active = undefined;
  clearTimeout(job.lease);
  clearTimeout(job.deadline);
  job.worker.terminate();
  job.finish(outcome);
}

function renew(): void {
  if (!active) return;
  clearTimeout(active.lease);
  active.lease = setTimeout(
    () => stop({ state: "interrupted" }),
    HOST_LEASE_MS,
  );
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (handleArchiveHost(message, sender, respond, Boolean(active))) return true;
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL("background.js") ||
    typeof message !== "object" ||
    message === null
  )
    return false;
  const command = message as Record<string, unknown>;
  if (
    command.target !== "analysis.host" ||
    command.protocolVersion !== PROTOCOL_VERSION
  )
    return false;
  if (
    command.type === "host.start" &&
    typeof command.jobId === "string" &&
    validInput(command.input)
  ) {
    if (active || archiveHostActive()) {
      respond({ state: "failed", error: "counter_failed" });
      return false;
    }
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const id = command.jobId;
    active = {
      id,
      worker,
      finish: respond,
      lease: setTimeout(() => stop({ state: "interrupted" }), HOST_LEASE_MS),
      deadline: setTimeout(
        () => stop({ state: "failed", error: "deadline_exceeded" }),
        JOB_DEADLINE_MS,
      ),
    };
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (active?.id !== id) return;
      const value = event.data as {
        ok?: unknown;
        result?: unknown;
        error?: unknown;
      };
      if (
        typeof value === "object" &&
        value !== null &&
        "stage" in value &&
        value.stage === "counting"
      ) {
        void chrome.runtime.sendMessage({
          protocolVersion: PROTOCOL_VERSION,
          type: "feasibility.counting",
          requestId: id,
        });
        return;
      }
      if (value?.ok === true && validateResult(value.result))
        stop({ state: "completed", result: value.result });
      else if (
        value?.ok === false &&
        (value.error === "counter_failed" || value.error === "invalid_input")
      )
        stop({ state: "failed", error: value.error });
      else stop({ state: "failed", error: "counter_failed" });
    };
    worker.onerror = () => stop({ state: "failed", error: "counter_failed" });
    worker.postMessage(command.input);
    return true;
  }
  if (command.type === "host.cancel" && command.jobId === active?.id) {
    stop({ state: "canceled" });
    respond({ ok: true });
    return false;
  }
  if (command.type === "host.renew" && command.jobId === active?.id) {
    renew();
    respond({ ok: true });
    return false;
  }
  if (command.type === "host.reconcile") {
    stop({ state: "interrupted" });
    stopArchive();
    respond({ ok: true });
    return false;
  }
  return false;
});
