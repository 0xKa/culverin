import type { ComponentChildren } from "preact";
import { InfoIcon, WarningIcon } from "./icons";

const tones = {
  info: "border-divider bg-surface text-ink [&>svg]:text-muted",
  warning:
    "border-warning/40 bg-warning-soft text-ink [&>svg]:text-warning-text",
  error: "border-error/40 bg-error-soft text-ink [&>svg]:text-error",
};

export function Callout({
  tone = "info",
  id,
  className,
  hidden,
  children,
}: {
  tone?: keyof typeof tones;
  id?: string;
  className?: string;
  hidden?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <div
      id={id}
      hidden={hidden}
      className={`grid grid-cols-[auto_1fr] gap-x-2.5 rounded-lg border px-3 py-2.5 ${tones[tone]} ${className ?? ""}`.trim()}
    >
      {tone === "info" ? (
        <InfoIcon className="mt-0.5" />
      ) : (
        <WarningIcon className="mt-0.5" />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
