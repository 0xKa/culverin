import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { brandMarkSvg } from "../extension/src/ui/brand-mark";

const output = resolve("assets/store");
const real = resolve(".bun/screenshots/real");
const fixtures = resolve(".bun/screenshots/current");
const accent = "#9fc5ef";

function png(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

function mark(size: number): string {
  return `<span class="mark" style="width:${size}px;height:${size}px">${brandMarkSvg(size * 2)}</span>`;
}

function shot(
  src: string,
  width: number,
  options: {
    left: number;
    top: number;
    height?: number;
    cropTop?: number;
    cropLeft?: number;
    scale?: number;
    ticks?: [number, number, number, number];
    fade?: boolean;
  },
): string {
  const scale = options.scale ?? 1;
  const ticks = options.ticks
    ? `<span class="ticks" style="left:${options.ticks[0]}px;top:${options.ticks[1]}px;width:${options.ticks[2]}px;height:${options.ticks[3]}px"></span>`
    : "";
  const height = options.height ? `height:${options.height}px;` : "";
  const fade = options.fade ? " fade" : "";
  return `<div class="shot${fade}" style="left:${options.left}px;top:${options.top}px;width:${width}px;${height}"><img src="${src}" style="width:${width * scale}px;margin-top:${-(options.cropTop ?? 0)}px;margin-left:${-(options.cropLeft ?? 0)}px">${ticks}</div>`;
}

const popupDark = png(resolve(real, "pingdotgg-t3code/popup-dark.png"));
const goPopupLight = png(resolve(real, "golang-go/popup-light.png"));
const aboutDark = png(resolve(real, "pingdotgg-t3code/about-dark.png"));
const aboutLight = png(resolve(real, "pingdotgg-t3code/about-light.png"));
const goAboutDark = png(resolve(real, "golang-go/about-dark.png"));
const appearance = png(resolve(fixtures, "settings-appearance-dark.png"));

const style = `
* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  position: relative;
  overflow: hidden;
  color: #e6edf3;
  font-family: "Noto Sans", sans-serif;
  background:
    radial-gradient(ellipse 60% 70% at 18% 105%, rgba(56, 105, 170, 0.28), transparent 70%),
    radial-gradient(ellipse 50% 60% at 95% 0%, rgba(56, 105, 170, 0.14), transparent 70%),
    #0a0e15;
}
body::before {
  content: "";
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(140, 170, 210, 0.055) 1px, transparent 1px),
    linear-gradient(90deg, rgba(140, 170, 210, 0.055) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse 80% 80% at 30% 60%, #000 30%, transparent 85%);
}
.mark { display: inline-block; color: ${accent}; flex: none; }
.mark svg { display: block; width: 100%; height: 100%; }
.brand { display: flex; align-items: center; gap: 0.32em; font-family: "JetBrainsMono Nerd Font", monospace; font-weight: 600; letter-spacing: -0.01em; color: #e6edf3; }
.text { position: absolute; }
.kicker { font-family: "JetBrainsMono Nerd Font", monospace; font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase; color: ${accent}; margin: 0 0 18px; }
h1 { margin: 0; font-size: 46px; line-height: 1.14; font-weight: 700; letter-spacing: -0.015em; }
h1 em, .tagline em { font-style: normal; color: #a9cdf5; }
p.lead { margin: 22px 0 0; font-size: 20px; line-height: 1.5; color: #a3b1c2; }
.tagline { margin: 0; font-size: 30px; line-height: 1.35; color: #c9d4e0; }
.tagline em { font-weight: 700; }
.chips { display: flex; gap: 12px; margin-top: 30px; }
.chip { font-family: "JetBrainsMono Nerd Font", monospace; font-size: 17px; color: ${accent}; border: 1px solid rgba(159, 197, 239, 0.45); background: rgba(159, 197, 239, 0.06); padding: 8px 16px; }
.shot { position: absolute; overflow: hidden; border-radius: 14px; border: 1px solid #2b3442; background: #0d1117; box-shadow: 0 30px 70px rgba(0, 0, 0, 0.55); }
.shot img { display: block; }
.shot.fade::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 90px; background: linear-gradient(rgba(13, 17, 23, 0), #0d1117); }
.ticks { position: absolute; pointer-events: none;
  background:
    linear-gradient(${accent}, ${accent}) left top / 12px 2px no-repeat,
    linear-gradient(${accent}, ${accent}) left top / 2px 12px no-repeat,
    linear-gradient(${accent}, ${accent}) right top / 12px 2px no-repeat,
    linear-gradient(${accent}, ${accent}) right top / 2px 12px no-repeat,
    linear-gradient(${accent}, ${accent}) left bottom / 12px 2px no-repeat,
    linear-gradient(${accent}, ${accent}) left bottom / 2px 12px no-repeat,
    linear-gradient(${accent}, ${accent}) right bottom / 12px 2px no-repeat,
    linear-gradient(${accent}, ${accent}) right bottom / 2px 12px no-repeat,
    rgba(159, 197, 239, 0.07);
}
ul.points { list-style: none; margin: 30px 0 0; padding: 0; display: grid; gap: 16px; }
ul.points li { display: flex; gap: 14px; align-items: baseline; font-size: 19px; line-height: 1.45; color: #c9d4e0; }
ul.points li::before { content: ""; flex: none; width: 10px; height: 10px; background: ${accent}; transform: translateY(-2px); }
.flow { position: absolute; display: grid; gap: 0; }
.node { border: 1px solid #2b3442; background: rgba(17, 24, 35, 0.92); border-radius: 14px; padding: 22px 26px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45); }
.node .label { font-family: "JetBrainsMono Nerd Font", monospace; font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #7d8a9b; }
.node .title { margin-top: 8px; font-size: 22px; font-weight: 700; }
.node .detail { margin-top: 6px; font-size: 16px; color: #a3b1c2; line-height: 1.45; }
.node.main { border-color: rgba(159, 197, 239, 0.55); }
.node.main .title { display: flex; align-items: center; gap: 12px; }
.arrow { height: 54px; display: flex; align-items: center; gap: 14px; padding-left: 44px; font-family: "JetBrainsMono Nerd Font", monospace; font-size: 14px; color: #7d8a9b; }
.arrow::before { content: ""; width: 2px; height: 100%; background: linear-gradient(${accent}, rgba(159, 197, 239, 0.25)); }
.none { margin-top: 26px; display: flex; align-items: center; gap: 12px; font-size: 17px; color: #7d8a9b; }
.swatches { display: flex; gap: 12px; margin-top: 30px; }
.swatches span { width: 28px; height: 28px; }
`;

function page(width: number, height: number, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style} body { width: ${width}px; height: ${height}px; }</style></head><body>${body}</body></html>`;
}

const images: [string, number, number, string][] = [
  [
    "screenshot-1-overview",
    1280,
    800,
    `<div class="text" style="left:80px;top:232px;width:560px">
      <div class="brand" style="font-size:64px">${mark(58)}Culverin</div>
      <p class="tagline" style="margin-top:34px">Code stats for GitHub repositories, counted <em>locally in your browser</em>.</p>
      <div class="chips"><span class="chip">Lines per language</span><span class="chip">Files</span><span class="chip">Size</span></div>
    </div>
    ${shot(popupDark, 360, { left: 860, top: 60, height: 800 })}
    ${shot(aboutDark, 304, { left: 590, top: 470, height: 236, cropTop: 248, ticks: [10, 92, 156, 96] })}`,
  ],
  [
    "screenshot-2-about-sidebar",
    1280,
    800,
    `<div class="text" style="left:80px;top:220px;width:520px">
      <p class="kicker">On every repository page</p>
      <h1>Code stats in GitHub's <em>About</em> sidebar</h1>
      <p class="lead">Choose Analyze with Culverin, and lines of code, files, and size appear beside stars and forks. Saved results come back instantly.</p>
    </div>
    ${shot(aboutLight, 304, { left: 660, top: 150, height: 482, ticks: [10, 340, 156, 96] })}
    ${shot(goAboutDark, 304, { left: 900, top: 90, height: 614, ticks: [10, 466, 156, 96] })}`,
  ],
  [
    "screenshot-3-languages",
    1280,
    800,
    `<div class="text" style="left:80px;top:220px;width:430px">
      <p class="kicker">In the toolbar popup</p>
      <h1>Every language, broken down</h1>
      <p class="lead">Code, comments, blank and text lines, with the files and lines behind each language. Light and dark themes follow your system.</p>
    </div>
    ${shot(goPopupLight, 340, { left: 560, top: 70, height: 800 })}
    ${shot(popupDark, 340, { left: 920, top: 40, height: 800 })}`,
  ],
  [
    "screenshot-4-privacy",
    1280,
    800,
    `<div class="text" style="left:80px;top:180px;width:560px">
      <p class="kicker">Private by design</p>
      <h1>Counted in your browser. <em>No servers, no tracking.</em></h1>
      <ul class="points">
        <li>Source goes straight from GitHub to your browser and is never stored.</li>
        <li>Lines are counted with Tokei, compiled to WebAssembly and packaged with the extension.</li>
        <li>Results stay on your device. Connect GitHub only if you want private repositories.</li>
      </ul>
    </div>
    <div class="flow" style="left:740px;top:150px;width:460px">
      <div class="node"><div class="label">GitHub</div><div class="title">github.com</div><div class="detail">Repository metadata and the source archive you choose to count</div></div>
      <div class="arrow">direct download</div>
      <div class="node main"><div class="label">Your browser</div><div class="title">${mark(26)}Culverin</div><div class="detail">Unpacks and counts the archive in memory with WebAssembly</div></div>
      <div class="arrow">totals only</div>
      <div class="node"><div class="label">This device</div><div class="title">Saved results</div><div class="detail">Counts per language, files, and size. No source code.</div></div>
      <div class="none">No Culverin server, analytics, or remote code.</div>
    </div>`,
  ],
  [
    "screenshot-5-settings",
    1280,
    800,
    `<div class="text" style="left:80px;top:230px;width:330px">
      <p class="kicker">Settings</p>
      <h1>Make it yours</h1>
      <p class="lead">Light or dark themes, six accent colors, number formats, ignore rules, and a download limit for very large repositories.</p>
      <div class="swatches"><span style="background:#9fc5ef"></span><span style="background:#e7a77b"></span><span style="background:#d1a4f0"></span><span style="background:#eba3c6"></span><span style="background:#7fcdc8"></span><span style="background:#b3bccb"></span></div>
    </div>
    ${shot(appearance, 792, { left: 448, top: 98, height: 605, cropTop: 120, cropLeft: 270, scale: 1100 / 792, fade: true })}`,
  ],
  [
    "promo-small-440x280",
    440,
    280,
    `<div class="text" style="left:0;top:0;width:440px;height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px">
      <div class="brand" style="font-size:50px">${mark(46)}Culverin</div>
      <div style="font-size:17px;color:#c9d4e0;text-align:center;line-height:1.4">Lines of code for GitHub,<br><span style="color:#a9cdf5;font-weight:700">counted in your browser</span></div>
    </div>`,
  ],
  [
    "promo-marquee-1400x560",
    1400,
    560,
    `<div class="text" style="left:90px;top:150px;width:620px">
      <div class="brand" style="font-size:72px">${mark(64)}Culverin</div>
      <p class="tagline" style="margin-top:30px">Code stats for GitHub repositories, counted <em>locally in your browser</em>.</p>
      <div class="chips"><span class="chip">Lines per language</span><span class="chip">Files</span><span class="chip">Size</span></div>
    </div>
    ${shot(popupDark, 360, { left: 980, top: 50, height: 600 })}
    ${shot(aboutDark, 304, { left: 700, top: 300, height: 236, cropTop: 248, ticks: [10, 92, 156, 96] })}`,
  ],
];

mkdirSync(output, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [name, width, height, body] of images) {
    const tab = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 1,
    });
    await tab.setContent(page(width, height, body));
    await tab.evaluate(() => document.fonts.ready);
    await tab.screenshot({
      path: resolve(output, `${name}.png`),
      omitBackground: false,
    });
    await tab.close();
  }
} finally {
  await browser.close();
}
console.log(`Store images written to ${output}`);
