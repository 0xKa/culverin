import {
  languageColors,
  languageMarkers,
  type LanguageColorMode,
  type LanguageMarker,
} from "../appearance/language-colors";
import { ActionStatus, type useAction } from "./ActionStatus";
import { useRootChoice } from "./useRootChoice";

type Option<T> = { value: T; label: string; detail: string };

const modes: Option<LanguageColorMode>[] = [
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

const markers: Option<LanguageMarker>[] = [
  {
    value: "square",
    label: "Square",
    detail: "A small square beside each language name.",
  },
  {
    value: "circle",
    label: "Circle",
    detail: "A small circle beside each language name.",
  },
  { value: "none", label: "None", detail: "Color only the bars." },
];

function Choice<T extends string>({
  legend,
  name,
  options,
  value,
  disabled,
  columns,
  state,
  onChange,
}: {
  legend: string;
  name: string;
  options: Option<T>[];
  value: T | undefined;
  disabled: boolean;
  columns: string;
  state: ReturnType<typeof useAction>["state"];
  onChange: (value: T) => void;
}) {
  return (
    <div className="relative">
      <fieldset className="m-0 border-0 p-0" disabled={disabled}>
        <legend className="text-md mb-3 p-0 font-semibold">{legend}</legend>
        <div className={`grid gap-2.5 ${columns}`}>
          {options.map((option) => (
            <label
              key={option.value}
              className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 has-disabled:hover:border-divider grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color,opacity] duration-150 has-disabled:cursor-default has-disabled:opacity-60"
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                className="size-4 translate-y-0.5"
                checked={value === option.value}
                onChange={() => onChange(option.value)}
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
        id={`${name}-status`}
        state={state}
        className="absolute top-0 right-0 h-[1.375rem]"
      />
    </div>
  );
}

export function LanguageColorOptions() {
  const mode = useRootChoice(languageColors);
  const marker = useRootChoice(languageMarkers);

  return (
    <div className="border-divider mt-5 grid gap-5 border-t pt-5">
      <Choice
        legend="Language colors"
        name="language-colors"
        options={modes}
        value={mode.value}
        disabled={!mode.value}
        columns="sm:grid-cols-2"
        state={mode.state}
        onChange={mode.change}
      />
      <Choice
        legend="Language markers"
        name="language-marker"
        options={markers}
        value={marker.value}
        disabled={!marker.value || mode.value === "single"}
        columns="sm:grid-cols-3"
        state={marker.state}
        onChange={marker.change}
      />
    </div>
  );
}
