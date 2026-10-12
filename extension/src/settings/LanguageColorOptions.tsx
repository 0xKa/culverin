import { useEffect, useState } from "preact/hooks";
import {
  languageColors,
  subscribeLanguageColors,
  type LanguageColorMode,
} from "../appearance/language-colors";
import { ActionStatus, useAction } from "./ActionStatus";

const options: { value: LanguageColorMode; label: string; detail: string }[] = [
  {
    value: "language",
    label: "By language",
    detail: "Use a consistent color for each language.",
  },
  {
    value: "single",
    label: "Single color",
    detail: "Use Culverin's accent for language bars.",
  },
];

export function LanguageColorOptions() {
  const [mode, setMode] = useState<LanguageColorMode>();
  const { state, run } = useAction();

  useEffect(() => subscribeLanguageColors(setMode), []);

  function change(next: LanguageColorMode): void {
    setMode(next);
    void run(() => languageColors.write(next), {
      restore: () => void languageColors.read().then(setMode),
    });
  }

  return (
    <div className="border-divider relative mt-5 border-t pt-5">
      <fieldset className="m-0 border-0 p-0" disabled={!mode}>
        <legend className="text-md mb-3 p-0 font-semibold">
          Language colors
        </legend>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {options.map((option) => (
            <label
              key={option.value}
              className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150"
            >
              <input
                type="radio"
                name="language-colors"
                value={option.value}
                className="size-4 translate-y-0.5"
                checked={mode === option.value}
                onChange={() => change(option.value)}
              />
              <span className="font-medium">{option.label}</span>
              <span className="text-muted col-start-2 text-sm">
                {option.detail}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <ActionStatus
        id="language-colors-status"
        state={state}
        className="absolute top-5 right-0 h-[1.375rem]"
      />
    </div>
  );
}
