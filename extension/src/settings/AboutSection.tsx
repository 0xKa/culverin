import { ExternalLink } from "../ui/ExternalLink";
import { useState } from "preact/hooks";
import {
  engineVersion,
  rulesProfile,
  rulesVersion,
  wrapperVersion,
} from "../counter/rules";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
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
      <h2 id="about-heading" className="mb-4 text-[1.5em] font-bold">
        About
      </h2>
      <p>{manifest.description}</p>
      <dl
        id="about-details"
        className="my-4 grid grid-cols-[10rem_1fr] gap-x-3 gap-y-1"
      >
        {rows.map(([label, value]) => (
          <>
            <dt key={`${label}-label`} className="text-muted">
              {label}
            </dt>
            <dd key={`${label}-value`} className="m-0 break-words">
              {value}
            </dd>
          </>
        ))}
        <dt className="text-muted">License</dt>
        <dd className="m-0">
          <ExternalLink
            href={`${REPOSITORY_URL}/blob/main/LICENSE`}
            className="underline"
          >
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
      </dl>
      <Button
        id="copy-details"
        type="button"

        onClick={() => void copy()}
      >
        Copy details
      </Button>
      <Status id="about-status" className="mt-2 min-h-[1.5em]">
        {copyStatus}
      </Status>
      <h3 className="mt-4 mb-2 text-[1.17em] font-bold">Links</h3>
      <ul className="list-disc pl-5">
        {links.map(([label, url]) => (
          <li key={label}>
            <ExternalLink href={url} className="underline">
              {label}
            </ExternalLink>
          </li>
        ))}
      </ul>
    </section>
  );
}
