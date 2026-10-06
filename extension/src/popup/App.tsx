import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
} from "preact/hooks";
import darkIcon from "../../../assets/dark/culverin-dark-stats.svg";
import lightIcon from "../../../assets/light/culverin-light-stats.svg";
import { Button } from "../ui/Button";
import { Callout } from "../ui/Callout";
import { DotLoader } from "../ui/DotLoader";
import { ExternalLink } from "../ui/ExternalLink";
import { IconButton } from "../ui/IconButton";
import { Joined } from "../ui/Separator";
import { GearIcon } from "../ui/icons";
import { Status } from "../ui/Status";
import { UsageMeter } from "../ui/UsageMeter";
import { createPopupController, openSettings } from "./controller";
import { ResultSection } from "./ResultSection";
import { initialView, reduce, type PopupView } from "./state";
import type { ResultView } from "./view";

function Header({ view }: { view: PopupView }) {
  return (
    <header className="border-divider flex items-center gap-2 border-b px-4 py-2.5">
      <picture className="shrink-0">
        <source srcSet={darkIcon} media="(prefers-color-scheme: dark)" />
        <img src={lightIcon} alt="" className="block size-5" />
      </picture>
      <h1 className="text-md m-0 font-semibold tracking-tight">Culverin</h1>
      <div className="ml-auto flex items-center gap-1">
        <span
          id="api-limit"
          hidden={!view.apiLimit}
          title={view.apiLimit?.title}
          className="text-muted tabular flex flex-col items-end px-1 text-2xs"
        >
          <span className="text-ink flex items-center gap-1.5 text-xs font-medium">
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
            <span id="api-limit-reset">{view.apiLimit.reset}</span>
          )}
        </span>
        <IconButton
          id="settings"
          type="button"
          label="Settings"
          onClick={() => openSettings()}
        >
          <GearIcon />
        </IconButton>
      </div>
    </header>
  );
}

function Totals({ result }: { result: ResultView }) {
  return (
    <div className="rise-in border-divider bg-raised mt-3 rounded-xl border p-4">
      <div className="flex items-end justify-between gap-3">
        <p id="code-lines" className="m-0 flex min-w-0 flex-col">
          <span className="text-display font-mono font-semibold">
            {result.codeTotal}
          </span>{" "}
          <span className="text-muted text-xs">code lines</span>
        </p>
        <p
          id="text-lines"
          title="Non-blank prose lines in Markdown, MDX, Djot, and plain text files"
          className="text-muted tabular m-0 pb-px text-right text-xs"
        >
          {result.textLines}
        </p>
      </div>
      <dl
        id="metrics"
        className="border-divider mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t pt-3.5"
      >
        {result.stats.map((stat) => (
          <div key={stat.label} className="flex flex-col">
            <dt className="text-muted text-2xs">{stat.label}</dt>{" "}
            <dd className="m-0 font-mono text-sm font-semibold">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Sizes({ view }: { view: PopupView }) {
  return (
    <dl id="sizes" hidden={!view.sizes} className="mt-3 grid gap-1 text-xs">
      <div className="flex justify-between gap-3">
        <dt className="text-muted break-words">
          Repository size (incl. history)
        </dt>
        <dd
          id="repository-size"
          title="Reported by GitHub; includes the full Git history"
          className="m-0 font-mono font-medium whitespace-nowrap"
        >
          {view.sizes?.repositorySize}
        </dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt id="snapshot-label" className="text-muted break-words">
          {view.sizes?.snapshotLabel ?? "Files at commit"}
        </dt>
        <dd
          id="snapshot-size"
          className="m-0 font-mono font-medium whitespace-nowrap"
        >
          {view.snapshotSize}
        </dd>
      </div>
    </dl>
  );
}

function OversizedFiles({ result }: { result: ResultView }) {
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

export function App() {
  const [view, dispatch] = useReducer(reduce, initialView);

  const controller = useMemo(() => createPopupController(dispatch), [dispatch]);
  useEffect(() => {
    controller.start();
    return controller.dispose;
  }, [controller]);

  const analyzing = view.cancelVisible;
  const followFocus = useRef(false);
  useLayoutEffect(() => {
    if (!followFocus.current) return;
    followFocus.current = analyzing;
    const active = document.activeElement;
    if (active !== document.body && active?.id !== "analyze") return;
    document.getElementById(analyzing ? "cancel" : "analyze")?.focus();
  }, [analyzing]);

  const result = view.result;
  return (
    <main>
      <Header view={view} />
      <div className="px-4 pt-3 pb-4">
        <p
          id="repository"
          hidden={!view.repository}
          className="m-0 text-base font-semibold break-words"
        >
          {view.repository}
        </p>
        <Status id="status" className="text-muted m-0 mt-0.5 min-h-5 text-xs">
          {view.status}
        </Status>
        <section id="analysis" hidden={!view.analysisVisible}>
          {result && <Totals key={view.sizes?.snapshotLabel} result={result} />}
          {result?.warning && <OversizedFiles result={result} />}
          <Sizes view={view} />
          <Callout
            id="ignore-summary"
            hidden={!view.ignoreSummary}
            className="mt-3 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span id="ignore-text">{view.ignoreSummary}</span>
              <Button
                id="ignore-edit"
                type="button"
                size="sm"
                variant="ghost"
                className="-my-1 -mr-1.5"
                onClick={() => openSettings("ignore")}
              >
                Edit
              </Button>
            </div>
          </Callout>
          {analyzing && (
            <div
              id="analysis-loader"
              className="rise-in text-accent-text mt-3 flex flex-col items-center gap-2 pt-2"
            >
              <DotLoader />
              <Button
                id="cancel"
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void controller.cancel()}
              >
                Cancel analysis
              </Button>
            </div>
          )}
          <div
            className="mt-3 flex items-center gap-2"
            hidden={analyzing && !view.connect}
          >
            <Button
              id="analyze"
              type="button"
              variant={view.reanalyze ? "secondary" : "primary"}
              className="flex-1"
              hidden={analyzing}
              disabled={view.analyzeDisabled}
              onClick={() => {
                followFocus.current = true;
                void controller.analyze(view.reanalyze);
              }}
            >
              {view.reanalyze ? "Reanalyze" : "Analyze repository"}
            </Button>
            <Button
              id="connect"
              type="button"
              variant="primary"
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
      </div>
    </main>
  );
}
