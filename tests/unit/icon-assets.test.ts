import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { accent } from "../../extension/src/appearance/accent";
import {
  iconSizes,
  toolbarIconFiles,
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

test("packaged accent icons preserve the white artwork, stay readable, and keep the installation icon blue", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  );
  expect(manifest.icons).toEqual(toolbarIconPaths("blue"));
  expect(manifest.action.default_icon).toEqual(toolbarIconPaths("blue"));
  expect(readdirSync(resolve(directory, "icons")).sort()).toEqual(
    toolbarIconFiles,
  );
  const backgrounds = new Set<string>();
  for (const value of accent.values) {
    let background: number[] | undefined;
    for (const size of iconSizes) {
      const source = pixels(toolbarIconPaths("blue")[size]!, size);
      const variant = pixels(toolbarIconPaths(value)[size]!, size);
      background ??= variant[0]!;
      expect(variant[0]).toEqual(background);
      const white = [255, 255, 255, 255];
      expect(variant.every((pixel) => pixel[3] === 255)).toBe(true);
      expect(
        variant.map((pixel) =>
          pixel.every((channel, i) => channel === white[i]),
        ),
      ).toEqual(
        source.map((pixel) =>
          pixel.every((channel, i) => channel === white[i]),
        ),
      );
      expect(new Set(variant.map((pixel) => pixel.join(","))).size).toBe(2);
    }
    if (value === "blue") expect(background).toEqual([29, 56, 92, 255]);
    const [red, green, blue] = background!.slice(0, 3).map((channel) => {
      const encoded = channel / 255;
      return encoded <= 0.04045
        ? encoded / 12.92
        : ((encoded + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
    expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
    backgrounds.add(background!.join(","));
  }
  expect(backgrounds.size).toBe(accent.values.length);
});
