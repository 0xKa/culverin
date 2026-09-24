import init, { bootstrap_version } from "../wasm/generated/culverin_counter.js";

let ready: Promise<string> | undefined;

function wasmVersion(): Promise<string> {
  ready ??= init().then(() => bootstrap_version());
  return ready;
}

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !isBootstrapPing(message))
      return false;
    void wasmVersion()
      .then((version) => sendResponse({ ok: true, version }))
      .catch(() => {
        ready = undefined;
        sendResponse({ ok: false });
      });
    return true;
  },
);

function isBootstrapPing(value: unknown): value is { type: "bootstrap.ping" } {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "bootstrap.ping"
  );
}
