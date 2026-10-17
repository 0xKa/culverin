import type { ComponentChildren } from "preact";
import { ActionStatus, type ActionState } from "./ActionStatus";

export function SettingRow({
  id,
  label,
  hint,
  state,
  statusId = `${id}-status`,
  stacked = false,
  statusCorner = false,
  children,
}: {
  id: string;
  label: string;
  hint?: ComponentChildren;
  state?: ActionState;
  statusId?: string;
  stacked?: boolean;
  statusCorner?: boolean;
  children: ComponentChildren;
}) {
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
          {!statusCorner && <ActionStatus id={statusId} state={state} />}
        </div>
        {hint && (
          <p id={`${id}-hint`} className="text-muted m-0 text-sm">
            {hint}
          </p>
        )}
      </div>
      <div
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
