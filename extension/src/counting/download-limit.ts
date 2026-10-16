import { DOWNLOAD_LIMITS } from "../archive/limits";
import {
  definePreference,
  type PreferenceStorage,
} from "../preferences/define";

const MIB = 1024 * 1024;

export const DOWNLOAD_LIMIT_KEY = "culverin.downloadLimit";

export const downloadLimitChoices: readonly number[] =
  DOWNLOAD_LIMITS.choices.map((bytes) => bytes / MIB);

export const downloadLimit = definePreference<number>({
  key: DOWNLOAD_LIMIT_KEY,
  fallback: DOWNLOAD_LIMITS.fallback / MIB,
  parse: (value) =>
    typeof value === "number" && downloadLimitChoices.includes(value)
      ? value
      : undefined,
  isDefault: (value) => value === DOWNLOAD_LIMITS.fallback / MIB,
});

export async function readDownloadLimit(
  storage?: PreferenceStorage,
): Promise<number> {
  return (await downloadLimit.read(storage)) * MIB;
}
