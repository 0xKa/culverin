export type PageRepository = { owner: string; name: string };

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

export function tabRepository(url: string): PageRepository | undefined {
  return repositoryPath(url)?.repository;
}

export function pageRoute(
  url: string,
): { repository: PageRepository; ref?: string } | undefined {
  const path = repositoryPath(url);
  if (!path) return undefined;
  if (!path.rest) return { repository: path.repository };
  const ref = /^tree\/(.+)$/.exec(path.rest)?.[1];
  if (!ref || ref.includes("//")) return undefined;
  try {
    return { repository: path.repository, ref: decodeURIComponent(ref) };
  } catch {
    return undefined;
  }
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
