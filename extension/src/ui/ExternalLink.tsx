import type { ComponentProps } from "preact";

export function ExternalLink({ className, ...props }: ComponentProps<"a">) {
  return (
    <a
      {...props}
      className={className ?? "underline"}
      target="_blank"
      rel="noreferrer"
    />
  );
}
