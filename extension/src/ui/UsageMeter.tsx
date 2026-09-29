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
}: {
  id: string;
  value: RateLimit;
  now: number;
}) {
  const level = usageLevel(value, now);
  return (
    <span
      id={id}
      aria-hidden="true"
      data-level={level}
      className="bg-divider inline-block h-1.5 w-10 overflow-hidden rounded-full align-middle"
    >
      <span
        className={`block h-full ${fill[level]}`}
        style={{ width: `${remainingPercent(value, now)}%` }}
      />
    </span>
  );
}
