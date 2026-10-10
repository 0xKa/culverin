import {
  definePreference,
  type Preference,
  type PreferenceStorage,
} from "../preferences/define";
import {
  defaultNumberFormats,
  type CountFormat,
  type NumberFormats,
  type SizeUnits,
} from "../ui/format";

export const COUNT_FORMAT_KEY = "culverin.countFormat";
export const SIZE_UNITS_KEY = "culverin.sizeUnits";

function parseCountFormat(value: unknown): CountFormat | undefined {
  return value === "full" || value === "abbreviated" ? value : undefined;
}

function parseSizeUnits(value: unknown): SizeUnits | undefined {
  return value === "binary" || value === "decimal" ? value : undefined;
}

export type NumberFormatPreferences = {
  counts: Preference<CountFormat>;
  sizes: Preference<SizeUnits>;
  defaults: NumberFormats;
};

export function defineNumberFormats(
  keys: { counts: string; sizes: string },
  defaults: NumberFormats,
): NumberFormatPreferences {
  return {
    counts: definePreference<CountFormat>({
      key: keys.counts,
      fallback: defaults.counts,
      parse: parseCountFormat,
      isDefault: (value) => value === defaults.counts,
    }),
    sizes: definePreference<SizeUnits>({
      key: keys.sizes,
      fallback: defaults.sizes,
      parse: parseSizeUnits,
      isDefault: (value) => value === defaults.sizes,
    }),
    defaults,
  };
}

export const appearanceNumberPreferences = defineNumberFormats(
  { counts: COUNT_FORMAT_KEY, sizes: SIZE_UNITS_KEY },
  defaultNumberFormats,
);
export const countFormat = appearanceNumberPreferences.counts;
export const sizeUnits = appearanceNumberPreferences.sizes;

export async function readNumberFormats(
  preferences: NumberFormatPreferences,
  storage: PreferenceStorage = chrome.storage.sync,
): Promise<NumberFormats> {
  const [counts, sizes] = await Promise.all([
    preferences.counts.read(storage),
    preferences.sizes.read(storage),
  ]);
  return { counts, sizes };
}

type Dependencies = {
  storage: PreferenceStorage;
  changes: Pick<
    typeof chrome.storage.onChanged,
    "addListener" | "removeListener"
  >;
};

export function subscribeNumberFormats(
  publish: (formats: NumberFormats) => void,
  dependencies: Dependencies = {
    storage: chrome.storage.sync,
    changes: chrome.storage.onChanged,
  },
  preferences: NumberFormatPreferences = appearanceNumberPreferences,
): () => void {
  const countKey = preferences.counts.key;
  const sizeKey = preferences.sizes.key;
  const defaults = preferences.defaults;
  let disposed = false;
  let countsChanged = false;
  let sizesChanged = false;
  let formats = { ...defaults };
  const changed = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (disposed || area !== "sync") return;
    if (!(countKey in changes) && !(sizeKey in changes)) return;
    if (countKey in changes) {
      countsChanged = true;
      formats = {
        ...formats,
        counts:
          parseCountFormat(changes[countKey]?.newValue) ?? defaults.counts,
      };
    }
    if (sizeKey in changes) {
      sizesChanged = true;
      formats = {
        ...formats,
        sizes: parseSizeUnits(changes[sizeKey]?.newValue) ?? defaults.sizes,
      };
    }
    publish(formats);
  };
  dependencies.changes.addListener(changed);
  void readNumberFormats(preferences, dependencies.storage).then(
    ({ counts, sizes }) => {
      if (disposed) return;
      formats = {
        counts: countsChanged ? formats.counts : counts,
        sizes: sizesChanged ? formats.sizes : sizes,
      };
      publish(formats);
    },
  );
  return () => {
    disposed = true;
    dependencies.changes.removeListener(changed);
  };
}
