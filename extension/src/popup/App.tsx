import { useEffect, useMemo, useReducer } from "preact/hooks";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import { Status } from "../ui/Status";
import { UsageMeter } from "../ui/UsageMeter";
import { createPopupController, openSettings } from "./controller";
import { initialView, reduce, type PopupView } from "./state";
import type { ResultView } from "./view";
import { ResultSection } from "./ResultSection";
import { ExternalLink } from "../ui/ExternalLink";

function Header({ view }: { view: PopupView }) {
  return (
    <>
      <header className="flex items-center justify-between gap-2">
        <h1 className="m-0 text-[1.2rem] font-bold">Culverin</h1>
        <div className="flex items-center gap-2">
          <span
            id="api-limit"
            hidden={!view.apiLimit}
            title={view.apiLimit?.title}
            className="text-muted flex flex-col items-end text-sm leading-tight tabular-nums"
          >
            <span className="flex items-center gap-1.5">
              {view.apiLimit && (
                <UsageMeter
                  id="api-limit-meter"
                  value={view.apiLimit.value}
                  now={view.apiLimit.now}
                />
              )}
              {view.apiLimit?.text}
            </span>
            {view.apiLimit?.reset && (
              <span id="api-limit-reset" className="text-xs">
                {view.apiLimit.reset}
              </span>
            )}
          </span>
          <Button
            id="settings"
            type="button"
            size="popup"
            onClick={() => openSettings()}
          >
            Settings
          </Button>
        </div>
      </header>
      <p
        id="repository"
        hidden={!view.repository}
        className="break-words font-semibold"
      >
        {view.repository}
      </p>
      <Status id="status" className="my-3 min-h-[1.45em]">
        {view.cancelVisible && !view.reanalyze && <Spinner />}
        {view.status}
      </Status>
    </>
  );
}

function Totals({ view }: { view: PopupView }) {
  return (
    <>
      <p id="code-lines" className="m-0 text-[1.4rem] font-bold">
        {view.result?.codeLines}
      </p>
      <p
        id="text-lines"
        title="Non-blank prose lines in Markdown, MDX, Djot, and plain text files"
        className="mt-0.5 mb-0 text-base font-semibold"
      >
        {view.result?.textLines}
      </p>
      <p id="metrics" className="my-1.5">
        {view.result?.metrics}
      </p>
      <p
        id="ignore-summary"
        hidden={!view.ignoreSummary}
        className="border-subtle mt-2 flex items-center justify-between gap-2 border-l-[3px] pl-2"
      >
        <span id="ignore-text">{view.ignoreSummary}</span>
        <Button
          id="ignore-edit"
          type="button"
          size="compact"
          onClick={() => openSettings("ignore")}
        >
          Edit
        </Button>
      </p>
      <dl id="sizes" hidden={!view.sizes} className="mt-2.5 grid gap-0.5">
        <div className="flex justify-between gap-3">
          <dt className="break-words">Repository size (incl. history)</dt>
          <dd
            id="repository-size"
            title="Reported by GitHub; includes the full Git history"
            className="m-0 whitespace-nowrap font-semibold tabular-nums"
          >
            {view.sizes?.repositorySize}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt id="snapshot-label" className="break-words">
            {view.sizes?.snapshotLabel ?? "Files at commit"}
          </dt>
          <dd
            id="snapshot-size"
            className="m-0 whitespace-nowrap font-semibold tabular-nums"
          >
            {view.snapshotSize}
          </dd>
        </div>
      </dl>
    </>
  );
}

function OversizedFiles({ result }: { result: ResultView }) {
  const list = (
    <ul
      aria-label="Files too large to count"
      className="my-1.5 list-disc pl-[22px]"
    >
      {result.oversizedFiles.map((file) => (
        <li key={file.path} className="my-1">
          <ExternalLink href={file.url} className="wrap-anywhere underline">
            {file.path}
          </ExternalLink>{" "}
          <span className="whitespace-nowrap">{file.size}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <div
      id="oversized-files"
      className="border-warning my-1.5 border-l-[3px] pl-2"
    >
      <p className="my-1.5">{result.warning}</p>
      <p className="my-1.5">{result.fileLimit}</p>
      {result.oversizedFiles.length === 1 && list}
      {result.oversizedFiles.length > 1 && (
        <details id="oversized-file-list">
          <summary>Show files</summary>
          {list}
        </details>
      )}
      {result.oversizedNote && <p className="my-1.5">{result.oversizedNote}</p>}
    </div>
  );
}

function Details({
  view,
  onToggle,
}: {
  view: PopupView;
  onToggle: (open: boolean) => void;
}) {
  const result = view.result;
  return (
    <details
      id="details"
      hidden={!result}
      open={view.detailsOpen}
      className="mt-3"
      onToggle={(event) => onToggle(event.currentTarget.open)}
    >
      <summary>Analysis details</summary>
      <div id="detail-content">
        {result?.intro.map((line) => (
          <p key={line} className="my-1.5">
            {line}
          </p>
        ))}
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
          >
            <p className="my-1.5">
              Not recognized as a programming or text language. Their lines are
              not included in code or text lines.
            </p>
          </ResultSection>
        )}
        {result?.noLanguages && <p className="my-1.5">{result.noLanguages}</p>}
        {result && <p className="my-1.5">{result.coverage}</p>}
        {result?.warning && <OversizedFiles result={result} />}
      </div>
    </details>
  );
}

export function App() {
  const [view, dispatch] = useReducer(reduce, initialView);

  const controller = useMemo(() => createPopupController(dispatch), [dispatch]);
  useEffect(() => {
    controller.start();
    return controller.dispose;
  }, [controller]);

  return (
    <main className="p-4">
      <Header view={view} />
      <section
        id="analysis"
        hidden={!view.analysisVisible}
        className="border-divider border-t pt-3"
      >
        <Totals view={view} />
        <div className="my-3 flex items-center justify-start gap-2">
          <Button
            id="analyze"
            type="button"
            size="popup"
            disabled={view.analyzeDisabled}
            aria-busy={view.cancelVisible}
            onClick={() => void controller.analyze(view.reanalyze)}
          >
            {view.reanalyze ? "Reanalyze" : "Analyze repository"}
          </Button>
          {view.cancelVisible && view.reanalyze && <Spinner />}
          <Button
            id="cancel"
            type="button"
            size="popup"
            hidden={!view.cancelVisible}
            onClick={() => void controller.cancel()}
          >
            Cancel analysis
          </Button>
          <Button
            id="connect"
            type="button"
            size="popup"
            hidden={!view.connect}
            onClick={() => openSettings("github")}
          >
            {view.connect}
          </Button>
        </div>
        <Details
          view={view}
          onToggle={(open) => dispatch({ type: "details", open })}
        />
      </section>
    </main>
  );
}
