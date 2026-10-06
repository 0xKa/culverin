import { pendingKey } from "../auth/pending";
import { sendSettings } from "./client";
import { authFailure, connectionView, type ConnectionView } from "./github";
import type { SettingsReply } from "../protocol/settings";

export type GitHubBusy = "connect" | "token" | "disconnect" | undefined;
type Update = {
  view: (value: ConnectionView) => void;
  status: (value: string) => void;
  busy: (value: GitHubBusy) => void;
  tokenCleared: () => void;
  copied: (ok: boolean) => void;
};
type Dependencies = {
  send?: typeof sendSettings;
  storage?: Pick<chrome.storage.StorageArea, "set">;
  copy?: (value: string) => Promise<void>;
};
export function createGitHubController(
  update: Update,
  dependencies: Dependencies = {},
) {
  const send = dependencies.send ?? sendSettings;
  let disposed = false;
  let started = false;
  let generation = 0;
  let busy: GitHubBusy;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const current = (id: number) => !disposed && generation === id;
  const status = (value: string) => {
    if (!disposed) update.status(value);
  };
  const setBusy = (value: GitHubBusy) => {
    busy = value;
    if (!disposed) update.busy(value);
  };
  const show = (reply: SettingsReply | undefined) => {
    const view = connectionView(reply);
    if (view && !disposed) update.view(view);
    return view;
  };
  function stopPolling(): void {
    clearTimeout(timer);
    timer = undefined;
  }
  function schedule(delay: number, id: number): void {
    stopPolling();
    if (current(id))
      timer = setTimeout(
        () => void check(id),
        Math.min(Math.max(delay, 1000), 60_000),
      );
  }
  async function check(id: number): Promise<void> {
    const reply = await send({ type: "auth.device.poll" });
    if (!current(id)) return;
    if (reply?.state === "pending") {
      schedule(reply.retryIn, id);
      return;
    }
    if (reply?.state === "failed" && reply.code === "network_unavailable") {
      schedule(10_000, id);
      return;
    }
    stopPolling();
    if (reply?.state === "connected") {
      show(reply);
      status(
        "Connected. Private repositories you gave Culverin access to can now be counted.",
      );
      return;
    }
    const latest = await send({ type: "auth.status" });
    if (!current(id)) return;
    const view = show(latest);
    if (reply?.state !== "device-missing" || !view?.connected)
      status(authFailure(reply));
  }
  function start(): void {
    if (disposed || started) return;
    started = true;
    const id = generation;
    void send({ type: "auth.status" }).then((reply) => {
      if (!current(id)) return;
      const view = show(reply);
      if (view?.device) schedule(view.device.interval * 1000, id);
    });
  }
  function wake(): void {
    if (disposed || timer === undefined) return;
    stopPolling();
    void check(generation);
  }
  async function connect(): Promise<void> {
    if (disposed || busy) return;
    const id = ++generation;
    stopPolling();
    setBusy("connect");
    status("");
    const reply = await send({ type: "auth.device.start" });
    if (!current(id)) return;
    setBusy(undefined);
    const view = show(reply);
    if (reply?.state === "ok" && view?.device)
      schedule(view.device.interval * 1000, id);
    else status(authFailure(reply));
  }
  async function cancel(): Promise<void> {
    if (disposed) return;
    const id = ++generation;
    stopPolling();
    setBusy(undefined);
    const reply = await send({ type: "auth.device.cancel" });
    if (!current(id)) return;
    show(reply);
    status("");
  }
  async function copy(code: string): Promise<void> {
    const id = generation;
    try {
      await (
        dependencies.copy ?? ((value) => navigator.clipboard.writeText(value))
      )(code);
      if (current(id)) update.copied(true);
    } catch {
      if (current(id)) update.copied(false);
    }
  }
  async function saveToken(token: string): Promise<void> {
    const value = token.trim();
    if (disposed || busy || !value) return;
    const id = ++generation;
    stopPolling();
    setBusy("token");
    status("Checking the token with GitHub…");
    const submissionId = crypto.randomUUID();
    try {
      await (dependencies.storage ?? chrome.storage.session).set({
        [pendingKey]: { token: value, submissionId, createdAt: Date.now() },
      });
    } catch {
      if (current(id)) {
        setBusy(undefined);
        status("Couldn't save the token. Try again.");
      }
      return;
    }
    if (!current(id)) return;
    const reply = await send({ type: "auth.submit", submissionId });
    if (!current(id)) return;
    setBusy(undefined);
    if (reply?.state === "connected") {
      update.tokenCleared();
      show(reply);
      status(
        "Connected. Private repositories this token can read can now be counted.",
      );
    } else status(authFailure(reply));
  }
  async function disconnect(): Promise<void> {
    if (disposed || busy) return;
    const id = ++generation;
    stopPolling();
    setBusy("disconnect");
    const reply = await send({ type: "auth.disconnect" });
    if (!current(id)) return;
    const latest = await send({ type: "auth.status" });
    if (!current(id)) return;
    setBusy(undefined);
    show(latest);
    status(
      reply?.state === "disconnected"
        ? "Disconnected. The saved token and private results were deleted."
        : "Extension unavailable. Try again.",
    );
  }
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    generation++;
    stopPolling();
  }
  return {
    start,
    wake,
    connect,
    cancel,
    copy,
    saveToken,
    disconnect,
    dispose,
  };
}
