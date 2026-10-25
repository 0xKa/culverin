import { expect, test } from "bun:test";
import {
  durationText,
  formatDuration,
  formatElapsed,
} from "../../extension/src/popup/duration";

test("formats a running count as minutes and seconds", () => {
  expect(formatElapsed(0)).toBe("0:00");
  expect(formatElapsed(9_999)).toBe("0:09");
  expect(formatElapsed(102_000)).toBe("1:42");
  expect(formatElapsed(3_600_000)).toBe("60:00");
  expect(formatElapsed(-5_000)).toBe("0:00");
});

test("formats a finished count's duration", () => {
  expect(formatDuration(42_000)).toBe("42s");
  expect(formatDuration(42_317)).toBe("42s");
  expect(formatDuration(59_400)).toBe("59s");
  expect(formatDuration(59_500)).toBe("1m 00s");
  expect(formatDuration(124_000)).toBe("2m 04s");
  expect(formatDuration(3_600_000)).toBe("60m 00s");
  expect(durationText.counted(124_000)).toBe("Counted in 2m 04s");
  expect(durationText.saved(124_000)).toBe("Took 2m 04s when counted");
  expect(durationText.stopped(190_000)).toBe("Stopped after 3m 10s");
});

test("formats a short count with milliseconds or tenths of a second", () => {
  expect(formatDuration(0)).toBe("0ms");
  expect(formatDuration(-5)).toBe("0ms");
  expect(formatDuration(412)).toBe("412ms");
  expect(formatDuration(999.4)).toBe("999ms");
  expect(formatDuration(999.6)).toBe("1.0s");
  expect(formatDuration(3_000)).toBe("3.0s");
  expect(formatDuration(4_230)).toBe("4.2s");
  expect(formatDuration(9_949)).toBe("9.9s");
  expect(formatDuration(9_950)).toBe("10s");
  expect(durationText.counted(412)).toBe("Counted in 412ms");
  expect(durationText.saved(4_230)).toBe("Took 4.2s when counted");
  expect(durationText.stopped(850)).toBe("Stopped after 850ms");
});
