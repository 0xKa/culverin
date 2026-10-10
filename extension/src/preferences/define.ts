export type PreferenceStorage = {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
};

export type Preference<T> = {
  key: string;
  fallback: T;
  read(storage?: PreferenceStorage): Promise<T>;
  write(value: T, storage?: PreferenceStorage): Promise<void>;
};

export function definePreference<T>({
  key,
  fallback,
  parse,
  isDefault,
}: {
  key: string;
  fallback: T;
  parse: (value: unknown) => T | undefined;
  isDefault: (value: T) => boolean;
}): Preference<T> {
  return {
    key,
    fallback,
    async read(storage = chrome.storage.sync) {
      try {
        return parse((await storage.get(key))[key]) ?? fallback;
      } catch {
        return fallback;
      }
    },
    async write(value, storage = chrome.storage.sync) {
      if (isDefault(value)) await storage.remove(key);
      else await storage.set({ [key]: value });
    },
  };
}
