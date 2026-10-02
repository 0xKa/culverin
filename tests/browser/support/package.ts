import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
export function inspectPackage(directory: string): void {
  assert.deepEqual(readdirSync(directory).sort(), [
    "THIRD_PARTY_NOTICES.txt",
    "assets",
    "background.js",
    "content.js",
    "icons",
    "manifest.json",
    "offscreen.html",
    "offscreen.js",
    "popup.html",
    "popup.js",
    "settings.html",
    "settings.js",
  ]);
  assert.deepEqual(readdirSync(resolve(directory, "icons")).sort(), [
    "icon-128.png",
    "icon-16.png",
    "icon-32.png",
    "icon-48.png",
  ]);
  assert.deepEqual(
    readdirSync(resolve(directory, "assets"))
      .map((name) => name.replace(/-[A-Za-z0-9_-]+(?=\.)/, "-HASH"))
      .sort(),
    [
      "culverin_counter_bg-HASH.wasm",
      "preact-HASH.js",
      "result-HASH.js",
      "settings-HASH.js",
      "settings-HASH.js",
      "styles-HASH.css",
      "styles-HASH.js",
      "tar-HASH.js",
      "worker-HASH.js",
      "worker-HASH.js",
    ],
  );
  const manifest = JSON.parse(
    readFileSync(resolve(directory, "manifest.json"), "utf8"),
  ) as {
    permissions: string[];
    host_permissions: string[];
    action: {
      default_icon: Record<string, string>;
      default_popup: string;
      default_title: string;
    };
    content_security_policy: { extension_pages: string };
    options_page: string;
  };
  assert.deepEqual(manifest.permissions, ["storage", "offscreen"]);
  assert.equal(manifest.options_page, "settings.html");
  assert.deepEqual(manifest.action, {
    default_icon: {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png",
      "48": "icons/icon-48.png",
      "128": "icons/icon-128.png",
    },
    default_title: "Culverin",
    default_popup: "popup.html",
  });
  assert.deepEqual(manifest.host_permissions, [
    "https://github.com/*",
    "https://api.github.com/*",
    "https://codeload.github.com/*",
  ]);
  assert.equal(
    manifest.content_security_policy.extension_pages,
    "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.github.com https://codeload.github.com https://github.com",
  );
  for (const file of [
    "settings.js",
    "popup.js",
    "content.js",
    "offscreen.js",
  ]) {
    const source = readFileSync(resolve(directory, file), "utf8");
    assert.equal(source.includes("github.connection"), false);
    assert.equal(source.includes("login/oauth/access_token"), false);
  }
  for (const file of readdirSync(resolve(directory, "assets")).filter((name) =>
    name.endsWith(".js"),
  )) {
    assert.equal(
      readFileSync(resolve(directory, "assets", file), "utf8").includes(
        "github.connection",
      ),
      false,
    );
  }
}
