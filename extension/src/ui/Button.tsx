import type { ComponentProps } from "preact";

const sizes = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-8 px-3 text-sm",
  lg: "h-9 px-3.5 text-base",
};

const variants = {
  primary:
    "border-transparent bg-accent text-accent-ink hover:not-disabled:bg-accent-hover",
  secondary:
    "border-border bg-raised text-ink shadow-card hover:not-disabled:bg-hover",
  ghost:
    "border-transparent bg-transparent text-muted hover:not-disabled:bg-hover hover:not-disabled:text-ink",
  danger:
    "border-error/45 bg-raised text-error hover:not-disabled:bg-error-soft",
};

export type ButtonProps = ComponentProps<"button"> & {
  size?: keyof typeof sizes;
  variant?: keyof typeof variants;
};

export function buttonClass(
  size: keyof typeof sizes,
  variant: keyof typeof variants,
): string {
  return `inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-[background-color,color,transform,opacity] duration-100 ease-out active:not-disabled:scale-[0.97] disabled:opacity-50 ${sizes[size]} ${variants[variant]}`;
}

export function Button({
  size = "lg",
  variant = "secondary",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      className={`${buttonClass(size, variant)} ${className ?? ""}`.trim()}
    />
  );
}
