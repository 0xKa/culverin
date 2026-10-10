import { Callout } from "../ui/Callout";
import { ExternalLink } from "../ui/ExternalLink";
import { Joined } from "../ui/Separator";
import { ResultSection } from "./ResultSection";
import type { ResultView } from "./view";

export function Totals({ result }: { result: ResultView }) {
  return (
    <div className="rise-in border-divider bg-raised mt-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <p id="code-lines" className="m-0 flex flex-col">
          <span
            className={`text-accent-text font-mono leading-none font-semibold ${result.codeTotal.length > 7 ? "text-[2rem] tracking-tight" : "text-display"}`}
          >
            {result.codeTotal}
          </span>{" "}
          <span className="text-muted mt-1 text-xs">code lines</span>
        </p>
        <p
          id="file-count"
          title={result.fileTitle}
          className="m-0 ml-auto flex flex-col items-end"
        >
          <span className="font-mono text-2xl leading-none font-semibold tracking-tight">
            {result.fileTotal}
          </span>{" "}
          <span className="text-muted mt-1 text-xs">{result.fileLabel}</span>
        </p>
      </div>
      <dl
        id="metrics"
        className="border-divider mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-3"
      >
        {result.stats.map((stat) => (
          <div key={stat.label} title={stat.title} className="flex flex-col">
            <dt className="text-muted text-2xs">{stat.label}</dt>{" "}
            <dd id={stat.id} className="m-0 font-mono text-sm font-semibold">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function Sizes({ result }: { result: ResultView }) {
  return (
    <dl id="sizes" className="mt-3 grid gap-1 text-xs">
      <div className="flex justify-between gap-3">
        <dt className="text-muted break-words">Size</dt>
        <dd
          id="snapshot-size"
          title={result.sizeTitle}
          className="m-0 font-mono font-medium whitespace-nowrap"
        >
          {result.snapshotSize}
        </dd>
      </div>
    </dl>
  );
}

export function OversizedFiles({ result }: { result: ResultView }) {
  const list = (
    <ul aria-label="Files too large to count" className="mt-1.5 grid gap-1">
      {result.oversizedFiles.map((file) => (
        <li key={file.path} className="flex items-baseline gap-2 text-xs">
          <ExternalLink
            href={file.url}
            className="min-w-0 font-mono wrap-anywhere underline"
          >
            {file.path}
          </ExternalLink>{" "}
          <span className="text-muted ml-auto font-mono whitespace-nowrap">
            {file.size}
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <Callout tone="warning" id="oversized-files" className="mt-3">
      <p className="m-0 font-medium">{result.warning}</p>
      <p className="text-muted m-0 mt-0.5 text-xs">{result.fileLimit}</p>
      {result.oversizedFiles.length === 1 && list}
      {result.oversizedFiles.length > 1 && (
        <details id="oversized-file-list" className="disclosure mt-1.5">
          <summary className="text-xs">Show files</summary>
          {list}
        </details>
      )}
      {result.oversizedNote && (
        <p className="text-muted m-0 mt-1.5 text-xs">{result.oversizedNote}</p>
      )}
    </Callout>
  );
}

export function Details({
  result,
  open,
  onToggle,
}: {
  result?: ResultView;
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      id="details"
      hidden={!result}
      open={open}
      className="disclosure border-divider mt-4 border-t pt-3"
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary className="text-sm">Analysis details</summary>
      <div id="detail-content" className="pt-1">
        {result?.intro.map((line) => (
          <p key={line.join()} className="text-muted m-0 mt-1.5 text-xs">
            <Joined parts={line} />
          </p>
        ))}
        {result?.cloneSize && (
          <p
            id="clone-size"
            title={result.cloneTitle}
            className="text-muted m-0 mt-1.5 text-xs"
          >
            Estimated clone size {result.cloneSize}
          </p>
        )}
        {result && result.codeRows.length > 0 && (
          <ResultSection
            title="Code"
            summary={result.codeSummary}
            summaryId="code-summary"
            rows={result.codeRows}
            label="Languages by code lines"
            moreLabel="More languages by code lines"
            id="more-code-languages"
          ></ResultSection>
        )}
        {result && result.textRows.length > 0 && (
          <ResultSection
            title="Text"
            summary={result.textSummary}
            summaryId="text-summary"
            rows={result.textRows}
            label="Text formats by text lines"
            moreLabel="More text formats by text lines"
            id="more-text-formats"
          ></ResultSection>
        )}
        {result && result.otherRows.length > 0 && (
          <ResultSection
            title="Other files"
            summary={result.otherSummary}
            summaryId="other-summary"
            rows={result.otherRows}
            label="Other files by lines"
            moreLabel="More other files by lines"
            id="more-other-files"
            muted
          >
            <p className="text-muted m-0 mt-1 text-xs">
              Not recognized as a programming or text language. Their lines are
              not included in code or text lines.
            </p>
          </ResultSection>
        )}
        {result?.noLanguages && (
          <p className="text-muted m-0 mt-3 text-xs">{result.noLanguages}</p>
        )}
        {result && (
          <p className="text-muted border-divider m-0 mt-4 border-t pt-3 text-2xs">
            {result.coverage}
          </p>
        )}
      </div>
    </details>
  );
}
