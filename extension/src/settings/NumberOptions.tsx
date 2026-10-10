import { countFormat, sizeUnits } from "../appearance/numbers";
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

export function NumberOptions() {
  const [formats, setFormats] = useNumberFormats();
  const countAction = useAction();
  const sizeAction = useAction();

  function changeCounts(value: CountFormat): void {
    if (!formats) return;
    setFormats({ ...formats, counts: value });
    void countAction.run(() => countFormat.write(value), {
      restore: () =>
        void countFormat
          .read()
          .then((counts) =>
            setFormats((current) => current && { ...current, counts }),
          ),
    });
  }

  function changeSizes(value: SizeUnits): void {
    if (!formats) return;
    setFormats({ ...formats, sizes: value });
    void sizeAction.run(() => sizeUnits.write(value), {
      restore: () =>
        void sizeUnits
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
                  name="count-format"
                  value={option.value}
                  className="size-4 translate-y-0.5"
                  checked={formats?.counts === option.value}
                  onChange={() => changeCounts(option.value)}
                />
                <span className="font-medium">{option.label}</span>
                <span className="text-muted col-start-2 text-sm">
                  {formatCount(12_480, option.value)} code lines
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <ActionStatus
          id="count-format-status"
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
                  name="size-units"
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
          id="size-units-status"
          state={sizeAction.state}
          className="absolute top-0 right-0 h-[1.375rem]"
        />
      </div>
      <p className="text-muted m-0 text-sm">
        Applies to the popup, saved results, and this preview. Hover or focus
        values to see exact counts and bytes.
      </p>
    </div>
  );
}
