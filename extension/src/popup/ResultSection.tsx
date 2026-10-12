import type { BreakdownRow } from "./view";
import { Joined } from "../ui/Separator";
import { ResultRows } from "./ResultRows";
import { tip } from "../ui/tooltip";

export function ResultSection({
  title,
  titleTip,
  summary,
  summaryTitle,
  summaryId,
  muted,
  ...rows
}: {
  title: string;
  titleTip?: string;
  summary: string[];
  summaryTitle?: string;
  summaryId: string;
  rows: BreakdownRow[];
  label: string;
  moreLabel: string;
  id: string;
  muted?: boolean;
}) {
  return (
    <section className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 {...tip(titleTip)} className="text-md m-0 font-semibold">
          {title}
        </h2>
        <p
          id={summaryId}
          {...tip(summaryTitle, { align: "end" })}
          className="text-muted tabular m-0 text-2xs"
        >
          <Joined parts={summary} />
        </p>
      </div>
      <ResultRows {...rows} muted={muted} />
    </section>
  );
}
