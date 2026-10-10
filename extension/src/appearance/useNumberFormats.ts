import { useEffect, useState } from "preact/hooks";
import type { NumberFormats } from "../ui/format";
import { subscribeNumberFormats } from "./numbers";

export function useNumberFormats() {
  const [formats, setFormats] = useState<NumberFormats>();
  useEffect(() => subscribeNumberFormats(setFormats), []);
  return [formats, setFormats] as const;
}
