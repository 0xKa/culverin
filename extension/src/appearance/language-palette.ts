import { linguistColors } from "./linguist/colors";

export const FALLBACK_COLORS = [
  "5b8def",
  "9b6ad6",
  "d0679d",
  "d9734e",
  "b59a35",
  "5fa45b",
  "3fa3a3",
  "c45a5a",
] as const;

export type Oklch = { l: number; c: number; h: number };

export function fallbackColor(name: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length]!;
}

export function languageColor(name: string): string {
  return Object.hasOwn(linguistColors, name)
    ? linguistColors[name]!
    : fallbackColor(name);
}

export function hexToOklch(hex: string): Oklch {
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const chroma = Math.hypot(a, bb);
  const hue = (Math.atan2(bb, a) * 180) / Math.PI;
  return {
    l: lightness,
    c: chroma,
    h: chroma < 1e-4 ? 0 : (hue + 360) % 360,
  };
}

const styles = new Map<string, Record<string, string>>();

export function languageColorStyle(name: string): Record<string, string> {
  let style = styles.get(name);
  if (!style) {
    const { l, c, h } = hexToOklch(languageColor(name));
    style = {
      "--language-l": l.toFixed(4),
      "--language-c": c.toFixed(4),
      "--language-h": h.toFixed(2),
    };
    styles.set(name, style);
  }
  return style;
}
