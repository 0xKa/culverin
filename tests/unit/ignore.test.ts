import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { validateResult } from "../../extension/src/counter/result";
import {
  defaultIgnore,
  effectiveRulesHash,
  ignoreGroups,
  normalizeIgnore,
  ruleError,
  type IgnoreGroup,
} from "../../extension/src/counter/rules";
import {
  describeIgnore,
  IGNORE_KEY,
  readIgnore,
  writeIgnore,
  type IgnoreStorage,
} from "../../extension/src/ignore/settings";

class MemoryStorage implements IgnoreStorage {
  values: Record<string, unknown> = {};
  async get(key: string) {
    return key in this.values ? { [key]: this.values[key] } : {};
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.values, structuredClone(items));
  }
  async remove(key: string) {
    delete this.values[key];
  }
}

function native(
  disabledGroups: IgnoreGroup[],
  exclusions: string[],
  paths: string[],
) {
  const output = spawnSync(
    "cargo",
    ["run", "--quiet", "--locked", "-p", "culverin-counter", "--bin", "parity"],
    {
      input: JSON.stringify({
        rules: {
          repositoryId: "1",
          commitSha: "a".repeat(40),
          disabledGroups,
          exclusions,
        },
        files: paths.map((path) => ({
          path,
          bytes: [...new TextEncoder().encode("fn main() {}\n")],
        })),
      }),
      encoding: "utf8",
    },
  );
  if (output.status !== 0) throw new Error(output.stderr);
  const result: unknown = JSON.parse(output.stdout);
  if (!validateResult(result)) throw new Error("invalid result");
  return result;
}

test("explains unsupported rules in plain language", () => {
  for (const rule of [
    "fixtures/",
    "*.snap",
    "schema.graphql",
    "docs/generated",
    "a/b/",
  ])
    expect(ruleError(rule)).toBeUndefined();
  expect(ruleError("/src")).toContain('leading "/"');
  expect(ruleError("src\\gen")).toContain('"/"');
  expect(ruleError("src/**/test")).toContain("Wildcards");
  expect(ruleError("*.")).toContain("file ending");
  expect(ruleError("*.a/b")).toContain("not folders");
  expect(ruleError("a/../b")).toContain('".."');
  expect(ruleError("a".repeat(257))).toContain("256 bytes");
});

test("normalizes settings and rejects unknown groups or extra keys", () => {
  expect(
    normalizeIgnore({
      disabledGroups: ["minified", "build", "build"],
      exclusions: ["b", "a", "b"],
    }),
  ).toEqual({ disabledGroups: ["build", "minified"], exclusions: ["a", "b"] });
  expect(() =>
    normalizeIgnore({ disabledGroups: ["everything"], exclusions: [] }),
  ).toThrow();
  expect(() =>
    normalizeIgnore({ disabledGroups: [], exclusions: [], extra: 1 }),
  ).toThrow();
  expect(() =>
    normalizeIgnore({
      disabledGroups: [],
      exclusions: Array.from({ length: 65 }, (_, n) => `r${n}`),
    }),
  ).toThrow();
});

test("matches the Rust counter's hash, groups, and rule forms", async () => {
  const ignore = normalizeIgnore({
    disabledGroups: ["build"],
    exclusions: ["fixtures/", "*.snap", "schema.rs", "docs/generated"],
  });
  const result = native(ignore.disabledGroups, ignore.exclusions, [
    "src/main.rs",
    "build/main.rs",
    "src/fixtures/a.rs",
    "src/app.snap",
    "api/schema.rs",
    "docs/generated/a.rs",
  ]);
  expect(result.engine.rulesHash).toBe(await effectiveRulesHash(ignore));
  expect(result.coverage.countedFiles).toBe(2);
  expect(result.coverage.skippedByReason.excluded_by_rule).toBe(4);
  expect(await effectiveRulesHash(ignore)).not.toBe(
    await effectiveRulesHash(defaultIgnore),
  );
});

test("keeps the settings page's built-in list in step with the counter", () => {
  const paths = ignoreGroups.flatMap((group) => [
    ...group.directories.map((name) => `${name}/main.rs`),
    ...group.files,
    ...group.suffixes.map((suffix) => `main${suffix}`),
  ]);
  const enabled = native([], [], paths);
  expect(enabled.coverage.skippedByReason.excluded_by_rule).toBe(paths.length);
  const disabled = native(
    ignoreGroups.map((group) => group.id),
    [],
    paths,
  );
  expect(disabled.coverage.skippedByReason.excluded_by_rule).toBe(0);
});

test("stores only non-default settings and falls back on invalid storage", async () => {
  const storage = new MemoryStorage();
  expect(await readIgnore(storage)).toEqual(defaultIgnore);
  await writeIgnore(
    { disabledGroups: ["lockfiles"], exclusions: ["*.snap", "*.snap"] },
    storage,
  );
  expect(storage.values[IGNORE_KEY]).toEqual({
    disabledGroups: ["lockfiles"],
    exclusions: ["*.snap"],
  });
  expect(await readIgnore(storage)).toEqual({
    disabledGroups: ["lockfiles"],
    exclusions: ["*.snap"],
  });
  await writeIgnore(defaultIgnore, storage);
  expect(IGNORE_KEY in storage.values).toBe(false);
  storage.values[IGNORE_KEY] = { disabledGroups: ["bogus"], exclusions: [] };
  expect(await readIgnore(storage)).toEqual(defaultIgnore);
  expect(
    writeIgnore({ disabledGroups: [], exclusions: ["/bad"] }, storage),
  ).rejects.toThrow();
});

test("summarizes active rules for the popup", () => {
  expect(describeIgnore(defaultIgnore)).toBe("");
  expect(describeIgnore({ disabledGroups: ["build"], exclusions: ["a"] })).toBe(
    "1 rule, Build output off",
  );
  expect(
    describeIgnore({
      disabledGroups: ["lockfiles", "dependencies"],
      exclusions: ["a", "b", "c"],
    }),
  ).toBe("3 rules, Dependencies off, Lockfiles off");
});
