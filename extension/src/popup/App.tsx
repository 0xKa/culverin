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
import { IconButton } from "../ui/IconButton";
import { GearIcon } from "../ui/icons";
import { Status } from "../ui/Status";
import { StatusBadge } from "../ui/StatusBadge";
import { UsageMeter } from "../ui/UsageMeter";
import { createPopupController, openSettings } from "./controller";
import { Details, OversizedFiles, Sizes, Totals } from "./ResultParts";
import { initialView, reduce, type PopupView } from "./state";

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
        <div className="flex items-start justify-between gap-3">
          {view.repository ? (
            <p
              id="repository"
              className="m-0 min-w-0 text-base font-semibold break-words"
            >
              {view.repository}
            </p>
          ) : (
            <p
              id="no-repository"
              className="text-muted m-0 min-w-0 text-base font-semibold"
            >
              No repository
            </p>
          )}
          <StatusBadge
            id="status-badge"
            tone={view.status.tone}
            mark={view.status.mark}
            label={view.status.label}
            detail={view.status.detail}
            aria-describedby="status"
            className="mt-px"
          />
        </div>
        <Status id="status" className="sr-only">
          {view.status.detail}
        </Status>
        <section id="analysis" hidden={!view.analysisVisible}>
          {result && <Totals key={view.sizes?.snapshotLabel} result={result} />}
          {result?.warning && <OversizedFiles result={result} />}
          <Sizes sizes={view.sizes} snapshotSize={view.snapshotSize} />
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
          {view.status.note && (
            <p
              id="status-note"
              className="text-muted m-0 mt-1.5 text-center text-xs"
            >
              {view.status.note}
            </p>
          )}
          <Details
            result={view.result}
            open={view.detailsOpen}
            onToggle={(open) => dispatch({ type: "details", open })}
          />
        </section>
      </div>
    </main>
  );
}
