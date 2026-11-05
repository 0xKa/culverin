import { expect, test } from "bun:test";
import { accent } from "../../extension/src/appearance/accent";
import { toolbarIconPaths } from "../../extension/src/appearance/icons";
import { colorScheme } from "../../extension/src/appearance/color-scheme";
import { theme } from "../../extension/src/appearance/theme";
import { createOffscreenManager } from "../../extension/src/background/offscreen";
import {
  followToolbarIcon,
  handleColorSchemeReport,
  probeColorScheme,
} from "../../extension/src/background/toolbar-icon";
import { deferred, event, settle } from "./support/events";

type Listener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

function fixture(
  initial: Record<string, unknown> = {},
  initialLocal: Record<string, unknown> = {},
) {
  const values = { ...initial };
  const localValues = { ...initialLocal };
  const probes: unknown[] = [];
  const probe = async () => {
    probes.push(true);
  };
  const calls: unknown[] = [];
  const changes = event<Listener>();
  const startup = event<() => void>();
  const installed = event<() => void>();
  const sync = {
    get: async () => ({ ...values }),
  };
  const local = {
    get: async () => ({ ...localValues }),
  };
  const action = {
    setIcon: async (details: unknown) => {
      calls.push(details);
    },
  };
  const browser = {
    storage: { sync, local, onChanged: changes },
    action,
    runtime: { onStartup: startup, onInstalled: installed },
  } as unknown as typeof chrome;
  return {
    browser,
    values,
    localValues,
    calls,
    changes,
    startup,
    installed,
    sync,
    local,
    action,
    probe,
    probes,
  };
}

test("restores the saved toolbar accent on worker start, browser startup, and installation", async () => {
  const api = fixture({ [accent.key]: "teal" });
  const stop = followToolbarIcon(api.browser, api.probe);
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("teal", "light") }]);
  api.values[accent.key] = "purple";
  api.startup.emit();
  await settle();
  expect(api.calls.at(-1)).toEqual({
    path: toolbarIconPaths("purple", "light"),
  });
  delete api.values[accent.key];
  api.installed.emit();
  await settle();
  expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("blue", "light") });
  expect(api.changes.listeners.size).toBe(1);
  stop();
  expect(api.changes.listeners.size).toBe(0);
  expect(api.startup.listeners.size).toBe(0);
  expect(api.installed.listeners.size).toBe(0);
});

test("newer accent changes win over a stale startup read", async () => {
  const reading = deferred<Record<string, unknown>>();
  const api = fixture();
  api.sync.get = () => reading.promise;
  const stop = followToolbarIcon(api.browser, api.probe);
  api.changes.emit({ [accent.key]: { newValue: "pink" } }, "sync");
  await settle();
  reading.resolve({ [accent.key]: "teal" });
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("pink", "light") }]);
  stop();
});

test("legacy accents restore and update the toolbar using the current Purple images", async () => {
  for (const oldValue of ["indigo", "violet"]) {
    const api = fixture({ [accent.key]: oldValue });
    const stop = followToolbarIcon(api.browser, api.probe);
    await settle();
    expect(api.calls).toEqual([{ path: toolbarIconPaths("purple", "light") }]);
    api.changes.emit({ [accent.key]: { newValue: oldValue } }, "sync");
    await settle();
    expect(api.calls.at(-1)).toEqual({
      path: toolbarIconPaths("purple", "light"),
    });
    stop();
  }
});

test("serializes icon updates and keeps only the latest pending choice", async () => {
  const pending = deferred<void>();
  const api = fixture({ [accent.key]: "teal" });
  api.action.setIcon = async (details) => {
    api.calls.push(details);
    if (api.calls.length === 1) await pending.promise;
  };
  const stop = followToolbarIcon(api.browser, api.probe);
  await settle();
  for (const newValue of ["copper", "pink", "slate"])
    api.changes.emit({ [accent.key]: { newValue } }, "sync");
  expect(api.calls).toHaveLength(1);
  pending.resolve();
  await settle();
  expect(api.calls).toEqual([
    { path: toolbarIconPaths("teal", "light") },
    { path: toolbarIconPaths("slate", "light") },
  ]);
  stop();
});

test("ignores unrelated storage changes and restores blue for deleted or invalid accents", async () => {
  const api = fixture({ [accent.key]: "purple" });
  const stop = followToolbarIcon(api.browser, api.probe);
  await settle();
  api.changes.emit({ [accent.key]: { newValue: "pink" } }, "local");
  api.changes.emit({ "culverin.unrelated": { newValue: "dark" } }, "sync");
  api.changes.emit({ [colorScheme.key]: { newValue: "dark" } }, "sync");
  await settle();
  expect(api.calls).toHaveLength(1);
  for (const change of [{}, { newValue: "unknown" }]) {
    api.changes.emit({ [accent.key]: change }, "sync");
    await settle();
    expect(api.calls.at(-1)).toEqual({
      path: toolbarIconPaths("blue", "light"),
    });
  }
  stop();
});

test("a failed icon update leaves later changes working", async () => {
  const api = fixture();
  api.action.setIcon = async (details) => {
    api.calls.push(details);
    if (api.calls.length === 1) throw new Error("unavailable");
  };
  const stop = followToolbarIcon(api.browser, api.probe);
  await settle();
  api.changes.emit({ [accent.key]: { newValue: "copper" } }, "sync");
  await settle();
  expect(api.calls).toEqual([
    { path: toolbarIconPaths("blue", "light") },
    { path: toolbarIconPaths("copper", "light") },
  ]);
  stop();
});

test("replacing a startup subscription discards its old read", async () => {
  const reading = deferred<Record<string, unknown>>();
  const api = fixture();
  api.sync.get = () => reading.promise;
  const stop = followToolbarIcon(api.browser, api.probe);
  api.sync.get = async () => ({ [accent.key]: "slate" });
  api.startup.emit();
  await settle();
  reading.resolve({ [accent.key]: "teal" });
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("slate", "light") }]);
  stop();
});

test("the icon shade follows the browser and ignores the Culverin theme", async () => {
  for (const [saved, shade] of [
    ["light", "dark"],
    ["dark", "light"],
  ] as const) {
    const api = fixture(
      { [theme.key]: saved, [accent.key]: "teal" },
      shade === "dark" ? { [colorScheme.key]: "dark" } : {},
    );
    const stop = followToolbarIcon(api.browser, api.probe);
    await settle();
    expect(api.calls).toEqual([{ path: toolbarIconPaths("teal", shade) }]);
    api.changes.emit({ [theme.key]: { newValue: shade } }, "sync");
    await settle();
    expect(api.calls).toHaveLength(1);
    stop();
  }
  const api = fixture({ [theme.key]: "dark", [accent.key]: "teal" });
  const stop = followToolbarIcon(api.browser, api.probe);
  await settle();
  api.changes.emit({ [colorScheme.key]: { newValue: "dark" } }, "local");
  await settle();
  expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("teal", "dark") });
  api.changes.emit({ [colorScheme.key]: {} }, "local");
  await settle();
  expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("teal", "light") });
  stop();
});

test("restores the saved browser color scheme and lets a newer report win over a stale read", async () => {
  const saved = fixture({}, { [colorScheme.key]: "dark" });
  const stopSaved = followToolbarIcon(saved.browser, saved.probe);
  await settle();
  expect(saved.calls).toEqual([{ path: toolbarIconPaths("blue", "dark") }]);
  stopSaved();

  const reading = deferred<Record<string, unknown>>();
  const api = fixture();
  api.local.get = () => reading.promise;
  const stop = followToolbarIcon(api.browser, api.probe);
  api.changes.emit({ [colorScheme.key]: { newValue: "dark" } }, "local");
  await settle();
  reading.resolve({});
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("blue", "dark") }]);
  stop();
});

test("asks for the browser color scheme on startup and installation, not on every worker start", async () => {
  const api = fixture();
  const stop = followToolbarIcon(api.browser, api.probe);
  await settle();
  expect(api.probes).toHaveLength(0);
  api.startup.emit();
  api.installed.emit();
  await settle();
  expect(api.probes).toHaveLength(2);
  stop();
});

test("a failed color scheme probe still restores the toolbar icon", async () => {
  const api = fixture({ [accent.key]: "pink" });
  const stop = followToolbarIcon(api.browser, async () => {
    throw new Error("unavailable");
  });
  api.startup.emit();
  await settle();
  expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("pink", "light") });
  stop();
});

function storage() {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: async () => ({ ...values }),
    set: async (items: Record<string, unknown>) => {
      Object.assign(values, items);
    },
    remove: async (key: string) => {
      delete values[key];
    },
  };
}

test("saves valid color scheme reports from this extension only", async () => {
  const local = storage();
  const browser = {
    runtime: { id: "self" },
    storage: { local },
  } as unknown as typeof chrome;
  const report = {
    target: "appearance.colorScheme",
    protocolVersion: 1,
    type: "colorScheme.report",
    scheme: "dark",
  };
  expect(handleColorSchemeReport(report, { id: "other" }, browser)).toBe(false);
  expect(
    handleColorSchemeReport({ type: "display.get" }, { id: "self" }, browser),
  ).toBe(false);
  await settle();
  expect(local.values).toEqual({});
  expect(
    handleColorSchemeReport(
      { ...report, scheme: "sepia" },
      { id: "self" },
      browser,
    ),
  ).toBe(true);
  await settle();
  expect(local.values).toEqual({});
  expect(handleColorSchemeReport(report, { id: "self" }, browser)).toBe(true);
  await settle();
  expect(local.values).toEqual({ [colorScheme.key]: "dark" });
  handleColorSchemeReport(
    { ...report, scheme: "light" },
    { id: "self" },
    browser,
  );
  await settle();
  expect(local.values).toEqual({});
});

test("the probe saves the offscreen answer and always releases the document", async () => {
  const local = storage();
  const events: string[] = [];
  let reply: Promise<unknown> = Promise.resolve({ scheme: "dark" });
  const browser = {
    runtime: { sendMessage: () => reply },
    storage: { local },
  } as unknown as typeof chrome;
  const lease = {
    ready: Promise.resolve(),
    release: () => events.push("release"),
  };
  const manager = {
    acquire: () => {
      events.push("acquire");
      return lease;
    },
  } as unknown as ReturnType<typeof createOffscreenManager>;
  await probeColorScheme(browser, manager);
  expect(local.values).toEqual({ [colorScheme.key]: "dark" });
  expect(events).toEqual(["acquire", "release"]);
  reply = Promise.reject(new Error("no receiver"));
  await expect(probeColorScheme(browser, manager)).rejects.toThrow();
  expect(events).toEqual(["acquire", "release", "acquire", "release"]);
  expect(local.values).toEqual({ [colorScheme.key]: "dark" });
});
