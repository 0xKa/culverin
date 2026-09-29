import { expect, test } from "bun:test";
import {
  aboutDetails,
  browserVersion,
  REPOSITORY_URL,
} from "../../extension/src/settings/about";

test("reads the Chrome version from the user agent", () => {
  expect(
    browserVersion(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.85 Safari/537.36",
    ),
  ).toBe("Chrome 131");
  expect(
    browserVersion("Mozilla/5.0 HeadlessChrome/140.0.7339.16 Safari/537.36"),
  ).toBe("Chrome 140");
  expect(browserVersion("Mozilla/5.0 Firefox/130.0")).toBe("Unknown");
});

test("formats details for an issue report", () => {
  expect(
    aboutDetails([
      ["Culverin", "0.0.2"],
      ["Browser", "Chrome 131"],
    ]),
  ).toBe("Culverin: 0.0.2\nBrowser: Chrome 131");
  expect(REPOSITORY_URL).toBe("https://github.com/0xKa/culverin");
});
