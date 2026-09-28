export const rulesProfile = "source-v1";
export const rulesVersion = "2";
export const coveragePolicyVersion = "1";
export const wrapperVersion = "2";

export const excludedDirectories = [
  ".git",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".venv",
  "bower_components",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "third-party",
  "third_party",
  "vendor",
  "venv",
] as const;

export const excludedFiles = [
  "bun.lock",
  "Cargo.lock",
  "Gemfile.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "composer.lock",
  "poetry.lock",
  "Pipfile.lock",
  "go.sum",
] as const;

const encoder = new TextEncoder();

function compareUtf8(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

export function normalizeExclusions(input: string[]): string[] {
  if (
    input.length > 64 ||
    input.some((x) => encoder.encode(x).length > 256) ||
    input.reduce((n, x) => n + encoder.encode(x).length, 0) > 4096
  )
    throw new Error("invalid exclusions");
  for (const value of input) {
    if (
      !value ||
      value.startsWith("/") ||
      value.includes("\\") ||
      value.includes("\0") ||
      value.includes("*") ||
      value.includes("?") ||
      value.split("/").some((x) => !x || x === "." || x === "..")
    )
      throw new Error("invalid exclusions");
  }
  return [...new Set(input)].sort(compareUtf8);
}

export async function effectiveRulesHash(
  exclusions: string[],
): Promise<string> {
  const canonical = JSON.stringify([
    rulesProfile,
    rulesVersion,
    normalizeExclusions(exclusions),
  ]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

export function coverageIdentity(
  engineVersion: string,
  wrapperVersion: string,
  rulesHash: string,
): string {
  return JSON.stringify([
    1,
    "tokei",
    engineVersion,
    wrapperVersion,
    rulesVersion,
    rulesHash,
    coveragePolicyVersion,
  ]);
}
