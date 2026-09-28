import type { LanguageCounts } from "../counter/result";

export const textLanguages = ["Djot", "MDX", "Markdown", "Plain Text"];

export function isTextLanguage(language: string): boolean {
  return textLanguages.includes(language);
}

export function textLines(languages: LanguageCounts[]): number {
  return languages
    .filter((row) => isTextLanguage(row.language))
    .reduce((sum, row) => sum + row.comments, 0);
}
