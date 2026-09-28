import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { validateResult } from "../../extension/src/counter/result";
import {
  isTextLanguage,
  textLines,
} from "../../extension/src/popup/text-lines";

const encoder = new TextEncoder();

test("counts prose lines from text formats without touching code lines", () => {
  const files = {
    "README.md": "# Title\n\nSome prose.\n\n```rust\nfn main() {}\n```\n",
    README: "plain readme\n\nsecond line\n",
    "notes.txt": "one\ntwo\n",
    "src/lib.rs": "// comment\nfn lib() {}\n",
  };
  const native = spawnSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "culverin-counter", "--bin", "parity"],
    {
      input: JSON.stringify({
        rules: { repositoryId: "1", commitSha: "a".repeat(40) },
        files: Object.entries(files).map(([path, text]) => ({
          path,
          bytes: [...encoder.encode(text)],
        })),
      }),
      encoding: "utf8",
    },
  );
  expect(native.status).toBe(0);
  const result: unknown = JSON.parse(native.stdout);
  if (!validateResult(result)) throw new Error("invalid result");
  expect(result.coverage.countedFiles).toBe(4);
  expect(result.totals.code).toBe(2);
  expect(textLines(result.languages)).toBe(8);
});

test("recognizes only prose formats as text", () => {
  for (const language of ["Markdown", "MDX", "Djot", "Plain Text"])
    expect(isTextLanguage(language)).toBe(true);
  for (const language of ["Rust", "HTML", "ReStructuredText", "JSON"])
    expect(isTextLanguage(language)).toBe(false);
});
