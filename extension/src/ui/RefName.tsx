import { tip } from "./tooltip";

export function RefName({ view }: { view: { name: string; note?: string } }) {
  const { name, note } = view;
  if (!note) return <span className="wrap-anywhere">{name}</span>;
  return (
    <span
      {...tip(note, { side: "top" })}
      className="bg-accent-soft text-accent-text rounded-sm px-1 font-medium wrap-anywhere forced-colors:outline forced-colors:outline-1 forced-colors:outline-[CanvasText]"
    >
      {name}
    </span>
  );
}
