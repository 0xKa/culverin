import { definePreference } from "../preferences/define";

export const ABOUT_VISIBILITIES = ["all", "public", "none"] as const;

export type AboutVisibility = (typeof ABOUT_VISIBILITIES)[number];

export function validAboutVisibility(value: unknown): value is AboutVisibility {
  return ABOUT_VISIBILITIES.includes(value as AboutVisibility);
}

export const aboutVisibility = definePreference<AboutVisibility>({
  key: "culverin.aboutVisibility",
  fallback: "all",
  parse: (value) => (validAboutVisibility(value) ? value : undefined),
  isDefault: (value) => value === "all",
});

export function showAbout(
  visibility: AboutVisibility,
  privateRepository: boolean | undefined,
): boolean {
  if (visibility === "none") return false;
  return visibility !== "public" || !privateRepository;
}
