import { failureMessages } from "../github/failure-messages";
import type { PublicErrorCode, PublicReply } from "../github/public-protocol";

export type AnalysisPhase = Extract<
  PublicReply,
  { type: "analysis.progress" }
>["phase"];

export type RowAction = "analyze" | "cancel";

export type RowState =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "running"; phase: AnalysisPhase }
  | { kind: "complete"; total: number }
  | { kind: "retry"; detail: string }
  | { kind: "notice"; label: string; detail: string };

export type VisibleRowState = Exclude<RowState, { kind: "hidden" }>;

export type RowView = {
  count?: string;
  label: string;
  title: string;
  action?: RowAction;
};

export type SummaryUi = {
  host: HTMLElement;
  live: HTMLElement;
  row?: HTMLElement;
  action?: RowAction;
};

const ICON_PATH =
  "M2 1h2v1h11v1.5H4v9h11V14H4v1H2v-1H1v-1.5h1v-9H1V2h1zM6 5h7v1H6zm0 2h5v1H6zm0 2h8v1H6zm0 2h3v1H6z";

const progressText: Record<AnalysisPhase, string> = {
  queued: "Waiting to count lines…",
  resolving: "Preparing to count lines…",
  downloading: "Downloading source…",
  decompressing: "Unpacking source…",
  counting: "Counting lines…",
};

const hiddenLookupFailures: PublicErrorCode[] = [
  "invalid_repository",
  "unsupported_page",
  "repository_unavailable",
  "repository_forbidden",
  "repository_empty",
  "authentication_required",
  "authentication_invalid",
];

const sizeFailures: PublicErrorCode[] = [
  "metadata_limit_exceeded",
  "compressed_limit_exceeded",
  "decompressed_limit_exceeded",
  "entry_limit_exceeded",
  "file_limit_exceeded",
];

const unsupportedFailures: PublicErrorCode[] = [
  "archive_invalid",
  "archive_unsupported",
  "repository_empty",
];

const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function compactCount(value: number): string {
  return compact.format(value).replace("K", "k");
}

export function failureState(
  code: PublicErrorCode,
  retryAt?: number,
): VisibleRowState {
  if (code === "analysis_canceled") return { kind: "idle" };
  const detail = failureMessages[code];
  if (code === "rate_limited")
    return {
      kind: "notice",
      label: "GitHub rate limit, try later",
      detail: `${detail}${retryAt ? ` Retry after ${new Date(retryAt).toLocaleString()}.` : " Try again later."}`,
    };
  if (sizeFailures.includes(code))
    return { kind: "notice", label: "Too large to count", detail };
  if (unsupportedFailures.includes(code))
    return { kind: "notice", label: "Can't count this repository", detail };
  return { kind: "retry", detail };
}

export function lookupFailureState(
  code: PublicErrorCode,
  retryAt?: number,
): RowState {
  if (hiddenLookupFailures.includes(code)) return { kind: "hidden" };
  if (code === "rate_limited") return failureState(code, retryAt);
  return { kind: "idle" };
}

export function partialState(reasons: string[]): VisibleRowState {
  return {
    kind: "notice",
    label: "Couldn't count every file",
    detail: `Partial analysis: ${reasons.map((reason) => (reason === "oversized_source" ? "some source files exceeded the safe size limit" : "some source counts may be inaccurate")).join("; ")}. No total is shown.`,
  };
}

export function rowView(state: VisibleRowState): RowView {
  if (state.kind === "idle")
    return {
      label: "Count lines of code",
      title:
        "Download this repository's source from GitHub and count it in your browser",
      action: "analyze",
    };
  if (state.kind === "running")
    return {
      label: progressText[state.phase],
      title: "Click to cancel",
      action: "cancel",
    };
  if (state.kind === "complete") {
    const label = state.total === 1 ? "line of code" : "lines of code";
    return {
      count: compactCount(state.total),
      label,
      title: `${state.total.toLocaleString("en")} ${label}`,
    };
  }
  if (state.kind === "retry")
    return {
      label: "Couldn't count lines · Retry",
      title: state.detail,
      action: "analyze",
    };
  return { label: state.label, title: state.detail };
}

function icon(): SVGSVGElement {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(namespace, "path");
  path.setAttribute("d", ICON_PATH);
  svg.append(path);
  return svg;
}

export function createSummaryUi(
  activate: (action: RowAction) => void,
): SummaryUi {
  const host = document.createElement("div");
  host.dataset.culverinRoot = "";
  host.hidden = true;
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
:host { display:block; margin-top:var(--base-size-8,8px); color:var(--fgColor-muted,#59636e) }
:host([hidden]) { display:none }
.row { display:inline; margin:0; padding:0; border:0; background:none; color:inherit; font:inherit; line-height:inherit; letter-spacing:inherit; text-align:start }
button.row { cursor:pointer }
button.row:hover, button.row:focus-visible { color:var(--fgColor-accent,#0969da) }
button.row:focus-visible { outline:2px solid var(--focus-outlineColor,var(--fgColor-accent,#0969da)); outline-offset:2px; border-radius:6px }
svg { display:inline-block; overflow:visible; margin-right:var(--base-size-8,8px); vertical-align:text-bottom }
strong { font-weight:var(--base-text-weight-semibold,600) }
`;
  const live = document.createElement("span");
  live.setAttribute("aria-live", "polite");
  live.setAttribute("aria-atomic", "true");
  shadow.append(style, live);
  const ui: SummaryUi = { host, live };
  live.addEventListener("click", (event) => {
    if (
      !event.isTrusted ||
      !ui.action ||
      !ui.row?.contains(event.target as Node)
    )
      return;
    activate(ui.action);
  });
  return ui;
}

export function showState(ui: SummaryUi, state: RowState): void {
  if (state.kind === "hidden") {
    ui.host.hidden = true;
    ui.action = undefined;
    return;
  }
  const view = rowView(state);
  const interactive = view.action !== undefined;
  let row = ui.row;
  if (!row || row instanceof HTMLButtonElement !== interactive) {
    row = document.createElement(interactive ? "button" : "span");
    row.className = "row";
    if (row instanceof HTMLButtonElement) row.type = "button";
    ui.live.replaceChildren(row);
    ui.row = row;
  }
  const parts: Node[] = [icon()];
  if (view.count !== undefined) {
    const count = document.createElement("strong");
    count.textContent = view.count;
    parts.push(count, document.createTextNode(` ${view.label}`));
  } else parts.push(document.createTextNode(view.label));
  row.replaceChildren(...parts);
  row.title = view.title;
  ui.action = view.action;
  ui.host.hidden = false;
}
