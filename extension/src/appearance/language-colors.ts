import { defineRootChoice } from "../preferences/root-choice";

export type LanguageColorMode = "language" | "single";

export type LanguageMarker = "square" | "circle" | "none";

export const languageColors = defineRootChoice<LanguageColorMode>({
  key: "culverin.languageColors",
  values: ["language", "single"],
  fallback: "language",
  attribute: "languageColors",
});

export const languageMarkers = defineRootChoice<LanguageMarker>({
  key: "culverin.languageMarker",
  values: ["square", "circle", "none"],
  fallback: "square",
  attribute: "languageMarker",
});

export function followLanguageColors(): void {
  languageColors.follow();
  languageMarkers.follow();
}
