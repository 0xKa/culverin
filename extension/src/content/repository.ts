import { validRepository } from "../github/client";

export type PageRepository = { owner: string; name: string };
export type PageContext = { repository: PageRepository; anchor: Element };

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

export function pageContext(
  url: string,
  document: Document,
): PageContext | undefined {
  const repository = pageRepository(url);
  if (!repository) return undefined;
  const header = document.querySelector("#repository-container-header");
  if (header) return { repository, anchor: header };
  const marker = document.querySelector(
    'meta[name="octolytics-dimension-repository_id"][content]',
  );
  const main = document.querySelector("main");
  if (marker && main) return { repository, anchor: main };
  return undefined;
}
