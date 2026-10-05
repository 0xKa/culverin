import { ExternalLink } from "../ui/ExternalLink";
import { useState } from "preact/hooks";
import {
  engineVersion,
  rulesProfile,
  rulesVersion,
  wrapperVersion,
} from "../counter/rules";
import { Button } from "../ui/Button";
import { ExternalIcon } from "../ui/icons";
import { Status } from "../ui/Status";
import { Panel, SectionHeader } from "./layout";
import { aboutDetails, browserVersion, REPOSITORY_URL } from "./about";

const links: [string, string][] = [
  ["Source code", REPOSITORY_URL],
  ["Changelog", `${REPOSITORY_URL}/blob/main/CHANGELOG.md`],
  ["Privacy policy", `${REPOSITORY_URL}/blob/main/docs/privacy.md`],
  ["Report an issue", `${REPOSITORY_URL}/issues`],
];

export function AboutSection({ hidden }: { hidden: boolean }) {
  const [copyStatus, setCopyStatus] = useState("");
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

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(
        aboutDetails([["Culverin", manifest.version], ...rows.slice(1)]),
      );
      setCopyStatus("Copied. Paste these details into your issue report.");
    } catch {
      setCopyStatus("Couldn't copy. Select the details above instead.");
    }
  }

  return (
    <section aria-labelledby="about-heading" hidden={hidden}>
      <SectionHeader id="about-heading" title="About">
        {manifest.description}
      </SectionHeader>
      <div className="grid gap-5">
        <Panel
          actions={
            <Button
              id="copy-details"
              type="button"
              size="md"
              onClick={() => void copy()}
            >
              Copy details
            </Button>
          }
          title="Details"
        >
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
                <ExternalLink href={`${REPOSITORY_URL}/blob/main/LICENSE`}>
                  Apache License 2.0
                </ExternalLink>
                {" · "}
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
          <Status
            id="about-status"
            className="text-muted m-0 text-sm not-empty:mt-2"
          >
            {copyStatus}
          </Status>
        </Panel>
        <Panel title="Links">
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
            {links.map(([label, url]) => (
              <li key={label}>
                <ExternalLink
                  href={url}
                  className="border-divider text-ink hover:bg-surface flex items-center justify-between rounded-lg border px-3.5 py-2.5 no-underline transition-colors duration-150"
                >
                  {label}
                  <ExternalIcon className="text-muted" />
                </ExternalLink>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </section>
  );
}
