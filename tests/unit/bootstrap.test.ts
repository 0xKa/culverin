import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("manifest grants only the execution host permission beyond bootstrap", () => {
  const manifest = JSON.parse(
    readFileSync("extension/public/manifest.json", "utf8"),
  ) as {
    manifest_version: number;
    permissions: string[];
    host_permissions: string[];
  };
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(["storage", "offscreen"]);
  expect(manifest.host_permissions).toEqual([
    "https://github.com/*",
    "https://api.github.com/*",
    "https://codeload.github.com/*",
  ]);
});
