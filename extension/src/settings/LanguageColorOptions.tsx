import {
  languageColors,
  languageMarkers,
  type LanguageColorMode,
  type LanguageMarker,
} from "../appearance/language-colors";
import { SettingRow, TickChoice, type ChoiceOption } from "./SettingRow";
import { useRootChoice } from "./useRootChoice";

const modes: ChoiceOption<LanguageColorMode>[] = [
  { value: "language", label: "By language" },
  { value: "single", label: "Single color" },
];

const markers: ChoiceOption<LanguageMarker>[] = [
  {
    value: "square",
    label: (
      <>
        <span aria-hidden="true" className="size-2 bg-current" />
        Square
      </>
    ),
    name: "Square",
  },
  {
    value: "circle",
    label: (
      <>
        <span aria-hidden="true" className="size-2 rounded-full bg-current" />
        Circle
      </>
    ),
    name: "Circle",
  },
  { value: "none", label: "None" },
];

export function LanguageColorOptions() {
  const mode = useRootChoice(languageColors);
  const marker = useRootChoice(languageMarkers);

  return (
    <>
      <SettingRow
        id="language-colors"
        label="Language colors"
        hint="Each language keeps its own color, or every bar uses your accent."
        state={mode.state}
      >
        <TickChoice
          name="language-colors"
          options={modes}
          value={mode.value}
          disabled={!mode.value}
          onChange={mode.change}
        />
      </SettingRow>
      <SettingRow
        id="language-marker"
        label="Language markers"
        hint="Shown beside each language name."
        state={marker.state}
      >
        <TickChoice
          name="language-marker"
          options={markers}
          value={marker.value}
          disabled={!marker.value || mode.value === "single"}
          onChange={marker.change}
        />
      </SettingRow>
    </>
  );
}
