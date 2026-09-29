export const COUNT_TRIGGER_KEY = "culverin.countTrigger";

export type CountTrigger = "manual" | "open";

export type CountTriggerStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

export async function readCountTrigger(
  storage: CountTriggerStorage = chrome.storage.sync,
): Promise<CountTrigger> {
  try {
    const value = (await storage.get(COUNT_TRIGGER_KEY))[COUNT_TRIGGER_KEY];
    return value === "open" ? "open" : "manual";
  } catch {
    return "manual";
  }
}

export async function writeCountTrigger(
  trigger: CountTrigger,
  storage: CountTriggerStorage = chrome.storage.sync,
): Promise<void> {
  if (trigger === "open") await storage.set({ [COUNT_TRIGGER_KEY]: "open" });
  else await storage.remove(COUNT_TRIGGER_KEY);
}
