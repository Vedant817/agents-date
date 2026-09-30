/**
 * Records a browser walkthrough of the demo using the Chrome DevTools Protocol.
 *
 * Why not OBS: this produces a deterministic, repeatable capture of exactly
 * the frames the submission needs -- profile pages first, then a real agent
 * date, then the rankings -- at a known frame rate so the cut is under the
 * 3-minute limit.
 *
 * Usage: node scripts/record-demo.mjs <baseUrl> <outFile> [--chrome <path>]
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";

const BASE = process.argv[2] ?? "http://localhost:3113";
const OUT = process.argv[3] ?? "artifacts/demo.mp4";
const FPS = 30;

/** Shots are pairs of [waitMs, javascript-to-run-before-capture]. */
const SHOTS = [];

function shot(waitMs, script, note) {
  SHOTS.push({ waitMs, script, note });
}

async function main() {
  const outDir = path.dirname(OUT);
  await mkdir(outDir, { recursive: true });

  const userDir = path.join(os.tmpdir(), "agents-date-record");
  await rm(userDir, { recursive: true, force: true });
  await mkdir(userDir, { recursive: true });

  const chrome = findChrome();
  if (!chrome) throw new Error("Chrome or Edge not found");

  const port = 9222;
  const chromeProc = spawn(chrome, [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    "--window-size=1600,900",
    "--hide-scrollbars",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--force-device-scale-factor=1",
    "about:blank",
  ], { stdio: "ignore" });

  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      target = list.find((t) => t.type === "page");
    } catch { /* not up yet */ }
  }
  if (!target) throw new Error("Could not reach Chrome DevTools");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1600, height: 900, deviceScaleFactor: 1, mobile: false,
  });

  // --- build the storyboard -------------------------------------------------
  const wait = (ms) => shot(ms, null, `hold ${ms}ms`);
  const go = (url) => shot(0, `location.href=${JSON.stringify(url)}`, `goto ${url}`);
  const clickText = (label) =>
    shot(0, `(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim().startsWith(${JSON.stringify(label)}));if(b)b.click();return !!b})()`, `click ${label}`);
  const clickNav = (name) =>
    shot(0, `(()=>{const a=[...document.querySelectorAll('.list-nav a')].find(x=>x.innerText.includes(${JSON.stringify(name)}));if(a)a.click();return !!a})()`, `nav ${name}`);
  const openAll = (n = 8) =>
    shot(0, `(()=>{let i=0;const t=setInterval(()=>{const d=document.querySelectorAll('details.disclose');if(d[i])d[i].open=true;i++;if(i>=${n}||i>=d.length)clearInterval(t)},40);return d.length})()`, "expand why");

  // 1. Premise + cohort
  go(`${BASE}/demo`);
  wait(2600);
  shot(0, `window.scrollTo(0,0)`, "top");
  wait(1600);

  // 2. The cohort list
  clickNav("Amara Okonkwo");
  wait(1400);
  openAll(4);
  wait(1200);
  shot(0, `document.querySelector('#person-detail').scrollIntoView({block:'start'})`, "profile top");
  wait(1800);
  shot(0, `document.querySelector('#person-detail').scrollIntoView({block:'end'})`, "profile bottom");
  wait(1800);

  // 3. A second profile
  clickNav("Nina Okafor");
  wait(1500);
  shot(0, `document.querySelector('#person-detail').scrollIntoView({block:'start'})`, "profile 2");
  wait(1800);

  // 4. The agents dating
  clickText("Dates");
  wait(1800);
  shot(0, `document.querySelectorAll('.turn')[0].scrollIntoView({block:'center'})`, "date start");
  wait(2600);
  shot(0, `document.querySelectorAll('.turn')[3].scrollIntoView({block:'center'})`, "date middle");
  wait(2600);
  shot(0, `document.querySelectorAll('.turn')[7].scrollIntoView({block:'center'})`, "date tension");
  wait(2600);
  shot(0, `document.querySelectorAll('.turn')[10].scrollIntoView({block:'center'})`, "date reflections");
  wait(2600);
  openAll(3);
  wait(1600);

  // 5. A different date
  shot(0, `window.scrollTo(0,0)`, "dates top");
  wait(1400);
  shot(0, `(()=>{const t=document.querySelectorAll('.turn');if(t[14])t[14].scrollIntoView({block:'center'})})()`, "date 2");
  wait(2600);

  // 6. Rankings, two different people
  clickText("Rankings");
  wait(1800);
  openAll(2);
  wait(1800);
  clickNav("Amara Okonkwo");
  wait(1600);
  shot(0, `document.querySelector('.person-card')?.scrollIntoView({block:'center'})`, "rank 1");
  wait(2400);
  clickNav("Tobias Lindqvist");
  wait(1800);
  shot(0, `document.querySelector('.person-card')?.scrollIntoView({block:'center'})`, "rank 2 directed");
  wait(2400);

  // 7. Live input path
  go(`${BASE}/`);
  wait(2400);
  shot(0, `window.scrollTo(0,document.body.scrollHeight*0.18)`, "start page");
  wait(2000);

  // 8. Method / limits
  go(`${BASE}/method`);
  wait(2000);
  shot(0, `window.scrollTo(0,document.body.scrollHeight*0.34)`, "limits");
  wait(2400);

  console.log(`storyboard: ${SHOTS.length} frames`);

  // --- record ---------------------------------------------------------------
  const framesDir = path.join(outDir, "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const cdpFrames = [];
  cdpFrames.push(await grab()); // first paint
  let frameNo = 0;

  for (const s of SHOTS) {
    if (s.script) {
      await send("Runtime.evaluate", { expression: s.script, awaitPromise: true }).catch(() => {});
    }
    if (s.waitMs > 0) {
      const endAt = Date.now() + s.waitMs;
      while (Date.now() < endAt) {
        const data = await grab();
        if (data) cdpFrames.push(data);
        await sleep(1000 / FPS);
      }
    }
  }

  const last = await grab();
  if (last) cdpFrames.push(last);

  // CDP emits raw JPEG frames; keep every Nth to bound encode time.
  const keepEvery = 2;
  const kept = cdpFrames.filter((_, i) => i % keepEvery === 0);
  console.log(`captured ${cdpFrames.length} frames, keeping ${kept.length}`);

  for (let i = 0; i < kept.length; i++) {
    const f = path.join(framesDir, `f${String(i).padStart(5, "0")}.jpg`);
    await writeFile(f, kept[i]);
  }

  ws.close();
  chromeProc.kill();
  console.log(`frames written to ${framesDir}`);

  async function grab() {
    try {
      const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 80, captureBeyondViewport: false });
      return data ? Buffer.from(data, "base64") : null;
    } catch {
      return null;
    }
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return candidates.find((c) => existsSync(c));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
