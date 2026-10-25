import { useEffect, useState } from "preact/hooks";
import {
  defaultIgnore,
  ignoreGroups,
  type IgnoreGroup,
  type IgnoreSettings,
} from "../counter/rules";
import { readIgnore, writeIgnore } from "../ignore/settings";
import { Info } from "lucide-preact";
import { Button } from "../ui/Button";
import { Checkbox } from "../ui/Checkbox";
import { IconButton } from "../ui/IconButton";
import { Joined } from "../ui/Separator";
import { inputClass, Panel, SectionHeader } from "./layout";
import { entries, parseRules } from "./rules-input";
import { ActionStatus, useAction } from "./ActionStatus";
import { BuiltInRulesDialog } from "./BuiltInRulesDialog";

export function IgnoreSection({ hidden }: { hidden: boolean }) {
  const [settings, setSettings] = useState<IgnoreSettings>(defaultIgnore);
  const [rulesText, setRulesText] = useState("");
  const groupsSave = useAction();
  const rulesSave = useAction();
  const [listOpen, setListOpen] = useState(false);
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
    void groupsSave.run(
      async () => {
        const stored = await readIgnore();
        await writeIgnore({ ...stored, disabledGroups });
      },
      { restore: () => void readIgnore().then(setSettings) },
    );
  }

  function save(next: IgnoreSettings): void {
    void rulesSave.run(async () => {
      const stored = await writeIgnore(next);
      setSettings(stored);
      setRulesText(stored.exclusions.join("\n"));
    });
  }

  return (
    <section aria-labelledby="ignore-heading" hidden={hidden}>
      <SectionHeader id="ignore-heading" title="Ignored files">
        Files that match these rules are skipped when counting lines. They still
        count toward the "Files at …" size. New analyses use your changes;
        earlier results are kept and reused if you switch back.
      </SectionHeader>
      <div className="grid gap-4">
        <Panel className="relative">
          <fieldset id="groups" className="m-0 border-0 p-0">
            <legend className="text-md mb-3 p-0 font-semibold">
              Built-in rules
            </legend>
            <div className="divide-divider grid divide-y">
              {ignoreGroups.map((group) => {
                const list = entries(group);
                return (
                  <label
                    key={group.id}
                    className="grid cursor-pointer grid-cols-[auto_1fr] items-center gap-x-3 py-3.5 first:pt-0 last:pb-0"
                  >
                    <Checkbox
                      id={`ignore-group-${group.id}`}
                      name="groups"
                      value={group.id}
                      aria-labelledby={`ignore-group-${group.id}-label`}
                      aria-describedby={`ignore-group-${group.id}-hint`}
                      checked={!settings.disabledGroups.includes(group.id)}
                      onChange={(event) =>
                        changeGroup(group.id, event.currentTarget.checked)
                      }
                    />
                    <span className="min-w-0">
                      <span
                        id={`ignore-group-${group.id}-label`}
                        className="block font-medium"
                      >
                        {group.label}
                      </span>
                      <span
                        id={`ignore-group-${group.id}-hint`}
                        className="text-muted block truncate font-mono text-xs"
                      >
                        {list.slice(0, 4).join(", ")}
                        {list.length > 4 ? ", …" : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <ActionStatus
              id="ignore-groups-status"
              state={groupsSave.state}
              className="h-[1.375rem]"
            />
            <IconButton
              id="show-built-in"
              type="button"
              label="Show full list"
              aria-haspopup="dialog"
              onClick={() => setListOpen(true)}
            >
              <Info />
            </IconButton>
          </div>
        </Panel>
        <Panel>
          <label for="rules" className="text-md mb-2 block font-semibold">
            Your rules
          </label>
          <textarea
            id="rules"
            rows={6}
            spellcheck={false}
            autocomplete="off"
            placeholder={"vendor/\n*.min.js"}
            aria-describedby="rules-help rules-usage rules-errors"
            aria-invalid={parsed.errors.length > 0}
            className={`${inputClass} block w-full resize-y font-mono text-sm aria-[invalid=true]:border-error`}
            value={rulesText}
            onInput={(event) => {
              setRulesText(event.currentTarget.value);
              rulesSave.clear();
            }}
          />
          <p id="rules-usage" className="text-muted m-0 mt-2 text-sm">
            <Joined parts={parsed.usage} />
          </p>
          <ul
            id="rules-errors"
            className="border-error/40 bg-error-soft m-0 mt-3 list-disc rounded-lg border py-2 pr-3 pl-8 text-sm empty:hidden"
          >
            {parsed.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
          <dl
            id="rules-help"
            className="bg-surface m-0 mt-4 grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 rounded-lg p-3.5 text-sm"
          >
            <dt className="font-mono text-xs leading-5">folder/</dt>
            <dd className="text-muted m-0">
              a folder with this name, anywhere
            </dd>
            <dt className="font-mono text-xs leading-5">*.ext</dt>
            <dd className="text-muted m-0">files ending in .ext</dd>
            <dt className="font-mono text-xs leading-5">name.ext</dt>
            <dd className="text-muted m-0">
              files or folders with this exact name, anywhere
            </dd>
            <dt className="font-mono text-xs leading-5">path/to/x</dt>
            <dd className="text-muted m-0">
              this exact path from the repository root and everything under it
            </dd>
          </dl>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              id="save-rules"
              type="button"
              size="md"
              variant="primary"
              disabled={parsed.errors.length > 0}
              onClick={() =>
                save({
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
              size="md"
              variant="ghost"
              onClick={() => {
                if (
                  confirm(
                    "Reset ignored files? All built-in rules are turned back on and your rules are removed.",
                  )
                )
                  save(defaultIgnore);
              }}
            >
              Reset to defaults
            </Button>
            <ActionStatus id="ignore-status" state={rulesSave.state} />
          </div>
        </Panel>
      </div>
      {listOpen && <BuiltInRulesDialog onClose={() => setListOpen(false)} />}
    </section>
  );
}
