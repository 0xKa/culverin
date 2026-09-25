import {
  AcquisitionError,
  resolveRepository,
  type Fetcher,
  type Resolution,
} from "../github/client";
import { pendingKey as PENDING, validPending } from "./pending";

const ACTIVE = "github.active";
const GENERATION = "github.generation";
const TRANSITION = "github.transition";

type Active = { token: string; generation: string };

let queue: Promise<unknown> = Promise.resolve();

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation, operation);
  queue = next.catch(() => undefined);
  return next;
}

export async function initializeSession(): Promise<void> {
  await chrome.storage.session.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  const state = await chrome.storage.session.get([GENERATION, TRANSITION]);
  if (state[TRANSITION]) {
    await chrome.storage.session.remove([ACTIVE, PENDING, TRANSITION]);
    await chrome.storage.session.set({ [GENERATION]: crypto.randomUUID() });
  } else if (typeof state[GENERATION] !== "string") {
    await chrome.storage.session.set({ [GENERATION]: crypto.randomUUID() });
  }
}

export async function authStatus(): Promise<{
  connected: boolean;
  generation: string;
}> {
  const state = await chrome.storage.session.get([ACTIVE, GENERATION]);
  const active = state[ACTIVE] as Active | undefined;
  return {
    connected:
      typeof active?.token === "string" &&
      active.generation === state[GENERATION],
    generation: state[GENERATION] as string,
  };
}

export async function activeToken(): Promise<{
  token?: string;
  generation: string;
}> {
  const state = await chrome.storage.session.get([ACTIVE, GENERATION]);
  const active = state[ACTIVE] as Active | undefined;
  return {
    token:
      active && active.generation === state[GENERATION]
        ? active.token
        : undefined,
    generation: state[GENERATION] as string,
  };
}

export async function activatePending(
  submissionId: string,
  fetcher: Fetcher,
): Promise<{ connected: true; resolution: Resolution } | { connected: false }> {
  const state = await chrome.storage.session.get([PENDING, GENERATION]);
  const pending: unknown = state[PENDING];
  if (
    !validPending(pending) ||
    pending.submissionId !== submissionId ||
    pending.generation !== state[GENERATION]
  )
    return { connected: false };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("deadline"), 10_000);
  let resolution: Resolution;
  try {
    resolution = await resolveRepository(
      fetcher,
      pending.owner,
      pending.name,
      pending.token,
      controller.signal,
    );
  } catch (error) {
    if (controller.signal.aborted)
      throw new AcquisitionError("analysis_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (resolution.visibility !== "private") return { connected: false };
  return mutate(async () => {
    const current = await chrome.storage.session.get([PENDING, GENERATION]);
    const candidate: unknown = current[PENDING];
    if (
      !validPending(candidate) ||
      candidate.submissionId !== submissionId ||
      candidate.generation !== pending.generation ||
      current[GENERATION] !== pending.generation
    )
      return { connected: false } as const;
    const generation = crypto.randomUUID();
    await chrome.storage.session.set({
      [TRANSITION]: true,
      [GENERATION]: generation,
    });
    await chrome.storage.session.remove([ACTIVE, PENDING]);
    await chrome.storage.session.set({
      [ACTIVE]: { token: pending.token, generation },
    });
    await chrome.storage.session.remove(TRANSITION);
    return { connected: true, resolution } as const;
  });
}

export async function removePending(submissionId: string): Promise<void> {
  await mutate(async () => {
    const state = await chrome.storage.session.get(PENDING);
    const pending: unknown = state[PENDING];
    if (
      pending &&
      typeof pending === "object" &&
      "submissionId" in pending &&
      pending.submissionId === submissionId
    )
      await chrome.storage.session.remove(PENDING);
  });
}

export async function disconnect(): Promise<string> {
  return mutate(async () => {
    const generation = crypto.randomUUID();
    await chrome.storage.session.set({
      [TRANSITION]: true,
      [GENERATION]: generation,
    });
    await chrome.storage.session.remove([ACTIVE, PENDING]);
    await chrome.storage.session.remove(TRANSITION);
    return generation;
  });
}

export async function clearPrivateSession(): Promise<string> {
  return mutate(async () => {
    const state = await chrome.storage.session.get(ACTIVE);
    const active = state[ACTIVE] as Active | undefined;
    const generation = crypto.randomUUID();
    await chrome.storage.session.set({
      [TRANSITION]: true,
      [GENERATION]: generation,
    });
    await chrome.storage.session.remove([ACTIVE, PENDING]);
    if (typeof active?.token === "string")
      await chrome.storage.session.set({
        [ACTIVE]: { token: active.token, generation },
      });
    await chrome.storage.session.remove(TRANSITION);
    return generation;
  });
}
