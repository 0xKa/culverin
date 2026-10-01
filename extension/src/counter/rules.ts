export const rulesProfile = "source-v1";
export const rulesVersion = "2";
export const coveragePolicyVersion = "2";
export const wrapperVersion = "3";
export const engineVersion = "15.0.0";

export type IgnoreGroup =
  "dependencies" | "build" | "environments" | "lockfiles" | "minified";

export type IgnoreSettings = {
  disabledGroups: IgnoreGroup[];
  exclusions: string[];
};

export const defaultIgnore: IgnoreSettings = {
  disabledGroups: [],
  exclusions: [],
};

export const MAX_RULES = 64;
export const MAX_RULE_BYTES = 256;
export const MAX_RULES_BYTES = 4096;

export const ignoreGroups: {
  id: IgnoreGroup;
  label: string;
  directories: string[];
  files: string[];
  suffixes: string[];
}[] = [
  {
    id: "dependencies",
    label: "Dependencies",
    directories: [
      "bower_components",
      "node_modules",
      "third-party",
      "third_party",
      "vendor",
    ],
    files: [],
    suffixes: [],
  },
  {
    id: "build",
    label: "Build output",
    directories: [
      ".next",
      ".nuxt",
      ".output",
      "build",
      "dist",
      "out",
      "target",
    ],
    files: [],
    suffixes: [],
  },
  {
    id: "environments",
    label: "Environments & caches",
    directories: [
      ".cache",
      ".git",
      ".parcel-cache",
      ".venv",
      "coverage",
      "venv",
    ],
    files: [],
    suffixes: [],
  },
  {
    id: "lockfiles",
    label: "Lockfiles",
    directories: [],
    files: [
      "bun.lock",
      "Cargo.lock",
      "composer.lock",
      "Gemfile.lock",
      "go.sum",
      "package-lock.json",
      "Pipfile.lock",
      "pnpm-lock.yaml",
      "poetry.lock",
      "yarn.lock",
    ],
    suffixes: [],
  },
  {
    id: "minified",
    label: "Minified & maps",
    directories: [],
    files: [],
    suffixes: [".map", ".min.css", ".min.js"],
  },
];

const encoder = new TextEncoder();

function compareUtf8(a: string, b: string): number {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) return left[i]! - right[i]!;
  }
  return left.length - right.length;
}

export function ruleError(rule: string): string | undefined {
  if (!rule) return "Rules can't be empty.";
  if (encoder.encode(rule).length > MAX_RULE_BYTES)
    return `Rules are limited to ${MAX_RULE_BYTES} bytes.`;
  if (rule.includes("\0")) return "Rules can't contain NUL characters.";
  if (rule.startsWith("/"))
    return 'Rules are relative to the repository root; remove the leading "/".';
  if (rule.includes("\\")) return 'Use "/" to separate folders.';
  if (rule.startsWith("*.")) {
    const suffix = rule.slice(2);
    if (!suffix) return 'Add a file ending after "*.".';
    if (suffix.includes("*") || suffix.includes("?"))
      return 'Wildcards other than a leading "*." aren\'t supported.';
    if (suffix.includes("/"))
      return '"*." rules match file endings, not folders.';
    return undefined;
  }
  if (rule.includes("*") || rule.includes("?"))
    return 'Wildcards other than a leading "*." aren\'t supported.';
  const body = rule.endsWith("/") ? rule.slice(0, -1) : rule;
  if (body.split("/").some((part) => !part || part === "." || part === ".."))
    return '".", "..", and empty folder names aren\'t allowed.';
  return undefined;
}

export function normalizeExclusions(input: string[]): string[] {
  if (
    input.length > MAX_RULES ||
    input.reduce((n, x) => n + encoder.encode(x).length, 0) > MAX_RULES_BYTES ||
    input.some((rule) => ruleError(rule) !== undefined)
  )
    throw new Error("invalid exclusions");
  return [...new Set(input)].sort(compareUtf8);
}

export function normalizeIgnore(value: unknown): IgnoreSettings {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("|") !== "disabledGroups|exclusions"
  )
    throw new Error("invalid ignore settings");
  const { disabledGroups, exclusions } = value as Record<string, unknown>;
  if (
    !Array.isArray(disabledGroups) ||
    !disabledGroups.every((group) =>
      ignoreGroups.some((known) => known.id === group),
    ) ||
    !Array.isArray(exclusions) ||
    !exclusions.every((rule) => typeof rule === "string")
  )
    throw new Error("invalid ignore settings");
  return {
    disabledGroups: [...new Set(disabledGroups as IgnoreGroup[])].sort(),
    exclusions: normalizeExclusions(exclusions as string[]),
  };
}

export function isDefaultIgnore(settings: IgnoreSettings): boolean {
  return !settings.disabledGroups.length && !settings.exclusions.length;
}

export async function effectiveRulesHash(
  settings: IgnoreSettings,
): Promise<string> {
  const normalized = normalizeIgnore(settings);
  const canonical = JSON.stringify([
    rulesProfile,
    rulesVersion,
    normalized.disabledGroups,
    normalized.exclusions,
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
