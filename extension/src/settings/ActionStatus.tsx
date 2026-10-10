import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { Status } from "../ui/Status";
import { StatusMark } from "../ui/StatusMark";

export const DONE_VISIBLE_MS = 3000;

export type ActionState = {
  id: number;
  result: "busy" | "done" | "failed";
  label?: string;
  message: string;
  faded: boolean;
};

export type ActionOptions = {
  label?: string;
  message?: string;
  failure?: string;
  quiet?: boolean;
  restore?: () => void;
};

export function useAction() {
  const [state, setState] = useState<ActionState>();
  const latest = useRef(0);

  useEffect(() => {
    if (state?.result !== "done" || state.faded) return;
    const timer = setTimeout(
      () => setState({ ...state, faded: true }),
      DONE_VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [state]);

  async function run(
    action: () => Promise<unknown>,
    {
      label = "Saved",
      message = "Saved.",
      failure = "Couldn't save. Try again.",
      quiet = false,
      restore,
    }: ActionOptions = {},
  ): Promise<boolean> {
    const id = ++latest.current;
    const shown = quiet ? undefined : label;
    setState({ id, result: "busy", label: shown, message: "", faded: false });
    try {
      await action();
      if (id === latest.current)
        setState({ id, result: "done", label: shown, message, faded: false });
      return true;
    } catch {
      if (id === latest.current) {
        restore?.();
        setState({
          id,
          result: "failed",
          label: failure,
          message: failure,
          faded: false,
        });
      }
      return false;
    }
  }

  function clear(): void {
    latest.current++;
    setState(undefined);
  }

  return { state, run, clear };
}

export function ActionStatus({
  id,
  state,
  className,
}: {
  id: string;
  state?: ActionState;
  className?: string;
}) {
  return (
    <>
      {state?.label && (
        <ActionMark
          key={state.id}
          id={`${id}-mark`}
          state={state}
          label={state.label}
          className={className}
        />
      )}
      <Status id={id} className="sr-only">
        {state?.message}
      </Status>
    </>
  );
}

function ActionMark({
  id,
  state,
  label,
  className,
}: {
  id: string;
  state: ActionState;
  label: string;
  className?: string;
}) {
  const mark = useRef<HTMLSpanElement>(null);
  const tone =
    state.result === "busy"
      ? "text-muted"
      : state.result === "failed"
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
      data-mark={state.result}
      data-faded={state.faded || undefined}
      className={`inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap transition-[color,opacity] duration-200 data-faded:opacity-0 ${tone} ${className ?? ""}`}
    >
      <StatusMark />
      <span
        className={`transition-opacity duration-200 ${state.result === "busy" ? "opacity-0" : ""}`}
      >
        {label}
      </span>
    </span>
  );
}
