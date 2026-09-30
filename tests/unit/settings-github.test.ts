import { expect, test } from "bun:test";
import {
  authFailure,
  connectionSummary,
  connectionView,
} from "../../extension/src/settings/github";

test("describes the GitHub connection", () => {
  const app = connectionView({
    state: "ok",
    connected: true,
    method: "app",
    login: "octo",
    expired: false,
  });
  expect(app && connectionSummary(app)).toBe(
    "Connected as @octo with the Culverin GitHub App.",
  );
  const token = connectionView({
    connected: true,
    method: "token",
    login: "octo",
    expired: false,
  });
  expect(token && connectionSummary(token)).toBe(
    "Connected as @octo with a personal access token.",
  );
  const expired = connectionView({
    connected: false,
    method: "app",
    login: "octo",
    expired: true,
  });
  expect(expired && connectionSummary(expired)).toContain("expired");
  const none = connectionView({ connected: false, expired: false });
  expect(none && connectionSummary(none)).toBe(
    "Not connected. Culverin counts public repositories only.",
  );
  expect(connectionView({ state: "failed" })).toBeUndefined();
});

test("shows only a well-formed device code", () => {
  const device = {
    userCode: "WDJB-MJHT",
    verificationUri: "https://github.com/login/device",
    expiresAt: 1000,
    interval: 5,
  };
  expect(
    connectionView({ connected: false, expired: false, device })?.device,
  ).toEqual(device);
  expect(
    connectionView({
      connected: false,
      expired: false,
      device: { ...device, verificationUri: "https://example.com/login" },
    })?.device,
  ).toBeUndefined();
  expect(
    connectionView({
      connected: false,
      expired: false,
      device: { ...device, userCode: "<b>no</b>" },
    })?.device,
  ).toBeUndefined();
});

test("explains connection failures", () => {
  expect(authFailure(undefined)).toBe("Extension unavailable. Try again.");
  expect(authFailure({ state: "device-expired" })).toContain("expired");
  expect(authFailure({ state: "device-denied" })).toContain("declined");
  expect(
    authFailure({ state: "failed", code: "authentication_invalid" }),
  ).toContain("didn't accept that token");
  expect(authFailure({ state: "failed", code: "rate_limited" })).toBe(
    "GitHub rate limit reached.",
  );
  expect(authFailure({ state: "failed", code: "unknown" })).toBe(
    "Couldn't connect to GitHub. Try again.",
  );
});
