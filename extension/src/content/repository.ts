import {
  pageRoute,
  sameRepository,
  type PageRepository,
} from "../github/repository";

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

const embeddedBranches = new WeakMap<
  Element,
  { text: string; branches: { repository: PageRepository; branch: string }[] }
>();

function collectBranches(
  value: unknown,
  depth: number,
  found: { repository: PageRepository; branch: string }[],
): void {
  if (depth > 8 || typeof value !== "object" || value === null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBranches(item, depth + 1, found);
    return;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.defaultBranch === "string" &&
    typeof record.ownerLogin === "string" &&
    typeof record.name === "string"
  )
    found.push({
      repository: { owner: record.ownerLogin, name: record.name },
      branch: record.defaultBranch,
    });
  for (const item of Object.values(record))
    collectBranches(item, depth + 1, found);
}

function defaultBranch(
  document: Document,
  repository: PageRepository,
): string | undefined {
  for (const script of Array.from(
    document.querySelectorAll(
      'script[type="application/json"][data-target="react-app.embeddedData"]',
    ),
  )) {
    const text = script.textContent ?? "";
    let entry = embeddedBranches.get(script);
    if (entry?.text !== text) {
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        continue;
      }
      entry = { text, branches: [] };
      collectBranches(data, 0, entry.branches);
      embeddedBranches.set(script, entry);
    }
    const match = entry.branches.find((candidate) =>
      sameRepository(candidate.repository, repository),
    );
    if (match) return match.branch;
  }
  return undefined;
}

export function pageContext(
  url: string,
  document: Document,
): PageContext | undefined {
  const route = pageRoute(url);
  if (!route) return undefined;
  const { repository } = route;
  if (
    route.ref !== undefined &&
    defaultBranch(document, repository) !== route.ref
  )
    return undefined;
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
