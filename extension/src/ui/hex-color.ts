export function hexColor(color: string): string {
  const context = document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
  if (!context) return "#000000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue]
    .map((channel) => (channel ?? 0).toString(16).padStart(2, "0"))
    .join("")}`;
}
