import { useEffect, useState } from "preact/hooks";
import type { RootChoice } from "../preferences/root-choice";
import { useAction } from "./ActionStatus";

export function useRootChoice<T extends string>(choice: RootChoice<T>) {
  const [value, setValue] = useState<T>();
  const action = useAction();
  useEffect(() => choice.subscribe(setValue), [choice]);
  function change(next: T): void {
    setValue(next);
    void action.run(() => choice.write(next), {
      restore: () => void choice.read().then(setValue),
    });
  }
  return { value, change, state: action.state };
}
