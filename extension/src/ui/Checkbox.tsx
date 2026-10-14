import type { ComponentProps } from "preact";

export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type" | "children">) {
  return (
    <span
      className={`culverin-checkbox relative inline-flex size-4.5 shrink-0 align-middle ${className ?? ""}`.trim()}
    >
      <input
        {...props}
        type="checkbox"
        className="absolute -inset-1.25 m-0 size-7 cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span
        className="checkbox-box pointer-events-none relative block size-full"
        aria-hidden="true"
      />
    </span>
  );
}
