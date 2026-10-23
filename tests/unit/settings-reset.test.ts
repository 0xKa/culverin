import { expect, test } from "bun:test";
import { accent } from "../../extension/src/appearance/accent";
import { highContrast } from "../../extension/src/appearance/contrast";
import { theme } from "../../extension/src/appearance/theme";
import { downloadLimit } from "../../extension/src/counting/download-limit";
import {
  aboutLayout,
  defaultAboutLayout,
  moveItem,
} from "../../extension/src/repository-page/about-items";
import {
  optionText,
  preferenceReset,
} from "../../extension/src/settings/reset";

test("offers a reset only once a loaded value differs from the default", () => {
  const change = () => {};
  expect(preferenceReset(theme, undefined, "System", change).modified).toBe(
    false,
  );
  expect(preferenceReset(theme, "system", "System", change).modified).toBe(
    false,
  );
  expect(preferenceReset(theme, "dark", "System", change).modified).toBe(true);
  expect(preferenceReset(highContrast, false, "Off", change).modified).toBe(
    false,
  );
  expect(preferenceReset(highContrast, true, "Off", change).modified).toBe(
    true,
  );
  expect(preferenceReset(downloadLimit, 512, "512 MiB", change).modified).toBe(
    false,
  );
  expect(preferenceReset(downloadLimit, 1024, "512 MiB", change).modified).toBe(
    true,
  );
});

test("compares layouts by content rather than identity", () => {
  const change = () => {};
  const copy = { order: [...defaultAboutLayout.order], hidden: [] };
  expect(preferenceReset(aboutLayout, copy, "default", change).modified).toBe(
    false,
  );
  expect(
    preferenceReset(
      aboutLayout,
      moveItem(defaultAboutLayout, "lines", 1),
      "default",
      change,
    ).modified,
  ).toBe(true);
  expect(
    preferenceReset(
      aboutLayout,
      { ...defaultAboutLayout, hidden: ["size"] },
      "default",
      change,
    ).modified,
  ).toBe(true);
});

test("resets by changing to the preference default", () => {
  const changes: string[] = [];
  const reset = preferenceReset(accent, "teal", "Blue", (value) =>
    changes.push(value),
  );
  expect(reset.to).toBe("Blue");
  reset.onReset();
  expect(changes).toEqual(["blue"]);
});

test("names the default by its visible label, then its accessible name", () => {
  const options = [
    { value: "square", label: { type: "span" }, name: "Square" },
    { value: "none", label: "None" },
    { value: "circle", label: { type: "span" } },
  ];
  expect(optionText(options, "none")).toBe("None");
  expect(optionText(options, "square")).toBe("Square");
  expect(optionText(options, "circle")).toBe("circle");
});
