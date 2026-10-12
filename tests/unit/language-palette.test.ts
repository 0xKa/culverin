import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { linguistColors } from "../../extension/src/appearance/linguist/colors";
import {
  FALLBACK_COLORS,
  fallbackColor,
  hexToOklch,
  languageColor,
  languageColorStyle,
} from "../../extension/src/appearance/language-palette";
import {
  contrast,
  css,
  luminance,
  oklch,
  themeModes,
  variable,
} from "./support/theme-css";

const root = resolve(import.meta.dirname, "../..");

function tokeiNames(): string[] {
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--locked", "--format-version", "1"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as { packages: { name: string; version: string; manifest_path: string }[] };
  const tokei = metadata.packages.find((item) => item.name === "tokei")!;
  expect(tokei.version).toBe("15.0.0");
  const languages = JSON.parse(
    readFileSync(join(dirname(tokei.manifest_path), "languages.json"), "utf8"),
  ).languages as Record<string, { name?: string }>;
  return Object.entries(languages).map(([key, entry]) => entry.name ?? key);
}

test("every pinned Tokei language resolves to a valid color", () => {
  const names = tokeiNames();
  expect(names.length).toBe(333);
  for (const name of names)
    expect(languageColor(name)).toMatch(/^[0-9a-f]{6}$/);
  const known = new Set(names);
  const matched = Object.keys(linguistColors);
  expect(matched.length).toBe(230);
  for (const name of matched) expect(known.has(name)).toBe(true);
  expect(matched).toEqual([...matched].sort());
});

test("uses Linguist colors for matched and aliased names", () => {
  expect(languageColor("Rust")).toBe("dea584");
  expect(languageColor("TypeScript")).toBe("3178c6");
  expect(languageColor("BASH")).toBe(languageColor("Shell"));
  expect(languageColor("C Header")).toBe(languageColor("C"));
  expect(languageColor("C++ Header")).toBe(languageColor("C++"));
  expect(languageColor("JSX")).toBe(languageColor("JavaScript"));
  expect(languageColor("Jupyter Notebooks")).toBe("da5b0b");
});

test("falls back to a stable color for unmatched and unknown names", () => {
  for (const name of [
    "Plain Text",
    "Djot",
    "A future language",
    "constructor",
    "__proto__",
    "",
  ]) {
    const color = languageColor(name);
    expect(FALLBACK_COLORS).toContain(
      color as (typeof FALLBACK_COLORS)[number],
    );
    expect(color).toBe(fallbackColor(name));
    expect(languageColor(name)).toBe(color);
  }
  expect(
    new Set(
      ["Djot", "Plain Text", "Unison", "Uiua", "Kaem", "ZoKrates"].map(
        fallbackColor,
      ),
    ).size,
  ).toBeGreaterThan(1);
});

test("styles depend only on the language name", () => {
  const rust = languageColorStyle("Rust");
  languageColorStyle("TypeScript");
  expect(languageColorStyle("Rust")).toEqual(rust);
  expect(rust).toEqual({
    "--language-l": expect.stringMatching(/^0\.\d{4}$/),
    "--language-c": expect.stringMatching(/^0\.\d{4}$/),
    "--language-h": expect.stringMatching(/^\d+\.\d{2}$/),
  });
});

test("converts sRGB colors to OKLCH", () => {
  const red = hexToOklch("ff0000");
  expect(red.l).toBeCloseTo(0.628, 3);
  expect(red.c).toBeCloseTo(0.2577, 3);
  expect(red.h).toBeCloseTo(29.23, 1);
  expect(hexToOklch("ffffff")).toEqual({
    l: expect.closeTo(1, 4),
    c: expect.closeTo(0, 4),
    h: 0,
  });
  expect(hexToOklch("555555").h).toBe(0);
});

const modes = {
  light: { blocks: themeModes.light, minimum: 3 },
  dark: { blocks: themeModes.dark, minimum: 3 },
  "high contrast light": {
    blocks: themeModes["high contrast light"],
    minimum: 4.5,
  },
  "high contrast dark": {
    blocks: themeModes["high contrast dark"],
    minimum: 4.5,
  },
};

const subdued = Number(
  /calc\(var\(--language-c\) \* ([\d.]+)\)/.exec(css)?.[1],
);

test("language bars and swatches stay readable in every theme and contrast mode", () => {
  expect(subdued).toBeGreaterThan(0);
  const colors = [
    ...new Set([...Object.values(linguistColors), ...FALLBACK_COLORS]),
  ];
  for (const [mode, { blocks, minimum }] of Object.entries(modes)) {
    const low = Number(variable(blocks, "--language-min-l"));
    const high = Number(variable(blocks, "--language-max-l"));
    const backgrounds = [
      "--color-track",
      "--color-canvas",
      "--color-raised",
    ].map((name) => luminance(oklch(variable(blocks, name))));
    const failures: string[] = [];
    for (const hex of colors) {
      const { l, c, h } = hexToOklch(hex);
      const lightness = Math.min(Math.max(l, low), high);
      for (const chroma of [c, c * subdued]) {
        const shown = luminance([lightness, chroma, h]);
        for (const background of backgrounds)
          if (contrast(shown, background) < minimum)
            failures.push(
              `${mode} ${hex} ${contrast(shown, background).toFixed(2)}`,
            );
      }
    }
    expect(failures).toEqual([]);
  }
});
