import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const manifest = JSON.parse(
  readFileSync(resolve(root, "extension/public/manifest.json"), "utf8"),
) as { version: string };
const name = `culverin-${manifest.version}.zip`;
const archive = readFileSync(resolve(root, "dist", name));
const [expected] = readFileSync(
  resolve(root, "dist", `${name}.sha256`),
  "utf8",
).split(/\s+/);
const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== expected) {
  console.error(`${name} does not match its checksum file`);
  process.exit(1);
}

const target = mkdtempSync(resolve(tmpdir(), "culverin-package-"));
const end = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
const count = archive.readUInt16LE(end + 10);
let entry = archive.readUInt32LE(end + 16);
for (let index = 0; index < count; index++) {
  const method = archive.readUInt16LE(entry + 10);
  const size = archive.readUInt32LE(entry + 20);
  const nameLength = archive.readUInt16LE(entry + 28);
  const extraLength = archive.readUInt16LE(entry + 30);
  const commentLength = archive.readUInt16LE(entry + 32);
  const offset = archive.readUInt32LE(entry + 42);
  const path = archive.toString("utf8", entry + 46, entry + 46 + nameLength);
  const output = resolve(target, path);
  if (method !== 8 || !output.startsWith(`${target}/`)) {
    console.error(`unexpected ZIP entry: ${path}`);
    process.exit(1);
  }
  const start =
    offset +
    30 +
    archive.readUInt16LE(offset + 26) +
    archive.readUInt16LE(offset + 28);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, inflateRawSync(archive.subarray(start, start + size)));
  entry += 46 + nameLength + extraLength + commentLength;
}

console.log(`Testing ${name} (${digest})`);
const run = spawnSync("bun", ["tests/browser-smoke.ts"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, CULVERIN_EXTENSION_DIR: target },
});
rmSync(target, { recursive: true, force: true });
process.exit(run.status ?? 1);
