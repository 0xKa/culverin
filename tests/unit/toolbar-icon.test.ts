import { expect, test } from "bun:test";
import { accent } from "../../extension/src/appearance/accent";
import { toolbarIconPaths } from "../../extension/src/appearance/icons";
import { followToolbarAccent } from "../../extension/src/background/toolbar-icon";
import { deferred, event, settle } from "./support/events";

type Listener = (
  changes: Record<string, chrome.storage.StorageChange>,
  area: string,
) => void;

function fixture(initial: Record<string, unknown> = {}) {
  const values = { ...initial };
  const calls: unknown[] = [];
  const changes = event<Listener>();
  const startup = event<() => void>();
  const installed = event<() => void>();
  const sync = {
    get: async () => ({ ...values }),
  };
  const action = {
    setIcon: async (details: unknown) => {
      calls.push(details);
    },
  };
  const browser = {
    storage: { sync, onChanged: changes },
    action,
    runtime: { onStartup: startup, onInstalled: installed },
  } as unknown as typeof chrome;
  return { browser, values, calls, changes, startup, installed, sync, action };
}

test("restores the saved toolbar accent on worker start, browser startup, and installation", async () => {
  const api = fixture({ [accent.key]: "teal" });
  const stop = followToolbarAccent(api.browser);
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("teal") }]);
  api.values[accent.key] = "purple";
  api.startup.emit();
  await settle();
  expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("purple") });
  delete api.values[accent.key];
  api.installed.emit();
  await settle();
  expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("blue") });
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
  const stop = followToolbarAccent(api.browser);
  api.changes.emit({ [accent.key]: { newValue: "pink" } }, "sync");
  await settle();
  reading.resolve({ [accent.key]: "teal" });
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("pink") }]);
  stop();
});

test("legacy accents restore and update the toolbar using the current Purple images", async () => {
  for (const oldValue of ["indigo", "violet"]) {
    const api = fixture({ [accent.key]: oldValue });
    const stop = followToolbarAccent(api.browser);
    await settle();
    expect(api.calls).toEqual([{ path: toolbarIconPaths("purple") }]);
    api.changes.emit({ [accent.key]: { newValue: oldValue } }, "sync");
    await settle();
    expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("purple") });
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
  const stop = followToolbarAccent(api.browser);
  await settle();
  for (const newValue of ["copper", "pink", "slate"])
    api.changes.emit({ [accent.key]: { newValue } }, "sync");
  expect(api.calls).toHaveLength(1);
  pending.resolve();
  await settle();
  expect(api.calls).toEqual([
    { path: toolbarIconPaths("teal") },
    { path: toolbarIconPaths("slate") },
  ]);
  stop();
});

test("ignores unrelated storage changes and restores blue for deleted or invalid accents", async () => {
  const api = fixture({ [accent.key]: "purple" });
  const stop = followToolbarAccent(api.browser);
  await settle();
  api.changes.emit({ [accent.key]: { newValue: "pink" } }, "local");
  api.changes.emit({ "culverin.theme": { newValue: "dark" } }, "sync");
  await settle();
  expect(api.calls).toHaveLength(1);
  for (const change of [{}, { newValue: "unknown" }]) {
    api.changes.emit({ [accent.key]: change }, "sync");
    await settle();
    expect(api.calls.at(-1)).toEqual({ path: toolbarIconPaths("blue") });
  }
  stop();
});

test("a failed icon update leaves later changes working", async () => {
  const api = fixture();
  api.action.setIcon = async (details) => {
    api.calls.push(details);
    if (api.calls.length === 1) throw new Error("unavailable");
  };
  const stop = followToolbarAccent(api.browser);
  await settle();
  api.changes.emit({ [accent.key]: { newValue: "copper" } }, "sync");
  await settle();
  expect(api.calls).toEqual([
    { path: toolbarIconPaths("blue") },
    { path: toolbarIconPaths("copper") },
  ]);
  stop();
});

test("replacing a startup subscription discards its old read", async () => {
  const reading = deferred<Record<string, unknown>>();
  const api = fixture();
  api.sync.get = () => reading.promise;
  const stop = followToolbarAccent(api.browser);
  api.sync.get = async () => ({ [accent.key]: "slate" });
  api.startup.emit();
  await settle();
  reading.resolve({ [accent.key]: "teal" });
  await settle();
  expect(api.calls).toEqual([{ path: toolbarIconPaths("slate") }]);
  stop();
});
