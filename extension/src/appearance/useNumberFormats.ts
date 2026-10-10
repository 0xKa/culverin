import { useEffect, useState } from "preact/hooks";
import type { NumberFormats } from "../ui/format";
import {
  appearanceNumberPreferences,
  subscribeNumberFormats,
  type NumberFormatPreferences,
} from "./numbers";

export function useNumberFormats(
  preferences: NumberFormatPreferences = appearanceNumberPreferences,
) {
  const [formats, setFormats] = useState<NumberFormats>();
  useEffect(
    () => subscribeNumberFormats(setFormats, undefined, preferences),
    [preferences],
  );
  return [formats, setFormats] as const;
}
