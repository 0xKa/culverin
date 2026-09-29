import { expect, test } from "bun:test";
import { sectionFromHash } from "../../extension/src/settings/sections";

test("selects the settings section named by the URL fragment", () => {
  expect(sectionFromHash("#storage")).toBe("storage");
  expect(sectionFromHash("#ignore")).toBe("ignore");
});

test("falls back to Culverin ignore for missing or unknown fragments", () => {
  expect(sectionFromHash("")).toBe("ignore");
  expect(sectionFromHash("#")).toBe("ignore");
  expect(sectionFromHash("#cache")).toBe("ignore");
  expect(sectionFromHash("#Storage")).toBe("ignore");
});
