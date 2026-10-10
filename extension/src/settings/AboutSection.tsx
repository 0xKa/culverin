import { ExternalLink as ExternalLinkComponent } from "../ui/ExternalLink";
import {
  engineVersion,
  rulesProfile,
  rulesVersion,
  wrapperVersion,
} from "../counter/rules";
import { Button } from "../ui/Button";
import { ExternalLink } from "lucide-preact";
import { Separator } from "../ui/Separator";
import { Panel, SectionHeader } from "./layout";
import { aboutDetails, browserVersion, REPOSITORY_URL } from "./about";
import { ActionStatus, useAction } from "./ActionStatus";

const links: [string, string][] = [
  ["Source code", REPOSITORY_URL],
  ["Changelog", `${REPOSITORY_URL}/blob/main/CHANGELOG.md`],
  ["Privacy policy", `${REPOSITORY_URL}/blob/main/docs/privacy.md`],
  ["Report an issue", `${REPOSITORY_URL}/issues`],
];

export function AboutSection({ hidden }: { hidden: boolean }) {
  const copied = useAction();
  const manifest = chrome.runtime.getManifest();
  const rows: [string, string][] = [
    ["Version", manifest.version],
    ["Counting engine", `Tokei ${engineVersion}, run locally as WebAssembly`],
    [
      "Counting rules",
      `${rulesProfile} profile, rules ${rulesVersion}, wrapper ${wrapperVersion}`,
    ],
    ["Browser", browserVersion(navigator.userAgent)],
    ["Extension ID", chrome.runtime.id],
  ];

  function copy(): void {
    void copied.run(
      () =>
        navigator.clipboard.writeText(
          aboutDetails([["Culverin", manifest.version], ...rows.slice(1)]),
        ),
      {
        label: "Copied",
        message: "Copied.",
        failure: "Couldn't copy. Select the details below instead.",
      },
    );
  }

  return (
    <section aria-labelledby="about-heading" hidden={hidden}>
      <SectionHeader id="about-heading" title="About">
        <p className="m-0">{manifest.description}</p>
        <p className="m-0 mt-2">
          Repository source is downloaded directly from GitHub and analyzed in
          your browser when you select Analyze, or when you open a repository
          page if you turn that on under Counting. Public repositories work
          without an account; connect GitHub to count private ones.
        </p>
      </SectionHeader>
      <div className="grid gap-4">
        <Panel
          actions={
            <div className="flex items-center gap-3">
              <ActionStatus id="about-status" state={copied.state} />
              <Button id="copy-details" type="button" size="md" onClick={copy}>
                Copy details
              </Button>
            </div>
          }
          title="Details"
        >
          <p className="text-muted m-0 mb-3 text-sm">
            Include these details when you report an issue.
          </p>
          <dl id="about-details" className="m-0 text-sm">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="border-divider grid gap-x-4 border-t py-2.5 first:border-t-0 first:pt-0 sm:grid-cols-[11rem_1fr]"
              >
                <dt className="text-muted">{label}</dt>
                <dd className="m-0 break-words">{value}</dd>
              </div>
            ))}
            <div className="border-divider grid gap-x-4 border-t pt-2.5 sm:grid-cols-[11rem_1fr]">
              <dt className="text-muted">License</dt>
              <dd className="m-0">
                <ExternalLinkComponent
                  href={`${REPOSITORY_URL}/blob/main/LICENSE`}
                >
                  Apache License 2.0
                </ExternalLinkComponent>
                <Separator />
                <a
                  href="THIRD_PARTY_NOTICES.txt"
                  target="_blank"
                  className="underline"
                >
                  Third-party notices
                </a>
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Links">
          <ul className="divide-divider m-0 -my-1 list-none divide-y p-0">
            {links.map(([label, url]) => (
              <li key={label}>
                <ExternalLinkComponent
                  href={url}
                  className="text-ink hover:text-accent-text -mx-2 flex items-center justify-between rounded-md px-2 py-2.5 no-underline transition-colors duration-150"
                >
                  {label}
                  <ExternalLink class="text-muted" />
                </ExternalLinkComponent>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}
