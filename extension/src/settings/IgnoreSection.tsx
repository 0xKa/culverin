import { useEffect, useState } from "preact/hooks";
import {
  defaultIgnore,
  ignoreGroups,
  type IgnoreGroup,
  type IgnoreSettings,
} from "../counter/rules";
import { readIgnore, writeIgnore } from "../ignore/settings";
import { Button } from "../ui/Button";
import { Status } from "../ui/Status";
import { entries, parseRules } from "./rules-input";

const savedMessage =
  "Saved. New analyses use these rules; earlier results are kept and reused if you switch back.";

export function IgnoreSection({ hidden }: { hidden: boolean }) {
  const [settings, setSettings] = useState<IgnoreSettings>(defaultIgnore);
  const [rulesText, setRulesText] = useState("");
  const [ignoreStatus, setIgnoreStatus] = useState("");
  const parsed = parseRules(rulesText);

  useEffect(() => {
    void readIgnore().then((stored) => {
      setSettings(stored);
      setRulesText(stored.exclusions.join("\n"));
    });
  }, []);

  function changeGroup(group: IgnoreGroup, checked: boolean): void {
    const disabledGroups = checked
      ? settings.disabledGroups.filter((id) => id !== group)
      : [...settings.disabledGroups, group];
    setSettings({ ...settings, disabledGroups });
    void (async () => {
      const stored = await readIgnore();
      try {
        await writeIgnore({ ...stored, disabledGroups });
        setIgnoreStatus(savedMessage);
      } catch {
        setIgnoreStatus("Couldn't save Culverin ignore. Try again.");
      }
    })();
  }

  async function save(next: IgnoreSettings): Promise<void> {
    try {
      const stored = await writeIgnore(next);
      setSettings(stored);
      setRulesText(stored.exclusions.join("\n"));
      setIgnoreStatus(savedMessage);
    } catch {
      setIgnoreStatus("Couldn't save Culverin ignore. Try again.");
    }
  }

  return (
    <section aria-labelledby="ignore-heading" hidden={hidden}>
      <h2 id="ignore-heading" className="mb-4 text-[1.5em] font-bold">
        Culverin ignore
      </h2>
      <p>
        Files that match these rules are skipped when counting lines. They still
        count toward the "Files at …" size.
      </p>
      <fieldset id="groups" className="mb-3 border-0 p-0">
        <legend className="mt-3 mb-1.5 font-semibold">Built-in rules</legend>
        {ignoreGroups.map((group) => {
          const list = entries(group);
          return (
            <label
              key={group.id}
              className="my-1 grid grid-cols-[auto_12rem_1fr] items-baseline gap-2"
            >
              <input
                type="checkbox"
                value={group.id}
                checked={!settings.disabledGroups.includes(group.id)}
                onChange={(event) =>
                  changeGroup(group.id, event.currentTarget.checked)
                }
              />
              <span>{group.label}</span>
              <span className="text-muted">
                {list.slice(0, 4).join(", ")}
                {list.length > 4 ? ", …" : ""}
              </span>
            </label>
          );
        })}
      </fieldset>
      <details className="my-2">
        <summary>Show full list</summary>
        <div id="built-in-content">
          <dl className="my-2 grid grid-cols-[12rem_1fr] gap-x-2 gap-y-1">
            {ignoreGroups.map((group) => (
              <>
                <dt key={group.id + "-label"}>{group.label}</dt>
                <dd
                  key={group.id + "-entries"}
                  className="m-0 break-words font-mono"
                >
                  {entries(group).join(", ")}
                </dd>
              </>
            ))}
          </dl>
        </div>
      </details>
      <label for="rules" className="mt-3 mb-1.5 block font-semibold">
        Your rules
      </label>
      <textarea
        id="rules"
        rows={6}
        spellcheck={false}
        autocomplete="off"
        aria-describedby="rules-help rules-usage rules-errors"
        aria-invalid={parsed.errors.length > 0}
        className="border-ink bg-canvas text-ink w-full border p-0.5 font-mono text-[0.95rem]"
        value={rulesText}
        onInput={(event) => {
          setRulesText(event.currentTarget.value);
          setIgnoreStatus("");
        }}
      />
      <dl
        id="rules-help"
        className="my-2 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5"
      >
        <dt className="font-mono">folder/</dt>
        <dd className="m-0">a folder with this name, anywhere</dd>
        <dt className="font-mono">*.ext</dt>
        <dd className="m-0">files ending in .ext</dd>
        <dt className="font-mono">name.ext</dt>
        <dd className="m-0">files or folders with this exact name, anywhere</dd>
        <dt className="font-mono">path/to/x</dt>
        <dd className="m-0">
          this exact path from the repository root and everything under it
        </dd>
      </dl>
      <p id="rules-usage" className="text-muted">
        {parsed.usage}
      </p>
      <ul
        id="rules-errors"
        className="border-error empty:hidden list-disc border-l-[3px] pl-6"
      >
        {parsed.errors.map((error) => (
          <li key={error}>{error}</li>
        ))}
      </ul>
      <div className="my-3 flex gap-2">
        <Button
          id="save-rules"
          type="button"
          className="px-3 py-[7px]"
          disabled={parsed.errors.length > 0}
          onClick={() =>
            void save({
              disabledGroups: settings.disabledGroups,
              exclusions: parsed.rules,
            })
          }
        >
          Save
        </Button>
        <Button
          id="reset-rules"
          type="button"
          className="px-3 py-[7px]"
          onClick={() => {
            if (
              confirm(
                "Reset Culverin ignore? All built-in rules are turned back on and your rules are removed.",
              )
            )
              void save(defaultIgnore);
          }}
        >
          Reset to defaults
        </Button>
      </div>
      <Status id="ignore-status" className="min-h-[1.5em] whitespace-pre-wrap">
        {ignoreStatus}
      </Status>
    </section>
  );
}
