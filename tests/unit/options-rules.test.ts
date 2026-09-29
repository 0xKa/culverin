import { expect, test } from "bun:test";
import { parseRules } from "../../extension/src/options/rules-input";

test("ignores blank lines, deduplicates rules, and reports exact usage", () => {
  expect(parseRules("\n README \n\nREADME\n *.md \n")).toEqual({
    rules: ["README", "*.md"],
    errors: [],
    usage: "2 of 64 rules · 10 of 4,096 bytes",
  });
});

test("reports invalid rules with their input line", () => {
  expect(parseRules("README\n\n/absolute").errors).toEqual([
    'Line 3: Rules are relative to the repository root; remove the leading "/".',
  ]);
});

test("enforces the rule count and combined byte limits", () => {
  const count = parseRules(
    Array.from({ length: 65 }, (_, index) => `file-${index}`).join("\n"),
  );
  expect(count.errors).toContain("Use at most 64 rules.");
  const bytes = parseRules(
    Array.from({ length: 64 }, (_, index) => `${index}-` + "a".repeat(70)).join(
      "\n",
    ),
  );
  expect(bytes.errors).toContain("Rules can use at most 4096 bytes in total.");
});
