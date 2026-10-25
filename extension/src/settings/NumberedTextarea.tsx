import type { ComponentProps } from "preact";
import { useRef } from "preact/hooks";

export function NumberedTextarea({
  value,
  invalid,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "className" | "class"> & {
  value: string;
  invalid: boolean;
}) {
  const numbers = useRef<HTMLDivElement>(null);
  const count = value ? value.split("\n").length : 0;

  return (
    <div
      className={`${invalid ? "border-error" : "border-control has-focus-visible:border-accent"} bg-canvas has-focus-visible:outline-accent flex overflow-hidden rounded-md border font-mono text-sm leading-5 transition-[border-color] duration-150 has-focus-visible:outline-2`}
    >
      <div
        aria-hidden="true"
        className="border-divider bg-surface text-muted relative shrink-0 overflow-hidden border-r select-none"
        style={{
          width: `calc(${Math.max(2, String(count).length)}ch + 1.25rem)`,
        }}
      >
        <div
          ref={numbers}
          className="absolute inset-x-0 top-0 px-2.5 py-1.5 text-right tabular-nums"
        >
          {Array.from({ length: count }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
      </div>
      <textarea
        {...props}
        value={value}
        wrap="off"
        aria-invalid={invalid}
        className="text-ink placeholder:text-muted block min-w-0 flex-1 resize-y border-0 bg-transparent px-2.5 py-1.5 font-mono text-sm leading-5 outline-none"
        onScroll={(event) => {
          if (numbers.current)
            numbers.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
        }}
      />
    </div>
  );
}
