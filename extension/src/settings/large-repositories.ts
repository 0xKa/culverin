import {
  ARCHIVE_LIMITS,
  ARCHIVE_TIMEOUTS,
  DOWNLOAD_LIMITS,
} from "../archive/limits";
import {
  downloadLimit,
  downloadLimitChoices,
} from "../counting/download-limit";

const MIB = 1024 * 1024;

export function sizeLabel(mebibytes: number): string {
  return mebibytes >= 1024 && mebibytes % 1024 === 0
    ? `${mebibytes / 1024} GiB`
    : `${mebibytes.toLocaleString("en")} MiB`;
}

export const downloadLimitOptions = downloadLimitChoices.map((value) => ({
  value: String(value),
  label:
    value === downloadLimit.fallback
      ? `${sizeLabel(value)} (default)`
      : sizeLabel(value),
}));

export const fixedLimits: { label: string; value: string }[] = [
  {
    label: "Unpacked size",
    value: `${DOWNLOAD_LIMITS.unpackedRatio} times the download limit`,
  },
  {
    label: "Archive entries",
    value: ARCHIVE_LIMITS.entries.toLocaleString("en"),
  },
  { label: "Files", value: ARCHIVE_LIMITS.regularFiles.toLocaleString("en") },
  {
    label: `Source files over ${sizeLabel(ARCHIVE_LIMITS.file / MIB)}`,
    value: "Skipped, and the total is marked partial",
  },
  {
    label: "Time per count",
    value: `${ARCHIVE_TIMEOUTS.job / 60_000} minutes`,
  },
];
