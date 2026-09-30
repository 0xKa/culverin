import type { ApiLimitView, ResultView, SizesView } from "./view";

export type PopupView = {
  repository?: string;
  status: string;
  analysisVisible: boolean;
  analyzeDisabled: boolean;
  cancelVisible: boolean;
  sizes?: SizesView;
  snapshotSize: string;
  ignoreSummary?: string;
  result?: ResultView;
  detailsOpen: boolean;
  reanalyze: boolean;
  connect?: string;
  apiLimit?: ApiLimitView;
};

export const initialView: PopupView = {
  status: "Open a GitHub repository overview to analyze it.",
  analysisVisible: false,
  analyzeDisabled: true,
  cancelVisible: false,
  snapshotSize: "Available after analysis",
  detailsOpen: false,
  reanalyze: false,
};

export type PopupEvent =
  | { type: "status"; value: string }
  | { type: "busy"; busy: boolean; disabled: boolean }
  | { type: "lookup" }
  | { type: "clearResult" }
  | { type: "sizes"; value: SizesView }
  | { type: "result"; value: ResultView; sizes: SizesView }
  | { type: "ignore"; value?: string }
  | { type: "left" }
  | { type: "repository"; value: string }
  | { type: "details"; open: boolean }
  | { type: "apiLimit"; value?: ApiLimitView }
  | { type: "connect"; label?: string };

export function reduce(view: PopupView, event: PopupEvent): PopupView {
  switch (event.type) {
    case "status":
      return view.status === event.value
        ? view
        : { ...view, status: event.value };
    case "busy":
      return {
        ...view,
        analyzeDisabled: event.disabled,
        cancelVisible: event.busy,
      };
    case "lookup":
      return { ...view, analyzeDisabled: true };
    case "clearResult":
      return {
        ...view,
        result: undefined,
        snapshotSize: "Available after analysis",
        detailsOpen: false,
        reanalyze: false,
      };
    case "sizes":
      return { ...view, sizes: event.value };
    case "result":
      return {
        ...view,
        sizes: event.sizes,
        snapshotSize: event.value.snapshotSize,
        result: event.value,
        detailsOpen: true,
        reanalyze: true,
      };
    case "ignore":
      return { ...view, ignoreSummary: event.value };
    case "left":
      return {
        ...initialView,
        status: "The active tab changed. Reopen the popup to analyze it.",
        apiLimit: view.apiLimit,
      };
    case "repository":
      return { ...view, repository: event.value, analysisVisible: true };
    case "details":
      return { ...view, detailsOpen: event.open };
    case "apiLimit":
      return { ...view, apiLimit: event.value };
    case "connect":
      return view.connect === event.label
        ? view
        : { ...view, connect: event.label };
  }
}
