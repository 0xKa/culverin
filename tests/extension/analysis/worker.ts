import { runCounter } from "../../../extension/src/counter/runner";
import type { JobInput } from "./protocol";

self.onmessage = (event: MessageEvent<JobInput>) => {
  const { rules, files, trap, slowCall, blockMs } = event.data;
  const input = files.map((file) => ({
    path: file.path,
    bytes: Uint8Array.from(file.bytes),
  }));
  if (slowCall)
    input.push({
      path: "slow.rs",
      bytes: new TextEncoder().encode("let value = 1;\n".repeat(349_525)),
    });
  self.postMessage({ stage: "counting" });
  if (blockMs) {
    const until = performance.now() + blockMs;
    let ticks = 0;
    while (performance.now() < until) ticks += 1;
    void ticks;
  }
  void runCounter(rules, input, trap).then((outcome) =>
    self.postMessage(outcome),
  );
};
