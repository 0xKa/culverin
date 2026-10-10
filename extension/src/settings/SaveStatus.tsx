import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Status } from "../ui/Status";
import { StatusMark } from "../ui/StatusMark";

export const SAVED_VISIBLE_MS = 3000;

const failedMessage = "Couldn't save. Try again.";

export type SaveState = {
  id: number;
  result: "saving" | "saved" | "failed";
  message: string;
  faded: boolean;
};

export function useSave() {
  const [state, setState] = useState<SaveState>();
  const latest = useRef(0);

  useEffect(() => {
    if (state?.result !== "saved" || state.faded) return;
    const timer = setTimeout(
      () => setState({ ...state, faded: true }),
      SAVED_VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [state]);

  async function save(
    write: () => Promise<unknown>,
    {
      message = "Saved.",
      restore,
    }: { message?: string; restore?: () => void } = {},
  ): Promise<void> {
    const id = ++latest.current;
    setState({ id, result: "saving", message: "", faded: false });
    try {
      await write();
      if (id === latest.current)
        setState({ id, result: "saved", message, faded: false });
    } catch {
      if (id !== latest.current) return;
      restore?.();
      setState({ id, result: "failed", message: failedMessage, faded: false });
    }
  }

  function clear(): void {
    latest.current++;
    setState(undefined);
  }

  return { state, save, clear };
}

export function SaveStatus({
  id,
  state,
  className,
}: {
  id: string;
  state?: SaveState;
  className?: string;
}) {
  return (
    <>
      {state && (
        <SaveMark
          key={state.id}
          id={`${id}-mark`}
          state={state}
          className={className}
        />
      )}
      <Status id={id} className="sr-only">
        {state?.message}
      </Status>
    </>
  );
}

function SaveMark({
  id,
  state,
  className,
}: {
  id: string;
  state: SaveState;
  className?: string;
}) {
  const mark = useRef<HTMLSpanElement>(null);
  const failed = state.result === "failed";
  const tone =
    state.result === "saving"
      ? "text-muted"
      : failed
        ? "text-error"
        : "text-ok-text";

  useLayoutEffect(() => {
    mark.current?.getBoundingClientRect();
  }, []);

  return (
    <span
      ref={mark}
      id={id}
      aria-hidden="true"
      data-mark={
        state.result === "saving" ? "busy" : failed ? "failed" : "done"
      }
      data-faded={state.faded || undefined}
      className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap transition-[color,opacity] duration-200 data-faded:opacity-0 ${tone} ${className ?? ""}`}
    >
      <StatusMark />
      <span
        className={`transition-opacity duration-200 ${state.result === "saving" ? "opacity-0" : ""}`}
      >
        {failed ? failedMessage : "Saved"}
      </span>
    </span>
  );
}
