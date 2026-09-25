import { validRepository } from "../github/client";

export type PageRepository = { owner: string; name: string };

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
  if (parsed.search || parsed.hash) return undefined;
  return { owner: parts[1]!, name: parts[2]! };
}
