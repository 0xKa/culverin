import { expect, test } from "bun:test";
import {
  compactCount,
  failureState,
  lookupFailureState,
  partialState,
  rowView,
} from "../../extension/src/content/ui";

test("formats counts like GitHub repository stats", () => {
  expect(compactCount(0)).toBe("0");
  expect(compactCount(999)).toBe("999");
  expect(compactCount(1_000)).toBe("1k");
  expect(compactCount(60_612)).toBe("60.6k");
  expect(compactCount(1_234_567)).toBe("1.2M");
  expect(compactCount(3_000_000_000)).toBe("3B");
});

test("describes complete counts with exact tooltips", () => {
  expect(rowView({ kind: "complete", total: 1_234_567 })).toEqual({
    count: "1.2M",
    label: "lines of code",
    title: "1,234,567 lines of code",
  });
  expect(rowView({ kind: "complete", total: 1 })).toEqual({
    count: "1",
    label: "line of code",
    title: "1 line of code",
  });
});

test("offers explicit analysis and cancellation actions", () => {
  expect(rowView({ kind: "idle" })).toMatchObject({
    label: "Count lines of code",
    action: "analyze",
  });
  expect(rowView({ kind: "running", phase: "downloading" })).toEqual({
    label: "Downloading source…",
    title: "Click to cancel",
    action: "cancel",
  });
  expect(rowView(failureState("network_unavailable"))).toEqual({
    label: "Couldn't count lines · Retry",
    title: "GitHub could not be reached.",
    action: "analyze",
  });
});

test("maps failures to retryable, blocked, and hidden states", () => {
  expect(failureState("analysis_canceled")).toEqual({ kind: "idle" });
  expect(failureState("analysis_interrupted")).toEqual({
    kind: "retry",
    detail: "Analysis was interrupted. Try again.",
  });
  for (const code of [
    "compressed_limit_exceeded",
    "decompressed_limit_exceeded",
    "entry_limit_exceeded",
    "file_limit_exceeded",
    "metadata_limit_exceeded",
  ] as const)
    expect(rowView(failureState(code))).toMatchObject({
      label: "Too large to count",
    });
  for (const code of [
    "archive_invalid",
    "archive_unsupported",
    "repository_empty",
  ] as const) {
    const view = rowView(failureState(code));
    expect(view.label).toBe("Can't count this repository");
    expect(view.action).toBeUndefined();
  }
  const limited = rowView(failureState("rate_limited", Date.now() + 60_000));
  expect(limited.label).toBe("GitHub rate limit, try later");
  expect(limited.title).toStartWith("GitHub rate limit reached. Retry after ");
  expect(limited.action).toBeUndefined();
  for (const code of [
    "repository_unavailable",
    "repository_forbidden",
    "repository_empty",
    "authentication_required",
  ] as const)
    expect(lookupFailureState(code)).toEqual({ kind: "hidden" });
  expect(lookupFailureState("network_unavailable")).toEqual({ kind: "idle" });
  expect(lookupFailureState("rate_limited")).toMatchObject({
    kind: "notice",
  });
});

test("never presents a partial analysis as a total", () => {
  const view = rowView(partialState(["oversized_source"]));
  expect(view.count).toBeUndefined();
  expect(view.action).toBeUndefined();
  expect(view.label).toBe("Couldn't count every file");
  expect(view.title).toContain("exceeded the safe size limit");
});
