import { useEffect, useState } from "preact/hooks";
import { brandMarkPixels, brandMarkSvg } from "./brand-mark";

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

export function BrandIcon({
  size,
  className,
}: {
  size: number;
  className?: string;
}) {
  const ratio = usePixelRatio();
  const pixels = brandMarkPixels(size, ratio);
  const length = `${pixels / ratio}px`;
  return (
    <span
      aria-hidden="true"
      className={`culverin-icon block shrink-0 ${className ?? ""}`.trim()}
      style={{
        width: length,
        height: length,
        maskImage: `url("data:image/svg+xml,${encodeURIComponent(brandMarkSvg(pixels))}")`,
      }}
    />
  );
}
