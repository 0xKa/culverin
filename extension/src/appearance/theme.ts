import { definePreference } from "../preferences/define";

export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_KEY = "culverin.theme";

export function parseTheme(value: unknown): Theme | undefined {
  return THEMES.includes(value as Theme) ? (value as Theme) : undefined;
}

export const theme = definePreference<Theme>({
  key: THEME_KEY,
  fallback: "system",
  parse: parseTheme,
  isDefault: (value) => value === "system",
});

export function applyTheme(
  value: Theme,
  root: { dataset: DOMStringMap } = document.documentElement,
): void {
  if (value === "system") delete root.dataset.theme;
  else root.dataset.theme = value;
}

export function readRememberedTheme(
  storage: Pick<Storage, "getItem"> = localStorage,
): Theme {
  try {
    return parseTheme(storage.getItem(THEME_KEY)) ?? "system";
  } catch {
    return "system";
  }
}

export function rememberTheme(
  value: Theme,
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
): void {
  try {
    if (value === "system") storage.removeItem(THEME_KEY);
    else storage.setItem(THEME_KEY, value);
  } catch {
    return;
  }
}

export function followTheme(): void {
  const show = (value: Theme) => {
    applyTheme(value);
    rememberTheme(value);
  };
  applyTheme(readRememberedTheme());
  chrome.storage.sync.onChanged.addListener((changes) => {
    if (THEME_KEY in changes)
      show(parseTheme(changes[THEME_KEY]?.newValue) ?? "system");
  });
  void theme.read().then(show);
}
