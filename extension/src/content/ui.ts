export type SummaryUi = {
  host: HTMLElement;
  label: HTMLElement;
};

export function createSummaryUi(): SummaryUi {
  const host = document.createElement("div");
  host.dataset.culverinRoot = "";
  host.setAttribute("aria-label", "Culverin repository summary");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
:host { display:block; margin:8px 0; color:var(--fgColor-default,#24292f); font:inherit }
.summary { display:inline-block; padding:4px 8px; border:1px solid var(--borderColor-default,#8c959f); border-radius:6px; background:var(--bgColor-default,#fff); font-size:12px; line-height:1.5 }
`;
  const label = document.createElement("span");
  label.className = "summary";
  label.setAttribute("role", "status");
  label.setAttribute("aria-live", "polite");
  label.setAttribute("aria-atomic", "true");
  label.textContent = "Culverin | Total LOC: —";
  shadow.append(style, label);
  return { host, label };
}

export function showTotalCodeLines(
  ui: SummaryUi,
  totalCodeLines: number | undefined,
): void {
  ui.label.textContent = `Culverin | Total LOC: ${totalCodeLines === undefined ? "—" : totalCodeLines.toLocaleString()}`;
}
