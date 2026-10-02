import type { ComponentProps } from "preact";

const sizes = {
  compact: "px-2 py-0.5",
  popup: "px-2.5 py-1.5",
  settings: "px-3 py-[7px]",
};
type Props = ComponentProps<"button"> & {
  size?: keyof typeof sizes;
  variant?: "danger";
};
export function Button({
  size = "settings",
  variant,
  className,
  ...props
}: Props) {
  return (
    <button
      {...props}
      className={`${sizes[size]} ${variant === "danger" ? "border-error/60!" : ""} ${className ?? ""}`.trim()}
    />
  );
}
