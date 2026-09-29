import { useEffect, useState } from "preact/hooks";
import {
  readCountTrigger,
  writeCountTrigger,
  type CountTrigger,
} from "../counting/trigger";
import { Status } from "../ui/Status";

const options: { value: CountTrigger; label: string; detail: string }[] = [
  {
    value: "manual",
    label: "When I select Count lines or Analyze",
    detail:
      "Opening a repository page makes no GitHub requests unless Culverin already has a result for it.",
  },
  {
    value: "open",
    label: "When I open the repository page",
    detail:
      "Culverin downloads a source snapshot once per browser session for each repository page you open without a current result. Each page visit uses 2 of the 60 GitHub API requests per hour your network can make without signing in.",
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
      <h2 id="counting-heading" className="mb-4 text-[1.5em] font-bold">
        Counting
      </h2>
      <fieldset className="mb-3 border-0 p-0">
        <legend className="mb-1.5 font-semibold">
          Count lines of code in a repository
        </legend>
        {options.map((option) => (
          <label
            key={option.value}
            className="my-2 grid grid-cols-[auto_1fr] items-baseline gap-x-2"
          >
            <input
              type="radio"
              name="count-trigger"
              value={option.value}
              checked={trigger === option.value}
              onChange={() => void change(option.value)}
            />
            <span>{option.label}</span>
            <span className="text-muted col-start-2">{option.detail}</span>
          </label>
        ))}
      </fieldset>
      <Status id="counting-status" className="min-h-[1.5em]">
        {status}
      </Status>
    </section>
  );
}
