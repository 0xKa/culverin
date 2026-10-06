const steps = Array.from(
  { length: 25 },
  (_, index) => (index % 5) + Math.floor(index / 5),
);

export function DotLoader({ className }: { className?: string }) {
  return (
    <span
      className={className ? `culverin-dots ${className}` : "culverin-dots"}
      aria-hidden="true"
    >
      {steps.map((step, index) => (
        <span key={index} style={{ "--step": step }} />
      ))}
    </span>
  );
}
