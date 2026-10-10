import { ChevronDown } from "lucide-preact";
import type { BreakdownRow } from "./view";
import { tip } from "../ui/tooltip";

const VISIBLE_ROWS = 10;

function Rows({
  rows,
  label,
  muted,
}: {
  rows: BreakdownRow[];
  label: string;
  muted?: boolean;
}) {
  return (
    <ul aria-label={label} className="mt-2.5 grid gap-2.5">
      {rows.map((row) => (
        <li key={row.label} {...tip(row.title)}>
          <span className="sr-only">{row.label}</span>
          <div aria-hidden="true">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="min-w-0 font-medium wrap-anywhere">
                {row.name}
              </span>
              <span className="text-muted shrink-0 text-2xs">{row.files}</span>
              <span className="ml-auto shrink-0 font-mono font-medium">
                {row.value}
              </span>
              <span className="text-muted w-11 shrink-0 text-right font-mono text-2xs">
                {row.share.toFixed(1)}%
              </span>
            </div>
            <div className="bg-track mt-1 h-1 overflow-hidden forced-colors:border forced-colors:border-[CanvasText]">
              <div
                className={`bar-fill h-full forced-colors:bg-[CanvasText] ${row.share > 0 ? "min-w-0.5" : ""} ${muted ? "bg-control" : "bg-accent"}`}
                style={{ width: `${row.share}%` }}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ResultRows({
  rows,
  label,
  moreLabel,
  id,
  muted,
}: {
  rows: BreakdownRow[];
  label: string;
  moreLabel: string;
  id: string;
  muted?: boolean;
}) {
  const visible = rows.slice(0, VISIBLE_ROWS);
  const more = rows.slice(VISIBLE_ROWS);
  return (
    <>
      <Rows rows={visible} label={label} muted={muted} />
      {more.length > 0 && (
        <details id={id} className="group">
          <summary className="text-accent-text mt-2.5 inline-flex items-center gap-1 rounded-sm text-xs font-medium">
            <span className="group-open:hidden">Show {more.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <ChevronDown
              size={12}
              strokeWidth={1.125}
              class="transition-transform duration-150 ease-(--ease-out-quick) group-open:rotate-180"
            />
          </summary>
          <Rows rows={more} label={moreLabel} muted={muted} />
        </details>
      )}
    </>
  );
}
