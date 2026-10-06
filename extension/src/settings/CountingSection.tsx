import { useEffect, useState } from "preact/hooks";
import {
  readCountTrigger,
  writeCountTrigger,
  type CountTrigger,
} from "../counting/trigger";
import { Status } from "../ui/Status";
import { Panel, SectionHeader } from "./layout";

const options: { value: CountTrigger; label: string; detail: string }[] = [
  {
    value: "manual",
    label: "When I click Count lines or Analyze",
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
  const [status, setStatus] = useState("");

  useEffect(() => {
    void readCountTrigger().then(setTrigger);
  }, []);

  async function change(next: CountTrigger): Promise<void> {
    setTrigger(next);
    try {
      await writeCountTrigger(next);
      setStatus("Saved. Applies to repository pages you open from now on.");
    } catch {
      setStatus("Couldn't save the setting. Try again.");
    }
  }

  return (
    <section aria-labelledby="counting-heading" hidden={hidden}>
      <SectionHeader id="counting-heading" title="Counting" />
      <Panel>
        <fieldset className="m-0 border-0 p-0">
          <legend className="text-md mb-3 p-0 font-semibold">
            Count lines of code in a repository
          </legend>
          <div className="grid gap-2.5">
            {options.map((option) => (
              <label
                key={option.value}
                className="border-divider hover:border-border has-checked:border-accent has-checked:bg-accent-soft/40 grid cursor-pointer grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1 rounded-lg border p-3.5 transition-[border-color,background-color] duration-150"
              >
                <input
                  type="radio"
                  name="count-trigger"
                  value={option.value}
                  className="size-4 translate-y-0.5"
                  checked={trigger === option.value}
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
          id="counting-status"
          className="text-muted m-0 text-sm not-empty:mt-2"
        >
          {status}
        </Status>
      </Panel>
    </section>
  );
}
