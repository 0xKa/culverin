import { accent, type Accent } from "./accent";
import type { ColorScheme } from "./color-scheme";

export const iconSizes = [16, 32, 48, 128] as const;

const colorSchemes: readonly ColorScheme[] = ["light", "dark"];

function sizedPaths(name: string): Record<string, string> {
  return Object.fromEntries(
    iconSizes.map((size) => [size, `icons/${name}-${size}.png`]),
  );
}

export const installationIconPaths = sizedPaths("icon");

export function toolbarIconPaths(
  value: Accent,
  scheme: ColorScheme,
): Record<string, string> {
  return sizedPaths(`${scheme}-${value}`);
}

export const packagedIconFiles = [
  installationIconPaths,
  ...accent.values.flatMap((value) =>
    colorSchemes.map((scheme) => toolbarIconPaths(value, scheme)),
  ),
]
  .flatMap((paths) => Object.values(paths))
  .map((path) => path.slice("icons/".length))
  .sort();
