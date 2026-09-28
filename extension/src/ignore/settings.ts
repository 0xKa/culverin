import {
  defaultIgnore,
  ignoreGroups,
  isDefaultIgnore,
  normalizeIgnore,
  type IgnoreSettings,
} from "../counter/rules";

export const IGNORE_KEY = "culverin.ignore";

export type IgnoreStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

export async function readIgnore(
  storage: IgnoreStorage = chrome.storage.sync,
): Promise<IgnoreSettings> {
  try {
    const value = (await storage.get(IGNORE_KEY))[IGNORE_KEY];
    return value === undefined ? defaultIgnore : normalizeIgnore(value);
  } catch {
    return defaultIgnore;
  }
}

export async function writeIgnore(
  settings: IgnoreSettings,
  storage: IgnoreStorage = chrome.storage.sync,
): Promise<IgnoreSettings> {
  const normalized = normalizeIgnore(settings);
  if (isDefaultIgnore(normalized)) await storage.remove(IGNORE_KEY);
  else await storage.set({ [IGNORE_KEY]: normalized });
  return normalized;
}

export function describeIgnore(settings: IgnoreSettings): string {
  const parts: string[] = [];
  const rules = settings.exclusions.length;
  if (rules) parts.push(`${rules} ${rules === 1 ? "rule" : "rules"}`);
  for (const group of ignoreGroups)
    if (settings.disabledGroups.includes(group.id))
      parts.push(`${group.label} off`);
  return parts.join(", ");
}
