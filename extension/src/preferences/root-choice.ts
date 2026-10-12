import {
  definePreference,
  type Preference,
  type PreferenceStorage,
} from "../preferences/define";

type Dependencies = {
  storage: PreferenceStorage;
  changes: Pick<
    typeof chrome.storage.onChanged,
    "addListener" | "removeListener"
  >;
};

type Root = { dataset: DOMStringMap };

export type RootChoice<T extends string> = Preference<T> & {
  values: readonly T[];
  parse(value: unknown): T | undefined;
  apply(value: T, root?: Root): void;
  readRemembered(storage?: Pick<Storage, "getItem">): T;
  remember(value: T, storage?: Pick<Storage, "setItem" | "removeItem">): void;
  subscribe(
    publish: (value: T) => void,
    dependencies?: Dependencies,
  ): () => void;
  follow(): void;
};

export function defineRootChoice<T extends string>({
  key,
  values,
  fallback,
  attribute,
  aliases,
}: {
  key: string;
  values: readonly T[];
  fallback: T;
  attribute: string;
  aliases?: Readonly<Record<string, T>>;
}): RootChoice<T> {
  const parse = (value: unknown): T | undefined => {
    if (values.includes(value as T)) return value as T;
    if (typeof value === "string" && aliases && Object.hasOwn(aliases, value))
      return aliases[value];
    return undefined;
  };
  const choice: RootChoice<T> = {
    ...definePreference<T>({
      key,
      fallback,
      parse,
      isDefault: (value) => value === fallback,
    }),
    values,
    parse,
    apply(value, root = document.documentElement) {
      if (value === fallback) delete root.dataset[attribute];
      else root.dataset[attribute] = value;
    },
    readRemembered(storage = localStorage) {
      try {
        return parse(storage.getItem(key)) ?? fallback;
      } catch {
        return fallback;
      }
    },
    remember(value, storage = localStorage) {
      try {
        if (value === fallback) storage.removeItem(key);
        else storage.setItem(key, value);
      } catch {
        return;
      }
    },
    subscribe(
      publish,
      dependencies = {
        storage: chrome.storage.sync,
        changes: chrome.storage.onChanged,
      },
    ) {
      let disposed = false;
      let changed = false;
      const listener = (
        changes: Record<string, chrome.storage.StorageChange>,
        area: string,
      ) => {
        if (disposed || area !== "sync" || !(key in changes)) return;
        changed = true;
        publish(parse(changes[key]?.newValue) ?? fallback);
      };
      dependencies.changes.addListener(listener);
      void choice.read(dependencies.storage).then((value) => {
        if (!disposed && !changed) publish(value);
      });
      return () => {
        disposed = true;
        dependencies.changes.removeListener(listener);
      };
    },
    follow() {
      choice.apply(choice.readRemembered());
      choice.subscribe((value) => {
        choice.apply(value);
        choice.remember(value);
      });
    },
  };
  return choice;
}
