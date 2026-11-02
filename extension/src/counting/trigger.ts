import { definePreference } from "../preferences/define";

export const COUNT_TRIGGER_KEY = "culverin.countTrigger";

export type CountTrigger = "manual" | "open";

export const countTrigger = definePreference<CountTrigger>({
  key: COUNT_TRIGGER_KEY,
  fallback: "manual",
  parse: (value) => (value === "open" ? "open" : undefined),
  isDefault: (value) => value === "manual",
});
