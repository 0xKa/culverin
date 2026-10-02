import { afterEach, expect, jest, test } from "bun:test";
import { createOffscreenManager } from "../../extension/src/background/offscreen";
import { deferred, settle } from "./support/events";
afterEach(() => jest.useRealTimers());

function manager() {
  let exists = false;
  let creates = 0;
  let closes = 0;
  let busy = false;
  const dependencies = {
    exists: async () => exists,
    create: async () => {
      creates++;
      exists = true;
    },
    close: async () => {
      closes++;
      exists = false;
    },
    idle: async () => !busy,
  };
  return {
    dependencies,
    create: () => createOffscreenManager(dependencies),
    creates: () => creates,
    closes: () => closes,
    busy: (value: boolean) => {
      busy = value;
    },
  };
}

test("concurrent clients share setup and keep the document until every owner releases", async () => {
  jest.useFakeTimers();
  const api = manager();
  const service = api.create();
  const archive = service.acquire();
  const fixture = service.acquire();
  await Promise.all([archive.ready, fixture.ready]);
  expect(api.creates()).toBe(1);
  archive.release();
  archive.release();
  jest.advanceTimersByTime(1000);
  await settle();
  expect(api.closes()).toBe(0);
  fixture.release();
  jest.advanceTimersByTime(1000);
  await settle();
  expect(api.closes()).toBe(1);
  expect(service.active()).toBe(false);
});

test("setup failure is shared, releasing canceled setup permits a clean retry", async () => {
  jest.useFakeTimers();
  const api = manager();
  const created = deferred<void>();
  const original = api.dependencies.create;
  api.dependencies.create = () => created.promise;
  const service = api.create();
  const first = service.acquire();
  const second = service.acquire();
  first.release();
  created.reject(new Error("Creation failed"));
  await expect(first.ready).rejects.toThrow("Creation failed");
  await expect(second.ready).rejects.toThrow("Creation failed");
  second.release();
  api.dependencies.create = original;
  const retry = service.acquire();
  await retry.ready;
  expect(api.creates()).toBe(1);
  retry.release();
  jest.advanceTimersByTime(1000);
  await settle();
  expect(service.active()).toBe(false);
});

test("acquisition invalidates a pending idle check and waits for an issued close", async () => {
  jest.useFakeTimers();
  const api = manager();
  const status = deferred<boolean>();
  api.dependencies.idle = () => status.promise;
  const service = api.create();
  const first = service.acquire();
  await first.ready;
  first.release();
  jest.advanceTimersByTime(1000);
  await settle();
  const next = service.acquire();
  await next.ready;
  status.resolve(true);
  await settle();
  expect(api.closes()).toBe(0);
  const close = deferred<void>();
  const original = api.dependencies.close;
  api.dependencies.close = async () => {
    await close.promise;
    await original();
  };
  next.release();
  jest.advanceTimersByTime(1000);
  await settle();
  const during = service.acquire();
  let ready = false;
  void during.ready.then(() => {
    ready = true;
  });
  await settle();
  expect(ready).toBe(false);
  close.resolve();
  await during.ready;
  expect(api.creates()).toBe(2);
  during.release();
  jest.advanceTimersByTime(1000);
  await settle();
});

test("host busy state defers closing and a failed close does not poison new acquisition", async () => {
  jest.useFakeTimers();
  const api = manager();
  const service = api.create();
  const first = service.acquire();
  await first.ready;
  api.busy(true);
  first.release();
  jest.advanceTimersByTime(1000);
  await settle();
  expect(api.closes()).toBe(0);
  api.busy(false);
  api.dependencies.close = async () => {
    throw new Error("Close failed");
  };
  jest.advanceTimersByTime(1000);
  await settle();
  const next = service.acquire();
  await next.ready;
  expect(api.creates()).toBe(1);
  next.release();
  jest.advanceTimersByTime(1000);
  await settle();
  expect(service.active()).toBe(false);
});
