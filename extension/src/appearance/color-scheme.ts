import { definePreference } from "../preferences/define";

export type ColorScheme = "light" | "dark";

export const COLOR_SCHEME_TARGET = "appearance.colorScheme";

const QUERY = "(prefers-color-scheme: dark)";

export function parseColorScheme(value: unknown): ColorScheme | undefined {
  return value === "light" || value === "dark" ? value : undefined;
}

export const colorScheme = definePreference<ColorScheme>({
  key: "culverin.colorScheme",
  fallback: "light",
  parse: parseColorScheme,
  isDefault: (value) => value === "light",
});

function current(media: MediaQueryList): ColorScheme {
  return media.matches ? "dark" : "light";
}

function report(scheme: ColorScheme): void {
  try {
    void chrome.runtime
      .sendMessage({
        target: COLOR_SCHEME_TARGET,
        protocolVersion: 1,
        type: "colorScheme.report",
        scheme,
      })
      .catch(() => undefined);
  } catch {
    return;
  }
}

export function followColorScheme({
  immediately,
}: {
  immediately: boolean;
}): void {
  const media = matchMedia(QUERY);
  if (immediately) report(current(media));
  media.addEventListener("change", () => report(current(media)));
}

export function answerColorSchemeReads(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    const request = message as Record<string, unknown> | null;
    if (
      sender.id !== chrome.runtime.id ||
      sender.url !== chrome.runtime.getURL("background.js") ||
      request?.target !== COLOR_SCHEME_TARGET ||
      request.type !== "colorScheme.read"
    )
      return false;
    respond({ scheme: current(matchMedia(QUERY)) });
    return false;
  });
}
