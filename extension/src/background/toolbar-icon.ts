import { accent, type Accent } from "../appearance/accent";
import { toolbarIconPaths } from "../appearance/icons";

export function followToolbarAccent(browser = chrome): () => void {
  let disposed = false;
  let updating = false;
  let next: Accent | undefined;
  let unsubscribe: (() => void) | undefined;

  async function update(): Promise<void> {
    if (updating || disposed) return;
    updating = true;
    try {
      while (next !== undefined && !disposed) {
        const value = next;
        next = undefined;
        await browser.action
          .setIcon({ path: toolbarIconPaths(value) })
          .catch(() => undefined);
      }
    } finally {
      updating = false;
    }
  }

  function refresh(): void {
    unsubscribe?.();
    unsubscribe = accent.subscribe(
      (value) => {
        next = value;
        void update();
      },
      {
        storage: browser.storage.sync,
        changes: browser.storage.onChanged,
      },
    );
  }

  browser.runtime.onStartup.addListener(refresh);
  browser.runtime.onInstalled.addListener(refresh);
  refresh();
  return () => {
    disposed = true;
    next = undefined;
    unsubscribe?.();
    browser.runtime.onStartup.removeListener(refresh);
    browser.runtime.onInstalled.removeListener(refresh);
  };
}
