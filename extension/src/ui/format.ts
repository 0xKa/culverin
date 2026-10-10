export type CountFormat = "full" | "abbreviated";
export type SizeUnits = "binary" | "decimal";
export type NumberFormats = { counts: CountFormat; sizes: SizeUnits };

export const defaultNumberFormats: NumberFormats = {
  counts: "full",
  sizes: "binary",
};

export function validNumberFormats(value: unknown): value is NumberFormats {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const formats = value as Record<string, unknown>;
  return (
    Object.keys(formats).sort().join() === "counts,sizes" &&
    (formats.counts === "full" || formats.counts === "abbreviated") &&
    (formats.sizes === "binary" || formats.sizes === "decimal")
  );
}

export function formatCount(
  count: number,
  format: CountFormat = "full",
  locale?: string,
): string {
  return count.toLocaleString(locale, {
    notation: format === "abbreviated" ? "compact" : "standard",
    maximumFractionDigits: format === "abbreviated" ? 1 : 0,
  });
}

export function exactBytes(bytes: number, locale?: string): string {
  return `${bytes.toLocaleString(locale)} ${bytes === 1 ? "byte" : "bytes"}`;
}

export function formatBytes(
  bytes: number,
  locale?: string,
  system: SizeUnits = "binary",
): string {
  const units =
    system === "binary"
      ? ["B", "KiB", "MiB", "GiB", "TiB"]
      : ["B", "KB", "MB", "GB", "TB"];
  const base = system === "binary" ? 1024 : 1000;
  let value = bytes;
  let unit = 0;
  for (;;) {
    const digits = unit === 0 || value >= 10 ? 0 : 1;
    const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
    if (rounded < base || unit === units.length - 1)
      return `${rounded.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[unit]}`;
    value /= base;
    unit++;
  }
}

export function formatClockTime(time: number): string {
  return new Date(time).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
