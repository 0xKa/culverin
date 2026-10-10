import { definePreference } from "../preferences/define";

export const HIGH_CONTRAST_KEY = "culverin.highContrast";

export function parseHighContrast(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export const highContrast = definePreference<boolean>({
  key: HIGH_CONTRAST_KEY,
  fallback: false,
  parse: parseHighContrast,
  isDefault: (value) => !value,
});

export function applyHighContrast(
  enabled: boolean,
  root: { dataset: DOMStringMap } = document.documentElement,
): void {
  if (enabled) root.dataset.contrast = "high";
  else delete root.dataset.contrast;
}

export function readRememberedHighContrast(
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  try {
    return storage.getItem(HIGH_CONTRAST_KEY) === "true";
  } catch {
    return false;
  }
}

export function rememberHighContrast(
  enabled: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (enabled) storage.setItem(HIGH_CONTRAST_KEY, "true");
    else storage.removeItem(HIGH_CONTRAST_KEY);
  } catch {
    return;
  }
}

export function followHighContrast(): void {
  const show = (enabled: boolean) => {
    applyHighContrast(enabled);
    rememberHighContrast(enabled);
  };
  applyHighContrast(readRememberedHighContrast());
  let changed = false;
  chrome.storage.sync.onChanged.addListener((changes) => {
    if (HIGH_CONTRAST_KEY in changes) {
      changed = true;
      show(parseHighContrast(changes[HIGH_CONTRAST_KEY]?.newValue) ?? false);
    }
  });
  void highContrast.read().then((enabled) => {
    if (!changed) show(enabled);
  });
}
