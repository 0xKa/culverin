import { statuses, type PopupStatus } from "./status";
import type { ApiLimitView, ResultView } from "./view";

export type PopupView = {
  pending: boolean;
  repository?: string;
  status: PopupStatus;
  analysisVisible: boolean;
  analyzeDisabled: boolean;
  cancelVisible: boolean;
  ignoreSummary?: string;
  result?: ResultView;
  detailsOpen: boolean;
  reanalyze: boolean;
  connect?: string;
  apiLimit?: ApiLimitView;
  timer?: { queued: true } | { startedAt: number };
  downloaded?: string;
  duration?: string;
};

export const initialView: PopupView = {
  pending: true,
  status: statuses.notRepository,
  analysisVisible: false,
  analyzeDisabled: true,
  cancelVisible: false,
  detailsOpen: false,
  reanalyze: false,
};

export type PopupEvent =
  | { type: "reveal" }
  | { type: "status"; value: PopupStatus }
  | { type: "busy"; busy: boolean; disabled: boolean }
  | { type: "lookup" }
  | { type: "clearResult" }
  | { type: "result"; value: ResultView }
  | { type: "ignore"; value?: string }
  | { type: "left" }
  | { type: "repository"; value: string }
  | { type: "details"; open: boolean }
  | { type: "apiLimit"; value?: ApiLimitView }
  | { type: "connect"; label?: string }
  | { type: "timer"; value?: { queued: true } | { startedAt: number } }
  | { type: "downloaded"; value?: string }
  | { type: "duration"; value?: string };

export function reduce(view: PopupView, event: PopupEvent): PopupView {
  switch (event.type) {
    case "reveal":
      return view.pending ? { ...view, pending: false } : view;
    case "status":
      return view.status === event.value
        ? view
        : { ...view, status: event.value };
    case "busy":
      return {
        ...view,
        analyzeDisabled: event.disabled,
        cancelVisible: event.busy,
        ...(event.busy ? {} : { timer: undefined, downloaded: undefined }),
      };
    case "lookup":
      return { ...view, analyzeDisabled: true };
    case "clearResult":
      return {
        ...view,
        result: undefined,
        detailsOpen: false,
        reanalyze: false,
      };
    case "result":
      return {
        ...view,
        result: event.value,
        detailsOpen: view.result ? view.detailsOpen : true,
        reanalyze: true,
      };
    case "ignore":
      return { ...view, ignoreSummary: event.value };
    case "left":
      return {
        ...initialView,
        pending: false,
        status: statuses.tabChanged,
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
    case "timer":
      return { ...view, timer: event.value };
    case "downloaded":
      return view.downloaded === event.value
        ? view
        : { ...view, downloaded: event.value };
    case "duration":
      return view.duration === event.value
        ? view
        : { ...view, duration: event.value };
  }
}
