const steps = Array.from(
  { length: 25 },
  (_, index) => (index % 5) + Math.floor(index / 5),
);

export function DotLoader({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={
        size === "sm" ? "culverin-dots culverin-dots-sm" : "culverin-dots"
      }
      aria-hidden="true"
    >
      {steps.map((step, index) => (
        <span key={index} style={{ "--step": step }} />
      ))}
    </span>
  );
}
