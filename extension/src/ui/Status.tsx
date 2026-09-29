import type { ComponentChildren } from "preact";

export function Status({
  id,
  className,
  children,
}: {
  id: string;
  className?: string;
  children?: ComponentChildren;
}) {
  return (
    <p
      id={id}
      className={className}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {children}
    </p>
  );
}
