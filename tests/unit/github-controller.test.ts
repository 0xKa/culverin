import { afterEach, expect, jest, test } from "bun:test";
import { createGitHubController } from "../../extension/src/settings/github-controller";
import type {
  SettingsCommand,
  SettingsPayload,
  SettingsReply,
} from "../../extension/src/protocol/settings";
import { pendingKey } from "../../extension/src/auth/pending";
import { deferred, settle } from "./support/events";

const reply = (payload: SettingsPayload): SettingsReply => ({
  protocolVersion: 1,
  requestId: crypto.randomUUID(),
  navigationId: crypto.randomUUID(),
  ...payload,
});
const status = () =>
  reply({
    state: "ok",
    connected: false,
    expired: false,
    generation: crypto.randomUUID(),
  });
const device = () =>
  reply({
    state: "ok",
    connected: false,
    expired: false,
    generation: crypto.randomUUID(),
    device: {
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      expiresAt: Date.now() + 60000,
      interval: 1,
    },
  });
const connected = () =>
  reply({
    state: "connected",
    connected: true,
    expired: false,
    generation: crypto.randomUUID(),
    method: "token",
    login: "octo",
  });
afterEach(() => jest.useRealTimers());
function controller(
  send: (command: SettingsCommand) => Promise<SettingsReply | undefined>,
) {
  const events: unknown[] = [];
  const stored: Record<string, unknown>[] = [];
  const current = createGitHubController(
    {
      view: (value) => events.push(value),
      status: (value) => events.push(value),
      busy: (value) => events.push(value),
      tokenCleared: () => events.push("token cleared"),
    },
    {
      send,
      storage: {
        set: async (value: Record<string, unknown>) => {
          stored.push(value);
        },
      } as Pick<chrome.storage.StorageArea, "set">,
    },
  );
  return { current, events, stored };
}

test("disposed initialization and start replies cannot publish into another instance or restart polling", async () => {
  jest.useFakeTimers();
  const initial = deferred<SettingsReply>();
  const first = controller(() => initial.promise);
  first.current.start();
  first.current.dispose();
  first.current.dispose();
  const second = controller(async () => status());
  second.current.start();
  initial.resolve(device());
  await settle();
  expect(first.events).toEqual([]);
  expect(second.events).toHaveLength(1);
  expect(jest.getTimerCount()).toBe(0);
  second.current.dispose();
});

test("cancel invalidates a pending device start and poll response", async () => {
  jest.useFakeTimers();
  const started = deferred<SettingsReply>();
  const polled = deferred<SettingsReply>();
  let delayed = true;
  const commands: string[] = [];
  const ui = controller((command) => {
    commands.push(command.type);
    if (command.type === "auth.device.start")
      return delayed ? started.promise : Promise.resolve(device());
    if (command.type === "auth.device.poll") return polled.promise;
    return Promise.resolve(status());
  });
  const start = ui.current.connect();
  await ui.current.cancel();
  const count = ui.events.length;
  started.resolve(device());
  await start;
  expect(ui.events).toHaveLength(count);
  expect(jest.getTimerCount()).toBe(0);
  delayed = false;
  await ui.current.connect();
  jest.advanceTimersByTime(1000);
  await ui.current.cancel();
  const canceled = ui.events.length;
  polled.resolve(reply({ state: "pending", retryIn: 5000 }));
  await settle();
  jest.advanceTimersByTime(10000);
  expect(ui.events).toHaveLength(canceled);
  expect(commands.filter((type) => type === "auth.device.poll")).toHaveLength(
    1,
  );
  ui.current.dispose();
});

test("polling retries network failures, reports expiry, and token submission carries only an ID", async () => {
  jest.useFakeTimers();
  const commands: SettingsCommand[] = [];
  let polls = 0;
  const ui = controller(async (command) => {
    commands.push(command);
    if (command.type === "auth.device.start") return device();
    if (command.type === "auth.device.poll")
      return reply(
        ++polls === 1
          ? { state: "failed", code: "network_unavailable" }
          : { state: "device-expired" },
      );
    if (command.type === "auth.submit") return connected();
    return status();
  });
  await ui.current.connect();
  jest.advanceTimersByTime(1000);
  await settle();
  jest.advanceTimersByTime(10000);
  await settle();
  expect(
    ui.events.some(
      (value) => typeof value === "string" && value.includes("code expired"),
    ),
  ).toBe(true);
  await ui.current.saveToken(" fixture-token ");
  const submission = commands.at(-1)!;
  expect(submission).toEqual({
    type: "auth.submit",
    submissionId: expect.any(String),
  });
  expect(ui.stored.at(-1)?.[pendingKey]).toMatchObject({
    token: "fixture-token",
    submissionId:
      "submissionId" in submission ? submission.submissionId : undefined,
  });
  expect(ui.events).toContain("token cleared");
  ui.current.dispose();
  expect(jest.getTimerCount()).toBe(0);
});
