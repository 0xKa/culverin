import { pageRoute, type PageRepository } from "../github/repository";

export type PageContext = {
  repository: PageRepository;
  ref: string;
  anchor?: Element;
  hydrating?: Element;
};

function visible(element: Element | null): element is Element {
  return (
    element !== null &&
    (typeof element.checkVisibility !== "function" || element.checkVisibility())
  );
}

export function privateRepository(
  repository: PageRepository,
  document: Document,
): boolean | undefined {
  const marker = document.querySelector(
    'meta[name="octolytics-dimension-repository_nwo"]',
  );
  if (
    marker?.getAttribute("content")?.toLowerCase() !==
    `${repository.owner}/${repository.name}`.toLowerCase()
  )
    return undefined;
  const value = document
    .querySelector('meta[name="octolytics-dimension-repository_public"]')
    ?.getAttribute("content");
  return value === "false" ? true : value === "true" ? false : undefined;
}

export function pageContext(
  url: string,
  document: Document,
): PageContext | undefined {
  const route = pageRoute(url);
  if (!route) return undefined;
  const { repository } = route;
  const ref = route.ref ?? "";
  const path = `${repository.owner}/${repository.name}`.toLowerCase();
  const forks = `/${path}/forks`;
  for (const link of Array.from(document.querySelectorAll(".mt-2 > a[href]"))) {
    const row = link.parentElement;
    if (link.getAttribute("href")?.toLowerCase() !== forks || !visible(row))
      continue;
    const app = row.closest("react-app, react-partial");
    return app && !app.classList.contains("loaded")
      ? { repository, ref, anchor: row, hydrating: app }
      : { repository, ref, anchor: row };
  }
  if (ref) return undefined;
  const marker = document.querySelector(
    'meta[name="octolytics-dimension-repository_nwo"]',
  );
  return marker?.getAttribute("content")?.toLowerCase() === path
    ? { repository, ref }
    : undefined;
}
