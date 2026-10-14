export const sections = [
  { id: "appearance", label: "Appearance", group: "Display" },
  { id: "repository-page", label: "Repository page", group: "Display" },
  { id: "counting", label: "When to count", group: "Counting" },
  { id: "ignore", label: "Ignored files", group: "Counting" },
  { id: "github", label: "GitHub", group: "Account & data" },
  { id: "storage", label: "Saved results", group: "Account & data" },
  { id: "about", label: "About" },
] as const;

export type Section = (typeof sections)[number];

export type SectionId = Section["id"];

export const sectionGroups = sections.reduce<
  { name?: string; sections: Section[] }[]
>((groups, section) => {
  const name = "group" in section ? section.group : undefined;
  const last = groups.at(-1);
  if (last && last.name === name) last.sections.push(section);
  else groups.push({ name, sections: [section] });
  return groups;
}, []);

export const SECTION_KEY = "culverin.settings.section";

export function parseSection(
  value: string | null | undefined,
): SectionId | undefined {
  const id = value?.replace(/^#/, "");
  return sections.find((section) => section.id === id)?.id;
}

export function initialSection(
  hash: string,
  remembered: string | null,
): SectionId {
  return parseSection(hash) ?? parseSection(remembered) ?? sections[0].id;
}

export function readSection(
  storage: Pick<Storage, "getItem"> = localStorage,
): string | null {
  try {
    return storage.getItem(SECTION_KEY);
  } catch {
    return null;
  }
}

export function rememberSection(
  id: SectionId,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(SECTION_KEY, id);
  } catch {
    return;
  }
}
