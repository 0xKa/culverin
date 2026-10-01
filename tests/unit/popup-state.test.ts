import { expect, test } from "bun:test";
import { initialView, reduce } from "../../extension/src/popup/state";

test("tracks repository, busy state, sizes, result and details", () => {
  const repository = reduce(initialView, {
    type: "repository",
    value: "owner/repo",
  });
  expect(repository.analysisVisible).toBe(true);
  expect(repository.repository).toBe("owner/repo");
  const busy = reduce(repository, { type: "busy", busy: true, disabled: true });
  expect(busy.cancelVisible).toBe(true);
  const sizes = { repositorySize: "2 MB", snapshotLabel: "Files at abc" };
  const ready = reduce(busy, { type: "sizes", value: sizes });
  const result = {
    codeLines: "1 code lines",
    textLines: "0 text lines",
    metrics: "",
    snapshotSize: "20 B",
    intro: [],
    codeRows: [],
    textRows: [],
    otherRows: [],
    moreOtherRows: [],
    noLanguages: "No language totals.",
    coverage: "",
  };
  expect(ready.reanalyze).toBe(false);
  const shown = reduce(ready, { type: "result", value: result, sizes });
  expect(shown.detailsOpen).toBe(true);
  expect(shown.reanalyze).toBe(true);
  expect(shown.snapshotSize).toBe("20 B");
  expect(reduce(shown, { type: "details", open: false }).detailsOpen).toBe(
    false,
  );
  const cleared = reduce(shown, { type: "clearResult" });
  expect(cleared.result).toBeUndefined();
  expect(cleared.sizes).toEqual(sizes);
  expect(cleared.snapshotSize).toBe("Available after analysis");
  expect(cleared.detailsOpen).toBe(false);
  expect(cleared.reanalyze).toBe(false);
});

test("leaving a repository resets every repository-specific field", () => {
  const active = {
    ...initialView,
    repository: "owner/repo",
    analysisVisible: true,
    analyzeDisabled: false,
    cancelVisible: true,
    sizes: { repositorySize: "2 MB", snapshotLabel: "Files at abc" },
    snapshotSize: "20 B",
    ignoreSummary: "Culverin ignore: 1 rule",
    detailsOpen: true,
    reanalyze: true,
  };
  expect(reduce(active, { type: "left" })).toEqual({
    ...initialView,
    status: "The active tab changed. Reopen the popup to analyze it.",
  });
});

test("keeps the API limit when leaving a repository", () => {
  const apiLimit = {
    text: "API 57/60",
    title: "",
    value: { limit: 60, remaining: 57, reset: 1 },
    now: 0,
  };
  const shown = reduce(initialView, { type: "apiLimit", value: apiLimit });
  expect(shown.apiLimit).toEqual(apiLimit);
  expect(reduce(shown, { type: "left" }).apiLimit).toEqual(apiLimit);
  expect(reduce(shown, { type: "apiLimit" }).apiLimit).toBeUndefined();
});

test("shows and hides the GitHub settings action", () => {
  const shown = reduce(initialView, {
    type: "connect",
    label: "Connect GitHub",
  });
  expect(shown.connect).toBe("Connect GitHub");
  expect(reduce(shown, { type: "connect", label: "Connect GitHub" })).toBe(
    shown,
  );
  expect(reduce(shown, { type: "connect" }).connect).toBeUndefined();
  expect(reduce(shown, { type: "left" }).connect).toBeUndefined();
});
