const units = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number, locale?: string): string {
  let value = bytes;
  let unit = 0;
  for (;;) {
    const digits = unit === 0 || value >= 10 ? 0 : 1;
    const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
    if (rounded < 1024 || unit === units.length - 1)
      return `${rounded.toLocaleString(locale, { maximumFractionDigits: digits })} ${units[unit]}`;
    value /= 1024;
    unit++;
  }
}

export function formatClockTime(time: number): string {
  return new Date(time).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
