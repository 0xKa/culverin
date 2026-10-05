import type { ComponentChildren, ComponentProps } from "preact";

export function IconButton({
  label,
  children,
  className,
  ...props
}: ComponentProps<"button"> & { label: string; children: ComponentChildren }) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`text-muted hover:bg-hover hover:text-ink inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-[background-color,color,transform] duration-100 ease-out active:scale-[0.94] ${className ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}
