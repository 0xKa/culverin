import type { ComponentChildren } from "preact";
import { ResultRows } from "./ResultRows";

export function ResultSection({
  title,
  summary,
  summaryId,
  children,
  ...rows
}: {
  title: string;
  summary: string;
  summaryId: string;
  rows: string[];
  label: string;
  moreLabel: string;
  id: string;
  children?: ComponentChildren;
}) {
  return (
    <>
      <h2 className="mt-3 text-[0.95rem] font-bold">{title}</h2>
      <p id={summaryId} className="my-1 font-semibold">
        {summary}
      </p>
      {children}
      <ResultRows {...rows} />
    </>
  );
}
