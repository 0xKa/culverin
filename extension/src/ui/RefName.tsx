import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { tip } from "./tooltip";

export function RefName({
  view,
  className = "",
}: {
  view: { name: string; note?: string };
  className?: string;
}) {
  const { name, note } = view;
  const element = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const node = element.current;
    if (!node) return;
    const measure = () => setCut(node.scrollWidth > node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [name]);
  return (
    <span
      ref={element}
      {...tip(note ?? (cut ? name : undefined), { side: "top" })}
      className={`min-w-0 truncate ${note ? "bg-accent-soft text-accent-text rounded-sm px-1 font-medium forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText]" : "text-muted"} ${className}`}
    >
      {name}
    </span>
  );
}
