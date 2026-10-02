import type { ComponentProps } from "preact";

export function ExternalLink({
  className = "underline",
  ...props
}: ComponentProps<"a">) {
  return (
    <a {...props} className={className} target="_blank" rel="noreferrer" />
  );
}
