import { expect, test } from "bun:test";
import { tabIconHref } from "../../extension/src/settings/tab-icon";
import { brandMarkLayout } from "../../extension/src/ui/brand-mark";
import { css, themeModes, variable } from "./support/theme-css";

test("draws the bare brand mark in the given color", () => {
  const href = tabIconHref("#1d385c", 32);
  expect(href.startsWith("data:image/svg+xml,")).toBe(true);
  const svg = decodeURIComponent(href.slice("data:image/svg+xml,".length));
  expect(svg).toContain('viewBox="0 0 32 32"');
  expect(svg).toContain('fill="#1d385c"');
  expect(svg).not.toContain("currentColor");
  expect([...svg.matchAll(/<rect /g)]).toHaveLength(brandMarkLayout(32).length);
});

test("uses the light and dark accent colors for the tab icon", () => {
  expect(variable([css], "--tab-icon-light")).toBe(
    variable(themeModes.light, "--color-accent"),
  );
  expect(variable([css], "--tab-icon-dark")).toBe(
    variable(themeModes.dark, "--color-accent"),
  );
});
