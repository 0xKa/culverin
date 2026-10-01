import { ArchiveError } from "./tar";

export function abortError(signal: AbortSignal): ArchiveError {
  return new ArchiveError(
    signal.reason === "deadline" ? "analysis_timeout" : "analysis_canceled",
  );
}

export function waitFor<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new ArchiveError("analysis_timeout"));
    }, timeoutMs);
    const abort = () => {
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    operation.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
