import assert from "node:assert/strict";
import type { runSetup } from "./setup";
export async function runDeniedDiagnostics(
  state: Awaited<ReturnType<typeof runSetup>>,
): Promise<void> {
  const { harness, fixtures } = state;
  const outcome = await harness.evaluate(async () => {
    const before = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    const requests = [
      { type: "bootstrap.ping" },
      {
        type: "counter.analyze",
        rules: { repositoryId: "1", commitSha: "a".repeat(40) },
        files: [],
      },
      { type: "archive.fixture", bytes: [1] },
      { type: "archive.fixture.cancel", targetRequestId: crypto.randomUUID() },
      {
        type: "feasibility.start",
        input: {
          rules: { repositoryId: "1", commitSha: "a".repeat(40) },
          files: [],
        },
      },
      { type: "feasibility.status" },
    ];
    const replies: string[] = [];
    for (const request of requests)
      replies.push(
        await new Promise((resolve) =>
          chrome.runtime.sendMessage(
            {
              protocolVersion: 1,
              requestId: crypto.randomUUID(),
              navigationId: crypto.randomUUID(),
              ...request,
            },
            () => resolve(chrome.runtime.lastError ? "rejected" : "handled"),
          ),
        ),
      );
    const after = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
    });
    return { replies, before: before.length, after: after.length };
  });
  assert.deepEqual(outcome.replies, Array(6).fill("rejected"));
  assert.equal(outcome.before, 0);
  assert.equal(outcome.after, 0);
  assert.equal(fixtures.apiRequests, 0);
  assert.equal(fixtures.archiveRequests, 0);
}
