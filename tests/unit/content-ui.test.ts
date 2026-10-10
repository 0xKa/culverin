import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  compactCount,
  failureState,
  lookupFailureState,
  resultViews,
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

test("describes complete counts with exact tooltips and opens details", () => {
  expect(
    rowView({ kind: "complete", total: 1_234_567, files: 1, bytes: 0 }),
  ).toEqual({
    count: "1.2M",
    label: "lines of code",
    title: "1,234,567 lines of code",
    action: "details",
  });
  expect(rowView({ kind: "complete", total: 1, files: 1, bytes: 0 })).toEqual({
    count: "1",
    label: "line of code",
    title: "1 line of code",
    action: "details",
  });
  expect(
    rowView({
      kind: "complete",
      total: 412_345,
      files: 1,
      bytes: 0,
      customIgnore: true,
    }),
  ).toEqual({
    count: "412.3k",
    label: "lines of code",
    title: "412,345 lines of code (Culverin ignore active)",
    action: "details",
  });
});

test("adds file count and size rows after a result", () => {
  const [lines, files, size] = resultViews({
    kind: "complete",
    total: 60_612,
    files: 1_234,
    bytes: 4_718_592,
    uncounted: 1,
  });
  expect(lines).toMatchObject({ count: "60.6k+", label: "lines of code" });
  expect(files).toEqual({
    item: "files",
    count: "1.2k",
    label: "files",
    title: "1,234 files at the analyzed commit",
    action: "details",
  });
  expect(size).toEqual({
    item: "size",
    count: "4.5 MiB",
    label: "",
    title:
      "4.5 MiB (4,718,592 bytes): total size of the files at the analyzed commit, as checked out. Doesn't include Git history, so a cloned folder with its .git folder is larger.",
    action: "details",
  });
  const [, oneFile, oneByte] = resultViews({
    kind: "complete",
    total: 0,
    files: 1,
    bytes: 1,
  });
  expect(oneFile).toMatchObject({ count: "1", label: "file" });
  expect(oneByte).toMatchObject({ count: "1 B" });
  expect(oneByte!.title).toContain("(1 byte)");
});

test("shows only the chosen About items in the chosen order", () => {
  const state = {
    kind: "complete",
    total: 10,
    files: 2,
    bytes: 2048,
  } as const;
  expect(resultViews(state).map((view) => view.item)).toEqual([
    "lines",
    "files",
    "size",
  ]);
  expect(
    resultViews(state, ["size", "lines"]).map(({ item, count }) => [
      item,
      count,
    ]),
  ).toEqual([
    ["size", "2 KiB"],
    ["lines", "10"],
  ]);
});

test("offers explicit analysis and cancellation actions", () => {
  expect(rowView({ kind: "idle" })).toMatchObject({
    label: "Analyze with Culverin",
    action: "analyze",
  });
  expect(rowView({ kind: "running", phase: "downloading" })).toEqual({
    label: "Downloading source…",
    title: "Open Culverin to follow progress or cancel",
    action: "details",
  });
  expect(rowView(failureState("network_unavailable"))).toEqual({
    label: "Couldn't analyze · Retry",
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
  expect(rowView(failureState("archive_throttled"))).toMatchObject({
    label: "Couldn't analyze · Retry",
    title:
      "GitHub is busy preparing this repository's source snapshot. Try again in a minute.",
    action: "analyze",
  });
  for (const code of [
    "invalid_repository",
    "unsupported_page",
    "repository_unavailable",
    "repository_forbidden",
    "repository_empty",
  ] as const)
    expect(lookupFailureState(code)).toEqual({ kind: "hidden" });
  expect(lookupFailureState("authentication_required")).toMatchObject({
    kind: "connect",
  });
  const signIn = rowView(failureState("authentication_required"));
  expect(signIn).toMatchObject({
    label: "Private repository? Connect GitHub",
    action: "connect",
  });
  expect(signIn.title).toContain("Connect GitHub");
  expect(rowView(failureState("access_not_granted"))).toMatchObject({
    label: "No access · Choose repositories",
    action: "connect",
  });
  expect(rowView(failureState("authentication_invalid"))).toMatchObject({
    label: "GitHub connection expired · Reconnect",
    action: "connect",
  });
  expect(rowView(failureState("repository_unavailable"))).toMatchObject({
    label: "Couldn't analyze · Retry",
    action: "analyze",
  });
  expect(lookupFailureState("network_unavailable")).toEqual({ kind: "idle" });
  expect(lookupFailureState("rate_limited")).toMatchObject({
    kind: "notice",
  });
});

test("names the limit an analysis reached", () => {
  expect(
    failureState("file_limit_exceeded", undefined, "regularFiles"),
  ).toEqual({
    kind: "notice",
    label: "Too large to count",
    detail:
      "The source snapshot exceeds the counting limit. The limit is 200,000 files.",
  });
  expect(
    rowView(
      failureState("decompressed_limit_exceeded", undefined, "decompressed"),
    ).title,
  ).toBe(
    "The source snapshot exceeds the expanded-size limit. The limit is 2,048 MiB unpacked.",
  );
  expect(
    failureState("metadata_limit_exceeded", undefined, "unknown"),
  ).toMatchObject({
    detail: "Repository metadata exceeds the safe limit.",
  });
  expect(
    failureState("file_limit_exceeded", undefined, "wasmBytes"),
  ).toMatchObject({
    detail:
      "The source snapshot exceeds the counting limit. The limit is 1,024 MiB of source files to count.",
  });
});

test("marks a total that leaves out files too large to count", () => {
  const view = rowView({
    kind: "complete",
    total: 1234,
    files: 1,
    bytes: 0,
    uncounted: 2,
  });
  expect(view.count).toBe("1.2k+");
  expect(view.action).toBe("details");
  expect(view.title).toBe(
    "1,234 lines of code, not including 2 source files too large to count",
  );
  expect(
    rowView({ kind: "complete", total: 1234, files: 1, bytes: 0, uncounted: 0 })
      .count,
  ).toBe("1.2k");
});

test("uses a pixel-aligned monochrome icon asset", () => {
  const source = readFileSync("assets/mono/culverin-mono-stats.svg", "utf8");
  const root = /^<svg ([^>]*)>/.exec(source)?.[1] ?? "";
  expect(root).toContain('viewBox="0 0 16 16"');
  expect(root).toContain('fill="currentColor"');
  expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  const shapes = [...source.matchAll(/<(\w+) ([^>]*)\/>/g)];
  expect(shapes.length).toBeGreaterThan(0);
  for (const [, tag, attributes] of shapes) {
    expect(tag).toBe("rect");
    for (const [, value] of attributes!.matchAll(/="([^"]*)"/g))
      expect(value).toMatch(/^\d+$/);
  }
});
