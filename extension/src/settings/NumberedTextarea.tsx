import type { ComponentProps } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

const LINE = 20;
const PAD = 6;
const NOTCH = 50;

function rowTop(row: number): number {
  return row > 0 ? PAD + row * LINE : 0;
}

export function NumberedTextarea({
  value,
  invalid,
  rows,
  ...props
}: Omit<
  ComponentProps<"textarea">,
  "value" | "rows" | "className" | "class"
> & {
  value: string;
  invalid: boolean;
  rows: number;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(0);
  const count = value ? value.split("\n").length : 0;

  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;
    element.style.height = "0";
    element.style.minHeight = "0";
    element.style.minWidth = "0";
    const height = element.scrollHeight;
    const width = element.scrollWidth;
    element.style.height = "";
    element.style.minHeight = `${height}px`;
    element.style.minWidth = width > element.clientWidth ? `${width}px` : "";
  }, [value]);

  function scrollRows(event: WheelEvent): void {
    const element = scroller.current;
    if (
      !element ||
      event.ctrlKey ||
      event.shiftKey ||
      !event.deltaY ||
      Math.abs(event.deltaX) > Math.abs(event.deltaY)
    )
      return;
    const max = element.scrollHeight - element.clientHeight;
    if (event.deltaY > 0 ? element.scrollTop >= max : element.scrollTop <= 0)
      return;
    event.preventDefault();
    let step: number;
    if (
      event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      Math.abs(event.deltaY) >= NOTCH
    ) {
      pending.current = 0;
      step = Math.sign(event.deltaY);
    } else {
      if (Math.sign(pending.current) !== Math.sign(event.deltaY))
        pending.current = 0;
      pending.current += event.deltaY;
      step = Math.trunc(pending.current / LINE);
      pending.current -= step * LINE;
      if (!step) return;
    }
    const row =
      element.scrollTop <= PAD
        ? 0
        : Math.round((element.scrollTop - PAD) / LINE);
    element.scrollTop = Math.min(max, Math.max(0, rowTop(row + step)));
  }

  return (
    <div
      ref={scroller}
      className={`${invalid ? "border-error" : "border-control has-focus-visible:border-accent"} bg-canvas has-focus-visible:outline-accent min-h-[calc(2rem+2px)] cursor-default resize-y overflow-auto rounded-md border font-mono text-sm leading-5 transition-[border-color] duration-150 has-focus-visible:outline-2`}
      style={{ height: `${rows * LINE + PAD * 2 + 2}px` }}
      onWheel={scrollRows}
    >
      <div className="flex min-h-full min-w-full">
        <div
          aria-hidden="true"
          className="border-divider bg-surface text-muted sticky left-0 z-10 shrink-0 border-r px-2.5 py-1.5 text-right tabular-nums select-none"
          style={{
            width: `calc(${Math.max(2, String(count).length)}ch + 1.25rem)`,
          }}
        >
          {Array.from({ length: count }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          {...props}
          ref={field}
          rows={1}
          value={value}
          wrap="off"
          aria-invalid={invalid}
          className="text-ink placeholder:text-muted block min-w-0 flex-1 resize-none overflow-hidden border-0 bg-transparent px-2.5 py-1.5 font-mono text-sm leading-5 outline-none"
        />
      </div>
    </div>
  );
}
