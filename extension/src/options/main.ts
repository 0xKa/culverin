import { pendingKey, validPending, validToken } from "../auth/pending";
import { validRepository } from "../github/client";

const navigationId = crypto.randomUUID();
const owner = document.querySelector<HTMLInputElement>("#owner")!;
const name = document.querySelector<HTMLInputElement>("#name")!;
const token = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLElement>("#status")!;
let activeRequestId: string | undefined;

type Reply = {
  state?: string;
  code?: string;
  connected?: boolean;
  generation?: string;
  resolution?: { sha: string; visibility: string; defaultBranch: string };
  archive?: { bytes: number; finalOrigin: string };
  retryAt?: number;
};

function show(message: string): void {
  status.textContent = message;
}

function send(
  type: string,
  extra: Record<string, unknown> = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        protocolVersion: 1,
        type,
        requestId: crypto.randomUUID(),
        navigationId,
        ...extra,
      },
      (reply: Reply) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error("Extension request failed"));
        else resolve(reply);
      },
    );
  });
}

function repository(): { owner: string; name: string } | undefined {
  const value = { owner: owner.value.trim(), name: name.value.trim() };
  if (!validRepository(value.owner, value.name)) {
    show("Enter a valid GitHub owner and repository name.");
    return undefined;
  }
  return value;
}

function display(reply: Reply): void {
  if (reply.state === "resolved" && reply.resolution) {
    show(
      `${reply.resolution.visibility} default branch ${reply.resolution.defaultBranch} at ${reply.resolution.sha}`,
    );
  } else if (
    reply.state === "downloaded" &&
    reply.resolution &&
    reply.archive
  ) {
    show(
      `Downloaded and discarded ${reply.archive.bytes} bytes for ${reply.resolution.sha}. Final origin: ${reply.archive.finalOrigin}`,
    );
  } else if (reply.state === "failed") {
    show(
      `Request failed: ${reply.code ?? "unknown"}${reply.retryAt ? `. Retry after ${new Date(reply.retryAt).toLocaleString()}` : ""}`,
    );
  } else {
    show(reply.state ?? "No response");
  }
}

async function run(
  type: "repository.lookup" | "analysis.request",
): Promise<void> {
  const target = repository();
  if (!target) return;
  const requestId = crypto.randomUUID();
  if (type === "analysis.request") activeRequestId = requestId;
  show(type === "analysis.request" ? "Downloading…" : "Resolving…");
  try {
    const reply = await new Promise<Reply>((resolve, reject) => {
      chrome.runtime.sendMessage(
        { protocolVersion: 1, type, requestId, navigationId, ...target },
        (value: Reply) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error("Extension request failed"));
          else resolve(value);
        },
      );
    });
    display(reply);
  } catch {
    show("Extension request failed.");
  } finally {
    if (activeRequestId === requestId) activeRequestId = undefined;
  }
}

document
  .querySelector("#lookup")!
  .addEventListener("click", () => void run("repository.lookup"));
document
  .querySelector("#download")!
  .addEventListener("click", () => void run("analysis.request"));
document.querySelector("#cancel")!.addEventListener("click", async () => {
  if (!activeRequestId) return;
  display(await send("analysis.cancel", { targetRequestId: activeRequestId }));
});
document.querySelector("#disconnect")!.addEventListener("click", async () => {
  display(await send("auth.disconnect"));
});
document.querySelector("#connect")!.addEventListener("click", async () => {
  const target = repository();
  if (!target) return;
  const value = token.value;
  token.value = "";
  if (!validToken(value)) {
    show("Enter a valid temporary token.");
    return;
  }
  try {
    const current = await send("auth.status");
    if (typeof current.generation !== "string")
      throw new Error("Missing generation");
    const submissionId = crypto.randomUUID();
    const pending = {
      token: value,
      submissionId,
      generation: current.generation,
      ...target,
      createdAt: Date.now(),
    };
    if (!validPending(pending)) throw new Error("Invalid submission");
    await chrome.storage.session.set({ [pendingKey]: pending });
    show("Validating access…");
    display(await send("auth.submit", { submissionId }));
  } catch {
    show("Token validation failed.");
  }
});

void send("auth.status").then(
  (reply) =>
    show(
      reply.connected
        ? "Token connected for this browser session."
        : "No token connected.",
    ),
  () => show("Extension unavailable."),
);
