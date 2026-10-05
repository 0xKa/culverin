import { ExternalLink } from "../ui/ExternalLink";
import { useEffect, useMemo, useState } from "preact/hooks";
import { DEVICE_URL, INSTALL_URL, TOKEN_URL } from "../auth/github-app";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Status } from "../ui/Status";
import { connectionSummary, type ConnectionView } from "./github";
import { inputClass, Panel, SectionHeader } from "./layout";
import { createGitHubController, type GitHubBusy } from "./github-controller";

export function GitHubSection({ hidden }: { hidden: boolean }) {
  const [view, setView] = useState<ConnectionView>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<GitHubBusy>();
  const [token, setToken] = useState("");

  const controller = useMemo(
    () =>
      createGitHubController({
        view: setView,
        status: setStatus,
        busy: setBusy,
        tokenCleared: () => setToken(""),
      }),
    [setView, setStatus, setBusy, setToken],
  );
  useEffect(() => {
    controller.start();
    return controller.dispose;
  }, [controller]);

  const device = view?.device;
  const tone = view?.connected
    ? "bg-ok"
    : view?.expired
      ? "bg-warning"
      : "bg-control";
  return (
    <section aria-labelledby="github-heading" hidden={hidden}>
      <SectionHeader id="github-heading" title="GitHub">
        Public repositories work without connecting. Connect GitHub to count
        private repositories and to use your account's limit of 5,000 GitHub
        requests per hour instead of 60.
      </SectionHeader>
      <div className="grid gap-5">
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
          <Panel title="Connect with GitHub">
            {device ? (
              <div id="github-device">
                <p className="m-0">
                  Enter this code at{" "}
                  <ExternalLink href={DEVICE_URL}>{DEVICE_URL}</ExternalLink>,
                  then approve Culverin:
                </p>
                <p
                  id="github-device-code"
                  className="border-border bg-surface my-4 inline-block rounded-lg border border-dashed px-5 py-3 font-mono text-2xl font-semibold tracking-[0.2em]"
                >
                  {device.userCode}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="md"
                    variant="primary"
                    onClick={() => void controller.copy(device.userCode)}
                  >
                    Copy code
                  </Button>
                  <Button
                    type="button"
                    size="md"
                    onClick={() => void chrome.tabs.create({ url: DEVICE_URL })}
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
                <p className="text-muted m-0 mt-4 text-sm">
                  Waiting for approval on GitHub. Only enter this code on
                  github.com. Culverin never asks for your GitHub password.
                </p>
              </div>
            ) : (
              <>
                <p className="text-muted m-0">
                  GitHub shows a short code here. You enter it on github.com,
                  approve Culverin, and pick the repositories it can read. The
                  Culverin app can only read repository contents.
                </p>
                <Button
                  id="github-connect"
                  type="button"
                  size="md"
                  variant="primary"
                  className="mt-4"
                  disabled={busy !== undefined}
                  aria-busy={busy === "connect"}
                  onClick={() => void controller.connect()}
                >
                  {busy === "connect" && <Spinner />}
                  {busy === "connect" ? "Connecting…" : "Connect with GitHub"}
                </Button>
              </>
            )}
            <p className="text-muted m-0 mt-4 text-sm">
              To add or remove repositories later,{" "}
              <ExternalLink href={INSTALL_URL}>
                manage the Culverin app on GitHub
              </ExternalLink>
              . Organizations may need an owner to approve it.
            </p>
            <details className="disclosure border-divider mt-5 border-t pt-4">
              <summary className="text-sm">
                Use a personal access token instead
              </summary>
              <div className="mt-3">
                <p className="text-muted m-0 text-sm">
                  For accounts or organizations that can't install the app.{" "}
                  <ExternalLink href={TOKEN_URL}>
                    Create a fine-grained token
                  </ExternalLink>{" "}
                  with read-only access to Contents for the repositories you
                  want to count, then paste it here.
                </p>
                <form
                  className="mt-3 flex flex-wrap items-end gap-2"
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
                    disabled={busy !== undefined}
                    value={token}
                    onInput={(event) => setToken(event.currentTarget.value)}
                    className={`${inputClass} h-8 min-w-0 flex-1 py-0 font-mono text-sm`}
                  />
                  <Button
                    id="github-token-save"
                    type="submit"
                    size="md"
                    disabled={busy !== undefined || !token.trim()}
                    aria-busy={busy === "token"}
                  >
                    {busy === "token" && <Spinner />}
                    {busy === "token" ? "Checking token…" : "Save token"}
                  </Button>
                </form>
              </div>
            </details>
          </Panel>
        )}
        <div className="px-1">
          <h3 className="text-md m-0 font-semibold">
            Where your connection is kept
          </h3>
          <p className="text-muted m-0 mt-1.5 max-w-[72ch] text-sm">
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
