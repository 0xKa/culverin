import {
  definePreference,
  type PreferenceStorage,
} from "../preferences/define";

export const LANGUAGE_COLOR_MODES = ["language", "single"] as const;

export type LanguageColorMode = (typeof LANGUAGE_COLOR_MODES)[number];

export const LANGUAGE_COLORS_KEY = "culverin.languageColors";

export function parseLanguageColors(
  value: unknown,
): LanguageColorMode | undefined {
  return LANGUAGE_COLOR_MODES.includes(value as LanguageColorMode)
    ? (value as LanguageColorMode)
    : undefined;
}

export const languageColors = definePreference<LanguageColorMode>({
  key: LANGUAGE_COLORS_KEY,
  fallback: "language",
  parse: parseLanguageColors,
  isDefault: (value) => value === "language",
});

export function applyLanguageColors(
  mode: LanguageColorMode,
  root: { dataset: DOMStringMap } = document.documentElement,
): void {
  if (mode === "single") root.dataset.languageColors = "single";
  else delete root.dataset.languageColors;
}

export function readRememberedLanguageColors(
  storage: Pick<Storage, "getItem"> = localStorage,
): LanguageColorMode {
  try {
    return (
      parseLanguageColors(storage.getItem(LANGUAGE_COLORS_KEY)) ?? "language"
    );
  } catch {
    return "language";
  }
}

export function rememberLanguageColors(
  mode: LanguageColorMode,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (mode === "single") storage.setItem(LANGUAGE_COLORS_KEY, mode);
    else storage.removeItem(LANGUAGE_COLORS_KEY);
  } catch {
    return;
  }
}

type Dependencies = {
  storage: PreferenceStorage;
  changes: Pick<
    typeof chrome.storage.onChanged,
    "addListener" | "removeListener"
  >;
};

export function subscribeLanguageColors(
  publish: (mode: LanguageColorMode) => void,
  dependencies: Dependencies = {
    storage: chrome.storage.sync,
    changes: chrome.storage.onChanged,
  },
): () => void {
  let disposed = false;
  let changed = false;
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (disposed || area !== "sync" || !(LANGUAGE_COLORS_KEY in changes))
      return;
    changed = true;
    publish(
      parseLanguageColors(changes[LANGUAGE_COLORS_KEY]?.newValue) ?? "language",
    );
  };
  dependencies.changes.addListener(listener);
  void languageColors.read(dependencies.storage).then((mode) => {
    if (!disposed && !changed) publish(mode);
  });
  return () => {
    disposed = true;
    dependencies.changes.removeListener(listener);
  };
}

export function followLanguageColors(): void {
  applyLanguageColors(readRememberedLanguageColors());
  subscribeLanguageColors((mode) => {
    applyLanguageColors(mode);
    rememberLanguageColors(mode);
  });
}
