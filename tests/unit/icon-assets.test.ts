import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { accent } from "../../extension/src/appearance/accent";
import {
  iconSizes,
  installationIconPaths,
  packagedIconFiles,
  toolbarIconPaths,
} from "../../extension/src/appearance/icons";

const directory = resolve(import.meta.dirname, "../../extension/public");

function pixels(path: string, size: number): number[][] {
  const data = readFileSync(resolve(directory, path));
  expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(data.readUInt32BE(16)).toBe(size);
  expect(data.readUInt32BE(20)).toBe(size);
  expect([...data.subarray(24, 26)]).toEqual([8, 6]);
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < data.length;) {
    const length = data.readUInt32BE(offset);
    if (data.toString("ascii", offset + 4, offset + 8) === "IDAT")
      chunks.push(data.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const rows = inflateSync(Buffer.concat(chunks));
  expect(rows.length).toBe(size * (1 + size * 4));
  const output: number[][] = [];
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    expect(rows[row]).toBe(0);
    for (let x = 0; x < size; x++)
      output.push([...rows.subarray(row + 1 + x * 4, row + 5 + x * 4)]);
  }
  return output;
}

function luminance(pixel: number[]): number {
  const [red, green, blue] = pixel.slice(0, 3).map((channel) => {
    const encoded = channel / 255;
    return encoded <= 0.04045
      ? encoded / 12.92
      : ((encoded + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(pixel: number[], background: number[]): number {
  const values = [luminance(pixel), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const white = [255, 255, 255];
const darkSurface = [41, 42, 45];

function mark(path: string, size: number): number[] {
  const image = pixels(path, size);
  const colors = new Set(
    image.filter((pixel) => pixel[3] !== 0).map((pixel) => pixel.join(",")),
  );
  expect(image.every((pixel) => pixel[3] === 0 || pixel[3] === 255)).toBe(true);
  expect(image[0]![3]).toBe(0);
  expect(colors.size).toBe(1);
  return [...colors][0]!.split(",").map(Number);
}

test("the packaged icons match the manifest and the expected files", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  );
  expect(manifest.icons).toEqual(installationIconPaths);
  expect(manifest.action.default_icon).toEqual(installationIconPaths);
  expect(readdirSync(resolve(directory, "icons")).sort()).toEqual(
    packagedIconFiles,
  );
});

test("the installation icon has no background and reads on light and dark surfaces", () => {
  for (const size of iconSizes) {
    const color = mark(installationIconPaths[size]!, size);
    expect(contrast(color, white)).toBeGreaterThanOrEqual(3);
    expect(contrast(color, darkSurface)).toBeGreaterThanOrEqual(3);
  }
});

test("toolbar icons keep the same shape without a background, in one readable color per accent and scheme", () => {
  const colors = new Set<string>();
  for (const value of accent.values) {
    for (const [scheme, surface] of [
      ["light", white],
      ["dark", darkSurface],
    ] as const) {
      let expected: number[] | undefined;
      for (const size of iconSizes) {
        const path = toolbarIconPaths(value, scheme)[size]!;
        const color = mark(path, size);
        expected ??= color;
        expect(color).toEqual(expected);
        expect(pixels(path, size).map((pixel) => pixel[3])).toEqual(
          pixels(installationIconPaths[size]!, size).map((pixel) => pixel[3]),
        );
      }
      expect(contrast(expected!, surface)).toBeGreaterThanOrEqual(4.5);
      colors.add(expected!.join(","));
    }
  }
  expect(colors.size).toBe(accent.values.length * 2);
});
