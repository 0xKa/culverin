import type { ComponentChildren, ComponentProps } from "preact";
import { tipPlacement, type TipPlacement } from "./tooltip";

const tones = {
  default: "text-muted hover:bg-hover hover:text-ink",
  danger: "text-error hover:bg-error-soft",
};

export function IconButton({
  label,
  tone = "default",
  tip = { align: "end" },
  children,
  className,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  tone?: keyof typeof tones;
  tip?: TipPlacement;
  children: ComponentChildren;
}) {
  return (
    <button
      {...props}
      aria-label={label}
      data-tip={label}
      {...tipPlacement(tip)}
      className={`${tones[tone]} inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-[background-color,color,translate] duration-100 ease-out active:translate-y-px ${className ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}
