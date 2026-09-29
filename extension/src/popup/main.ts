import { analyze, cancel, openOptions, startPopup } from "./controller";
import { initialView, reduce, type PopupEvent, type PopupView } from "./state";

const element = <T extends HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const repository = element<HTMLElement>("#repository");
const status = element<HTMLElement>("#status");
const analysis = element<HTMLElement>("#analysis");
const codeLines = element<HTMLElement>("#code-lines");
const textLines = element<HTMLElement>("#text-lines");
const metrics = element<HTMLElement>("#metrics");
const ignoreSummary = element<HTMLElement>("#ignore-summary");
const ignoreText = element<HTMLElement>("#ignore-text");
const sizes = element<HTMLElement>("#sizes");
const repositorySize = element<HTMLElement>("#repository-size");
const snapshotLabel = element<HTMLElement>("#snapshot-label");
const snapshotSize = element<HTMLElement>("#snapshot-size");
const analyzeButton = element<HTMLButtonElement>("#analyze");
const cancelButton = element<HTMLButtonElement>("#cancel");
const details = element<HTMLDetailsElement>("#details");
const detailContent = element<HTMLElement>("#detail-content");
let view = initialView;

function paragraph(value: string, className?: string): HTMLElement {
  const node = document.createElement("p");
  node.textContent = value;
  if (className) node.className = className;
  return node;
}

function list(title: string, label: string, rows: string[]): HTMLElement[] {
  const heading = document.createElement("h2");
  heading.textContent = title;
  const items = document.createElement("ul");
  items.setAttribute("aria-label", label);
  for (const row of rows) {
    const item = document.createElement("li");
    item.textContent = row;
    items.append(item);
  }
  return [heading, items];
}

function render(next: PopupView): void {
  repository.hidden = !next.repository;
  repository.textContent = next.repository ?? "";
  if (status.textContent !== next.status) status.textContent = next.status;
  analysis.hidden = !next.analysisVisible;
  codeLines.textContent = next.result?.codeLines ?? "";
  textLines.textContent = next.result?.textLines ?? "";
  metrics.textContent = next.result?.metrics ?? "";
  ignoreSummary.hidden = !next.ignoreSummary;
  ignoreText.textContent = next.ignoreSummary ?? "";
  sizes.hidden = !next.sizes;
  repositorySize.textContent = next.sizes?.repositorySize ?? "";
  snapshotLabel.textContent = next.sizes?.snapshotLabel ?? "Files at commit";
  snapshotSize.textContent = next.snapshotSize;
  analyzeButton.disabled = next.analyzeDisabled;
  cancelButton.hidden = !next.cancelVisible;
  details.hidden = !next.result;
  details.open = next.detailsOpen;
  const result = next.result;
  if (!result) detailContent.replaceChildren();
  else {
    detailContent.replaceChildren(
      ...result.intro.map((value) => paragraph(value)),
    );
    if (result.codeRows.length)
      detailContent.append(
        ...list("Code", "Languages by code lines", result.codeRows),
      );
    if (result.textRows.length)
      detailContent.append(
        ...list("Text", "Text formats by text lines", result.textRows),
      );
    if (result.noLanguages) detailContent.append(paragraph(result.noLanguages));
    detailContent.append(paragraph(result.coverage));
    if (result.warning)
      detailContent.append(paragraph(result.warning, "warning"));
  }
}

function dispatch(event: PopupEvent): void {
  view = reduce(view, event);
  render(view);
}

for (const selector of ["#settings", "#ignore-edit"])
  element<HTMLButtonElement>(selector).addEventListener("click", openOptions);
analyzeButton.addEventListener("click", () => void analyze());
cancelButton.addEventListener("click", () => void cancel());
details.addEventListener("toggle", () =>
  dispatch({ type: "details", open: details.open }),
);

startPopup(dispatch);
