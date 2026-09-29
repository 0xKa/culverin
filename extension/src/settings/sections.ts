export const sections = [
  { id: "ignore", label: "Culverin ignore" },
  { id: "storage", label: "Storage" },
] as const;

export type SectionId = (typeof sections)[number]["id"];

export function sectionFromHash(hash: string): SectionId {
  const id = hash.replace(/^#/, "");
  return sections.find((section) => section.id === id)?.id ?? "ignore";
}
