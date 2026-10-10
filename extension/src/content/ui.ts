import iconSource from "../../../assets/mono/culverin-mono-stats.svg" with { type: "text" };
import { Code, createElement, Database, Files, type IconNode } from "lucide";
import spinnerStyles from "../ui/spinner.css" with { type: "text" };
import { formatBytes } from "../ui/format";
import { failureMessages, limitNote } from "../github/failure-messages";
import type { PublicErrorCode, PublicReply } from "../github/public-protocol";

export type AnalysisPhase = Extract<
  PublicReply,
  { type: "analysis.progress" }
>["phase"];

export type RowAction = "analyze" | "details" | "connect";

export type RowState =
  | { kind: "hidden" }
  | { kind: "idle" }
  | { kind: "running"; phase: AnalysisPhase }
  | CompleteState
  | { kind: "retry"; detail: string }
  | { kind: "notice"; label: string; detail: string }
  | { kind: "connect"; label: string; detail: string };

export type CompleteState = {
  kind: "complete";
  total: number;
  files: number;
  bytes: number;
  uncounted?: number;
  customIgnore?: boolean;
};

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
  rows: HTMLElement[];
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
  limit?: string,
): VisibleRowState {
  if (code === "analysis_canceled") return { kind: "idle" };
  const detail = failureMessages[code] + limitNote(limit);
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
      label: "Analyze with Culverin",
      title:
        "Download this repository's source from GitHub and count its lines of code, files, and size in your browser",
      action: "analyze",
    };
  if (state.kind === "running")
    return {
      label: progressText[state.phase],
      title: "Open Culverin to follow progress or cancel",
      action: "details",
    };
  if (state.kind === "complete") {
    const label = state.total === 1 ? "line of code" : "lines of code";
    const uncounted = state.uncounted
      ? `, not including ${state.uncounted.toLocaleString("en")} source ${state.uncounted === 1 ? "file" : "files"} too large to count`
      : "";
    return {
      count: `${compactCount(state.total)}${state.uncounted ? "+" : ""}`,
      label,
      title: `${state.total.toLocaleString("en")} ${label}${uncounted}${state.customIgnore ? " (Culverin ignore active)" : ""}`,
      action: "details",
    };
  }
  if (state.kind === "retry")
    return {
      label: "Couldn't analyze · Retry",
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

export function resultViews(state: CompleteState): RowView[] {
  const files = state.files === 1 ? "file" : "files";
  const size = formatBytes(state.bytes, "en");
  return [
    rowView(state),
    {
      count: compactCount(state.files),
      label: files,
      title: `${state.files.toLocaleString("en")} ${files} at the analyzed commit`,
      action: "details",
    },
    {
      count: size,
      label: "",
      title: `${size} (${state.bytes.toLocaleString("en")} ${state.bytes === 1 ? "byte" : "bytes"}): total size of the files at the analyzed commit, as checked out. Doesn't include Git history, so a cloned folder with its .git folder is larger.`,
      action: "details",
    },
  ];
}

const resultIcons: IconNode[] = [Code, Files, Database];

function resultIcon(node: IconNode): Element {
  return createElement(node, {
    width: 16,
    height: 16,
    "stroke-width": 2.25,
    "aria-hidden": "true",
    focusable: "false",
  });
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
${spinnerStyles}
:host { display:block; margin-top:var(--base-size-8,8px); color:var(--fgColor-muted,#59636e) }
:host([hidden]) { display:none }
[aria-live] { display:flex; flex-direction:column; align-items:flex-start; gap:var(--base-size-8,8px) }
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
  const ui: SummaryUi = { host, live, rows: [] };
  live.addEventListener("click", (event) => {
    if (
      !event.isTrusted ||
      !ui.action ||
      !ui.rows.some((row) => row.contains(event.target as Node))
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
  const views =
    state.kind === "complete" ? resultViews(state) : [rowView(state)];
  const rows = views.map((view, index) => {
    const interactive = view.action !== undefined;
    const current = ui.rows[index];
    if (current && current instanceof HTMLButtonElement === interactive)
      return current;
    const row = document.createElement(interactive ? "button" : "span");
    row.className = "row";
    if (row instanceof HTMLButtonElement) row.type = "button";
    return row;
  });
  if (
    rows.length !== ui.rows.length ||
    rows.some((row, index) => row !== ui.rows[index])
  )
    ui.live.replaceChildren(...rows);
  ui.rows = rows;
  views.forEach((view, index) => {
    const row = rows[index]!;
    let indicator: Element;
    if (state.kind === "running") {
      indicator =
        row.querySelector(".culverin-spinner") ??
        document.createElement("span");
      indicator.className = "culverin-spinner";
      indicator.setAttribute("aria-hidden", "true");
    } else if (state.kind === "complete")
      indicator = resultIcon(resultIcons[index]!);
    else indicator = icon();
    const parts: Node[] = [indicator];
    if (view.count !== undefined) {
      const count = document.createElement("strong");
      count.textContent = view.count;
      parts.push(count);
      if (view.label) parts.push(document.createTextNode(` ${view.label}`));
    } else parts.push(document.createTextNode(view.label));
    row.replaceChildren(...parts);
    row.title = view.title;
  });
  ui.action = views[0]!.action;
  ui.host.hidden = false;
}
