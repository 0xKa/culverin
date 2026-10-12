import { defineRootChoice } from "../preferences/root-choice";

export type Accent = "blue" | "indigo" | "violet" | "pink" | "teal" | "slate";

export const accent = defineRootChoice<Accent>({
  key: "culverin.accent",
  values: ["blue", "indigo", "violet", "pink", "teal", "slate"],
  fallback: "blue",
  attribute: "accent",
});

export function followAccent(): void {
  accent.follow();
}
