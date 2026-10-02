const VISIBLE_ROWS = 10;

export function ResultRows({
  rows,
  label,
  moreLabel,
  id,
}: {
  rows: string[];
  label: string;
  moreLabel: string;
  id: string;
}) {
  const visible = rows.slice(0, VISIBLE_ROWS);
  const more = rows.slice(VISIBLE_ROWS);
  return (
    <>
      <ul aria-label={label} className="mt-1 list-disc pl-[22px]">
        {visible.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
      {more.length > 0 && (
        <details id={id} className="group">
          <summary className="inline-flex list-none items-center gap-1 pl-[22px] [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {more.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              width="12"
              height="12"
              className="transition-transform group-open:rotate-180"
            >
              <path
                d="M4 6l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </summary>
          <ul aria-label={moreLabel} className="mt-1 list-disc pl-[22px]">
            {more.map((row) => (
              <li key={row}>{row}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
