import {
  runCounter,
  type CounterFile,
  type CounterRules,
} from "../counter/runner";
import { handleFeasibility } from "../analysis/coordinator";

chrome.runtime.onMessage.addListener(
  (message: unknown, sender, sendResponse) => {
    if (handleFeasibility(message, sender, sendResponse)) return true;
    if (
      sender.id !== chrome.runtime.id ||
      typeof message !== "object" ||
      message === null ||
      !("type" in message)
    )
      return false;
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
