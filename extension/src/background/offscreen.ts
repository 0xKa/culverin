type Dependencies = {
  exists: () => Promise<boolean>;
  create: () => Promise<void>;
  close: () => Promise<void>;
  idle: () => Promise<boolean>;
};
export function createOffscreenManager(dependencies: Dependencies) {
  let owners = 0;
  let epoch = 0;
  let creating: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function schedule(): void {
    clearTimeout(timer);
    if (owners) return;
    const expected = epoch;
    timer = setTimeout(() => {
      timer = undefined;
      void closeIdle(expected).catch(() => undefined);
    }, 1000);
  }
  async function ensure(): Promise<void> {
    if (closing) await closing.catch(() => undefined);
    creating ??= (async () => {
      if (!(await dependencies.exists())) await dependencies.create();
    })().finally(() => {
      creating = undefined;
      if (!owners) schedule();
    });
    await creating;
  }
  async function closeIdle(expected: number): Promise<void> {
    if (creating) await creating.catch(() => undefined);
    if (
      owners ||
      epoch !== expected ||
      closing ||
      !(await dependencies.exists())
    )
      return;
    const idle = await dependencies.idle();
    if (owners || epoch !== expected || closing) return;
    if (!idle) {
      schedule();
      return;
    }
    closing = dependencies.close().finally(() => {
      closing = undefined;
    });
    await closing;
  }
  function acquire() {
    owners++;
    epoch++;
    clearTimeout(timer);
    timer = undefined;
    let released = false;
    const ready = ensure();
    void ready.catch(() => undefined);
    return {
      ready,
      release: () => {
        if (released) return;
        released = true;
        owners--;
        if (!owners) schedule();
      },
    };
  }
  return { acquire, exists: dependencies.exists, active: () => owners > 0 };
}

export const offscreen = createOffscreenManager({
  exists: async () =>
    (
      await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [chrome.runtime.getURL("offscreen.html")],
      })
    ).length > 0,
  create: () =>
    chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification:
        "Analyze bounded local inputs in packaged terminable workers",
    }),
  close: () => chrome.offscreen.closeDocument(),
  idle: async () =>
    (
      await chrome.runtime.sendMessage({
        target: "archive.host",
        protocolVersion: 1,
        type: "archive.status",
      })
    )?.state === "idle",
});
