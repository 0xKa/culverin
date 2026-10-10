import type { ComponentChildren } from "preact";
import { Panel } from "./layout";

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

export function QuestionsPanel() {
  return (
    <Panel title="Common questions" titleId="questions-heading">
      <div className="divide-divider border-divider -mb-3 divide-y border-t">
        <Question summary="Why is there a limit?">
          <p>
            GitHub allows 60 requests per hour to anyone who isn't signed in.
            Culverin has no server of its own, so requests go straight from your
            browser to GitHub without your GitHub account. Everything on your
            network that uses GitHub without signing in shares the same 60, and
            the count resets every hour. Connect GitHub above to use your
            account's own limit of 5,000 requests per hour instead.
          </p>
        </Question>
        <Question summary="Why does a check use 2 requests?">
          <p>
            The first asks for the repository's details: its default branch, its
            size, and whether it's still public. The second asks for the latest
            commit on that branch, which tells Culverin whether a saved count is
            still current. Downloading the source doesn't use any of them.
          </p>
        </Question>
        <Question summary="What uses requests, and what doesn't?">
          <ul className="m-0 grid list-disc gap-1 pl-5">
            <li>
              Analyze: 2, unless the repository was checked in the last 20
              minutes.
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
            Culverin stops asking GitHub and shows when you can try again,
            usually within the hour. Counts checked in the last 20 minutes still
            show.
          </p>
        </Question>
        <Question summary="Why might a count be out of date?">
          <p>
            To save requests, Culverin reuses a check for up to 20 minutes, so a
            new commit can take that long to appear. Select Reanalyze in the
            toolbar popup to check right away.
          </p>
        </Question>
      </div>
    </Panel>
  );
}
