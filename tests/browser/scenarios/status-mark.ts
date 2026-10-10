import assert from "node:assert/strict";
import type { createBrowserSession } from "../support/session";

type MotionScope = typeof globalThis & {
  releaseSave?: () => Promise<void>;
  spin?: Animation;
};

export async function runStatusMarkMotion({
  context,
}: Awaited<ReturnType<typeof createBrowserSession>>) {
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  const page = await context.newPage();
  try {
    await page.goto(
      `chrome-extension://${new URL(worker.url()).host}/settings.html#appearance`,
    );
    await page.locator('input[name="theme"]:checked').waitFor();

    async function holdSave(failed = false) {
      await page.evaluate((failed) => {
        const scope = globalThis as MotionScope;
        const sync = chrome.storage.sync;
        const original = sync.set.bind(sync);
        sync.set = ((items: Record<string, unknown>) =>
          new Promise<void>((resolve, reject) => {
            scope.releaseSave = async () => {
              scope.releaseSave = undefined;
              sync.set = original;
              if (failed) reject(new Error("Save failed"));
              else {
                await original(items);
                resolve();
              }
            };
          })) as typeof sync.set;
      }, failed);
    }

    for (const [theme, failed] of [
      ["light", false],
      ["dark", true],
      ["dark", false],
    ] as const) {
      await holdSave(failed);
      await page.locator(`input[name="theme"][value="${theme}"]`).click();
      await page.locator('#appearance-status-mark[data-mark="busy"]').waitFor();

      const startedAt = await page.evaluate(() => {
        const ring = document.querySelector(
          "#appearance-status-mark .status-ring",
        )!;
        const spin = ring
          .getAnimations()
          .find(
            (animation) =>
              animation instanceof CSSAnimation &&
              animation.animationName === "status-spin",
          )!;
        spin.currentTime = 5775;
        (globalThis as MotionScope).spin = spin;
        return Number(spin.currentTime);
      });
      await page.evaluate(() => (globalThis as MotionScope).releaseSave?.());
      await page
        .locator(
          `#appearance-status-mark[data-mark="${failed ? "failed" : "done"}"]`,
        )
        .waitFor();

      const stopped = await page.evaluate(async () => {
        const ring = document.querySelector(
          "#appearance-status-mark .status-ring",
        )!;
        const spin = (globalThis as MotionScope).spin!;
        const time = Number(spin.currentTime);
        const rotation = getComputedStyle(ring).rotate;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
        return {
          sameAnimation: ring.getAnimations().includes(spin),
          state: spin.playState,
          time,
          laterTime: Number(spin.currentTime),
          rotation,
          laterRotation: getComputedStyle(ring).rotate,
        };
      });
      assert.equal(stopped.sameAnimation, true);
      assert.equal(stopped.state, "paused");
      assert.ok(stopped.time >= startedAt);
      assert.equal(stopped.laterTime, stopped.time);
      assert.notEqual(stopped.rotation, "none");
      assert.equal(stopped.laterRotation, stopped.rotation);

      await page.waitForFunction(() => {
        const ring = document.querySelector(
          "#appearance-status-mark .status-ring",
        )!;
        const style = getComputedStyle(ring);
        return (
          style.strokeDasharray === "24px, 0px" && style.fillOpacity === "0.16"
        );
      });
      if (failed)
        await page
          .locator('input[name="theme"][value="light"]:checked')
          .waitFor();
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    await holdSave();
    await page.locator('input[name="theme"][value="light"]').click();
    await page.locator('#appearance-status-mark[data-mark="busy"]').waitFor();
    const ring = page.locator("#appearance-status-mark .status-ring");
    assert.equal(
      await ring.evaluate((element) => getComputedStyle(element).animationName),
      "none",
    );
    await page.evaluate(() => (globalThis as MotionScope).releaseSave?.());
    await page.locator('#appearance-status-mark[data-mark="done"]').waitFor();
    assert.equal(
      await ring.evaluate((element) => getComputedStyle(element).animationName),
      "none",
    );
    assert.equal(
      await ring.evaluate(
        (element) => getComputedStyle(element).transitionDuration,
      ),
      "0s",
    );
  } finally {
    await page.evaluate(async () => {
      await (globalThis as MotionScope).releaseSave?.();
      await chrome.storage.sync.remove("culverin.theme");
    });
    await page.close();
  }
}
