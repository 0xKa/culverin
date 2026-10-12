import { languageColorStyle } from "../appearance/language-palette";

export type BreakdownKind = "code" | "text" | "other";

export function breakdownColor(kind: BreakdownKind, name: string) {
  if (kind === "other")
    return { row: {}, swatch: false, fill: "bg-control" } as const;
  return {
    row: {
      className: "language-color",
      "data-subdued": kind === "text" ? "" : undefined,
      style: languageColorStyle(name),
    },
    swatch: true,
    fill: "language-fill bg-accent",
  } as const;
}
