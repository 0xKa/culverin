import {
  definePreference,
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

export const countFormat = definePreference<CountFormat>({
  key: COUNT_FORMAT_KEY,
  fallback: defaultNumberFormats.counts,
  parse: parseCountFormat,
  isDefault: (value) => value === defaultNumberFormats.counts,
});

export const sizeUnits = definePreference<SizeUnits>({
  key: SIZE_UNITS_KEY,
  fallback: defaultNumberFormats.sizes,
  parse: parseSizeUnits,
  isDefault: (value) => value === defaultNumberFormats.sizes,
});

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
): () => void {
  let disposed = false;
  let countsChanged = false;
  let sizesChanged = false;
  let formats = { ...defaultNumberFormats };
  const changed = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (disposed || area !== "sync") return;
    if (!(COUNT_FORMAT_KEY in changes) && !(SIZE_UNITS_KEY in changes)) return;
    if (COUNT_FORMAT_KEY in changes) {
      countsChanged = true;
      formats = {
        ...formats,
        counts:
          parseCountFormat(changes[COUNT_FORMAT_KEY]?.newValue) ??
          defaultNumberFormats.counts,
      };
    }
    if (SIZE_UNITS_KEY in changes) {
      sizesChanged = true;
      formats = {
        ...formats,
        sizes:
          parseSizeUnits(changes[SIZE_UNITS_KEY]?.newValue) ??
          defaultNumberFormats.sizes,
      };
    }
    publish(formats);
  };
  dependencies.changes.addListener(changed);
  void Promise.all([
    countFormat.read(dependencies.storage),
    sizeUnits.read(dependencies.storage),
  ]).then(([counts, sizes]) => {
    if (disposed) return;
    formats = {
      counts: countsChanged ? formats.counts : counts,
      sizes: sizesChanged ? formats.sizes : sizes,
    };
    publish(formats);
  });
  return () => {
    disposed = true;
    dependencies.changes.removeListener(changed);
  };
}
