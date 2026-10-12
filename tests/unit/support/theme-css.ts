import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const css = readFileSync(
  resolve(import.meta.dirname, "../../../extension/src/ui/styles.css"),
  "utf8",
);

function section(start: string, end: string, from = 0): string {
  const begin = css.indexOf(start, from);
  const finish = css.indexOf(end, begin + start.length);
  if (begin < 0 || finish <= begin) throw new Error(`missing section ${start}`);
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

export const themeModes = {
  light: [rootLight, themeBlock],
  dark: [rootDark, rootLight, themeBlock],
  "high contrast light": [highLight, rootLight, themeBlock],
  "high contrast dark": [highDark, highLight, rootDark, rootLight, themeBlock],
};

export function variable(blocks: string[], name: string): string {
  for (const block of blocks) {
    const match = new RegExp(`${name}:\\s*([^;]+);`).exec(block);
    if (match)
      return match[1]!
        .replace(/\s+/g, " ")
        .replace(/\( /g, "(")
        .replace(/ \)/g, ")")
        .trim();
  }
  throw new Error(`missing ${name}`);
}

export function oklch(value: string): [number, number, number] {
  const match = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value);
  if (!match) throw new Error(`unexpected color ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function luminance([l, c, h]: [number, number, number]): number {
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

export function contrast(first: number, second: number): number {
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}
