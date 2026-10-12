import { defineRootChoice } from "../preferences/root-choice";

export type Accent = "blue" | "copper" | "purple" | "pink" | "teal" | "slate";

export const accent = defineRootChoice<Accent>({
  key: "culverin.accent",
  values: ["blue", "copper", "purple", "pink", "teal", "slate"],
  fallback: "blue",
  attribute: "accent",
  aliases: { indigo: "purple", violet: "purple" },
});

export function followAccent(): void {
  accent.follow();
}
