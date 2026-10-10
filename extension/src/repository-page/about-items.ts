import { definePreference } from "../preferences/define";

export const ABOUT_ITEMS = ["lines", "files", "size"] as const;

export type AboutItem = (typeof ABOUT_ITEMS)[number];

export type AboutLayout = { order: AboutItem[]; hidden: AboutItem[] };

export const defaultAboutLayout: AboutLayout = {
  order: [...ABOUT_ITEMS],
  hidden: [],
};

export function isAboutItem(value: unknown): value is AboutItem {
  return ABOUT_ITEMS.includes(value as AboutItem);
}

export function parseAboutLayout(value: unknown): AboutLayout | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const { order, hidden } = value as Record<string, unknown>;
  if (!Array.isArray(order) || !Array.isArray(hidden)) return undefined;
  const items = [...new Set([...order.filter(isAboutItem), ...ABOUT_ITEMS])];
  const hiddenItems = items.filter((item) => hidden.includes(item));
  return {
    order: items,
    hidden: hiddenItems.length === items.length ? [] : hiddenItems,
  };
}

export function shownItems(layout: AboutLayout): AboutItem[] {
  return layout.order.filter((item) => !layout.hidden.includes(item));
}

export function validShownItems(value: unknown): value is AboutItem[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isAboutItem) &&
    new Set(value).size === value.length
  );
}

export function moveItem(
  layout: AboutLayout,
  item: AboutItem,
  offset: -1 | 1,
): AboutLayout {
  const from = layout.order.indexOf(item);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= layout.order.length) return layout;
  const order = [...layout.order];
  [order[from], order[to]] = [order[to]!, order[from]!];
  return { ...layout, order };
}

export function toggleItem(layout: AboutLayout, item: AboutItem): AboutLayout {
  if (layout.hidden.includes(item))
    return {
      ...layout,
      hidden: layout.hidden.filter((other) => other !== item),
    };
  if (shownItems(layout).length === 1) return layout;
  return {
    ...layout,
    hidden: layout.order.filter(
      (other) => other === item || layout.hidden.includes(other),
    ),
  };
}

export const aboutLayout = definePreference<AboutLayout>({
  key: "culverin.aboutItems",
  fallback: defaultAboutLayout,
  parse: parseAboutLayout,
  isDefault: (layout) =>
    layout.hidden.length === 0 &&
    layout.order.every((item, index) => item === ABOUT_ITEMS[index]),
});
