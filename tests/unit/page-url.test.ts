import { expect, test } from "bun:test";
import { isPageUrl } from "../../extension/src/background/page-url";

const settings = "chrome-extension://abcdefghijklmnop/settings.html";

test("matches an extension page with or without a URL fragment", () => {
  expect(isPageUrl(settings, settings)).toBe(true);
  expect(isPageUrl(`${settings}#storage`, settings)).toBe(true);
  expect(isPageUrl(`${settings}#`, settings)).toBe(true);
});

test("rejects other pages, queries, extensions, and invalid URLs", () => {
  expect(isPageUrl(undefined, settings)).toBe(false);
  expect(isPageUrl("", settings)).toBe(false);
  expect(isPageUrl("not a url", settings)).toBe(false);
  expect(isPageUrl(`${settings}?section=storage`, settings)).toBe(false);
  expect(
    isPageUrl("chrome-extension://abcdefghijklmnop/popup.html", settings),
  ).toBe(false);
  expect(
    isPageUrl("chrome-extension://ponmlkjihgfedcba/settings.html", settings),
  ).toBe(false);
  expect(isPageUrl("https://github.com/settings.html#storage", settings)).toBe(
    false,
  );
});
