import { useEffect, useState } from "preact/hooks";
import { currentRemaining } from "../github/rate-limit";
import {
  subscribeRateLimit,
  type RateLimitSnapshot,
} from "../github/rate-limit-observer";
import { Button } from "../ui/Button";
import { DotLoader } from "../ui/DotLoader";
import { formatClockTime } from "../ui/format";
import { IconButton } from "../ui/IconButton";
import { RefreshIcon } from "../ui/icons";
import { Status } from "../ui/Status";
import { UsageMeter } from "../ui/UsageMeter";
import { sendSettings } from "./client";
import { Panel } from "./layout";

const FREE =
  "Checking is free without a GitHub connection. While connected, it uses 1 of your requests.";

export function RequestsPanel() {
  const [snapshot, setSnapshot] = useState<RateLimitSnapshot>({
    value: undefined,
    now: Date.now(),
  });
  const { value: rateLimit, now } = snapshot;
  const limit = rateLimit?.authenticated
    ? rateLimit.limit.toLocaleString()
    : "60";

  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => subscribeRateLimit(setSnapshot), []);

  async function check(): Promise<void> {
    setChecking(true);
    setStatus("");
    const reply = await sendSettings({ type: "rate-limit.check" });
    setChecking(false);
    if (reply?.state === "checked") return;
    setStatus(
      reply?.state === "failed" && reply.code === "authentication_invalid"
        ? "Your GitHub connection expired. Reconnect GitHub to check your account's limit."
        : "Couldn't reach GitHub. Try again.",
    );
  }

  return (
    <Panel title="GitHub requests" titleId="requests-heading">
      <div id="api-usage" className="bg-surface mb-4 rounded-lg p-4">
        <p className="text-muted m-0 text-sm">GitHub API usage</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {rateLimit ? (
            <>
              <span className="font-mono text-xl font-semibold">
                {currentRemaining(rateLimit, now)}
                <span className="text-muted text-base font-normal">
                  /{rateLimit.limit}
                </span>
              </span>
              <UsageMeter
                id="api-usage-meter"
                value={rateLimit}
                now={now}
                className="h-2 w-32"
              />
              {now < rateLimit.reset && (
                <span className="text-muted text-sm">
                  resets at {formatClockTime(rateLimit.reset)}
                </span>
              )}
              <IconButton
                id="api-usage-check"
                type="button"
                label={checking ? "Checking…" : "Refresh"}
                className="ml-auto disabled:pointer-events-none"
                disabled={checking}
                aria-busy={checking}
                onClick={() => void check()}
              >
                {checking ? <DotLoader size="sm" /> : <RefreshIcon />}
              </IconButton>
            </>
          ) : (
            <>
              <span className="text-muted text-sm">Not known yet.</span>
              <Button
                id="api-usage-check"
                type="button"
                size="sm"
                title={FREE}
                disabled={checking}
                aria-busy={checking}
                onClick={() => void check()}
              >
                {checking && <DotLoader size="sm" />}
                {checking ? "Checking…" : "Check now"}
              </Button>
            </>
          )}
        </div>
        {!rateLimit && <p className="text-muted m-0 mt-1.5 text-xs">{FREE}</p>}
        <Status id="api-usage-status" className="m-0 text-sm not-empty:mt-2">
          {status}
        </Status>
      </div>
      <p className="m-0">
        Checking a repository uses 2 of your {limit} GitHub requests per hour.
        The toolbar popup shows how many are left.
      </p>
      <p id="api-usage-shared" className="text-muted m-0 mt-2 text-sm">
        {rateLimit?.authenticated
          ? `GitHub counts every request made with your account toward the same ${limit}, including VS Code, GitHub Desktop, the gh command line, and other GitHub apps or tokens you use. The count can be below ${limit} before Culverin has used any.`
          : `Everything on your network that uses GitHub without signing in shares the same ${limit}. The count can be below ${limit} before Culverin has used any.`}
      </p>
    </Panel>
  );
}
