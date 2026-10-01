import iconSource from "../../../assets/mono/culverin-mono-stats.svg" with { type: "text" };
import { failureMessages } from "../github/failure-messages";
import type { PublicErrorCode, PublicReply } from "../github/public-protocol";

export type AnalysisPhase = Extract<
  PublicReply,
  { type: "analysis.progress" }
>["phase"];

export type RowAction = "analyze" | "cancel" | "details" | "connect";

export type RowState =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "running"; phase: AnalysisPhase }
  | {
      kind: "complete";
      total: number;
      uncounted?: number;
      customIgnore?: boolean;
    }
  | { kind: "retry"; detail: string }
  | { kind: "notice"; label: string; detail: string }
  | { kind: "connect"; label: string; detail: string };

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
];

const connectLabels: Partial<Record<PublicErrorCode, string>> = {
  authentication_required: "Private repository? Connect GitHub",
  authentication_invalid: "GitHub connection expired · Reconnect",
  access_not_granted: "No access · Choose repositories",
};

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
  const connect = connectLabels[code];
  if (connect) return { kind: "connect", label: connect, detail };
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
  if (code === "rate_limited" || connectLabels[code])
    return failureState(code, retryAt);
  return { kind: "idle" };
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
    const uncounted = state.uncounted
      ? `, not including ${state.uncounted.toLocaleString("en")} source ${state.uncounted === 1 ? "file" : "files"} too large to count`
      : "";
    return {
      count: `${compactCount(state.total)}${state.uncounted ? "+" : ""}`,
      label,
      title: `${state.total.toLocaleString("en")} ${label}${uncounted}${state.customIgnore ? " (Culverin ignore active)" : ""}. Open Culverin for details`,
      action: "details",
    };
  }
  if (state.kind === "retry")
    return {
      label: "Couldn't count lines · Retry",
      title: state.detail,
      action: "analyze",
    };
  if (state.kind === "connect")
    return {
      label: state.label,
      title: `${state.detail} Click to open Culverin's GitHub settings`,
      action: "connect",
    };
  return { label: state.label, title: state.detail };
}

let iconTemplate: Element | undefined;

function icon(): Element {
  if (!iconTemplate) {
    iconTemplate = new DOMParser().parseFromString(
      iconSource,
      "image/svg+xml",
    ).documentElement;
    for (const node of Array.from(iconTemplate.childNodes))
      if (node.nodeType !== Node.ELEMENT_NODE) node.remove();
  }
  const svg = document.importNode(iconTemplate, true);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
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
