import {
  formatCount,
  type CountFormat,
  type NumberFormats,
} from "../ui/format";

export const defaultPageNumberFormats: NumberFormats = {
  counts: "abbreviated",
  sizes: "binary",
};

export function formatPageCount(
  value: number,
  format: CountFormat = "abbreviated",
): string {
  return formatCount(value, format, "en").replace("K", "k");
}
