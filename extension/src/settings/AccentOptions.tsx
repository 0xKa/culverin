import { accent, type Accent } from "../appearance/accent";
import { ActionStatus } from "./ActionStatus";
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
    <div className="border-divider mt-5 border-t pt-5">
      <div className="relative">
        <fieldset className="m-0 border-0 p-0" disabled={!choice.value}>
          <legend className="text-md mb-1 p-0 font-semibold">
            Accent color
          </legend>
          <p className="text-muted m-0 mb-3 text-sm">
            Used for the Culverin icon, highlights, links, buttons, and
            single-color language bars.
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-2.5">
            {options.map((option) => (
              <label
                key={option.value}
                className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 has-disabled:hover:border-divider flex cursor-pointer items-center gap-2.5 rounded-lg border px-3.5 py-2.5 transition-[border-color,background-color,opacity] duration-150 has-disabled:cursor-default has-disabled:opacity-60"
              >
                <input
                  type="radio"
                  name="accent"
                  value={option.value}
                  className="size-4 shrink-0"
                  checked={choice.value === option.value}
                  onChange={() => choice.change(option.value)}
                />
                <span
                  data-accent={option.value}
                  className="accent-swatch size-3.5 shrink-0 shadow-[inset_0_0_0_1px_oklch(0_0_0/0.12)] forced-colors:hidden"
                  aria-hidden="true"
                />
                <span className="font-medium">{option.label}</span>
                {option.value === accent.fallback && (
                  <span className="text-muted ml-auto text-sm">Default</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
        <ActionStatus
          id="accent-status"
          state={choice.state}
          className="absolute top-0 right-0 h-[1.375rem]"
        />
      </div>
    </div>
  );
}
