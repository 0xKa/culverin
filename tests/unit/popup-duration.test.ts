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
  expect(formatDuration(59_400)).toBe("59s");
  expect(formatDuration(124_000)).toBe("2m 04s");
  expect(formatDuration(3_600_000)).toBe("60m 00s");
  expect(durationText.counted(124_000)).toBe("Counted in 2m 04s");
  expect(durationText.saved(124_000)).toBe("Took 2m 04s when counted");
  expect(durationText.stopped(190_000)).toBe("Stopped after 3m 10s");
});
