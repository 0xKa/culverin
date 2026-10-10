import { expect, test } from "bun:test";
import {
  exactBytes,
  formatBytes,
  formatCount,
} from "../../extension/src/ui/format";

test("formats byte counts with binary units", () => {
  const cases: [number, string][] = [
    [0, "0 B"],
    [21, "21 B"],
    [1023, "1,023 B"],
    [1024, "1 KiB"],
    [1536, "1.5 KiB"],
    [200 * 1024, "200 KiB"],
    [1024 * 1024 - 1, "1 MiB"],
    [8000000, "7.6 MiB"],
    [8 * 1024 * 1024, "8 MiB"],
    [1.2 * 1024 ** 3, "1.2 GiB"],
    [5000 * 1024 ** 4, "5,000 TiB"],
  ];
  for (const [bytes, text] of cases)
    expect(formatBytes(bytes, "en-US")).toBe(text);
});

test("uses decimal divisors and promotes rounded values at unit boundaries", () => {
  const cases: [number, string][] = [
    [0, "0 B"],
    [999, "999 B"],
    [1000, "1 KB"],
    [1500, "1.5 KB"],
    [999_999, "1 MB"],
    [8_000_000, "8 MB"],
    [1.5 * 1024 ** 2, "1.6 MB"],
    [1.2 * 1000 ** 3, "1.2 GB"],
    [5000 * 1000 ** 4, "5,000 TB"],
  ];
  for (const [bytes, text] of cases)
    expect(formatBytes(bytes, "en-US", "decimal")).toBe(text);
  expect(formatBytes(1536, "de-DE", "binary")).toBe("1,5 KiB");
  expect(formatBytes(1_500_000, "de-DE", "decimal")).toBe("1,5 MB");
  expect(exactBytes(1_572_864, "en-US")).toBe("1,572,864 bytes");
  expect(exactBytes(1, "en-US")).toBe("1 byte");
});

test("keeps full counts exact and abbreviates large values with locale-aware rounding", () => {
  expect(formatCount(12_480, "full", "en-US")).toBe("12,480");
  expect(formatCount(12_480, "abbreviated", "en-US")).toBe("12.5K");
  expect(formatCount(999, "abbreviated", "en-US")).toBe("999");
  expect(formatCount(999_950, "abbreviated", "en-US")).toBe("1M");
  expect(formatCount(1_234_567, "abbreviated", "en-US")).toBe("1.2M");
  expect(formatCount(0, "abbreviated", "en-US")).toBe("0");
  expect(formatCount(12_480, "full", "de-DE")).toBe("12.480");
});
