import { failureMessages } from "../github/failure-messages";
import type { PublicErrorCode } from "../github/public-protocol";

export type DeviceView = {
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
};

export type ConnectionView = {
  connected: boolean;
  method?: "app" | "token";
  login?: string;
  expired: boolean;
  device?: DeviceView;
};

export type AuthReply = {
  state?: import("../protocol/settings").SettingsPayload["state"];
  code?: string;
  retryIn?: number;
} & Partial<ConnectionView>;

const loginPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

function validDevice(value: unknown): value is DeviceView {
  if (!value || typeof value !== "object") return false;
  const device = value as Record<string, unknown>;
  return (
    typeof device.userCode === "string" &&
    /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(device.userCode) &&
    device.verificationUri === "https://github.com/login/device" &&
    Number.isSafeInteger(device.expiresAt) &&
    Number.isSafeInteger(device.interval)
  );
}

export function connectionView(
  reply: AuthReply | undefined,
): ConnectionView | undefined {
  if (!reply || typeof reply.connected !== "boolean") return undefined;
  const login =
    typeof reply.login === "string" && loginPattern.test(reply.login)
      ? reply.login
      : undefined;
  const method =
    reply.method === "app" || reply.method === "token"
      ? reply.method
      : undefined;
  return {
    connected: reply.connected,
    expired: reply.expired === true,
    ...(login && method ? { login, method } : {}),
    ...(validDevice(reply.device) ? { device: reply.device } : {}),
  };
}

export function connectionSummary(view: ConnectionView): string {
  const via =
    view.method === "app"
      ? "the Culverin GitHub App"
      : "a personal access token";
  if (view.connected && view.login)
    return `Connected as @${view.login} with ${via}.`;
  if (view.expired && view.login)
    return `Your GitHub connection for @${view.login} expired or was revoked. Connect again to count private repositories.`;
  return "Not connected. Culverin counts public repositories only.";
}

export function authFailure(reply: AuthReply | undefined): string {
  if (!reply) return "Extension unavailable. Try again.";
  if (reply.state === "device-expired")
    return "The code expired before it was approved. Select Connect with GitHub to get a new code.";
  if (reply.state === "device-denied")
    return "The request was declined on GitHub. Select Connect with GitHub to try again.";
  if (reply.state === "stale")
    return "Your GitHub connection changed while connecting. Try again.";
  if (reply.code === "authentication_invalid")
    return "GitHub didn't accept that token. Check that it's complete and hasn't expired.";
  return reply.code && reply.code in failureMessages
    ? failureMessages[reply.code as PublicErrorCode]
    : "Couldn't connect to GitHub. Try again.";
}
