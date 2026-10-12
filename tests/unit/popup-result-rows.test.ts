import { expect, test } from "bun:test";
import { breakdownColor } from "../../extension/src/popup/breakdown";
import { languageColorStyle } from "../../extension/src/appearance/language-palette";

test("code rows carry their own language color, a swatch, and a colorable bar", () => {
  for (const name of ["Rust", "TypeScript", "A future language"]) {
    expect(breakdownColor("code", name)).toEqual({
      row: {
        className: "language-color",
        "data-subdued": undefined,
        style: languageColorStyle(name),
      },
      swatch: true,
      fill: "language-fill bg-accent",
    });
  }
});

test("colors follow the language, not its rank or neighbors", () => {
  const first = ["Rust", "Go", "C"].map((name) => breakdownColor("code", name));
  const second = ["C", "Rust", "Go"].map((name) =>
    breakdownColor("code", name),
  );
  expect(first[0]).toEqual(second[1]!);
  expect(first[1]).toEqual(second[2]!);
  expect(first[2]).toEqual(second[0]!);
  expect(first[0]!.row.style).not.toEqual(first[1]!.row.style);
});

test("text rows use a subdued version of their own color", () => {
  const markdown = breakdownColor("text", "Markdown");
  expect(markdown.row["data-subdued"]).toBe("");
  expect(markdown.row.style).toEqual(languageColorStyle("Markdown"));
  expect(markdown.swatch).toBe(true);
});

test("other files stay neutral even when an extension looks like a language", () => {
  for (const name of [".rs", "Rust", "No extension"])
    expect(breakdownColor("other", name)).toEqual({
      row: {},
      swatch: false,
      fill: "bg-control",
    });
});
