import { ExternalLink } from "../ui/ExternalLink";
import { useEffect, useMemo, useState } from "preact/hooks";
import { DEVICE_URL, INSTALL_URL, TOKEN_URL } from "../auth/github-app";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Status } from "../ui/Status";
import { connectionSummary, type ConnectionView } from "./github";
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
              <ExternalLink href={INSTALL_URL}>
                Choose repositories on GitHub
              </ExternalLink>
            </p>
          )}
          <div className="my-3 flex flex-wrap gap-2">
            <Button
              id="github-disconnect"
              type="button"

              disabled={busy !== undefined}
              onClick={() => void controller.disconnect()}
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
                className="my-1"
                disabled={busy !== undefined}
                onClick={() => void controller.disconnect()}
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
                  Enter this code at{" "}
                  <ExternalLink href={DEVICE_URL}>{DEVICE_URL}</ExternalLink>,
                  then approve Culverin:
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

                    onClick={() => void controller.copy(device.userCode)}
                  >
                    Copy code
                  </Button>
                  <Button
                    type="button"

                    onClick={() => void chrome.tabs.create({ url: DEVICE_URL })}
                  >
                    Open GitHub
                  </Button>
                  <Button
                    id="github-device-cancel"
                    type="button"

                    onClick={() => void controller.cancel()}
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
                  className="my-3"
                  disabled={busy !== undefined}
                  aria-busy={busy === "connect"}
                  onClick={() => void controller.connect()}
                >
                  {busy === "connect" && <Spinner />}
                  {busy === "connect" ? "Connecting…" : "Connect with GitHub"}
                </Button>
              </>
            )}
            <p>
              To add or remove repositories later,{" "}
              <ExternalLink href={INSTALL_URL}>
                manage the Culverin app on GitHub
              </ExternalLink>
              . Organizations may need an owner to approve it.
            </p>
            <details className="my-4">
              <summary className="cursor-pointer">
                Use a personal access token instead
              </summary>
              <div className="mt-2 pl-4">
                <p>
                  For accounts or organizations that can't install the app.{" "}
                  <ExternalLink href={TOKEN_URL}>
                    Create a fine-grained token
                  </ExternalLink>{" "}
                  with read-only access to Contents for the repositories you
                  want to count, then paste it here.
                </p>
                <form
                  className="my-3 flex flex-wrap items-center gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void controller.saveToken(token);
                  }}
                >
                  <label htmlFor="github-token" className="font-semibold">
                    Token
                  </label>
                  <input
                    id="github-token"
                    type="password"
                    autoComplete="off"
                    spellcheck={false}
                    disabled={busy !== undefined}
                    value={token}
                    onInput={(event) => setToken(event.currentTarget.value)}
                    className="border-subtle min-w-0 flex-1 rounded-md border px-2 py-1 font-mono"
                  />
                  <Button
                    id="github-token-save"
                    type="submit"

                    disabled={busy !== undefined || !token.trim()}
                    aria-busy={busy === "token"}
                  >
                    {busy === "token" && <Spinner />}
                    {busy === "token" ? "Checking token…" : "Save token"}
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
