import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "extension/dist");
const output = resolve(root, "dist");

const ROOT_FILES = [
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
];
const ICONS = ["icon-128.png", "icon-16.png", "icon-32.png", "icon-48.png"];
const ASSET = /^[A-Za-z0-9_]+-[A-Za-z0-9_-]{8}\.(js|css|wasm)$/;
const ORIGINS = new Set([
  "https://github.com",
  "https://api.github.com",
  "https://codeload.github.com",
  "http://www.w3.org",
]);
const CSP =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; connect-src 'self' https://api.github.com https://codeload.github.com https://github.com";
const MANIFEST_KEYS = [
  "action",
  "background",
  "content_scripts",
  "content_security_policy",
  "description",
  "host_permissions",
  "icons",
  "manifest_version",
  "minimum_chrome_version",
  "name",
  "options_page",
  "permissions",
  "version",
];

const failures: string[] = [];
function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

function walk(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function same(actual: unknown, expected: unknown): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const files = walk(source)
  .map((path) => relative(source, path).split("\\").join("/"))
  .sort();

check(
  same(readdirSync(source).sort(), ROOT_FILES),
  `unexpected top-level files: ${readdirSync(source).sort().join(", ")}`,
);
check(
  same(readdirSync(resolve(source, "icons")).sort(), ICONS),
  "unexpected icon files",
);
const assets = readdirSync(resolve(source, "assets"));
for (const name of assets)
  check(ASSET.test(name), `unexpected asset file: assets/${name}`);
const wasm = assets.filter((name) => name.endsWith(".wasm"));
check(wasm.length === 1, "expected exactly one WebAssembly module");
for (const name of wasm)
  check(
    same(
      [...readFileSync(resolve(source, "assets", name)).subarray(0, 4)],
      [0, 97, 115, 109],
    ),
    `invalid WebAssembly header: assets/${name}`,
  );

const manifest = JSON.parse(
  readFileSync(resolve(source, "manifest.json"), "utf8"),
) as Record<string, unknown> & {
  version: string;
  permissions: string[];
  host_permissions: string[];
  content_security_policy: Record<string, string>;
};
check(
  same(Object.keys(manifest).sort(), MANIFEST_KEYS),
  `unexpected manifest keys: ${Object.keys(manifest).sort().join(", ")}`,
);
check(manifest.manifest_version === 3, "manifest_version must be 3");
check(
  /^\d+(\.\d+){0,3}$/.test(manifest.version),
  "manifest version must be numeric",
);
check(
  same(manifest.permissions, ["storage", "offscreen"]),
  "permissions changed",
);
check(
  same(manifest.host_permissions, [
    "https://github.com/*",
    "https://api.github.com/*",
    "https://codeload.github.com/*",
  ]),
  "host permissions changed",
);
check(
  same(manifest.content_security_policy, { extension_pages: CSP }),
  "content security policy changed",
);

const forbidden = [
  root,
  homedir(),
  "sourceMappingURL",
  "localhost",
  "127.0.0.1",
];
for (const file of files) {
  check(!file.endsWith(".map"), `source map included: ${file}`);
  if (!/\.(js|css|html|json|txt)$/.test(file)) continue;
  const text = readFileSync(resolve(source, file), "utf8");
  for (const value of forbidden)
    check(!text.includes(value), `${file} contains ${value}`);
  if (file.endsWith(".txt")) continue;
  for (const [origin] of text.matchAll(/https?:\/\/[A-Za-z0-9.-]+/g))
    check(
      ORIGINS.has(origin) ||
        (file.endsWith(".css") && origin === "https://tailwindcss.com"),
      `${file} references ${origin}`,
    );
}

if (failures.length) {
  for (const failure of failures)
    console.error(`package check failed: ${failure}`);
  process.exit(1);
}

const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const local: Buffer[] = [];
const central: Buffer[] = [];
let offset = 0;
for (const file of files) {
  const data = readFileSync(resolve(source, file));
  const compressed = deflateRawSync(data, { level: 9 });
  const name = Buffer.from(file, "utf8");
  const checksum = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  local.push(header, name, compressed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE((3 << 8) | 20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(DOS_TIME, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(checksum, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, name);
  offset += header.length + name.length + compressed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, directory, end]);

const name = `culverin-${manifest.version}.zip`;
const digest = createHash("sha256").update(archive).digest("hex");
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, name), archive);
writeFileSync(resolve(output, `${name}.sha256`), `${digest}  ${name}\n`);

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");
const dirty = git("status", "--porcelain").length > 0;
console.log(`dist/${name}`);
console.log(`files: ${files.length}, bytes: ${archive.length}`);
console.log(`sha256: ${digest}`);
console.log(`source: ${commit}${dirty ? " with uncommitted changes" : ""}`);
