import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  readCountTrigger,
  writeCountTrigger,
  type CountTrigger,
} from "../counting/trigger";
import { Status } from "../ui/Status";

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
    <details className="my-2">
      <summary className="cursor-pointer">{summary}</summary>
      <div className="mt-1 mb-3 pl-4">{children}</div>
    </details>
  );
}

export function CountingSection({ hidden }: { hidden: boolean }) {
  const [trigger, setTrigger] = useState<CountTrigger>();
  const [status, setStatus] = useState("");

  useEffect(() => {
    void readCountTrigger().then(setTrigger);
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
      <h2 id="counting-heading" className="mb-4 text-[1.5em] font-bold">
        Counting
      </h2>
      <fieldset className="mb-3 border-0 p-0">
        <legend className="mb-1.5 font-semibold">
          Count lines of code in a repository
        </legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="my-2 grid grid-cols-[auto_1fr] items-baseline gap-x-2"
          >
            <input
              type="radio"
              name="count-trigger"
              value={option.value}
              checked={trigger === option.value}
              onChange={() => void change(option.value)}
            />
            <span>{option.label}</span>
            <span className="text-muted col-start-2">{option.detail}</span>
          </label>
        ))}
      </fieldset>
      <Status id="counting-status" className="min-h-[1.5em]">
        {status}
      </Status>
      <h3 id="requests-heading" className="mt-6 mb-2 text-[1.17em] font-bold">
        GitHub requests
      </h3>
      <p>
        Checking a repository uses 2 of your 60 GitHub requests per hour. The
        toolbar popup shows how many are left, such as{" "}
        <span className="whitespace-nowrap">API 57/60</span>.
      </p>
      <Question summary="Why is there a limit?">
        <p>
          GitHub allows 60 requests per hour to anyone who isn't signed in.
          Culverin has no server of its own, so requests go straight from your
          browser to GitHub without your GitHub account. Everything on your
          network that uses GitHub without signing in shares the same 60, and
          the count resets every hour.
        </p>
      </Question>
      <Question summary="Why does a check use 2 requests?">
        <p>
          The first asks for the repository's details: its default branch, its
          size, and whether it's still public. The second asks for the latest
          commit on that branch, which tells Culverin whether a saved count is
          still current. Downloading the source doesn't use any of the 60.
        </p>
      </Question>
      <Question summary="What uses requests, and what doesn't?">
        <ul className="list-disc pl-5">
          <li>
            Count lines or Analyze: 2, unless the repository was checked in the
            last 20 minutes.
          </li>
          <li>Reanalyze in the popup: always 2.</li>
          <li>
            Opening a repository page: none if you haven't counted it. If you
            have, or if you count when the page opens, 2 at most once every 20
            minutes.
          </li>
          <li>
            Opening the popup, or browsing files, issues, or pull requests:
            none.
          </li>
        </ul>
      </Question>
      <Question summary="What happens when I run out?">
        <p>
          Culverin stops asking GitHub and shows when you can try again, usually
          within the hour. Counts checked in the last 20 minutes still show.
        </p>
      </Question>
      <Question summary="Why might a count be out of date?">
        <p>
          To save requests, Culverin reuses a check for up to 20 minutes, so a
          new commit can take that long to appear. Select Reanalyze in the
          toolbar popup to check right away.
        </p>
      </Question>
    </section>
  );
}
