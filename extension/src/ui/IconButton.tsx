import type { ComponentChildren, ComponentProps } from "preact";

const tones = {
  default: "text-muted hover:bg-hover hover:text-ink",
  danger: "text-error hover:bg-error-soft",
};

export function IconButton({
  label,
  tone = "default",
  children,
  className,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  tone?: keyof typeof tones;
  children: ComponentChildren;
}) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`${tones[tone]} inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-[background-color,color,translate] duration-100 ease-out active:translate-y-px ${className ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}
