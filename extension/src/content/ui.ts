import type { AnalysisResultV1 } from "../counter/result";
import type { ResolutionEnvelope } from "../github/public-protocol";

const css = `
:host { --culverin-fg:#24292f; --culverin-bg:#fff; display:block; margin:16px 0; color:var(--fgColor-default, var(--culverin-fg)); color-scheme:light dark; font:inherit }
* { box-sizing:border-box }
.card { max-width:720px; padding:12px 16px; border:1px solid var(--borderColor-default, #8c959f); border-radius:6px; background:var(--bgColor-default, var(--culverin-bg)); color:var(--fgColor-default, var(--culverin-fg)) }
.heading { margin:0 0 8px; font-size:1rem; font-weight:600 }
.actions { display:flex; flex-wrap:wrap; gap:8px; align-items:center }
button { font:inherit; font-weight:600; padding:5px 12px; border:1px solid var(--borderColor-default, #8c959f); border-radius:6px; background:var(--button-default-bgColor-rest, var(--culverin-bg)); color:var(--fgColor-default, var(--culverin-fg)); cursor:pointer }
button:hover { background:var(--button-default-bgColor-hover, #eaeef2) }
button:disabled { opacity:.6; cursor:default }
:is(button,summary):focus-visible { outline:3px solid var(--focus-outlineColor, #0969da); outline-offset:3px }
.status { margin:8px 0 0 }
details { margin-top:8px }
summary { cursor:pointer; font-weight:600 }
.summary { display:block; margin:0 0 6px; font-size:1.1rem }
.detail { padding-top:8px }
.detail p { margin:4px 0 10px }
.detail ul { margin:0 0 10px; padding-left:24px }
.detail li { margin:4px 0 }
.warning { border-left:4px solid var(--borderColor-attention-emphasis, #9a6700); padding-left:8px }
@media (forced-colors:active) { .card,button { border-color:CanvasText } :is(button,summary):focus-visible { outline-color:Highlight } }
@media (prefers-color-scheme:dark) { :host { --culverin-fg:#f0f6fc; --culverin-bg:#0d1117 } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none!important; transition:none!important } }
`;

function node<K extends keyof HTMLElementTagNameMap>(
  name: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(name);
  if (text !== undefined) result.textContent = text;
  return result;
}

export type AnalysisUi = {
  host: HTMLElement;
  status: HTMLElement;
  details: HTMLDetailsElement;
  summary: HTMLElement;
  result: HTMLElement;
  analyze: HTMLButtonElement;
  cancel: HTMLButtonElement;
};

export function createAnalysisUi(): AnalysisUi {
  const host = node("section");
  host.dataset.culverinRoot = "";
  host.setAttribute("aria-label", "Culverin repository analysis");
  const shadow = host.attachShadow({ mode: "open" });
  const style = node("style", css);
  const card = node("div");
  card.className = "card";
  const heading = node("h2", "Culverin");
  heading.className = "heading";
  const actions = node("div");
  actions.className = "actions";
  const analyze = node("button", "Analyze repository");
  analyze.type = "button";
  const cancel = node("button", "Cancel analysis");
  cancel.type = "button";
  cancel.hidden = true;
  actions.append(analyze, cancel);
  const status = node("p", "Ready to analyze.");
  status.className = "status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.setAttribute("aria-atomic", "true");
  const details = node("details");
  details.hidden = true;
  const summary = node("summary", "Analysis details");
  const result = node("div");
  result.className = "detail";
  details.append(summary, result);
  card.append(heading, actions, status, details);
  shadow.append(style, card);
  return { host, status, details, summary, result, analyze, cancel };
}

export function clearAnalysisUi(ui: AnalysisUi): void {
  ui.details.hidden = true;
  ui.details.open = false;
  ui.result.replaceChildren();
}

export function showAnalysisResult(
  ui: AnalysisUi,
  result: AnalysisResultV1,
  resolution: ResolutionEnvelope,
): void {
  const { totals, coverage, engine } = result;
  ui.summary.textContent = `${totals.code.toLocaleString()} code lines across ${totals.files.toLocaleString()} files`;
  ui.result.replaceChildren();
  ui.result.append(
    node(
      "p",
      `${totals.lines} physical lines · ${totals.comments} comments · ${totals.blanks} blanks`,
    ),
    node(
      "p",
      `Default branch ${resolution.defaultBranch} · commit ${resolution.sha.slice(0, 12)}`,
    ),
    node(
      "p",
      `${engine.name} ${engine.version} · ${engine.rulesProfile} profile, rules ${engine.rulesVersion} · wrapper ${engine.wrapperVersion}`,
    ),
    node(
      "p",
      "Repository source was downloaded directly from GitHub and analyzed in your browser.",
    ),
  );
  const list = node("ul");
  list.setAttribute("aria-label", "Languages by code lines");
  for (const language of result.languages) {
    const percent = totals.code === 0 ? 0 : (language.code / totals.code) * 100;
    list.append(
      node(
        "li",
        `${language.language}: ${language.code} code lines (${percent.toFixed(1)}% of code lines), ${language.files} files`,
      ),
    );
  }
  ui.result.append(list);
  if (totals.code === 0)
    ui.result.append(
      node(
        "p",
        "No code lines were counted; language percentages are 0.0% of code lines.",
      ),
    );
  const skipped = coverage.skippedByReason;
  ui.result.append(
    node(
      "p",
      `Source profile coverage: ${coverage.countedFiles} of ${coverage.regularFiles} regular files counted; ${coverage.skippedFiles} skipped (${skipped.excluded_by_rule} excluded by source profile, ${skipped.unsupported_language} unsupported language, ${skipped.binary_content} binary, ${skipped.oversized_source} oversized).`,
    ),
  );
  if (!coverage.complete) {
    const warning = node(
      "p",
      `Partial analysis: ${coverage.incompleteReasons.map((reason) => (reason === "oversized_source" ? "some source files exceeded the safe size limit" : "some source counts may be inaccurate")).join("; ")}.`,
    );
    warning.className = "warning";
    ui.result.append(warning);
  }
  ui.details.hidden = false;
  ui.details.open = true;
}
