import { expect, test } from "bun:test";
import {
  aboutVisibility,
  showAbout,
  type AboutVisibility,
} from "../../extension/src/repository-page/visibility";
import { privateRepository } from "../../extension/src/content/repository";

test("visibility preserves public and unknown pages and hides every state when disabled", () => {
  for (const privacy of [true, false, undefined]) {
    expect(showAbout("all", privacy)).toBe(true);
    expect(showAbout("none", privacy)).toBe(false);
  }
  expect(showAbout("public", true)).toBe(false);
  for (const privacy of [false, undefined]) {
    expect(showAbout("public", privacy)).toBe(true);
  }
});

test("visibility sync preferences preserve defaults and reject unknown settings", async () => {
  const values: Record<string, unknown> = {};
  const storage = {
    get: async () => values,
    set: async (items: Record<string, unknown>) =>
      void Object.assign(values, items),
    remove: async (key: string) => void delete values[key],
  };
  expect(await aboutVisibility.read(storage)).toBe("all");
  for (const choice of ["public", "none"] as AboutVisibility[]) {
    await aboutVisibility.write(choice, storage);
    expect(await aboutVisibility.read(storage)).toBe(choice);
  }
  await aboutVisibility.write("all", storage);
  expect(values).toEqual({});
  for (const invalid of [true, "private", "unknown", {}, ["none"]]) {
    values[aboutVisibility.key] = invalid;
    expect(await aboutVisibility.read(storage)).toBe("all");
  }
});

test("page privacy requires a marker for the current repository", () => {
  const repository = { owner: "owner", name: "repo" };
  const document = (nwo: string, publicValue?: string) =>
    ({
      querySelector: (selector: string) => ({
        getAttribute: () => (selector.includes("_nwo") ? nwo : publicValue),
      }),
    }) as unknown as Document;
  expect(privateRepository(repository, document("Owner/Repo", "false"))).toBe(
    true,
  );
  expect(privateRepository(repository, document("owner/repo", "true"))).toBe(
    false,
  );
  expect(
    privateRepository(repository, document("other/repo", "false")),
  ).toBeUndefined();
  expect(privateRepository(repository, document("owner/repo"))).toBeUndefined();
});
