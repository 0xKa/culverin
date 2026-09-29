import type { ComponentProps } from "preact";

export function Button(props: ComponentProps<"button">) {
  return <button {...props} />;
}
