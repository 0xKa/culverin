import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BRAND_GRID,
  brandMarkLayout,
  brandMarkPixels,
  brandMarkRects,
  brandMarkSvg,
} from "../../extension/src/ui/brand-mark";

function symbolRects(path: string): number[][] {
  const source = readFileSync(path, "utf8");
  const symbol = source.slice(source.indexOf("<g fill="));
  return [...symbol.matchAll(/<rect ([^>]*)\/>/g)].map(([, attributes]) =>
    ["x", "y", "width", "height"].map(
      (name) =>
        Number(new RegExp(`${name}="(\\d+)"`).exec(attributes!)?.[1]) / 8,
    ),
  );
}

test("matches the symbol of every icon artwork", () => {
  for (const path of [
    "assets/culverin-icon.svg",
    "assets/culverin-icon-light.svg",
    "assets/culverin-icon-dark.svg",
  ])
    expect(symbolRects(path)).toEqual(brandMarkRects.map((rect) => [...rect]));
});

test("draws equal strokes with equal device pixels at every size", () => {
  for (let pixels = BRAND_GRID; pixels <= 256; pixels++) {
    const [stem, top, bottom, ...lines] = brandMarkLayout(pixels);
    expect(bottom![3]).toBe(top![3]);
    expect(stem![2]).toBe(top![3]);
    for (const line of lines) expect(line[3]).toBe(top![3]);
    const rows = [top!, ...lines, bottom!];
    const gaps = rows
      .slice(1)
      .map((row, index) => row[1] - rows[index]![1] - rows[index]![3]);
    expect(new Set(gaps).size).toBe(1);
    expect(stem![1]).toBe(top![1]);
    expect(stem![1] + stem![3]).toBe(bottom![1] + bottom![3]);
    const below = pixels - stem![1] - stem![3];
    expect(Math.abs(below - stem![1])).toBeLessThanOrEqual(1);
    for (const [x, y, width, height] of brandMarkLayout(pixels)) {
      expect(Math.min(x!, y!, width!, height!)).toBeGreaterThanOrEqual(0);
      expect(Math.max(x! + width!, y! + height!)).toBeLessThanOrEqual(pixels);
    }
  }
});

test("scales the grid exactly at whole multiples", () => {
  for (const scale of [1, 2, 3, 4, 7, 8])
    expect(
      brandMarkLayout(BRAND_GRID * scale).map((rect) => [...rect]),
    ).toEqual(brandMarkRects.map((rect) => rect.map((value) => value * scale)));
});

test("sizes the mark in whole device pixels", () => {
  expect(brandMarkPixels(20, 1)).toBe(20);
  expect(brandMarkPixels(20, 1.25)).toBe(25);
  expect(brandMarkPixels(16, 1.5)).toBe(24);
  expect(brandMarkPixels(8, 1)).toBe(BRAND_GRID);
  const svg = brandMarkSvg(25);
  expect(svg).toContain('viewBox="0 0 25 25"');
  expect(svg).toContain('fill="currentColor"');
  expect(svg).toContain('shape-rendering="crispEdges"');
});

test("draws only the rects it is given", () => {
  const layout = brandMarkLayout(56);
  const svg = brandMarkSvg(56, layout.slice(0, 3));
  expect([...svg.matchAll(/<rect /g)]).toHaveLength(3);
  expect(brandMarkSvg(56)).toContain(
    `<rect x="${layout[5]![0]}" y="${layout[5]![1]}" width="${layout[5]![2]}" height="${layout[5]![3]}"/>`,
  );
});
