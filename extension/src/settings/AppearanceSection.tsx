import { useEffect, useState } from "preact/hooks";
import { theme, type Theme } from "../appearance/theme";
import { Panel, SectionHeader } from "./layout";
import { ActionStatus, useAction } from "./ActionStatus";
import { ThemeSample } from "./ThemeSample";

const options: { value: Theme; label: string; detail: string }[] = [
  {
    value: "system",
    label: "System",
    detail: "Light or dark to match your device or browser.",
  },
  { value: "light", label: "Light", detail: "Always light." },
  { value: "dark", label: "Dark", detail: "Always dark." },
];

export function AppearanceSection({ hidden }: { hidden: boolean }) {
  const [choice, setChoice] = useState<Theme>();
  const { state, run } = useAction();

  useEffect(() => {
    void theme.read().then(setChoice);
  }, []);

  function change(next: Theme): void {
    setChoice(next);
    void run(() => theme.write(next), {
      restore: () => void theme.read().then(setChoice),
    });
  }

  return (
    <section aria-labelledby="appearance-heading" hidden={hidden}>
      <SectionHeader id="appearance-heading" title="Appearance">
        How the popup and settings look. GitHub repository pages keep your
        GitHub theme.
      </SectionHeader>
      <Panel className="relative">
        <fieldset className="m-0 border-0 p-0">
          <legend className="text-md mb-3 p-0 font-semibold">Theme</legend>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {options.map((option) => (
              <label
                key={option.value}
                className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150"
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  className="size-4 translate-y-0.5"
                  checked={choice === option.value}
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
          id="appearance-status"
          state={state}
          className="absolute top-4 right-4 h-[1.375rem]"
        />
        <ThemeSample />
      </Panel>
    </section>
  );
}
