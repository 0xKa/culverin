import { pageRepository, type PageRepository } from "../github/repository";

export type PageContext = {
  repository: PageRepository;
  anchor?: Element;
  hydrating?: Element;
};

function visible(element: Element | null): element is Element {
  return (
    element !== null &&
    (typeof element.checkVisibility !== "function" || element.checkVisibility())
  );
}

export function pageContext(
  url: string,
  document: Document,
): PageContext | undefined {
  const repository = pageRepository(url);
  if (!repository) return undefined;
  const path = `${repository.owner}/${repository.name}`.toLowerCase();
  const forks = `/${path}/forks`;
  for (const link of Array.from(document.querySelectorAll(".mt-2 > a[href]"))) {
    const row = link.parentElement;
    if (link.getAttribute("href")?.toLowerCase() !== forks || !visible(row))
      continue;
    const app = row.closest("react-app, react-partial");
    return app && !app.classList.contains("loaded")
      ? { repository, anchor: row, hydrating: app }
      : { repository, anchor: row };
  }
  const marker = document.querySelector(
    'meta[name="octolytics-dimension-repository_nwo"]',
  );
  return marker?.getAttribute("content")?.toLowerCase() === path
    ? { repository }
    : undefined;
}
