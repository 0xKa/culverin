import { useEffect, useState } from "preact/hooks";
import {
  defaultCountTrigger,
  readCountTrigger,
  writeCountTrigger,
  type CountTrigger,
} from "../counting/trigger";
import { Panel, SectionHeader } from "./layout";
import { useAction } from "./ActionStatus";
import { optionText } from "./reset";
import { SettingRow } from "./SettingRow";

const options: { value: CountTrigger; label: string; detail: string }[] = [
  {
    value: "manual",
    label: "When I click Analyze",
    detail:
      "Opening a repository page sends nothing to GitHub unless you counted it before. Then Culverin checks that the count is still current, at most once every 20 minutes.",
  },
  {
    value: "open",
    label: "When I open the repository page",
    detail:
      "Every repository page you open without a current count is checked and counted. Culverin tries each commit once per browser session, so a count that fails or is canceled isn't repeated on every visit.",
  },
];

export function CountingSection({ hidden }: { hidden: boolean }) {
  const [trigger, setTrigger] = useState<CountTrigger>();
  const { state, run } = useAction();

  useEffect(() => {
    void readCountTrigger().then(setTrigger);
  }, []);

  function change(next: CountTrigger): void {
    setTrigger(next);
    void run(() => writeCountTrigger(next), {
      restore: () => void readCountTrigger().then(setTrigger),
    });
  }

  return (
    <section aria-labelledby="counting-heading" hidden={hidden}>
      <SectionHeader id="counting-heading" title="When to count">
        Changes apply to repository pages you open from now on.
      </SectionHeader>
      <Panel>
        <SettingRow
          id="counting"
          label="Count lines of code in a repository"
          state={state}
          stacked
          reset={{
            to: optionText(options, defaultCountTrigger),
            modified: trigger !== undefined && trigger !== defaultCountTrigger,
            onReset: () => change(defaultCountTrigger),
          }}
        >
          {options.map((option) => (
            <label
              key={option.value}
              className="ticks ticks-quiet group has-checked:bg-accent-soft has-focus-visible:outline-accent grid cursor-pointer gap-0.5 px-3 py-2.5 transition-colors duration-150 has-focus-visible:outline-2 has-focus-visible:outline-offset-4"
            >
              <input
                type="radio"
                name="count-trigger"
                value={option.value}
                aria-label={option.label}
                aria-describedby={`count-trigger-${option.value}-detail`}
                className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0"
                checked={trigger === option.value}
                disabled={!trigger}
                onChange={() => change(option.value)}
              />
              <span className="group-has-checked:text-accent-text font-medium">
                {option.label}
              </span>
              <span
                id={`count-trigger-${option.value}-detail`}
                className="text-muted text-sm"
              >
                {option.detail}
              </span>
            </label>
          ))}
        </SettingRow>
      </Panel>
    </section>
  );
}
