import {
  appearanceNumberPreferences,
  type NumberFormatPreferences,
} from "../appearance/numbers";
import { useNumberFormats } from "../appearance/useNumberFormats";
import { formatCount, type CountFormat, type SizeUnits } from "../ui/format";
import { ActionStatus, useAction } from "./ActionStatus";

const counts: { value: CountFormat; label: string }[] = [
  { value: "full", label: "Full" },
  { value: "abbreviated", label: "Abbreviated" },
];

const sizes: { value: SizeUnits; label: string; detail: string }[] = [
  {
    value: "binary",
    label: "Binary",
    detail: "KiB, MiB, GiB · 1 KiB = 1,024 bytes",
  },
  {
    value: "decimal",
    label: "Decimal",
    detail: "KB, MB, GB · 1 KB = 1,000 bytes",
  },
];

export function NumberOptions({
  preferences = appearanceNumberPreferences,
  idPrefix = "",
  description = "Applies to the popup, saved results, and this preview. Hover or focus values to see exact counts and bytes.",
  formatExample = formatCount,
}: {
  preferences?: NumberFormatPreferences;
  idPrefix?: string;
  description?: string;
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

  return (
    <div className="border-divider mt-5 grid gap-5 border-t pt-5">
      <div className="relative">
        <fieldset className="m-0 border-0 p-0" disabled={!formats}>
          <legend className="text-md mb-3 p-0 font-semibold">Numbers</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {counts.map((option) => (
              <label
                key={option.value}
                className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150"
              >
                <input
                  type="radio"
                  name={`${idPrefix}count-format`}
                  value={option.value}
                  className="size-4 translate-y-0.5"
                  checked={formats?.counts === option.value}
                  onChange={() => changeCounts(option.value)}
                />
                <span className="font-medium">{option.label}</span>
                <span className="text-muted col-start-2 text-sm">
                  {formatExample(12_480, option.value)} code lines
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ActionStatus
          id={`${idPrefix}count-format-status`}
          state={countAction.state}
          className="absolute top-0 right-0 h-[1.375rem]"
        />
      </div>
      <div className="relative">
        <fieldset className="m-0 border-0 p-0" disabled={!formats}>
          <legend className="text-md mb-3 p-0 font-semibold">Size units</legend>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {sizes.map((option) => (
              <label
                key={option.value}
                className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150"
              >
                <input
                  type="radio"
                  name={`${idPrefix}size-units`}
                  value={option.value}
                  className="size-4 translate-y-0.5"
                  checked={formats?.sizes === option.value}
                  onChange={() => changeSizes(option.value)}
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
          id={`${idPrefix}size-units-status`}
          state={sizeAction.state}
          className="absolute top-0 right-0 h-[1.375rem]"
        />
      </div>
      <p className="text-muted m-0 text-sm">{description}</p>
    </div>
  );
}
