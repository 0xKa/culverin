import { useEffect, useReducer } from "preact/hooks";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
import { UsageMeter } from "../ui/UsageMeter";
import { analyze, cancel, openSettings, startPopup } from "./controller";
import { initialView, reduce, type PopupView } from "./state";

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
            className="text-muted flex items-center gap-1.5 text-sm tabular-nums"
          >
            {view.apiLimit && (
              <UsageMeter
                id="api-limit-meter"
                value={view.apiLimit.value}
                now={view.apiLimit.now}
              />
            )}
            {view.apiLimit?.text}
          </span>
          <Button
            id="settings"
            type="button"
            className="px-2.5 py-1.5"
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
          className="px-2 py-0.5"
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
          <>
            <h2 className="mt-3 text-[0.95rem] font-bold">Code</h2>
            <ul
              aria-label="Languages by code lines"
              className="mt-1 list-disc pl-[22px]"
            >
              {result.codeRows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          </>
        )}
        {result && result.textRows.length > 0 && (
          <>
            <h2 className="mt-3 text-[0.95rem] font-bold">Text</h2>
            <ul
              aria-label="Text formats by text lines"
              className="mt-1 list-disc pl-[22px]"
            >
              {result.textRows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          </>
        )}
        {result && result.otherRows.length > 0 && (
          <>
            <h2 className="mt-3 text-[0.95rem] font-bold">Other files</h2>
            <p className="my-1.5">
              Not recognized as a programming or text language. Their lines are
              not included in code or text lines.
            </p>
            <ul
              aria-label="Other files by lines"
              className="mt-1 list-disc pl-[22px]"
            >
              {result.otherRows.map((row) => (
                <li key={row}>{row}</li>
              ))}
            </ul>
          </>
        )}
        {result?.noLanguages && <p className="my-1.5">{result.noLanguages}</p>}
        {result && <p className="my-1.5">{result.coverage}</p>}
        {result?.warning && (
          <p className="border-warning my-1.5 border-l-[3px] pl-2">
            {result.warning}
          </p>
        )}
      </div>
    </details>
  );
}

export function App() {
  const [view, dispatch] = useReducer(reduce, initialView);

  useEffect(() => startPopup(dispatch), []);

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
            className="px-2.5 py-1.5"
            disabled={view.analyzeDisabled}
            onClick={() => void analyze(view.reanalyze)}
          >
            {view.reanalyze ? "Reanalyze" : "Analyze repository"}
          </Button>
          <Button
            id="cancel"
            type="button"
            className="px-2.5 py-1.5"
            hidden={!view.cancelVisible}
            onClick={() => void cancel()}
          >
            Cancel analysis
          </Button>
          <Button
            id="connect"
            type="button"
            className="px-2.5 py-1.5"
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
