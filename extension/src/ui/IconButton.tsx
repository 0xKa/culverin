import type { ComponentChildren, ComponentProps } from "preact";
import { tipPlacement, type TipPlacement } from "./tooltip";

const sizes = {
  sm: "size-6",
  md: "size-8",
};

const tones = {
  default: "text-muted hover:bg-hover hover:text-ink",
  danger: "text-error hover:bg-error-soft",
  accent: "text-accent-text hover:bg-accent-soft",
};

export function IconButton({
  label,
  size = "md",
  tone = "default",
  tip = { align: "end" },
  children,
  className,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  size?: keyof typeof sizes;
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
      className={`${tones[tone]} ${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-md border border-transparent transition-[background-color,color,translate] duration-100 ease-out active:translate-y-px ${className ?? ""}`.trim()}
    >
      {children}
    </button>
  );
}
