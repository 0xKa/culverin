import { expect, test } from "bun:test";
import { formatBytes } from "../../extension/src/ui/format";

test("formats byte counts with binary units", () => {
  const cases: [number, string][] = [
    [0, "0 B"],
    [21, "21 B"],
    [1023, "1,023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [200 * 1024, "200 KB"],
    [1024 * 1024 - 1, "1 MB"],
    [8000000, "7.6 MB"],
    [8 * 1024 * 1024, "8 MB"],
    [1.2 * 1024 ** 3, "1.2 GB"],
    [5000 * 1024 ** 4, "5,000 TB"],
  ];
  for (const [bytes, text] of cases)
    expect(formatBytes(bytes, "en-US")).toBe(text);
});
