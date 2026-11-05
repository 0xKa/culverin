import { accent, type Accent } from "../appearance/accent";
import {
  COLOR_SCHEME_TARGET,
  colorScheme,
  parseColorScheme,
  type ColorScheme,
} from "../appearance/color-scheme";
import { toolbarIconPaths } from "../appearance/icons";
import { parseTheme, theme, type Theme } from "../appearance/theme";
import { offscreen } from "./offscreen";

type Appearance = { accent: Accent; theme: Theme; scheme: ColorScheme };

export function handleColorSchemeReport(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  browser = chrome,
): boolean {
  const report = message as Record<string, unknown> | null;
  if (
    sender.id !== browser.runtime.id ||
    report?.target !== COLOR_SCHEME_TARGET ||
    report.type !== "colorScheme.report"
  )
    return false;
  const scheme = parseColorScheme(report.scheme);
  if (scheme)
    void colorScheme
      .write(scheme, browser.storage.local)
      .catch(() => undefined);
  return true;
}

export async function probeColorScheme(
  browser: typeof chrome = chrome,
  manager = offscreen,
): Promise<void> {
  const lease = manager.acquire();
  try {
    await lease.ready;
    const reply = (await browser.runtime.sendMessage({
      target: COLOR_SCHEME_TARGET,
      protocolVersion: 1,
      type: "colorScheme.read",
    })) as { scheme?: unknown } | undefined;
    const scheme = parseColorScheme(reply?.scheme);
    if (scheme) await colorScheme.write(scheme, browser.storage.local);
  } finally {
    lease.release();
  }
}

export function followToolbarIcon(
  browser = chrome,
  probe: () => Promise<void> = () => probeColorScheme(browser),
): () => void {
  let disposed = false;
  let updating = false;
  let next: Record<string, string> | undefined;
  let state: Appearance | undefined;
  let pending: Partial<Appearance> | undefined;

  async function update(): Promise<void> {
    if (updating || disposed) return;
    updating = true;
    try {
      while (next !== undefined && !disposed) {
        const path = next;
        next = undefined;
        await browser.action.setIcon({ path }).catch(() => undefined);
      }
    } finally {
      updating = false;
    }
  }

  function show(): void {
    if (!state) return;
    next = toolbarIconPaths(
      state.accent,
      state.theme === "system" ? state.scheme : state.theme,
    );
    void update();
  }

  const changed = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ): void => {
    const update: Partial<Appearance> = {};
    if (area === "sync") {
      if (accent.key in changes)
        update.accent =
          accent.parse(changes[accent.key]?.newValue) ?? accent.fallback;
      if (theme.key in changes)
        update.theme =
          parseTheme(changes[theme.key]?.newValue) ?? theme.fallback;
    } else if (area === "local" && colorScheme.key in changes) {
      update.scheme =
        parseColorScheme(changes[colorScheme.key]?.newValue) ??
        colorScheme.fallback;
    }
    if (!Object.keys(update).length) return;
    if (pending) Object.assign(pending, update);
    if (state) {
      state = { ...state, ...update };
      show();
    }
  };

  function refresh(): void {
    const overrides: Partial<Appearance> = {};
    pending = overrides;
    void Promise.all([
      accent.read(browser.storage.sync),
      theme.read(browser.storage.sync),
      colorScheme.read(browser.storage.local),
    ]).then(([savedAccent, savedTheme, savedScheme]) => {
      if (disposed || pending !== overrides) return;
      pending = undefined;
      state = {
        accent: savedAccent,
        theme: savedTheme,
        scheme: savedScheme,
        ...overrides,
      };
      show();
    });
  }

  function restart(): void {
    refresh();
    void probe().catch(() => undefined);
  }

  browser.storage.onChanged.addListener(changed);
  browser.runtime.onStartup.addListener(restart);
  browser.runtime.onInstalled.addListener(restart);
  refresh();
  return () => {
    disposed = true;
    next = undefined;
    browser.storage.onChanged.removeListener(changed);
    browser.runtime.onStartup.removeListener(restart);
    browser.runtime.onInstalled.removeListener(restart);
  };
}
