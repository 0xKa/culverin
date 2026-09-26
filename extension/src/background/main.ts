import {
  runCounter,
  type CounterFile,
  type CounterRules,
} from "../counter/runner";
import { handleFeasibility } from "../analysis/coordinator";
import { handleArchiveCounting, handleGithub } from "./github";
import { analyzeArchiveStream } from "../archive/bridge";

let fixtureJob:
  { id: string; owner: string; controller: AbortController } | undefined;

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (handleArchiveCounting(message, sender)) return false;
    if (handleFeasibility(message, sender, sendResponse)) return true;
    if (handleGithub(message, sender, sendResponse)) return true;
    const currentFixture = fixtureJob;
    if (
      sender.id !== chrome.runtime.id ||
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    )
      return false;
    if (
      sender.url === chrome.runtime.getURL("test-harness.html") &&
      message.type === "popup.open" &&
      "targetTabId" in message &&
      Number.isSafeInteger(message.targetTabId) &&
      (message.targetTabId as number) >= 0
    ) {
      void chrome.tabs
        .get(message.targetTabId as number)
        .then(async (tab) => {
          if (tab.windowId === undefined)
            throw new Error("Missing browser window");
          await chrome.tabs.update(tab.id!, { active: true });
          await chrome.action.openPopup({ windowId: tab.windowId });
          sendResponse({ ok: true });
        })
        .catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (
      sender.url === chrome.runtime.getURL("test-harness.html") &&
      message.type === "archive.fixture.cancel" &&
      "targetRequestId" in message &&
      currentFixture !== undefined &&
      currentFixture.id === message.targetRequestId &&
      currentFixture.owner === sender.documentId
    ) {
      currentFixture.controller.abort("cancel");
      sendResponse({ state: "canceled" });
      return false;
    }
    if (
      sender.url === chrome.runtime.getURL("test-harness.html") &&
      message.type === "archive.fixture" &&
      "requestId" in message &&
      typeof message.requestId === "string" &&
      /^[0-9a-f-]{36}$/.test(message.requestId) &&
      "bytes" in message &&
      Array.isArray(message.bytes) &&
      message.bytes.length <= 128 * 1024 &&
      (!("chunkDelayMs" in message) ||
        (Number.isInteger(message.chunkDelayMs) &&
          (message.chunkDelayMs as number) >= 0 &&
          (message.chunkDelayMs as number) <= 100)) &&
      (!("countBlockMs" in message) ||
        (Number.isInteger(message.countBlockMs) &&
          (message.countBlockMs as number) >= 0 &&
          (message.countBlockMs as number) <= 10_000)) &&
      message.bytes.every(
        (value: unknown) =>
          Number.isInteger(value) &&
          (value as number) >= 0 &&
          (value as number) <= 255,
      ) &&
      !fixtureJob
    ) {
      const job = {
        id: message.requestId,
        owner: sender.documentId ?? "",
        controller: new AbortController(),
      };
      fixtureJob = job;
      const bytes = Uint8Array.from(message.bytes);
      let offset = 0;
      const delay =
        "chunkDelayMs" in message ? (message.chunkDelayMs as number) : 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          if (job.controller.signal.aborted || offset >= bytes.length) {
            controller.close();
            return;
          }
          controller.enqueue(
            bytes.subarray(offset, offset + (delay ? 32 : bytes.length)),
          );
          offset += delay ? 32 : bytes.length;
        },
      });
      void analyzeArchiveStream(
        stream,
        { repositoryId: "1", sha: "a".repeat(40) },
        job.controller.signal,
        job.id,
        "countBlockMs" in message ? (message.countBlockMs as number) : 0,
      )
        .then((outcome) => sendResponse({ state: "analyzed", ...outcome }))
        .catch((error: unknown) =>
          sendResponse({
            state: "failed",
            code:
              typeof error === "object" && error && "code" in error
                ? error.code
                : "archive_invalid",
          }),
        )
        .finally(() => {
          if (fixtureJob === job) fixtureJob = undefined;
        });
      return true;
    }
    if (message.type === "bootstrap.ping") {
      void runCounter({ repositoryId: "1", commitSha: "a".repeat(40) }, [
        {
          path: "fixture.rs",
          bytes: new TextEncoder().encode("fn main() {}\n"),
        },
      ]).then((result) =>
        sendResponse(
          result.ok
            ? { ok: true, version: result.result.engine.version }
            : { ok: false },
        ),
      );
      return true;
    }
    if (
      message.type === "counter.analyze" &&
      sender.url === chrome.runtime.getURL("test-harness.html") &&
      "rules" in message &&
      "files" in message &&
      Array.isArray(message.files)
    ) {
      if (message.files.length > 100) return false;
      const files: CounterFile[] = [];
      let totalBytes = 0;
      for (const entry of message.files) {
        if (
          typeof entry !== "object" ||
          entry === null ||
          !("path" in entry) ||
          !("bytes" in entry) ||
          typeof entry.path !== "string" ||
          entry.path.length > 4096 ||
          !Array.isArray(entry.bytes) ||
          entry.bytes.length > 8 * 1024 * 1024 ||
          !entry.bytes.every(
            (n: unknown) =>
              Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 255,
          )
        )
          return false;
        totalBytes += entry.bytes.length;
        if (totalBytes > 16 * 1024 * 1024) return false;
        files.push({ path: entry.path, bytes: Uint8Array.from(entry.bytes) });
      }
      void runCounter(
        message.rules as CounterRules,
        files,
        "trap" in message && message.trap === true,
      ).then(sendResponse);
      return true;
    }
    return false;
  },
);
