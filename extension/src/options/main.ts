import {
  defaultIgnore,
  ignoreGroups,
  MAX_RULES,
  MAX_RULES_BYTES,
  ruleError,
  type IgnoreGroup,
  type IgnoreSettings,
} from "../counter/rules";
import { readIgnore, writeIgnore } from "../ignore/settings";

const output = document.querySelector<HTMLElement>("#status")!;
const button = document.querySelector<HTMLButtonElement>("#clear-public")!;

button.addEventListener("click", () => {
  chrome.runtime.sendMessage(
    {
      protocolVersion: 1,
      type: "cache.clear-public",
      requestId: crypto.randomUUID(),
      navigationId: crypto.randomUUID(),
    },
    (reply: { state?: string } | undefined) => {
      output.textContent =
        !chrome.runtime.lastError && reply?.state === "public-cache-cleared"
          ? "Public cache cleared."
          : "Extension unavailable. Try again.";
    },
  );
});

const groupsField = document.querySelector<HTMLFieldSetElement>("#groups")!;
const builtInContent =
  document.querySelector<HTMLElement>("#built-in-content")!;
const rulesInput = document.querySelector<HTMLTextAreaElement>("#rules")!;
const usage = document.querySelector<HTMLElement>("#rules-usage")!;
const errorList = document.querySelector<HTMLUListElement>("#rules-errors")!;
const saveButton = document.querySelector<HTMLButtonElement>("#save-rules")!;
const resetButton = document.querySelector<HTMLButtonElement>("#reset-rules")!;
const ignoreStatus = document.querySelector<HTMLElement>("#ignore-status")!;
const encoder = new TextEncoder();
const savedMessage =
  "Saved. New analyses use these rules; earlier results are kept and reused if you switch back.";

function entries(group: (typeof ignoreGroups)[number]): string[] {
  return [
    ...group.directories.map((name) => `${name}/`),
    ...group.files,
    ...group.suffixes.map((suffix) => `*${suffix}`),
  ];
}

for (const group of ignoreGroups) {
  const row = document.createElement("label");
  row.className = "group";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.value = group.id;
  const name = document.createElement("span");
  name.textContent = group.label;
  const examples = document.createElement("span");
  const list = entries(group);
  examples.textContent =
    list.slice(0, 4).join(", ") + (list.length > 4 ? ", …" : "");
  row.append(box, name, examples);
  groupsField.append(row);
}
const fullList = document.createElement("dl");
for (const group of ignoreGroups) {
  const term = document.createElement("dt");
  term.textContent = group.label;
  const detail = document.createElement("dd");
  detail.textContent = entries(group).join(", ");
  fullList.append(term, detail);
}
builtInContent.append(fullList);

function checkedGroups(): IgnoreGroup[] {
  return Array.from(
    groupsField.querySelectorAll<HTMLInputElement>("input:not(:checked)"),
    (box) => box.value as IgnoreGroup,
  );
}

function parseRules(): { rules: string[]; errors: string[] } {
  const rules: string[] = [];
  const errors: string[] = [];
  rulesInput.value.split("\n").forEach((line, index) => {
    const rule = line.trim();
    if (!rule) return;
    const error = ruleError(rule);
    if (error) errors.push(`Line ${index + 1}: ${error}`);
    else rules.push(rule);
  });
  const unique = new Set(rules).size;
  const bytes = [...new Set(rules)].reduce(
    (sum, rule) => sum + encoder.encode(rule).length,
    0,
  );
  if (unique > MAX_RULES) errors.push(`Use at most ${MAX_RULES} rules.`);
  if (bytes > MAX_RULES_BYTES)
    errors.push(`Rules can use at most ${MAX_RULES_BYTES} bytes in total.`);
  usage.textContent = `${unique} of ${MAX_RULES} rules · ${bytes.toLocaleString()} of ${MAX_RULES_BYTES.toLocaleString()} bytes`;
  return { rules: [...new Set(rules)], errors };
}

function validate(): { rules: string[]; errors: string[] } {
  const parsed = parseRules();
  errorList.replaceChildren(
    ...parsed.errors.map((error) => {
      const item = document.createElement("li");
      item.textContent = error;
      return item;
    }),
  );
  rulesInput.setAttribute("aria-invalid", String(parsed.errors.length > 0));
  saveButton.disabled = parsed.errors.length > 0;
  return parsed;
}

function render(settings: IgnoreSettings): void {
  for (const box of Array.from(
    groupsField.querySelectorAll<HTMLInputElement>("input"),
  ))
    box.checked = !settings.disabledGroups.includes(box.value as IgnoreGroup);
  rulesInput.value = settings.exclusions.join("\n");
  validate();
}

async function save(settings: IgnoreSettings): Promise<void> {
  try {
    render(await writeIgnore(settings));
    ignoreStatus.textContent = savedMessage;
  } catch {
    ignoreStatus.textContent = "Couldn't save Culverin ignore. Try again.";
  }
}

groupsField.addEventListener("change", () => {
  void (async () => {
    const stored = await readIgnore();
    const settings = { ...stored, disabledGroups: checkedGroups() };
    try {
      await writeIgnore(settings);
      ignoreStatus.textContent = savedMessage;
    } catch {
      ignoreStatus.textContent = "Couldn't save Culverin ignore. Try again.";
    }
  })();
});
rulesInput.addEventListener("input", () => {
  validate();
  ignoreStatus.textContent = "";
});
saveButton.addEventListener("click", () => {
  const { rules, errors } = validate();
  if (errors.length) return;
  void save({ disabledGroups: checkedGroups(), exclusions: rules });
});
resetButton.addEventListener("click", () => {
  if (
    !confirm(
      "Reset Culverin ignore? All built-in rules are turned back on and your rules are removed.",
    )
  )
    return;
  void save(defaultIgnore);
});

void readIgnore().then(render);
