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

const css = readFileSync(resolve(root, "extension/src/ui/styles.css"), "utf8");

function section(start: string, end: string, from = 0): string {
  const begin = css.indexOf(start, from);
  const finish = css.indexOf(end, begin + start.length);
  expect(begin).toBeGreaterThanOrEqual(0);
  expect(finish).toBeGreaterThan(begin);
  return css.slice(begin, finish);
}

const themeBlock = section("@theme {", "\n:root {");
const rootStart = css.indexOf("\n:root {");
const rootLight = section("\n:root {", "@variant dark {");
const rootDark = section(
  "@variant dark {",
  ':root[data-contrast="high"] {',
  rootStart,
);
const highStart = css.indexOf(':root[data-contrast="high"] {');
const highLight = section(':root[data-contrast="high"] {', "@variant dark {");
const highDark = section("@variant dark {", "@layer base", highStart);

function variable(blocks: string[], name: string): string {
  for (const block of blocks) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
    if (match) return match[1]!.trim();
  }
  throw new Error(`missing ${name}`);
}

function oklch(value: string): [number, number, number] {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`unexpected color ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function luminance([l, c, h]: [number, number, number]): number {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  const [red, green, blue] = [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [
    number,
    number,
    number,
  ];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const modes = {
  light: { blocks: [rootLight, themeBlock], minimum: 3 },
  dark: { blocks: [rootDark, rootLight, themeBlock], minimum: 3 },
  "high contrast light": {
    blocks: [highLight, rootLight, themeBlock],
    minimum: 4.5,
  },
  "high contrast dark": {
    blocks: [highDark, highLight, rootDark, rootLight, themeBlock],
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
