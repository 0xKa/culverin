export type PageRepository = { owner: string; name: string };
export type RefTarget = { path: string; exact: boolean };
export type RepositoryRoute = {
  repository: PageRepository;
  target?: RefTarget;
};

export const REF_LIMIT = 255;

const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const repositoryPattern = /^[A-Za-z0-9._-]{1,100}$/;

export function validLogin(login: string): boolean {
  return ownerPattern.test(login);
}

export function validRepository(owner: string, name: string): boolean {
  return (
    ownerPattern.test(owner) &&
    repositoryPattern.test(name) &&
    name !== "." &&
    name !== ".."
  );
}

const reservedOwners = new Set([
  "about",
  "account",
  "advisories",
  "apps",
  "codespaces",
  "collections",
  "contact",
  "copilot",
  "customer-stories",
  "dashboard",
  "enterprise",
  "enterprises",
  "events",
  "explore",
  "features",
  "github-copilot",
  "login",
  "marketplace",
  "new",
  "notifications",
  "organizations",
  "orgs",
  "readme",
  "resources",
  "search",
  "security",
  "sessions",
  "settings",
  "site",
  "solutions",
  "sponsors",
  "stars",
  "topics",
  "trending",
  "user-attachments",
  "users",
]);

function repositoryPath(
  url: string,
): { repository: PageRepository; rest: string } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (
    parsed.origin !== "https://github.com" ||
    parsed.username ||
    parsed.password
  )
    return undefined;
  const parts = /^\/([^/]+)\/([^/]+)(?:\/(.*))?$/.exec(parsed.pathname);
  const owner = parts?.[1] ?? "";
  const name = parts?.[2] ?? "";
  if (
    !parts ||
    !validRepository(owner, name) ||
    reservedOwners.has(owner.toLowerCase())
  )
    return undefined;
  return {
    repository: { owner, name },
    rest: (parts[3] ?? "").replace(/\/$/, ""),
  };
}

function refPath(value: string, limit: number): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(value);
  } catch {
    return undefined;
  }
  if (
    path.length > limit ||
    [...path].some((char) => char < " " || char === "\u007f") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  )
    return undefined;
  return path;
}

export function refPrefixes(path: string): string[] {
  const parts = path.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function validRef(ref: unknown): ref is string {
  return typeof ref === "string" && refPath(ref, REF_LIMIT) === ref;
}

export function tabRepository(url: string): PageRepository | undefined {
  return repositoryPath(url)?.repository;
}

export function tabRoute(url: string): RepositoryRoute | undefined {
  const path = repositoryPath(url);
  if (!path) return undefined;
  const { repository, rest } = path;
  const browse = /^(?:tree|blob|blame|commits)\/(.+)$/.exec(rest)?.[1];
  const exact =
    /^commit\/([0-9a-fA-F]{7,64})$/.exec(rest)?.[1] ??
    /^releases\/tag\/(.+)$/.exec(rest)?.[1];
  const target = browse
    ? refPath(browse, 1024)
    : exact
      ? refPath(exact, REF_LIMIT)
      : undefined;
  return target
    ? { repository, target: { path: target, exact: !browse } }
    : { repository };
}

export function pageRoute(
  url: string,
): { repository: PageRepository; ref?: string } | undefined {
  const path = repositoryPath(url);
  if (!path) return undefined;
  if (!path.rest) return { repository: path.repository };
  const ref = /^tree\/(.+)$/.exec(path.rest)?.[1];
  const decoded = ref === undefined ? undefined : refPath(ref, REF_LIMIT);
  return decoded === undefined
    ? undefined
    : { repository: path.repository, ref: decoded };
}

export function pageRepository(url: string): PageRepository | undefined {
  return pageRoute(url)?.repository;
}

export function sameRepository(
  current: PageRepository | undefined,
  expected: PageRepository | undefined,
): boolean {
  return Boolean(
    current &&
    expected &&
    current.owner.toLowerCase() === expected.owner.toLowerCase() &&
    current.name.toLowerCase() === expected.name.toLowerCase(),
  );
}
