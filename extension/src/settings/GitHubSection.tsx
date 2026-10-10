import { ExternalLink } from "../ui/ExternalLink";
import { useEffect, useMemo, useState } from "preact/hooks";
import { DEVICE_URL, INSTALL_URL, TOKEN_URL } from "../auth/github-app";
import { Button } from "../ui/Button";
import { DotLoader } from "../ui/DotLoader";
import { IconButton } from "../ui/IconButton";
import { Check, Copy } from "lucide-preact";
import { Status } from "../ui/Status";
import { connectionSummary, type ConnectionView } from "./github";
import { inputClass, Panel, SectionHeader } from "./layout";
import { QuestionsPanel } from "./QuestionsPanel";
import { RequestsPanel } from "./RequestsPanel";
import { createGitHubController, type GitHubBusy } from "./github-controller";

export function GitHubSection({ hidden }: { hidden: boolean }) {
  const [view, setView] = useState<ConnectionView>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<GitHubBusy>();
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState<boolean>();

  const controller = useMemo(
    () =>
      createGitHubController({
        view: setView,
        status: setStatus,
        busy: setBusy,
        tokenCleared: () => setToken(""),
        copied: setCopied,
      }),
    [setView, setStatus, setBusy, setToken, setCopied],
  );
  useEffect(() => {
    controller.start();
    const wake = () => {
      if (document.visibilityState === "visible") controller.wake();
    };
    document.addEventListener("visibilitychange", wake);
    addEventListener("focus", wake);
    return () => {
      document.removeEventListener("visibilitychange", wake);
      removeEventListener("focus", wake);
      controller.dispose();
    };
  }, [controller]);

  const device = view?.device;
  useEffect(() => setCopied(undefined), [device?.userCode]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const tone = view?.connected
    ? "bg-ok"
    : view?.expired
      ? "bg-warning"
      : "bg-control";
  return (
    <section aria-labelledby="github-heading" hidden={hidden}>
      <SectionHeader id="github-heading" title="GitHub">
        Public repositories work without connecting. Connect with the GitHub app
        or a personal access token to count private repositories and to use your
        account's limit of 5,000 GitHub requests per hour instead of 60.
      </SectionHeader>
      <div className="grid gap-4">
        <Panel>
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-2.5 shrink-0 rounded-full forced-colors:bg-[CanvasText] ${view ? tone : "bg-transparent"}`}
            />
            <div className="min-w-0 flex-1">
              <p id="github-connection" className="m-0 min-h-6 font-medium">
                {view ? connectionSummary(view) : ""}
              </p>
              {view?.connected && view.method === "app" && (
                <p className="text-muted m-0 mt-1 text-sm">
                  Culverin can read the repositories you chose when you
                  installed the app.{" "}
                  <ExternalLink href={INSTALL_URL}>
                    Choose repositories on GitHub
                  </ExternalLink>
                </p>
              )}
            </div>
            {view?.connected && (
              <Button
                id="github-disconnect"
                type="button"
                size="md"
                disabled={busy !== undefined}
                onClick={() => void controller.disconnect()}
              >
                Disconnect
              </Button>
            )}
          </div>
          {view?.expired && !view.connected && (
            <Button
              id="github-forget"
              type="button"
              size="md"
              variant="danger"
              className="mt-3"
              disabled={busy !== undefined}
              onClick={() => void controller.disconnect()}
            >
              Forget @{view.login} and delete private results
            </Button>
          )}
          <Status id="github-status" className="m-0 text-sm not-empty:mt-3">
            {status}
          </Status>
        </Panel>
        {view && !view.connected && (
          <div className="grid gap-4 md:grid-cols-2">
            <Panel title="GitHub app" className="flex flex-col">
              {device ? (
                <div id="github-device">
                  <p className="m-0 text-sm">
                    Enter this code at{" "}
                    <ExternalLink href={DEVICE_URL}>{DEVICE_URL}</ExternalLink>,
                    then approve Culverin:
                  </p>
                  <div className="my-4 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p
                      id="github-device-code"
                      className="border-border bg-surface m-0 rounded-lg border border-dashed px-4 py-2 font-mono text-xl font-semibold tracking-[0.2em]"
                    >
                      {device.userCode}
                    </p>
                    <IconButton
                      id="github-device-copy"
                      type="button"
                      label="Copy code"
                      onClick={() => void controller.copy(device.userCode)}
                    >
                      {copied ? <Check /> : <Copy />}
                    </IconButton>
                    <Status id="github-copy-status" className="m-0 text-sm">
                      {copied === undefined
                        ? ""
                        : copied
                          ? "Code copied."
                          : "Couldn't copy. Type the code instead."}
                    </Status>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="md"
                      variant="primary"
                      onClick={() =>
                        void chrome.tabs.create({ url: DEVICE_URL })
                      }
                    >
                      Open GitHub
                    </Button>
                    <Button
                      id="github-device-cancel"
                      type="button"
                      size="md"
                      variant="ghost"
                      onClick={() => void controller.cancel()}
                    >
                      Cancel
                    </Button>
                  </div>
                  <p
                    id="github-device-waiting"
                    className="m-0 mt-4 flex items-center gap-2 text-sm font-medium"
                  >
                    <DotLoader size="sm" />
                    Waiting for approval on GitHub…
                  </p>
                  <p className="text-muted m-0 mt-1 text-sm">
                    Culverin notices within a few seconds of approval. Only
                    enter this code on github.com. Culverin never asks for your
                    GitHub password.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-muted m-0 text-sm">
                    Enter a short code on github.com, approve Culverin, and pick
                    the repositories it can read. The app can only read
                    repository contents, and there's no token to renew.
                  </p>
                  <p className="text-muted m-0 mt-2 text-sm">
                    <ExternalLink href={INSTALL_URL}>
                      Manage the Culverin app on GitHub
                    </ExternalLink>{" "}
                    to change its repositories later. Organizations may need an
                    owner to approve it.
                  </p>
                  <Button
                    id="github-connect"
                    type="button"
                    size="md"
                    variant="primary"
                    className="mt-4 self-start"
                    disabled={busy !== undefined}
                    aria-busy={busy === "connect"}
                    onClick={() => void controller.connect()}
                  >
                    {busy === "connect" && <DotLoader size="sm" />}
                    {busy === "connect" ? "Connecting…" : "Connect with GitHub"}
                  </Button>
                </>
              )}
            </Panel>
            <Panel title="Personal access token" className="flex flex-col">
              <p className="text-muted m-0 text-sm">
                <ExternalLink href={TOKEN_URL}>
                  Create a fine-grained token
                </ExternalLink>{" "}
                with read-only access to Contents for the repositories you want
                to count, then paste it here. Works anywhere you can create a
                token; you renew it when it expires.
              </p>
              <form
                className="mt-auto flex flex-wrap items-end gap-2 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void controller.saveToken(token);
                }}
              >
                <label
                  htmlFor="github-token"
                  className="w-full text-sm font-medium"
                >
                  Token
                </label>
                <input
                  id="github-token"
                  type="password"
                  autoComplete="off"
                  spellcheck={false}
                  placeholder="github_pat_…"
                  disabled={busy !== undefined || device !== undefined}
                  value={token}
                  onInput={(event) => setToken(event.currentTarget.value)}
                  className={`${inputClass} h-8 min-w-0 flex-1 py-0 font-mono text-sm`}
                />
                <Button
                  id="github-token-save"
                  type="submit"
                  size="md"
                  variant="primary"
                  disabled={
                    busy !== undefined || device !== undefined || !token.trim()
                  }
                  aria-busy={busy === "token"}
                >
                  {busy === "token" && <DotLoader size="sm" />}
                  {busy === "token" ? "Checking token…" : "Save token"}
                </Button>
              </form>
            </Panel>
          </div>
        )}
        <RequestsPanel />
        <QuestionsPanel />
        <div>
          <h3 className="text-md m-0 font-semibold">
            Where your connection is kept
          </h3>
          <p className="text-muted m-0 mt-1.5 text-sm">
            The token is saved in this browser's extension storage so you don't
            need to connect again after a restart. Only Culverin's own pages and
            background worker can read it, and it's sent only to GitHub. Counts
            for private repositories are saved the same way, separately from
            public results, and deleted when you disconnect.
          </p>
        </div>
      </div>
    </section>
  );
}
