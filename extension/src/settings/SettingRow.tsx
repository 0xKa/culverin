import type { ComponentChildren, RefObject } from "preact";
import { RotateCcw } from "lucide-preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { IconButton } from "../ui/IconButton";
import { ActionStatus, type ActionState } from "./ActionStatus";
import type { SettingReset } from "./reset";

export function SettingRow({
  id,
  label,
  hint,
  state,
  statusId = `${id}-status`,
  stacked = false,
  statusCorner = false,
  reset,
  children,
}: {
  id: string;
  label: string;
  hint?: ComponentChildren;
  state?: ActionState;
  statusId?: string;
  stacked?: boolean;
  statusCorner?: boolean;
  reset?: SettingReset;
  children: ComponentChildren;
}) {
  const group = useRef<HTMLDivElement>(null);
  return (
    <div
      className={`grid items-center gap-x-6 gap-y-2.5 py-3.5 first:pt-0 last:pb-0 ${stacked ? "" : "sm:grid-cols-[1fr_auto]"} ${statusCorner ? "relative" : ""}`}
    >
      <div className="min-w-0">
        <div
          className={`flex min-h-[1.375rem] items-center gap-2.5 ${statusCorner ? "max-sm:pr-20" : ""}`}
        >
          <span id={`${id}-label`} className="font-medium">
            {label}
          </span>
          {reset && (
            <ResetButton
              id={`${id}-reset`}
              reset={reset}
              describedBy={`${id}-label`}
              focusWithin={group}
            />
          )}
          {!statusCorner && <ActionStatus id={statusId} state={state} />}
        </div>
        {hint && (
          <p id={`${id}-hint`} className="text-muted m-0 text-sm">
            {hint}
          </p>
        )}
      </div>
      <div
        ref={group}
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={`${stacked ? "grid gap-1.5" : "flex flex-wrap items-center gap-1.5"} ${statusCorner ? "sm:self-end" : ""}`}
      >
        {children}
      </div>
      {statusCorner && (
        <ActionStatus
          id={statusId}
          state={state}
          className="absolute top-0 right-0 h-[1.375rem]"
        />
      )}
    </div>
  );
}

export function ResetButton({
  id,
  reset,
  describedBy,
  focusWithin,
}: {
  id: string;
  reset: SettingReset;
  describedBy: string;
  focusWithin: RefObject<HTMLElement>;
}) {
  const [refocus, setRefocus] = useState(false);

  useEffect(() => {
    if (!refocus) return;
    setRefocus(false);
    focusWithin.current?.querySelector<HTMLElement>("input:checked")?.focus();
  }, [refocus, focusWithin]);

  if (!reset.modified) return null;
  return (
    <IconButton
      id={id}
      type="button"
      size="sm"
      label={`Reset to ${reset.to}`}
      tip={{}}
      aria-describedby={describedBy}
      disabled={reset.disabled}
      className="-my-1 disabled:opacity-40"
      onClick={() => {
        reset.onReset();
        setRefocus(true);
      }}
    >
      <RotateCcw size={14} />
    </IconButton>
  );
}

export type ChoiceOption<T extends string> = {
  value: T;
  label: ComponentChildren;
  name?: string;
  mono?: boolean;
};

export function TickChoice<T extends string>({
  name,
  options,
  value,
  disabled,
  onChange,
}: {
  name: string;
  options: ChoiceOption<T>[];
  value: T | undefined;
  disabled?: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <>
      {options.map((option) => (
        <label
          key={option.value}
          className={`ticks ticks-quiet ticks-choice text-muted hover:text-ink has-checked:bg-accent-soft has-checked:text-accent-text has-focus-visible:outline-accent has-disabled:hover:text-muted inline-flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-sm transition-colors duration-150 has-checked:font-medium has-disabled:cursor-default has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-offset-4 ${option.mono ? "font-mono" : ""}`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            aria-label={option.name}
            className="absolute inset-0 m-0 size-full cursor-pointer appearance-none opacity-0 disabled:cursor-default"
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </>
  );
}
