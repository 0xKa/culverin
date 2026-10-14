import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { BrandIcon } from "../ui/BrandIcon";
import TechText from "../ui/tech-text/TechText";

const NAME = "Culverin";
const SIZE = 52;
const WEIGHT = 600;
const SPACING = -0.05;
const PADDING = 24;
const BLEED = 24;
const INTRO = 2400;
const SETTLE = 300;
const INTRO_SPEED = Math.PI / 0.45 / (INTRO / 1000);

function canvas(): CanvasRenderingContext2D | null {
  return document
    .createElement("canvas")
    .getContext("2d", { willReadFrequently: true });
}

function measure(fontFamily: string): number | undefined {
  const context = canvas();
  if (!context) return undefined;
  context.font = `${WEIGHT} ${SIZE}px ${fontFamily}`;
  context.letterSpacing = `${SPACING * SIZE}px`;
  const metrics = context.measureText(NAME);
  return Math.ceil(
    metrics.actualBoundingBoxLeft +
      metrics.actualBoundingBoxRight +
      PADDING * 2,
  );
}

function toHex(color: string): string {
  const context = canvas();
  if (!context) return "#000000";
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return `#${[red, green, blue]
    .map((channel) => (channel ?? 0).toString(16).padStart(2, "0"))
    .join("")}`;
}

export function BrandHeader() {
  const header = useRef<HTMLElement>(null);
  const highlight = useRef<HTMLSpanElement>(null);
  const [colors, setColors] = useState<{ ink: string; accent: string }>();
  const [width, setWidth] = useState<number>();
  const [intro, setIntro] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      if (timer !== undefined || document.visibilityState !== "visible") return;
      timer = setTimeout(() => setIntro(false), INTRO + SETTLE);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, []);

  useLayoutEffect(() => {
    const element = header.current;
    const swatch = highlight.current;
    if (!element || !swatch) return;
    const read = () => {
      const ink = toHex(getComputedStyle(element).color);
      const accent = toHex(getComputedStyle(swatch).color);
      setColors((current) =>
        current?.ink === ink && current.accent === accent
          ? current
          : { ink, accent },
      );
    };
    read();
    const size = () => setWidth(measure(getComputedStyle(element).fontFamily));
    size();
    void document.fonts.ready.then(size);
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "data-contrast", "data-accent"],
    });
    scheme.addEventListener("change", read);
    return () => {
      observer.disconnect();
      scheme.removeEventListener("change", read);
    };
  }, []);

  return (
    <header
      ref={header}
      className="text-ink mb-8 flex items-center gap-1 font-mono"
    >
      <BrandIcon size={56} className="translate-y-[3px]" />
      <span
        ref={highlight}
        aria-hidden="true"
        className="text-accent-text hidden"
      />
      <h1
        className="relative m-0 max-w-full min-w-0 flex-1"
        style={{ height: Math.round(SIZE * 0.68) * 2, maxWidth: width }}
      >
        {colors ? (
          <div className="absolute" style={{ inset: -BLEED }}>
            <TechText
              text={NAME}
              fontSize={SIZE}
              fontWeight={WEIGHT}
              letterSpacing={SPACING}
              color={colors.ink}
              accentColor={colors.accent}
              draggable={false}
              sweep={intro}
              speed={INTRO_SPEED}
            />
          </div>
        ) : null}
      </h1>
    </header>
  );
}
