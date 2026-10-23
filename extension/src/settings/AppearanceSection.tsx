import { useEffect, useState } from "preact/hooks";
import { theme, type Theme } from "../appearance/theme";
import {
  highContrast,
  HIGH_CONTRAST_KEY,
  parseHighContrast,
} from "../appearance/contrast";
import { Panel, SectionHeader } from "./layout";
import { useAction } from "./ActionStatus";
import { optionText, preferenceReset } from "./reset";
import { SettingRow, TickChoice, type ChoiceOption } from "./SettingRow";
import { ThemeSample } from "./ThemeSample";
import { NumberOptions } from "./NumberOptions";
import { LanguageColorOptions } from "./LanguageColorOptions";
import { AccentOptions } from "./AccentOptions";

const options: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const contrastOptions: ChoiceOption<"standard" | "high">[] = [
  { value: "standard", label: "Off" },
  { value: "high", label: "On" },
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
      <Panel>
        <div className="divide-divider grid divide-y">
          <SettingRow
            id="theme"
            label="Theme"
            hint="System follows your device or browser."
            state={state}
            statusId="appearance-status"
            reset={preferenceReset(
              theme,
              choice,
              optionText(options, theme.fallback),
              change,
            )}
          >
            <TickChoice
              name="theme"
              options={options}
              value={choice}
              disabled={!choice}
              onChange={change}
            />
          </SettingRow>
          <AccentOptions />
          <SettingRow
            id="contrast"
            label="High contrast"
            hint="Stronger text, borders, and controls in the popup and settings."
            state={contrastAction.state}
            reset={preferenceReset(
              highContrast,
              contrast,
              optionText(
                contrastOptions,
                highContrast.fallback ? "high" : "standard",
              ),
              changeContrast,
            )}
          >
            <TickChoice
              name="high-contrast"
              options={contrastOptions}
              value={
                contrast === undefined
                  ? undefined
                  : contrast
                    ? "high"
                    : "standard"
              }
              disabled={contrast === undefined}
              onChange={(value) => changeContrast(value === "high")}
            />
          </SettingRow>
          <NumberOptions />
          <LanguageColorOptions />
        </div>
        <p className="text-muted m-0 mt-4 text-sm">
          Numbers and size units apply to the popup, saved results, and this
          preview. Hover or focus values to see exact counts and bytes.
        </p>
        <ThemeSample />
      </Panel>
    </section>
  );
}
