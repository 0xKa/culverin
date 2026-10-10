import type { ComponentProps } from "preact";
import type { StatusMark as Mark, StatusTone } from "./badge";
import { StatusMark } from "./StatusMark";

export function StatusBadge({
  tone,
  mark,
  label,
  detail,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children" | "role"> & {
  tone: StatusTone;
  mark: Mark;
  label: string;
  detail: string;
}) {
  return (
    <span
      {...props}
      role="img"
      tabIndex={0}
      aria-label={label}
      data-tone={tone}
      data-mark={mark}
      data-tip={detail}
      data-tip-align="end"
      className={`status-badge ${className ?? ""}`.trim()}
    >
      <StatusMark />
      {label}
    </span>
  );
}
