export function event<T extends (...args: never[]) => unknown>() {
  const listeners = new Set<T>();
  return {
    listeners,
    addListener: (listener: T) => listeners.add(listener),
    removeListener: (listener: T) => listeners.delete(listener),
    emit: (...args: Parameters<T>) => {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export async function settle(): Promise<void> {
  for (let index = 0; index < 30; index++) await Promise.resolve();
}
