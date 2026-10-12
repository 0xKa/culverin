import { defineRootChoice } from "../preferences/root-choice";

export type ApiLimitDisplay = "shown" | "hidden";

export const popupApiLimit = defineRootChoice<ApiLimitDisplay>({
  key: "culverin.popupApiLimit",
  values: ["shown", "hidden"],
  fallback: "hidden",
  attribute: "apiLimit",
});
