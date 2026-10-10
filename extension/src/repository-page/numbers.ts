import { defineNumberFormats } from "../appearance/numbers";
import { defaultPageNumberFormats } from "./format";

export const PAGE_COUNT_FORMAT_KEY = "culverin.repositoryPage.countFormat";
export const PAGE_SIZE_UNITS_KEY = "culverin.repositoryPage.sizeUnits";

export const pageNumberPreferences = defineNumberFormats(
  { counts: PAGE_COUNT_FORMAT_KEY, sizes: PAGE_SIZE_UNITS_KEY },
  defaultPageNumberFormats,
);
