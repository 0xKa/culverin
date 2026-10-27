import { useEffect, useState } from "preact/hooks";
import {
  brandMarkLayout,
  brandMarkPixels,
  brandMarkRects,
  brandMarkSvg,
} from "./brand-mark";

function usePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    const query = matchMedia(`(resolution: ${ratio}dppx)`);
    const update = () => setRatio(window.devicePixelRatio || 1);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [ratio]);

  return ratio;
}

function mask(pixels: number, layout?: ReturnType<typeof brandMarkLayout>) {
  return `url("data:image/svg+xml,${encodeURIComponent(brandMarkSvg(pixels, layout))}")`;
}

export function BrandIcon({
  size,
  className,
  recount = false,
}: {
  size: number;
  className?: string;
  recount?: boolean;
}) {
  const ratio = usePixelRatio();
  const pixels = brandMarkPixels(size, ratio);
  const length = `${pixels / ratio}px`;
  const classes = `block shrink-0 ${className ?? ""}`.trim();
  if (!recount)
    return (
      <span
        aria-hidden="true"
        className={`culverin-icon ${classes}`}
        style={{ width: length, height: length, maskImage: mask(pixels) }}
      />
    );
  const layout = brandMarkLayout(pixels);
  const frame = layout.slice(0, 3);
  const lines = layout.slice(3);
  return (
    <span
      aria-hidden="true"
      className={`relative ${classes}`}
      style={{ width: length, height: length }}
    >
      <span
        className="culverin-icon absolute inset-0"
        style={{ maskImage: mask(pixels, frame) }}
      />
      {lines.map(([x, y, width, height], index) => (
        <span
          key={index}
          className="culverin-icon brand-line absolute"
          style={{
            left: `${x / ratio}px`,
            top: `${y / ratio}px`,
            width: `${width / ratio}px`,
            height: `${height / ratio}px`,
            "--line-cells": brandMarkRects[index + 3]![2],
            "--line-index": index,
          }}
        />
      ))}
    </span>
  );
}
