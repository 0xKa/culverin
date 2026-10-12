import { accent, type Accent } from "./accent";

export const iconSizes = [16, 32, 48, 128] as const;

export function toolbarIconPaths(value: Accent): Record<string, string> {
  return Object.fromEntries(
    iconSizes.map((size) => [
      size,
      `icons/${value === accent.fallback ? "icon" : `accent-${value}`}-${size}.png`,
    ]),
  );
}

export const toolbarIconFiles = accent.values
  .flatMap((value) => Object.values(toolbarIconPaths(value)))
  .map((path) => path.slice("icons/".length))
  .sort();
