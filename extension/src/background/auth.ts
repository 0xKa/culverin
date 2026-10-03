import { type Auth } from "../auth/connection";
import {
  pollDeviceCode,
  requestDeviceCode,
  type DeviceCode,
} from "../auth/device";
import { DEVICE_URL } from "../auth/github-app";
import { pendingKey, validPending } from "../auth/pending";
import { AUTO_COUNT_KEY } from "../counting/claims";
import {
  AcquisitionError,
  fetchLogin,
  resolveRepository,
  safeFailure,
  type Fetcher,
  type Resolution,
} from "../github/client";
import { type PublicErrorCode } from "../github/public-protocol";
import {
  RATE_LIMIT_KEY,
  readRateLimit,
  type RateLimit,
} from "../github/rate-limit";
import type { SettingsRequest } from "../protocol/settings";
import {
  type SettingsPayload,
  type SettingsStatus,
} from "../protocol/settings";
import type { BackgroundResources } from "./resources";

export function createAuthService(resources: BackgroundResources) {
  const {
    chrome,
    fetch,
    connection,
    coordinator,
    privateResults,
    refs,
    optionRefs,
    cache,
    rates,
  } = resources;
  const { trackedFetch } = rates;
  const DEVICE = "github.device";
  const LAST = "github.last";
  async function connectionChanged(
    previous: string,
    options: {
      clearPrivate: boolean;
      clearRefs: boolean;
      rateLimit?: RateLimit;
    },
  ): Promise<void> {
    coordinator.abortGeneration(previous);
    rates.clear(previous);
    await Promise.all([
      chrome.storage.session.remove([LAST, RATE_LIMIT_KEY]),
      ...(options.clearRefs ? [refs.clear(), optionRefs.clear()] : []),
      ...(options.clearPrivate ? [privateResults.clear()] : []),
    ]);
    if (options.rateLimit)
      await chrome.storage.session.set({ [RATE_LIMIT_KEY]: options.rateLimit });
  }
  function observeRateLimit() {
    let observed: RateLimit | undefined;
    const fetcher: Fetcher = async (input, init) => {
      const response = await fetch(input, init);
      observed = readRateLimit(response.headers, true);
      return response;
    };
    return { fetcher, observed: () => observed };
  }
  async function resolveFor(
    repository: { owner: string; name: string },
    auth: Auth,
  ): Promise<Resolution> {
    const anonymous = () =>
      resolveRepository(
        trackedFetch(false),
        repository.owner,
        repository.name,
        undefined,
        AbortSignal.timeout(10_000),
      );
    if (!auth.token) return anonymous();
    try {
      return await resolveRepository(
        trackedFetch(true),
        repository.owner,
        repository.name,
        auth.token,
        AbortSignal.timeout(10_000),
      );
    } catch (error) {
      if (!(error instanceof AcquisitionError)) throw error;
      if (error.code === "authentication_invalid") {
        if (await connection.expire(auth.generation))
          await connectionChanged(auth.generation, {
            clearPrivate: false,
            clearRefs: false,
          });
        return anonymous();
      }
      if (error.code !== "repository_unavailable") throw error;
      try {
        return await anonymous();
      } catch {
        throw error;
      }
    }
  }
  async function accessFailure(
    code: PublicErrorCode,
    auth: Auth,
    repository: { owner: string; name: string },
    resolving: boolean,
  ): Promise<PublicErrorCode> {
    if (code === "authentication_invalid" && auth.token) {
      if (await connection.expire(auth.generation))
        await connectionChanged(auth.generation, {
          clearPrivate: false,
          clearRefs: false,
        });
      return code;
    }
    if (code !== "repository_unavailable" && code !== "repository_forbidden")
      return code;
    if (!auth.token) return resolving ? "authentication_required" : code;
    await privateResults.purgeName(repository).catch(() => undefined);
    return "access_not_granted";
  }
  type DeviceState = DeviceCode & { generation: string; nextPollAt: number };
  let device: DeviceState | undefined;

  function validDevice(value: unknown): value is DeviceState {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const state = value as Record<string, unknown>;
    return (
      typeof state.deviceCode === "string" &&
      typeof state.userCode === "string" &&
      typeof state.generation === "string" &&
      [state.expiresAt, state.interval, state.nextPollAt].every(
        (item) => Number.isSafeInteger(item) && (item as number) > 0,
      )
    );
  }

  async function readDevice(): Promise<DeviceState | undefined> {
    if (device) return device;
    const stored: unknown = (await chrome.storage.session.get(DEVICE))[DEVICE];
    if (validDevice(stored)) device = stored;
    return device;
  }

  async function saveDevice(next?: DeviceState): Promise<void> {
    device = next;
    if (next) await chrome.storage.session.set({ [DEVICE]: next });
    else await chrome.storage.session.remove(DEVICE);
  }

  async function statusReply(): Promise<SettingsStatus> {
    const current = await readDevice();
    const active =
      current && Date.now() < current.expiresAt ? current : undefined;
    return {
      ...(await connection.status()),
      ...(active
        ? {
            device: {
              userCode: active.userCode,
              verificationUri: DEVICE_URL,
              expiresAt: active.expiresAt,
              interval: active.interval,
            },
          }
        : {}),
    };
  }

  async function handle(
    request: SettingsRequest,
    reply: (payload: SettingsPayload) => void,
  ): Promise<boolean> {
    if (request.type === "auth.status") {
      reply({ state: "ok", ...(await statusReply()) });
      return true;
    }
    if (request.type === "auth.submit") {
      const stored: unknown = (await chrome.storage.session.get(pendingKey))[
        pendingKey
      ];
      await chrome.storage.session.remove(pendingKey);
      if (
        !validPending(stored) ||
        stored.submissionId !== request.submissionId
      ) {
        reply({ state: "failed", code: "authentication_invalid" });
        return true;
      }
      const generation = await connection.generation();
      const signal = AbortSignal.timeout(10_000);
      const loginRate = observeRateLimit();
      let login: string;
      try {
        login = await fetchLogin(loginRate.fetcher, stored.token, signal);
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
        return true;
      }
      const result = await connection.connect(
        { method: "token", login, token: stored.token },
        generation,
      );
      if (!result.connected) {
        reply({ state: "stale" });
        return true;
      }
      await saveDevice();
      await connectionChanged(result.previous, {
        clearPrivate: result.accountChanged,
        clearRefs: true,
        rateLimit: loginRate.observed(),
      });
      reply({ state: "connected", ...(await statusReply()) });
      return true;
    }
    if (request.type === "auth.device.start") {
      const signal = AbortSignal.timeout(10_000);
      try {
        const code = await requestDeviceCode(fetch, signal);
        await saveDevice({
          ...code,
          generation: await connection.generation(),
          nextPollAt: Date.now() + code.interval * 1000,
        });
        reply({ state: "ok", ...(await statusReply()) });
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
      }
      return true;
    }
    if (request.type === "auth.device.cancel") {
      await saveDevice();
      reply({ state: "ok", ...(await statusReply()) });
      return true;
    }
    if (request.type === "auth.device.poll") {
      const current = await readDevice();
      const now = Date.now();
      if (!current || now >= current.expiresAt) {
        await saveDevice();
        reply({ state: current ? "device-expired" : "device-missing" });
        return true;
      }
      if (now < current.nextPollAt) {
        reply({ state: "pending", retryIn: current.nextPollAt - now });
        return true;
      }
      await saveDevice({
        ...current,
        nextPollAt: now + current.interval * 1000,
      });
      const signal = AbortSignal.timeout(10_000);
      let outcome: Awaited<ReturnType<typeof pollDeviceCode>>;
      try {
        outcome = await pollDeviceCode(fetch, current.deviceCode, signal);
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
        return true;
      }
      if (outcome.state === "pending") {
        const interval = outcome.interval ?? current.interval;
        if (device?.deviceCode === current.deviceCode)
          await saveDevice({
            ...device,
            interval,
            nextPollAt: Date.now() + interval * 1000,
          });
        reply({ state: "pending", retryIn: interval * 1000 });
        return true;
      }
      if (outcome.state !== "granted") {
        if (device?.deviceCode === current.deviceCode) await saveDevice();
        reply({
          state:
            outcome.state === "expired" ? "device-expired" : "device-denied",
        });
        return true;
      }
      const loginRate = observeRateLimit();
      let login: string;
      try {
        login = await fetchLogin(
          loginRate.fetcher,
          outcome.grant.token,
          signal,
        );
      } catch (error) {
        reply({ state: "failed", ...safeFailure(error, signal) });
        return true;
      }
      if (device?.deviceCode !== current.deviceCode) {
        reply({ state: "device-missing" });
        return true;
      }
      await saveDevice();
      const result = await connection.connect(
        { method: "app", login, ...outcome.grant },
        current.generation,
      );
      if (!result.connected) {
        reply({ state: "stale" });
        return true;
      }
      await connectionChanged(result.previous, {
        clearPrivate: result.accountChanged,
        clearRefs: true,
        rateLimit: loginRate.observed(),
      });
      reply({ state: "connected", ...(await statusReply()) });
      return true;
    }
    if (
      request.type === "cache.clear-public" ||
      request.type === "cache.clear-all"
    ) {
      if (request.type === "cache.clear-all") {
        const { previous } = await connection.rotate();
        await connectionChanged(previous, {
          clearPrivate: true,
          clearRefs: true,
        });
      }
      await cache.clear();
      await Promise.all([refs.clear(), optionRefs.clear()]);
      await chrome.storage.session.remove(AUTO_COUNT_KEY);
      reply({
        state:
          request.type === "cache.clear-all"
            ? "all-results-cleared"
            : "public-cache-cleared",
      });
      return true;
    }
    if (request.type === "auth.disconnect") {
      await saveDevice();
      const { previous, generation } = await connection.disconnect();
      await connectionChanged(previous, {
        clearPrivate: true,
        clearRefs: true,
      });
      reply({ state: "disconnected", generation });
      return true;
    }
    if (request.type === "auth.clear-private-session") {
      const { previous, generation } = await connection.rotate();
      await connectionChanged(previous, {
        clearPrivate: true,
        clearRefs: true,
      });
      reply({ state: "cleared", generation });
      return true;
    }

    return false;
  }

  return { handle, resolveFor, accessFailure };
}
