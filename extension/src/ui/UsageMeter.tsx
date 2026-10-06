import {
  remainingPercent,
  usageLevel,
  type RateLimit,
} from "../github/rate-limit";

const fill = { low: "bg-ok", medium: "bg-warning", high: "bg-error" };

export function UsageMeter({
  id,
  value,
  now,
  className = "h-1.5 w-10",
}: {
  id: string;
  value: RateLimit;
  now: number;
  className?: string;
}) {
  const level = usageLevel(value, now);
  return (
    <span
      id={id}
      aria-hidden="true"
      data-level={level}
      className={`bg-track inline-block shrink-0 overflow-hidden align-middle forced-colors:border forced-colors:border-[CanvasText] ${className}`}
    >
      <span
        className={`block h-full transition-[width] duration-200 ease-(--ease-out-quick) forced-colors:bg-[CanvasText] ${fill[level]}`}
        style={{ width: `${remainingPercent(value, now)}%` }}
      />
    </span>
  );
}
