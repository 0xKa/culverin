import { useEffect, useState } from "preact/hooks";
import { DEVICE_URL, INSTALL_URL, TOKEN_URL } from "../auth/github-app";
import { pendingKey } from "../auth/pending";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
import {
  authFailure,
  connectionSummary,
  connectionView,
  type AuthReply,
  type ConnectionView,
} from "./github";

type Update = {
  view: (value: ConnectionView) => void;
  status: (value: string) => void;
};

let update: Update | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

function send(
  type: string,
  extra: Record<string, unknown> = {},
): Promise<AuthReply | undefined> {
  return new Promise((resolve) =>
    chrome.runtime.sendMessage(
      {
        protocolVersion: 1,
        type,
        requestId: crypto.randomUUID(),
        navigationId: crypto.randomUUID(),
        ...extra,
      },
      (reply: AuthReply | undefined) =>
        resolve(chrome.runtime.lastError ? undefined : reply),
    ),
  );
}

function show(reply: AuthReply | undefined): ConnectionView | undefined {
  const next = connectionView(reply);
  if (next) update?.view(next);
  return next;
}

function stopPolling(): void {
  clearTimeout(timer);
  timer = undefined;
}

function schedule(delay: number): void {
  stopPolling();
  if (!update) return;
  timer = setTimeout(
    () => void check(),
    Math.min(Math.max(delay, 1000), 60_000),
  );
}

async function check(): Promise<void> {
  const reply = await send("auth.device.poll");
  if (reply?.state === "pending") {
    schedule(reply.retryIn ?? 5000);
    return;
  }
  if (reply?.state === "failed" && reply.code === "network_unavailable") {
    schedule(10_000);
    return;
  }
  stopPolling();
  if (reply?.state === "connected") {
    show(reply);
    update?.status(
      "Connected. Private repositories you gave Culverin access to can now be counted.",
    );
    return;
  }
  const current = show(await send("auth.status"));
  if (reply?.state !== "device-missing" || !current?.connected)
    update?.status(authFailure(reply));
}

function start(next: Update): () => void {
  update = next;
  void send("auth.status").then((reply) => {
    const current = show(reply);
    if (current?.device) schedule(current.device.interval * 1000);
  });
  return () => {
    stopPolling();
    update = undefined;
  };
}

function Link({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  );
}

export function GitHubSection({ hidden }: { hidden: boolean }) {
  const [view, setView] = useState<ConnectionView>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => start({ view: setView, status: setStatus }), []);

  async function connect(): Promise<void> {
    setBusy(true);
    setStatus("");
    const reply = await send("auth.device.start");
    setBusy(false);
    const current = show(reply);
    if (reply?.state === "ok" && current?.device)
      schedule(current.device.interval * 1000);
    else setStatus(authFailure(reply));
  }

  async function cancel(): Promise<void> {
    stopPolling();
    show(await send("auth.device.cancel"));
    setStatus("");
  }

  async function copy(code: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(code);
      setStatus("Code copied.");
    } catch {
      setStatus("Couldn't copy. Type the code shown above instead.");
    }
  }

  async function saveToken(event: Event): Promise<void> {
    event.preventDefault();
    const value = token.trim();
    if (!value) return;
    setBusy(true);
    setStatus("Checking the token with GitHub…");
    const submissionId = crypto.randomUUID();
    try {
      await chrome.storage.session.set({
        [pendingKey]: { token: value, submissionId, createdAt: Date.now() },
      });
    } catch {
      setBusy(false);
      setStatus("Couldn't save the token. Try again.");
      return;
    }
    const reply = await send("auth.submit", { submissionId });
    setBusy(false);
    if (reply?.state === "connected") {
      setToken("");
      stopPolling();
      show(reply);
      setStatus(
        "Connected. Private repositories this token can read can now be counted.",
      );
    } else setStatus(authFailure(reply));
  }

  async function disconnect(): Promise<void> {
    setBusy(true);
    stopPolling();
    const reply = await send("auth.disconnect");
    setBusy(false);
    show(await send("auth.status"));
    setStatus(
      reply?.state === "disconnected"
        ? "Disconnected. The saved token and private results were deleted."
        : "Extension unavailable. Try again.",
    );
  }

  const device = view?.device;
  return (
    <section aria-labelledby="github-heading" hidden={hidden}>
      <h2 id="github-heading" className="mb-4 text-[1.5em] font-bold">
        GitHub
      </h2>
      <p>
        Public repositories work without connecting. Connect GitHub to count
        private repositories and to use your account's limit of 5,000 GitHub
        requests per hour instead of 60.
      </p>
      <p id="github-connection" className="my-3 font-semibold">
        {view ? connectionSummary(view) : ""}
      </p>
      {view?.connected ? (
        <>
          {view.method === "app" && (
            <p>
              Culverin can read the repositories you chose when you installed
              the app.{" "}
              <Link href={INSTALL_URL}>Choose repositories on GitHub</Link>
            </p>
          )}
          <div className="my-3 flex flex-wrap gap-2">
            <Button
              id="github-disconnect"
              type="button"
              className="px-3 py-[7px]"
              disabled={busy}
              onClick={() => void disconnect()}
            >
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        view && (
          <>
            {view.expired && (
              <Button
                id="github-forget"
                type="button"
                className="my-1 px-3 py-[7px]"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                Forget @{view.login} and delete private results
              </Button>
            )}
            <h3 className="mt-6 mb-2 text-[1.17em] font-bold">
              Connect with GitHub
            </h3>
            {device ? (
              <div id="github-device">
                <p className="m-0">
                  Enter this code at <Link href={DEVICE_URL}>{DEVICE_URL}</Link>
                  , then approve Culverin:
                </p>
                <p
                  id="github-device-code"
                  className="my-3 font-mono text-[1.6em] font-bold tracking-widest"
                >
                  {device.userCode}
                </p>
                <div className="my-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    className="px-3 py-[7px]"
                    onClick={() => void copy(device.userCode)}
                  >
                    Copy code
                  </Button>
                  <Button
                    type="button"
                    className="px-3 py-[7px]"
                    onClick={() => void chrome.tabs.create({ url: DEVICE_URL })}
                  >
                    Open GitHub
                  </Button>
                  <Button
                    id="github-device-cancel"
                    type="button"
                    className="px-3 py-[7px]"
                    onClick={() => void cancel()}
                  >
                    Cancel
                  </Button>
                </div>
                <p className="text-muted">
                  Waiting for approval on GitHub. Only enter this code on
                  github.com. Culverin never asks for your GitHub password.
                </p>
              </div>
            ) : (
              <>
                <p>
                  GitHub shows a short code here. You enter it on github.com,
                  approve Culverin, and pick the repositories it can read. The
                  Culverin app can only read repository contents.
                </p>
                <Button
                  id="github-connect"
                  type="button"
                  className="my-3 px-3 py-[7px]"
                  disabled={busy}
                  onClick={() => void connect()}
                >
                  Connect with GitHub
                </Button>
              </>
            )}
            <p>
              To add or remove repositories later,{" "}
              <Link href={INSTALL_URL}>manage the Culverin app on GitHub</Link>.
              Organizations may need an owner to approve it.
            </p>
            <details className="my-4">
              <summary className="cursor-pointer">
                Use a personal access token instead
              </summary>
              <div className="mt-2 pl-4">
                <p>
                  For accounts or organizations that can't install the app.{" "}
                  <Link href={TOKEN_URL}>Create a fine-grained token</Link> with
                  read-only access to Contents for the repositories you want to
                  count, then paste it here.
                </p>
                <form
                  className="my-3 flex flex-wrap items-center gap-2"
                  onSubmit={(event) => void saveToken(event)}
                >
                  <label htmlFor="github-token" className="font-semibold">
                    Token
                  </label>
                  <input
                    id="github-token"
                    type="password"
                    autoComplete="off"
                    spellcheck={false}
                    value={token}
                    onInput={(event) => setToken(event.currentTarget.value)}
                    className="border-subtle min-w-0 flex-1 rounded-md border px-2 py-1 font-mono"
                  />
                  <Button
                    id="github-token-save"
                    type="submit"
                    className="px-3 py-[7px]"
                    disabled={busy || !token.trim()}
                  >
                    Save token
                  </Button>
                </form>
              </div>
            </details>
          </>
        )
      )}
      <Status id="github-status" className="min-h-[1.5em]">
        {status}
      </Status>
      <h3 className="mt-6 mb-2 text-[1.17em] font-bold">
        Where your connection is kept
      </h3>
      <p>
        The token is saved in this browser's extension storage so you don't need
        to connect again after a restart. Only Culverin's own pages and
        background worker can read it, and it's sent only to GitHub. Counts for
        private repositories are saved the same way, separately from public
        results, and deleted when you disconnect.
      </p>
    </section>
  );
}
