import { expect, test } from "bun:test";
import { CLIENT_ID } from "../../extension/src/auth/github-app";
import {
  GrantRejected,
  pollDeviceCode,
  refreshGrant,
  requestDeviceCode,
} from "../../extension/src/auth/device";
import { fetchLogin, type Fetcher } from "../../extension/src/github/client";

function response(body: unknown, url: string, status = 200): Response {
  const result = new Response(JSON.stringify(body), { status });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

const signal = new AbortController().signal;

test("requests a device code with only the client ID", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetcher: Fetcher = async (url, init) => {
    seen = { url, init };
    return response(
      {
        device_code: "device-123",
        user_code: "WDJB-MJHT",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      url,
    );
  };
  const code = await requestDeviceCode(fetcher, signal, () => 1000);
  expect(code).toEqual({
    deviceCode: "device-123",
    userCode: "WDJB-MJHT",
    expiresAt: 901_000,
    interval: 5,
  });
  expect(seen?.url).toBe("https://github.com/login/device/code");
  expect(seen?.init.method).toBe("POST");
  expect(seen?.init.credentials).toBe("omit");
  expect(seen?.init.redirect).toBe("error");
  expect(String(seen?.init.body)).toBe(`client_id=${CLIENT_ID}`);
  expect(String(seen?.init.body)).not.toContain("secret");
});

test("rejects a device code that points somewhere other than GitHub", async () => {
  const fetcher: Fetcher = async (url) =>
    response(
      {
        device_code: "device-123",
        user_code: "WDJB-MJHT",
        verification_uri: "https://example.com/login/device",
        expires_in: 900,
        interval: 5,
      },
      url,
    );
  await expect(requestDeviceCode(fetcher, signal)).rejects.toThrow();
  const redirected: Fetcher = async () =>
    response({}, "https://example.com/login/device/code");
  await expect(requestDeviceCode(redirected, signal)).rejects.toThrow();
});

test("maps device polling outcomes", async () => {
  const reply =
    (body: unknown): Fetcher =>
    async (url) =>
      response(body, url);
  expect(
    await pollDeviceCode(
      reply({ error: "authorization_pending" }),
      "d",
      signal,
    ),
  ).toEqual({ state: "pending" });
  expect(
    await pollDeviceCode(
      reply({ error: "slow_down", interval: 10 }),
      "d",
      signal,
    ),
  ).toEqual({ state: "pending", interval: 10 });
  expect(
    await pollDeviceCode(reply({ error: "expired_token" }), "d", signal),
  ).toEqual({ state: "expired" });
  expect(
    await pollDeviceCode(reply({ error: "access_denied" }), "d", signal),
  ).toEqual({ state: "denied" });
  expect(
    await pollDeviceCode(
      reply({
        access_token: "ghu_access",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_refresh",
        refresh_token_expires_in: 15897600,
      }),
      "d",
      signal,
      () => 0,
    ),
  ).toEqual({
    state: "granted",
    grant: {
      token: "ghu_access",
      expiresAt: 28_800_000,
      refreshToken: "ghr_refresh",
      refreshExpiresAt: 15_897_600_000,
    },
  });
});

test("refreshes without a client secret and reports rejected grants", async () => {
  let body = "";
  const fetcher: Fetcher = async (url, init) => {
    body = String(init.body);
    return response(
      {
        access_token: "ghu_next",
        token_type: "bearer",
        expires_in: 28800,
        refresh_token: "ghr_next",
        refresh_token_expires_in: 15897600,
      },
      url,
    );
  };
  expect((await refreshGrant(fetcher, "ghr_old", signal, () => 0)).token).toBe(
    "ghu_next",
  );
  expect(new URLSearchParams(body).get("grant_type")).toBe("refresh_token");
  expect(new URLSearchParams(body).get("refresh_token")).toBe("ghr_old");
  expect(new URLSearchParams(body).has("client_secret")).toBe(false);
  const rejected: Fetcher = async (url) =>
    response({ error: "bad_refresh_token" }, url);
  await expect(
    refreshGrant(rejected, "ghr_old", signal),
  ).rejects.toBeInstanceOf(GrantRejected);
});

test("reads the signed-in login", async () => {
  let authorization = null as string | null;
  const fetcher: Fetcher = async (url, init) => {
    authorization = new Headers(init.headers).get("authorization");
    return response({ login: "octo-cat" }, url);
  };
  expect(await fetchLogin(fetcher, "github_pat_x", signal)).toBe("octo-cat");
  expect(authorization).toBe("Bearer github_pat_x");
  const invalid: Fetcher = async (url) =>
    response({ message: "Bad credentials" }, url, 401);
  await expect(fetchLogin(invalid, "bad", signal)).rejects.toMatchObject({
    code: "authentication_invalid",
  });
});
