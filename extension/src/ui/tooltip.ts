export type TipPlacement = {
  align?: "start" | "end";
  side?: "top" | "bottom" | "left";
};

export function tipPlacement({
  align = "start",
  side = "bottom",
}: TipPlacement) {
  return { "data-tip-align": align, "data-tip-side": side };
}

export function tip(text: string | undefined, placement: TipPlacement = {}) {
  if (!text) return {};
  return {
    "data-tip": text,
    "aria-description": text,
    tabIndex: 0,
    ...tipPlacement(placement),
  };
}
