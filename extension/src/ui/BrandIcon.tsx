import icon from "../../../assets/mono/culverin-mono-stats.svg";

export function BrandIcon({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`culverin-icon block shrink-0 ${className}`}
      style={{ maskImage: `url("${icon}")` }}
    />
  );
}
