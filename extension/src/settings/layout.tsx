import type { ComponentChildren } from "preact";

export function SectionHeader({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children?: ComponentChildren;
}) {
  return (
    <div className="mb-6">
      <h2 id={id} className="m-0 text-xl font-semibold tracking-tight">
        {title}
      </h2>
      {children && <div className="text-muted mt-1.5">{children}</div>}
    </div>
  );
}

export function Panel({
  title,
  titleId,
  actions,
  className,
  children,
}: {
  title?: string;
  titleId?: string;
  actions?: ComponentChildren;
  className?: string;
  children?: ComponentChildren;
}) {
  return (
    <div
      className={`border-divider bg-raised rounded-xl border p-4 ${className ?? ""}`.trim()}
    >
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {title && (
            <h3 id={titleId} className="text-md m-0 font-semibold">
              {title}
            </h3>
          )}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export const inputClass =
  "border-control bg-canvas text-ink placeholder:text-muted rounded-md border px-2.5 py-1.5 transition-[border-color] duration-150 focus-visible:border-accent disabled:opacity-60";
