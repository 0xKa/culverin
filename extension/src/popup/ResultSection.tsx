import type { ComponentChildren } from "preact";
import type { BreakdownRow } from "./view";
import { Joined } from "../ui/Separator";
import { ResultRows } from "./ResultRows";
import { tip } from "../ui/tooltip";

export function ResultSection({
  title,
  summary,
  summaryTitle,
  summaryId,
  children,
  muted,
  ...rows
}: {
  title: string;
  summary: string[];
  summaryTitle?: string;
  summaryId: string;
  rows: BreakdownRow[];
  label: string;
  moreLabel: string;
  id: string;
  muted?: boolean;
  children?: ComponentChildren;
}) {
  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold">{title}</h2>
        <p
          id={summaryId}
          {...tip(summaryTitle, { align: "end" })}
          className="text-muted tabular m-0 text-2xs"
        >
          <Joined parts={summary} />
        </p>
      </div>
      {children}
      <ResultRows {...rows} muted={muted} />
    </section>
  );
}
