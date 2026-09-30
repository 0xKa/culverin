import { validLogin } from "../github/client";
import { GrantRejected, type Grant } from "./device";
import { validToken } from "./pending";

export const CONNECTION_KEY = "github.connection";
export const REFRESH_MARGIN = 5 * 60_000;

export type Method = "app" | "token";

export type Credential =
  | ({ method: "app"; login: string } & Grant)
  | { method: "token"; login: string; token: string };

type Stored = {
  version: 1;
  generation: string;
  credential?: Credential;
  expired?: { method: Method; login: string };
};

export type ConnectionStatus = {
  generation: string;
  connected: boolean;
  method?: Method;
  login?: string;
  expired: boolean;
};

export type Auth = { token?: string; generation: string };

export type ConnectionStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const time = (value: unknown) =>
  value === undefined || (Number.isSafeInteger(value) && (value as number) > 0);
const validGeneration = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);

function validCredential(value: unknown): value is Credential {
  if (
    !record(value) ||
    typeof value.login !== "string" ||
    !validLogin(value.login) ||
    !validToken(value.token)
  )
    return false;
  if (value.method === "token") return Object.keys(value).length === 3;
  return (
    value.method === "app" &&
    time(value.expiresAt) &&
    (value.refreshToken === undefined || validToken(value.refreshToken)) &&
    time(value.refreshExpiresAt) &&
    Object.keys(value).every((key) =>
      [
        "method",
        "login",
        "token",
        "expiresAt",
        "refreshToken",
        "refreshExpiresAt",
      ].includes(key),
    )
  );
}

function validStored(value: unknown): value is Stored {
  if (
    !record(value) ||
    value.version !== 1 ||
    !validGeneration(value.generation) ||
    (value.credential !== undefined && !validCredential(value.credential))
  )
    return false;
  const expired = value.expired;
  return (
    expired === undefined ||
    (value.credential === undefined &&
      record(expired) &&
      (expired.method === "app" || expired.method === "token") &&
      typeof expired.login === "string" &&
      validLogin(expired.login))
  );
}

export class ConnectionStore {
  private tail: Promise<unknown> = Promise.resolve();
  private refreshing: Promise<Auth> | undefined;

  constructor(
    private readonly storage: ConnectionStorage,
    private readonly refresh: (refreshToken: string) => Promise<Grant>,
    private readonly now: () => number = Date.now,
  ) {}

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation);
    this.tail = next.catch(() => undefined);
    return next;
  }

  private async read(): Promise<Stored> {
    const value = (await this.storage.get(CONNECTION_KEY))[CONNECTION_KEY];
    if (validStored(value)) return value;
    const fresh: Stored = { version: 1, generation: crypto.randomUUID() };
    await this.storage.set({ [CONNECTION_KEY]: fresh });
    return fresh;
  }

  private async write(next: Stored): Promise<void> {
    await this.storage.set({ [CONNECTION_KEY]: next });
  }

  initialize(): Promise<void> {
    return this.serial(async () => {
      await this.read();
    });
  }

  async status(): Promise<ConnectionStatus> {
    const stored = await this.serial(() => this.read());
    const account = stored.credential ?? stored.expired;
    return {
      generation: stored.generation,
      connected: stored.credential !== undefined,
      ...(account ? { method: account.method, login: account.login } : {}),
      expired: stored.expired !== undefined,
    };
  }

  async generation(): Promise<string> {
    return (await this.serial(() => this.read())).generation;
  }

  async auth(): Promise<Auth> {
    const stored = await this.serial(() => this.read());
    const credential = stored.credential;
    if (!credential) return { generation: stored.generation };
    if (credential.method === "token")
      return { token: credential.token, generation: stored.generation };
    const now = this.now();
    if (!credential.expiresAt || now < credential.expiresAt - REFRESH_MARGIN)
      return { token: credential.token, generation: stored.generation };
    if (
      !credential.refreshToken ||
      (credential.refreshExpiresAt !== undefined &&
        now >= credential.refreshExpiresAt)
    ) {
      if (now < credential.expiresAt)
        return { token: credential.token, generation: stored.generation };
      await this.expire(stored.generation);
      return { generation: await this.generation() };
    }
    this.refreshing ??= this.renew(stored.generation, credential).finally(
      () => {
        this.refreshing = undefined;
      },
    );
    return this.refreshing;
  }

  private async renew(
    generation: string,
    credential: Extract<Credential, { method: "app" }>,
  ): Promise<Auth> {
    let granted: Grant;
    try {
      granted = await this.refresh(credential.refreshToken!);
    } catch (error) {
      if (error instanceof GrantRejected) {
        await this.expire(generation);
        return { generation: await this.generation() };
      }
      return this.now() < credential.expiresAt!
        ? { token: credential.token, generation }
        : { generation };
    }
    return this.serial(async () => {
      const current = await this.read();
      if (
        current.generation !== generation ||
        current.credential?.method !== "app" ||
        current.credential.refreshToken !== credential.refreshToken
      )
        return { generation: current.generation };
      await this.write({
        ...current,
        credential: { method: "app", login: credential.login, ...granted },
      });
      return { token: granted.token, generation };
    });
  }

  connect(
    credential: Credential,
    expectedGeneration?: string,
  ): Promise<
    | {
        connected: true;
        previous: string;
        generation: string;
        accountChanged: boolean;
      }
    | { connected: false }
  > {
    return this.serial(async () => {
      if (!validCredential(credential)) return { connected: false } as const;
      const current = await this.read();
      if (
        expectedGeneration !== undefined &&
        current.generation !== expectedGeneration
      )
        return { connected: false } as const;
      const account = current.credential ?? current.expired;
      const generation = crypto.randomUUID();
      await this.write({ version: 1, generation, credential });
      return {
        connected: true,
        previous: current.generation,
        generation,
        accountChanged:
          account !== undefined &&
          account.login.toLowerCase() !== credential.login.toLowerCase(),
      } as const;
    });
  }

  disconnect(): Promise<{ previous: string; generation: string }> {
    return this.serial(async () => {
      const current = await this.read();
      const generation = crypto.randomUUID();
      await this.write({ version: 1, generation });
      return { previous: current.generation, generation };
    });
  }

  rotate(): Promise<{ previous: string; generation: string }> {
    return this.serial(async () => {
      const current = await this.read();
      const generation = crypto.randomUUID();
      await this.write({ ...current, generation });
      return { previous: current.generation, generation };
    });
  }

  expire(generation: string): Promise<boolean> {
    return this.serial(async () => {
      const current = await this.read();
      if (current.generation !== generation || !current.credential)
        return false;
      await this.write({
        version: 1,
        generation: crypto.randomUUID(),
        expired: {
          method: current.credential.method,
          login: current.credential.login,
        },
      });
      return true;
    });
  }
}
