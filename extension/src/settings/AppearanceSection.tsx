import { useEffect, useState } from "preact/hooks";
import { theme, type Theme } from "../appearance/theme";
import { Status } from "../ui/Status";
import { Panel, SectionHeader } from "./layout";

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
  const [status, setStatus] = useState("");

  useEffect(() => {
    void theme.read().then(setChoice);
  }, []);

  async function change(next: Theme): Promise<void> {
    setChoice(next);
    try {
      await theme.write(next);
      setStatus("Saved.");
    } catch {
      setStatus("Couldn't save the setting. Try again.");
    }
  }

  return (
    <section aria-labelledby="appearance-heading" hidden={hidden}>
      <SectionHeader id="appearance-heading" title="Appearance">
        How the popup and settings look. GitHub repository pages keep your
        GitHub theme.
      </SectionHeader>
      <Panel>
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
                  onChange={() => void change(option.value)}
                />
                <span className="font-medium">{option.label}</span>
                <span className="text-muted col-start-2 text-sm">
                  {option.detail}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Status
          id="appearance-status"
          className="text-muted m-0 text-sm not-empty:mt-2"
        >
          {status}
        </Status>
      </Panel>
    </section>
  );
}
