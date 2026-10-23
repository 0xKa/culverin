import { accent, type Accent } from "../appearance/accent";
import { optionText, preferenceReset } from "./reset";
import { SettingRow } from "./SettingRow";
import { useRootChoice } from "./useRootChoice";

const options: { value: Accent; label: string }[] = [
  { value: "blue", label: "Blue" },
  { value: "copper", label: "Copper" },
  { value: "purple", label: "Purple" },
  { value: "pink", label: "Pink" },
  { value: "teal", label: "Teal" },
  { value: "slate", label: "Slate" },
];

export function AccentOptions() {
  const choice = useRootChoice(accent);

  return (
    <SettingRow
      id="accent"
      label="Accent color"
      hint="Used for the Culverin icon, highlights, links, buttons, and single-color language bars."
      state={choice.state}
      reset={preferenceReset(
        accent,
        choice.value,
        optionText(options, accent.fallback),
        choice.change,
      )}
    >
      {options.map((option) => (
        <label
          key={option.value}
          data-tip={option.label}
          data-tip-align="end"
          className="ticks ticks-quiet has-focus-visible:outline-accent has-disabled:opacity-60 inline-flex cursor-pointer p-1.5 has-disabled:cursor-default has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
        >
          <input
            type="radio"
            name="accent"
            value={option.value}
            className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
            checked={choice.value === option.value}
            disabled={!choice.value}
            onChange={() => choice.change(option.value)}
          />
          <span
            data-accent={option.value}
            className="accent-swatch block size-4 shadow-[inset_0_0_0_1px_oklch(0_0_0/0.12)] forced-colors:hidden"
            aria-hidden="true"
          />
          <span className="forced-colors:not-sr-only sr-only">
            {option.label}
          </span>
        </label>
      ))}
    </SettingRow>
  );
}
