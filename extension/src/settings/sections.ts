export const sections = [
  { id: "storage", label: "Storage" },
  { id: "ignore", label: "Culverin ignore" },
  { id: "counting", label: "Counting" },
  { id: "about", label: "About" },
] as const;

export type SectionId = (typeof sections)[number]["id"];

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
