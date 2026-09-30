import {
  AcquisitionError,
  boundedJson,
  trustedOrigin,
  type Fetcher,
} from "../github/client";
import { CLIENT_ID, DEVICE_URL } from "./github-app";
import { validToken } from "./pending";

const CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

export type DeviceCode = {
  deviceCode: string;
  userCode: string;
  expiresAt: number;
  interval: number;
};

export type Grant = {
  token: string;
  expiresAt?: number;
  refreshToken?: string;
  refreshExpiresAt?: number;
};

export type PollResult =
  | { state: "pending"; interval?: number }
  | { state: "granted"; grant: Grant }
  | { state: "expired" }
  | { state: "denied" };

export class GrantRejected extends Error {
  constructor() {
    super("grant_rejected");
  }
}

const seconds = (value: unknown, max: number): number | undefined =>
  Number.isSafeInteger(value) &&
  (value as number) > 0 &&
  (value as number) <= max
    ? (value as number)
    : undefined;

async function post(
  fetcher: Fetcher,
  url: string,
  body: Record<string, string>,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetcher(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal,
  });
  if (!trustedOrigin(response, "https://github.com")) {
    await response.body?.cancel().catch(() => undefined);
    throw new AcquisitionError("network_unavailable");
  }
  if (response.status === 429 || response.status >= 500) {
    await response.body?.cancel().catch(() => undefined);
    throw new AcquisitionError("network_unavailable");
  }
  const value = await boundedJson(response);
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new AcquisitionError("network_unavailable");
  return value as Record<string, unknown>;
}

function grant(value: Record<string, unknown>, now: number): Grant | undefined {
  if (!validToken(value.access_token)) return undefined;
  if (typeof value.token_type === "string" && value.token_type !== "bearer")
    return undefined;
  const expiresIn = seconds(value.expires_in, 366 * 24 * 60 * 60);
  const refreshIn = seconds(value.refresh_token_expires_in, 366 * 24 * 60 * 60);
  if (value.refresh_token !== undefined && !validToken(value.refresh_token))
    return undefined;
  return {
    token: value.access_token,
    ...(expiresIn ? { expiresAt: now + expiresIn * 1000 } : {}),
    ...(validToken(value.refresh_token)
      ? {
          refreshToken: value.refresh_token,
          ...(refreshIn ? { refreshExpiresAt: now + refreshIn * 1000 } : {}),
        }
      : {}),
  };
}

export async function requestDeviceCode(
  fetcher: Fetcher,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<DeviceCode> {
  const value = await post(fetcher, CODE_URL, { client_id: CLIENT_ID }, signal);
  const expiresIn = seconds(value.expires_in, 60 * 60);
  const interval = seconds(value.interval, 120) ?? 5;
  if (
    typeof value.device_code !== "string" ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(value.device_code) ||
    typeof value.user_code !== "string" ||
    !/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value.user_code) ||
    value.verification_uri !== DEVICE_URL ||
    !expiresIn
  )
    throw new AcquisitionError("network_unavailable");
  return {
    deviceCode: value.device_code,
    userCode: value.user_code,
    expiresAt: now() + expiresIn * 1000,
    interval,
  };
}

export async function pollDeviceCode(
  fetcher: Fetcher,
  deviceCode: string,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<PollResult> {
  const value = await post(
    fetcher,
    TOKEN_URL,
    {
      client_id: CLIENT_ID,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    },
    signal,
  );
  if (value.error === "authorization_pending") return { state: "pending" };
  if (value.error === "slow_down") {
    const interval = seconds(value.interval, 120);
    return { state: "pending", ...(interval ? { interval } : {}) };
  }
  if (value.error === "expired_token") return { state: "expired" };
  if (value.error === "access_denied") return { state: "denied" };
  if (value.error !== undefined)
    throw new AcquisitionError("authentication_invalid");
  const granted = grant(value, now());
  if (!granted) throw new AcquisitionError("network_unavailable");
  return { state: "granted", grant: granted };
}

export async function refreshGrant(
  fetcher: Fetcher,
  refreshToken: string,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<Grant> {
  const value = await post(
    fetcher,
    TOKEN_URL,
    {
      client_id: CLIENT_ID,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    signal,
  );
  if (value.error !== undefined) throw new GrantRejected();
  const granted = grant(value, now());
  if (!granted) throw new AcquisitionError("network_unavailable");
  return granted;
}
