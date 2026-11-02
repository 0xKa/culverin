import {
  brandMarkLayout,
  brandMarkPixels,
  brandMarkSvg,
} from "../ui/brand-mark";
import { hexColor } from "../ui/hex-color";

export function tabIconHref(color: string, pixels: number): string {
  const svg = brandMarkSvg(pixels, brandMarkLayout(pixels), color);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function followTabIcon(): void {
  const scheme = matchMedia("(prefers-color-scheme: dark)");
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  const probe = document.createElement("span");
  probe.hidden = true;
  document.head.append(link, probe);
  const update = () => {
    probe.style.color = `var(--tab-icon-${scheme.matches ? "dark" : "light"})`;
    const color = hexColor(getComputedStyle(probe).color);
    const href = tabIconHref(color, brandMarkPixels(16, devicePixelRatio));
    if (link.href !== href) link.href = href;
  };
  update();
  scheme.addEventListener("change", update);
  new MutationObserver(update).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-accent"],
  });
}
