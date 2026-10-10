import { useEffect, useState } from "preact/hooks";
import { theme, type Theme } from "../appearance/theme";
import {
  highContrast,
  HIGH_CONTRAST_KEY,
  parseHighContrast,
} from "../appearance/contrast";
import { Panel, SectionHeader } from "./layout";
import { ActionStatus, useAction } from "./ActionStatus";
import { ThemeSample } from "./ThemeSample";
import { NumberOptions } from "./NumberOptions";

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
  const [contrast, setContrast] = useState<boolean>();
  const { state, run } = useAction();
  const contrastAction = useAction();

  useEffect(() => {
    void theme.read().then(setChoice);
  }, []);

  useEffect(() => {
    let initialPending = true;
    const changed = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (HIGH_CONTRAST_KEY in changes) {
        initialPending = false;
        setContrast(
          parseHighContrast(changes[HIGH_CONTRAST_KEY]?.newValue) ?? false,
        );
      }
    };
    chrome.storage.sync.onChanged.addListener(changed);
    void highContrast.read().then((enabled) => {
      if (initialPending) setContrast(enabled);
    });
    return () => {
      initialPending = false;
      chrome.storage.sync.onChanged.removeListener(changed);
    };
  }, []);

  function change(next: Theme): void {
    setChoice(next);
    void run(() => theme.write(next), {
      restore: () => void theme.read().then(setChoice),
    });
  }

  function changeContrast(enabled: boolean): void {
    setContrast(enabled);
    void contrastAction.run(() => highContrast.write(enabled), {
      restore: () => void highContrast.read().then(setContrast),
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
        <div className="border-divider mt-5 border-t pt-5">
          <div className="relative">
            <fieldset className="m-0 border-0 p-0">
              <legend className="text-md mb-3 p-0 font-semibold">
                Contrast
              </legend>
              <label className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150">
                <input
                  id="high-contrast"
                  type="checkbox"
                  name="high-contrast"
                  className="size-4 translate-y-0.5"
                  checked={contrast === true}
                  disabled={contrast === undefined}
                  onChange={(event) =>
                    changeContrast(event.currentTarget.checked)
                  }
                />
                <span className="font-medium">High contrast</span>
                <span className="text-muted col-start-2 text-sm">
                  Stronger text, borders, and controls in the popup and
                  settings.
                </span>
              </label>
            </fieldset>
            <ActionStatus
              id="contrast-status"
              state={contrastAction.state}
              className="absolute top-0 right-0 h-[1.375rem]"
            />
          </div>
        </div>
        <NumberOptions />
        <ThemeSample />
      </Panel>
    </section>
  );
}
