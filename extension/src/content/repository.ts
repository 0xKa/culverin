import { validRepository } from "../github/client";

export type PageRepository = { owner: string; name: string };
export type PageContext = { repository: PageRepository; anchor: Element };

function visible(element: Element | null): element is Element {
  return (
    element !== null &&
    (typeof element.checkVisibility !== "function" || element.checkVisibility())
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

export function pageContext(
  url: string,
  document: Document,
): PageContext | undefined {
  const repository = pageRepository(url);
  if (!repository) return undefined;
  const forks = `/${repository.owner}/${repository.name}/forks`.toLowerCase();
  for (const link of Array.from(document.querySelectorAll(".mt-2 > a[href]"))) {
    const row = link.parentElement;
    if (link.getAttribute("href")?.toLowerCase() === forks && visible(row))
      return { repository, anchor: row };
  }
  return undefined;
}
