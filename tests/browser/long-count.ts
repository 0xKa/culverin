import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";
import { encoder, entry, join } from "../tar-fixture";

const durationMs = Number(process.env.CULVERIN_LONG_COUNT_MS ?? 390_000);
const intervalMs = 10_000;
const sha = "c".repeat(40);
const lines = 50_000;
const temporary = mkdtempSync(resolve(tmpdir(), "culverin-long-count-"));
const extension = resolve(temporary, "extension");
const profile = resolve(temporary, "profile");
cpSync(resolve("extension/dist"), extension, { recursive: true });

const certificate = spawnSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=github.com",
    "-addext",
    "subjectAltName=DNS:github.com,DNS:api.github.com,DNS:codeload.github.com",
    "-keyout",
    resolve(temporary, "key.pem"),
    "-out",
    resolve(temporary, "cert.pem"),
  ],
  { encoding: "utf8" },
);
assert.equal(certificate.status, 0, certificate.stderr);

const archive = gzipSync(
  join(
    entry(
      `long-count-${sha}/src/main.rs`,
      encoder.encode("fn main() {}\n".repeat(lines)),
    ),
    new Uint8Array(1024),
  ),
);
const slices = Math.max(1, Math.ceil(durationMs / intervalMs));
const page = `<!doctype html><html><head><meta name="octolytics-dimension-repository_nwo" content="culverin/long-count"><meta name="octolytics-dimension-repository_public" content="true"></head><body><main><react-app id="app" class="loaded"><div id="about"><h2>About</h2><div class="mt-2"><a id="forks" href="/culverin/long-count/forks"><strong>0</strong> forks</a></div></div></react-app></main></body></html>`;
let archiveStarted = 0;
let archiveFinished = 0;

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  tls: {
    cert: readFileSync(resolve(temporary, "cert.pem"), "utf8"),
    key: readFileSync(resolve(temporary, "key.pem"), "utf8"),
  },
  fetch(request) {
    const url = new URL(request.url);
    const host = request.headers.get("host")?.split(":")[0];
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        headers: { "content-type": "application/json" },
      });
    if (host === "github.com" && url.pathname === "/culverin/long-count")
      return new Response(page, { headers: { "content-type": "text/html" } });
    if (host === "api.github.com") {
      if (url.pathname === "/repos/culverin/long-count")
        return json({
          id: 7,
          name: "long-count",
          owner: { login: "culverin" },
          private: false,
          default_branch: "main",
          size: 1,
        });
      if (url.pathname === "/repos/culverin/long-count/commits/main")
        return json({ sha });
      if (url.pathname === `/repos/culverin/long-count/tarball/${sha}`)
        return Response.redirect(
          `https://codeload.github.com/culverin/long-count/legacy.tar.gz/${sha}`,
          302,
        );
    }
    if (
      host === "codeload.github.com" &&
      url.pathname === `/culverin/long-count/legacy.tar.gz/${sha}`
    ) {
      archiveStarted = Date.now();
      let index = 0;
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (index === slices) {
              archiveFinished = Date.now();
              controller.close();
              return;
            }
            if (index > 0) await Bun.sleep(intervalMs);
            const size = Math.ceil(archive.length / slices);
            controller.enqueue(archive.slice(index * size, ++index * size));
          },
        }),
        { headers: { "content-type": "application/x-gzip" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  },
});

const browser = spawn(
  process.env.CHROME_BIN || chromium.executablePath(),
  [
    "--headless=new",
    `--user-data-dir=${profile}`,
    "--remote-debugging-port=0",
    `--disable-extensions-except=${extension}`,
    `--load-extension=${extension}`,
    `--host-resolver-rules=MAP github.com 127.0.0.1:${server.port},MAP api.github.com 127.0.0.1:${server.port},MAP codeload.github.com 127.0.0.1:${server.port}`,
    "--ignore-certificate-errors",
    "--no-first-run",
    "about:blank",
  ],
  { stdio: "ignore" },
);

type Reply = { id?: number; result?: Record<string, unknown>; error?: unknown };

try {
  const portFile = resolve(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt++)
    await Bun.sleep(100);
  const [port, path] = readFileSync(portFile, "utf8").trim().split("\n");
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((done) => socket.addEventListener("open", done));
  let nextId = 0;
  const waiting = new Map<number, (reply: Reply) => void>();
  socket.addEventListener("message", (event) => {
    const reply = JSON.parse(String(event.data)) as Reply;
    const handler =
      typeof reply.id === "number" ? waiting.get(reply.id) : undefined;
    if (typeof handler === "function") handler(reply);
  });
  const send = (
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ) =>
    new Promise<Record<string, unknown>>((done, fail) => {
      const id = ++nextId;
      waiting.set(id, (reply) => {
        waiting.delete(id);
        if (reply.error) fail(new Error(JSON.stringify(reply.error)));
        else done(reply.result ?? {});
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  const { targetId } = await send("Target.createTarget", {
    url: "https://github.com/culverin/long-count",
  });
  const { sessionId } = (await send("Target.attachToTarget", {
    targetId,
    flatten: true,
  })) as { sessionId: string };
  const evaluate = async (expression: string) =>
    (
      (await send("Runtime.evaluate", { expression }, sessionId)) as {
        result: { value?: unknown };
      }
    ).result.value;
  const row = `document.querySelector("[data-culverin-root]")?.shadowRoot`;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (await evaluate(`Boolean(${row}?.querySelector("button.row"))`)) break;
    await Bun.sleep(100);
  }
  const [x, y] = JSON.parse(
    String(
      await evaluate(
        `(() => { const box = ${row}.querySelector("button.row").getBoundingClientRect(); return JSON.stringify([box.x + box.width / 2, box.y + box.height / 2]); })()`,
      ),
    ),
  ) as [number, number];
  for (const type of ["mousePressed", "mouseReleased"])
    await send(
      "Input.dispatchMouseEvent",
      { type, x, y, button: "left", clickCount: 1 },
      sessionId,
    );
  const started = Date.now();
  let text = "";
  let worker = true;
  while (Date.now() - started < durationMs + 5 * 60_000) {
    await Bun.sleep(5_000);
    text = String(
      await evaluate(
        `(() => { const live = ${row}?.querySelector("[aria-live]"); return [live?.textContent, live?.querySelector(".row")?.getAttribute("title")].filter(Boolean).join(" — "); })()`,
      ),
    );
    const { targetInfos } = (await send("Target.getTargets")) as {
      targetInfos: { type: string; url: string }[];
    };
    worker &&= targetInfos.some(
      (target) =>
        target.type === "service_worker" &&
        target.url.endsWith("/background.js"),
    );
    if (/lines of code|Couldn't|Retry/i.test(text)) break;
  }
  const elapsedMs = Date.now() - started;
  console.log(
    JSON.stringify({
      elapsedMs,
      archiveMs: archiveFinished - archiveStarted,
      slices,
      intervalMs,
      serviceWorkerSeenThroughout: worker,
      row: text,
    }),
  );
  assert.ok(archiveFinished - archiveStarted >= durationMs - intervalMs);
  assert.match(text, new RegExp(`${lines.toLocaleString("en")} lines of code`));
  console.log(
    `Long count completed after ${Math.round(elapsedMs / 1000)} s without the service worker being kept alive by a debugger`,
  );
} finally {
  browser.kill();
  await server.stop(true);
  rmSync(temporary, { recursive: true, force: true });
}
