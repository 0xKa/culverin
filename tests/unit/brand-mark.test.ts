import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  BRAND_GRID,
  brandMarkLayout,
  brandMarkPixels,
  brandMarkRects,
  brandMarkSvg,
} from "../../extension/src/ui/brand-mark";

test("matches the white symbol of the original icon artwork", () => {
  const source = readFileSync(
    "assets/original/culverin-original-stats.svg",
    "utf8",
  );
  const symbol = source.slice(source.indexOf('<g fill="#ffffff">'));
  const rects = [...symbol.matchAll(/<rect ([^>]*)\/>/g)].map(
    ([, attributes]) =>
      ["x", "y", "width", "height"].map(
        (name) =>
          Number(new RegExp(`${name}="(\\d+)"`).exec(attributes!)?.[1]) / 8,
      ),
  );
  expect(rects).toEqual(brandMarkRects.map((rect) => [...rect]));
});

test("draws equal strokes with equal device pixels at every size", () => {
  for (let pixels = BRAND_GRID; pixels <= 256; pixels++) {
    const [stem, top, bottom, ...lines] = brandMarkLayout(pixels);
    expect(bottom![3]).toBe(top![3]);
    expect(stem![2]).toBe(top![3]);
    expect(new Set(lines.map((line) => line[3])).size).toBe(1);
    expect(top![1] - stem![1]).toBe(
      stem![1] + stem![3] - bottom![1] - bottom![3],
    );
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
