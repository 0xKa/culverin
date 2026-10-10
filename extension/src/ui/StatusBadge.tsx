import type { ComponentProps } from "preact";
import type { StatusMark, StatusTone } from "./badge";

export function StatusBadge({
  tone,
  mark,
  label,
  detail,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children" | "role"> & {
  tone: StatusTone;
  mark: StatusMark;
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
      <svg
        className="status-mark"
        viewBox="0 0 16 16"
        aria-hidden="true"
        focusable="false"
      >
        <circle className="status-ring" cx="8" cy="8" r="6" pathLength="24" />
        <circle className="status-dot" cx="8" cy="8" r="2" />
        <path
          className="status-draw"
          data-shape="check"
          d="M5.25 8.25 7.25 10.25 10.75 6.25"
          pathLength="1"
        />
        <path
          className="status-draw"
          data-shape="cross"
          d="M6 6 10 10"
          pathLength="1"
        />
        <path
          className="status-draw"
          data-shape="cross"
          d="M10 6 6 10"
          pathLength="1"
        />
      </svg>
      {label}
    </span>
  );
}
