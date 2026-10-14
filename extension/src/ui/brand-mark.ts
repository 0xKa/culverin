export const BRAND_GRID = 16;

type Rect = readonly [number, number, number, number];

export const brandMarkRects: readonly Rect[] = [
  [2, 1, 2, 13],
  [1, 2, 14, 2],
  [1, 11, 14, 2],
  [5, 5, 7, 1],
  [5, 7, 5, 1],
  [5, 9, 9, 1],
];

const rowGroups = "mobbglglglgbbomm";
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
    if (rest < 0 || rest > free.length) continue;
    const score = cost(picked);
    if (!best || score < best.score) best = { picked, rest, score };
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
    (picked) =>
      4 * +(picked.has("b") !== picked.has("l")) +
      2 * +(picked.has("o") !== picked.has("b")) +
      +(picked.has("g") !== picked.has("l")),
  );
  const columns = fit(
    columnGroups,
    pixels,
    (picked) =>
      4 * +(picked.has("s") !== rows.picked.has("b")) +
      2 * +(picked.has("o") !== rows.picked.has("o")) +
      +(picked.has("g") !== rows.picked.has("g")),
  );
  return brandMarkRects.map(([x, y, width, height]): Rect => [
    columns.edges[x]!,
    rows.edges[y]!,
    columns.edges[x + width]! - columns.edges[x]!,
    rows.edges[y + height]! - rows.edges[y]!,
  ]);
}

export function brandMarkSvg(pixels: number): string {
  const rects = brandMarkLayout(pixels)
    .map(
      ([x, y, width, height]) =>
        `<rect x="${x}" y="${y}" width="${width}" height="${height}"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixels} ${pixels}" fill="currentColor" shape-rendering="crispEdges">${rects}</svg>`;
}
