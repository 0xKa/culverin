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

export function pageRepository(url: string): PageRepository | undefined {
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
  const parts = /^\/([^/]+)\/([^/]+)\/?$/.exec(parsed.pathname);
  if (!parts || !validRepository(parts[1] ?? "", parts[2] ?? ""))
    return undefined;
  if (parsed.search) return undefined;
  return { owner: parts[1]!, name: parts[2]! };
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
