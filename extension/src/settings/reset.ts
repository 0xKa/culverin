import type { Preference } from "../preferences/define";

export type SettingReset = {
  to: string;
  modified: boolean;
  disabled?: boolean;
  onReset: () => void;
};

export function preferenceReset<T>(
  preference: Pick<Preference<T>, "fallback" | "isDefault">,
  value: T | undefined,
  to: string,
  change: (value: T) => void,
): SettingReset {
  return {
    to,
    modified: value !== undefined && !preference.isDefault(value),
    onReset: () => change(preference.fallback),
  };
}

export function optionText<T>(
  options: readonly { value: T; label: unknown; name?: string }[],
  value: T,
): string {
  const option = options.find((option) => option.value === value);
  if (typeof option?.label === "string") return option.label;
  return option?.name ?? String(value);
}
