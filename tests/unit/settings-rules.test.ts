import { expect, test } from "bun:test";
import { parseRules } from "../../extension/src/settings/rules-input";

test("ignores blank lines and deduplicates rules", () => {
  expect(parseRules("\n README \n\nREADME\n *.md \n")).toEqual({
    rules: ["README", "*.md"],
    errors: [],
    usage: [],
  });
});

test("reports exact usage only near either limit", () => {
  const rules = (count: number, length: number) =>
    Array.from({ length: count }, (_, index) =>
      `${index}`.padStart(length, "a"),
    ).join("\n");
  expect(parseRules(rules(51, 10)).usage).toEqual([]);
  expect(parseRules(rules(52, 10)).usage).toEqual([
    "52 of 64 rules",
    "520 of 4,096 bytes",
  ]);
  expect(parseRules(rules(40, 80)).usage).toEqual([]);
  expect(parseRules(rules(41, 80)).usage).toEqual([
    "41 of 64 rules",
    "3,280 of 4,096 bytes",
  ]);
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
