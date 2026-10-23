import {
  appearanceNumberPreferences,
  type NumberFormatPreferences,
} from "../appearance/numbers";
import { useNumberFormats } from "../appearance/useNumberFormats";
import { formatCount, type CountFormat, type SizeUnits } from "../ui/format";
import { useAction } from "./ActionStatus";
import { optionText, preferenceReset } from "./reset";
import { SettingRow, TickChoice } from "./SettingRow";

const counts: { value: CountFormat; name: string }[] = [
  { value: "full", name: "Full" },
  { value: "abbreviated", name: "Abbreviated" },
];

const sizes: { value: SizeUnits; label: string; name: string }[] = [
  { value: "binary", label: "KiB", name: "Binary, KiB" },
  { value: "decimal", label: "KB", name: "Decimal, KB" },
];

export function NumberOptions({
  preferences = appearanceNumberPreferences,
  idPrefix = "",
  formatExample = formatCount,
}: {
  preferences?: NumberFormatPreferences;
  idPrefix?: string;
  formatExample?: (value: number, format: CountFormat) => string;
} = {}) {
  const [formats, setFormats] = useNumberFormats(preferences);
  const countAction = useAction();
  const sizeAction = useAction();

  function changeCounts(value: CountFormat): void {
    if (!formats) return;
    setFormats({ ...formats, counts: value });
    void countAction.run(() => preferences.counts.write(value), {
      restore: () =>
        void preferences.counts
          .read()
          .then((counts) =>
            setFormats((current) => current && { ...current, counts }),
          ),
    });
  }

  function changeSizes(value: SizeUnits): void {
    if (!formats) return;
    setFormats({ ...formats, sizes: value });
    void sizeAction.run(() => preferences.sizes.write(value), {
      restore: () =>
        void preferences.sizes
          .read()
          .then((sizes) =>
            setFormats((current) => current && { ...current, sizes }),
          ),
    });
  }

  const countOptions = counts.map((option) => {
    const example = formatExample(12_480, option.value);
    return {
      value: option.value,
      label: example,
      name: `${option.name}, ${example}`,
      mono: true,
    };
  });

  return (
    <>
      <SettingRow
        id={`${idPrefix}count-format`}
        label="Numbers"
        hint="Full counts or short ones."
        state={countAction.state}
        reset={preferenceReset(
          preferences.counts,
          formats?.counts,
          optionText(countOptions, preferences.counts.fallback),
          changeCounts,
        )}
      >
        <TickChoice
          name={`${idPrefix}count-format`}
          options={countOptions}
          value={formats?.counts}
          disabled={!formats}
          onChange={changeCounts}
        />
      </SettingRow>
      <SettingRow
        id={`${idPrefix}size-units`}
        label="Size units"
        hint="1 KiB = 1,024 bytes; 1 KB = 1,000 bytes."
        state={sizeAction.state}
        reset={preferenceReset(
          preferences.sizes,
          formats?.sizes,
          optionText(sizes, preferences.sizes.fallback),
          changeSizes,
        )}
      >
        <TickChoice
          name={`${idPrefix}size-units`}
          options={sizes.map((option) => ({ ...option, mono: true }))}
          value={formats?.sizes}
          disabled={!formats}
          onChange={changeSizes}
        />
      </SettingRow>
    </>
  );
}
