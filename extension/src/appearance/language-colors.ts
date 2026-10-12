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

function defineRootChoice<T extends string>({
  key,
  values,
  fallback,
  attribute,
}: {
  key: string;
  values: readonly T[];
  fallback: T;
  attribute: string;
}): RootChoice<T> {
  const parse = (value: unknown) =>
    values.includes(value as T) ? (value as T) : undefined;
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

export type LanguageColorMode = "language" | "single";

export type LanguageMarker = "square" | "circle" | "none";

export const languageColors = defineRootChoice<LanguageColorMode>({
  key: "culverin.languageColors",
  values: ["language", "single"],
  fallback: "language",
  attribute: "languageColors",
});

export const languageMarkers = defineRootChoice<LanguageMarker>({
  key: "culverin.languageMarker",
  values: ["square", "circle", "none"],
  fallback: "square",
  attribute: "languageMarker",
});

export function followLanguageColors(): void {
  languageColors.follow();
  languageMarkers.follow();
}
