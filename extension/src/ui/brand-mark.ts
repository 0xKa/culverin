export const BRAND_GRID = 16;

type Rect = readonly [number, number, number, number];

export const brandMarkRects: readonly Rect[] = [
  [2, 1, 2, 14],
  [1, 1, 14, 2],
  [1, 13, 14, 2],
  [5, 4, 7, 2],
  [5, 7, 5, 2],
  [5, 10, 9, 2],
];

const rowGroups = "mbbgllgllgllgbbm";
const columnGroups = "mossgmmmmmmmmmom";

function fit(
  groups: string,
  pixels: number,
  cost: (picked: Set<string>) => number,
): { edges: number[]; picked: Set<string> } {
  const base = Math.floor(pixels / BRAND_GRID);
  const extra = pixels - base * BRAND_GRID;
  const units = [...groups];
  const classes = [...new Set(units.filter((group) => group !== "m"))];
  const free = units.flatMap((group, index) => (group === "m" ? [index] : []));
  let best: { picked: Set<string>; rest: number; score: number } | undefined;
  for (let mask = 0; mask < 1 << classes.length; mask++) {
    const picked = new Set(classes.filter((_, index) => mask & (1 << index)));
    const rest = extra - units.filter((group) => picked.has(group)).length;
    if (rest < 0) continue;
    const score = cost(picked);
    if (
      !best ||
      score < best.score ||
      (score === best.score && rest < best.rest)
    )
      best = { picked, rest, score };
  }
  const sizes = units.map((group) => base + (best!.picked.has(group) ? 1 : 0));
  for (let index = 0; index < best!.rest; index++)
    sizes[free[Math.floor(((index + 0.5) * free.length) / best!.rest)]!]!++;
  const edges = [0];
  for (const size of sizes) edges.push(edges.at(-1)! + size);
  return { edges, picked: best!.picked };
}

export function brandMarkPixels(size: number, ratio: number): number {
  return Math.max(BRAND_GRID, Math.round(size * ratio));
}

export function brandMarkLayout(pixels: number): Rect[] {
  const rows = fit(
    rowGroups,
    pixels,
    (picked) => +(picked.has("b") !== picked.has("l")),
  );
  const columns = fit(
    columnGroups,
    pixels,
    (picked) =>
      2 * +(picked.has("s") !== rows.picked.has("b")) +
      +(picked.has("g") !== rows.picked.has("g")),
  );
  return brandMarkRects.map(([x, y, width, height]): Rect => [
    columns.edges[x]!,
    rows.edges[y]!,
    columns.edges[x + width]! - columns.edges[x]!,
    rows.edges[y + height]! - rows.edges[y]!,
  ]);
}

export function brandMarkSvg(
  pixels: number,
  layout: readonly Rect[] = brandMarkLayout(pixels),
): string {
  const rects = layout
    .map(
      ([x, y, width, height]) =>
        `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixels} ${pixels}" fill="currentColor" shape-rendering="crispEdges">${rects}</svg>`;
}
