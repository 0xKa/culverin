export const pendingKey = "github.pending";
const MAX_TOKEN_LENGTH = 512;

export type Pending = {
  token: string;
  submissionId: string;
  generation: string;
  owner: string;
  name: string;
  createdAt: number;
};

export function validToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_TOKEN_LENGTH &&
    !/\s/.test(value) &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

export function validPending(value: unknown): value is Pending {
  if (!value || typeof value !== "object") return false;
  const pending = value as Partial<Pending>;
  return (
    typeof pending.token === "string" &&
    validToken(pending.token) &&
    typeof pending.submissionId === "string" &&
    /^[0-9a-f-]{36}$/.test(pending.submissionId) &&
    typeof pending.generation === "string" &&
    /^[0-9a-f-]{36}$/.test(pending.generation) &&
    typeof pending.owner === "string" &&
    typeof pending.name === "string" &&
    typeof pending.createdAt === "number" &&
    Number.isFinite(pending.createdAt) &&
    Math.abs(Date.now() - pending.createdAt) < 60_000
  );
}
