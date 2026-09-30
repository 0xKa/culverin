import { validToken } from "./device";

export const pendingKey = "github.pending";

export type Pending = {
  token: string;
  submissionId: string;
  createdAt: number;
};

export function validPending(value: unknown): value is Pending {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Partial<Pending>;
  return (
    Object.keys(pending).length === 3 &&
    validToken(pending.token) &&
    typeof pending.submissionId === "string" &&
    /^[0-9a-f-]{36}$/.test(pending.submissionId) &&
    typeof pending.createdAt === "number" &&
    Number.isFinite(pending.createdAt) &&
    Math.abs(Date.now() - pending.createdAt) < 60_000
  );
}
