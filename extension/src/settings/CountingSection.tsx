import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { currentRemaining } from "../github/rate-limit";
import {
  subscribeRateLimit,
  type RateLimitSnapshot,
} from "../github/rate-limit-observer";
import {
  readCountTrigger,
  writeCountTrigger,
  type CountTrigger,
} from "../counting/trigger";
import { formatClockTime } from "../ui/format";
import { Status } from "../ui/Status";
import { UsageMeter } from "../ui/UsageMeter";
import { Panel, SectionHeader } from "./layout";

const options: { value: CountTrigger; label: string; detail: string }[] = [
  {
    value: "manual",
    label: "When I select Count lines or Analyze",
    detail:
      "Opening a repository page sends nothing to GitHub unless you counted it before. Then Culverin checks that the count is still current, at most once every 20 minutes.",
  },
  {
    value: "open",
    label: "When I open the repository page",
    detail:
      "Every repository page you open without a current count is checked and counted. Culverin tries each commit once per browser session, so a count that fails or is canceled isn't repeated on every visit.",
  },
];

function Question({
  summary,
  children,
}: {
  summary: string;
  children: ComponentChildren;
}) {
  return (
    <details className="disclosure py-3">
      <summary className="font-medium">{summary}</summary>
      <div className="text-muted mt-2 pl-[1.15rem] [&_p]:m-0">{children}</div>
    </details>
  );
}

export function CountingSection({ hidden }: { hidden: boolean }) {
  const [trigger, setTrigger] = useState<CountTrigger>();
  const [status, setStatus] = useState("");
  const [snapshot, setSnapshot] = useState<RateLimitSnapshot>({
    value: undefined,
    now: Date.now(),
  });
  const { value: rateLimit, now } = snapshot;
  const limit = rateLimit?.authenticated
    ? rateLimit.limit.toLocaleString()
    : "60";

  useEffect(() => {
    void readCountTrigger().then(setTrigger);
    return subscribeRateLimit(setSnapshot);
  }, []);

  async function change(next: CountTrigger): Promise<void> {
    setTrigger(next);
    try {
      await writeCountTrigger(next);
      setStatus("Saved. Applies to repository pages you open from now on.");
    } catch {
      setStatus("Couldn't save the setting. Try again.");
    }
  }

  return (
    <section aria-labelledby="counting-heading" hidden={hidden}>
      <SectionHeader id="counting-heading" title="Counting" />
      <div className="grid gap-5">
        <Panel>
          <fieldset className="m-0 border-0 p-0">
            <legend className="text-md mb-3 p-0 font-semibold">
              Count lines of code in a repository
            </legend>
            <div className="grid gap-2.5">
              {options.map((option) => (
                <label
                  key={option.value}
                  className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150"
                >
                  <input
                    type="radio"
                    name="count-trigger"
                    value={option.value}
                    className="size-4 translate-y-0.5"
                    checked={trigger === option.value}
                    onChange={() => void change(option.value)}
                  />
                  <span className="font-medium">{option.label}</span>
                  <span className="text-muted col-start-2 text-sm">
                    {option.detail}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <Status
            id="counting-status"
            className="text-muted m-0 text-sm not-empty:mt-2"
          >
            {status}
          </Status>
        </Panel>
        <Panel title="GitHub requests" titleId="requests-heading">
          <div id="api-usage" className="bg-surface mb-4 rounded-lg p-4">
            <p className="text-muted m-0 text-sm">GitHub API usage</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              {rateLimit ? (
                <>
                  <span className="tabular text-xl font-semibold">
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
                </>
              ) : (
                <span className="text-muted text-sm">
                  Not known yet. GitHub only reports it in reply to a request,
                  and Culverin doesn't send one just to check. It appears after
                  Culverin next contacts GitHub.
                </span>
              )}
            </div>
          </div>
          <p className="m-0">
            Checking a repository uses 2 of your {limit} GitHub requests per
            hour. The toolbar popup shows how many are left.
          </p>
          <p id="api-usage-shared" className="text-muted m-0 mt-2 text-sm">
            {rateLimit?.authenticated
              ? `GitHub counts every request made with your account toward the same ${limit}, including VS Code, GitHub Desktop, the gh command line, and other GitHub apps or tokens you use. The count can be below ${limit} before Culverin has used any.`
              : `Everything on your network that uses GitHub without signing in shares the same ${limit}. The count can be below ${limit} before Culverin has used any.`}
          </p>
        </Panel>
        <Panel title="Common questions" titleId="questions-heading">
          <div className="divide-divider border-divider -mb-3 divide-y border-t">
            <Question summary="Why is there a limit?">
              <p>
                GitHub allows 60 requests per hour to anyone who isn't signed
                in. Culverin has no server of its own, so requests go straight
                from your browser to GitHub without your GitHub account.
                Everything on your network that uses GitHub without signing in
                shares the same 60, and the count resets every hour. Connect
                GitHub in the GitHub section to use your account's own limit of
                5,000 requests per hour instead.
              </p>
            </Question>
            <Question summary="Why does a check use 2 requests?">
              <p>
                The first asks for the repository's details: its default branch,
                its size, and whether it's still public. The second asks for the
                latest commit on that branch, which tells Culverin whether a
                saved count is still current. Downloading the source doesn't use
                any of them.
              </p>
            </Question>
            <Question summary="What uses requests, and what doesn't?">
              <ul className="m-0 grid list-disc gap-1 pl-5">
                <li>
                  Count lines or Analyze: 2, unless the repository was checked
                  in the last 20 minutes.
                </li>
                <li>Reanalyze in the popup: always 2.</li>
                <li>
                  Opening a repository page: none if you haven't counted it. If
                  you have, or if you count when the page opens, 2 at most once
                  every 20 minutes.
                </li>
                <li>
                  Opening the popup, or browsing files, issues, or pull
                  requests: none.
                </li>
              </ul>
            </Question>
            <Question summary="What happens when I run out?">
              <p>
                Culverin stops asking GitHub and shows when you can try again,
                usually within the hour. Counts checked in the last 20 minutes
                still show.
              </p>
            </Question>
            <Question summary="Why might a count be out of date?">
              <p>
                To save requests, Culverin reuses a check for up to 20 minutes,
                so a new commit can take that long to appear. Select Reanalyze
                in the toolbar popup to check right away.
              </p>
            </Question>
          </div>
        </Panel>
      </div>
    </section>
  );
}
