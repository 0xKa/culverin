import type { ComponentProps } from "preact";
import { Check } from "lucide-preact";

export function Checkbox({
  className,
  ...props
}: Omit<ComponentProps<"input">, "type" | "children">) {
  return (
    <span
      className={`culverin-checkbox relative inline-flex size-4 shrink-0 align-middle ${className ?? ""}`.trim()}
    >
      <input
        {...props}
        type="checkbox"
        className="absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-default"
      />
      <span
        className="checkbox-box pointer-events-none flex size-full items-center justify-center rounded-md border"
        aria-hidden="true"
      >
        <Check size={12} strokeWidth={2} />
      </span>
    </span>
  );
}
