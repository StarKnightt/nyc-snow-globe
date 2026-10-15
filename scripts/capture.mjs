// Headed Chrome capture harness on the second screen (x=1930, y=20) at 1920x1080.
// Captures 6 fixed camera angles + 3 mid-shake frames for the Builder/Critic gauntlet.
// Usage: node scripts/capture.mjs <roundName> [url]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const roundName = process.argv[2] || 'round-01';
const baseUrl = process.argv[3] || 'http://127.0.0.1:5192/?capture=1';
const outDir = path.resolve('shots', roundName);
fs.mkdirSync(outDir, { recursive: true });

const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

// Second screen positioning (DISPLAY2: x >= 1920)
const WX = 1930;
const WY = 20;

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: false,
  args: [
    `--window-position=${WX},${WY}`,
    '--window-size=1040,900',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    '--enable-UnsafeWebGPU',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});

const page = await context.newPage();
const consoleLogs = [];
page.on('console', (m) => {
  if (['error', 'warning'].includes(m.type())) {
    consoleLogs.push(`[${m.type()}] ${m.text()}`);
  }
});
page.on('pageerror', (e) => consoleLogs.push(`[pageerror] ${e.message}`));

await page.goto(baseUrl, { waitUntil: 'load' });
await page.waitForFunction(() => window.__globe && window.__globe.ready, null, { timeout: 60000 });
await page.waitForTimeout(400);

// 1. Capture the 6 fixed camera angles in calm state
const fixedAngles = [
  ['01_hero_front', 'hero_front'],
  ['02_side_east', 'side_east'],
  ['03_park_north', 'park_north'],
  ['04_street_taxi_closeup', 'street_taxi_closeup'],
  ['05_brownstone_stoops', 'brownstone_stoops'],
  ['06_top_overview', 'top_overview'],
];

await page.evaluate(() => window.__globe.setCaptureState('calm'));

for (const [fileStub, presetName] of fixedAngles) {
  await page.evaluate((preset) => {
    window.__globe.setCameraPreset(preset);
    window.__globe.advance(1 / 60, 2);
  }, presetName);
  await page.waitForTimeout(180);
  const filePath = path.join(outDir, `${fileStub}.png`);
  await page.screenshot({ path: filePath });
  console.log('Captured:', filePath);
}

// 2. Capture the 3 mid-shake frames (with full-globe product-shot framing so top apex & base foot are cleanly inside frame)
const shakeFrames = [
  ['07_shake_01_impulse', 'shake_01_impulse', [0.58, 2.50, 6.15], [0.0, 1.72, 0.0], 36],
  ['08_shake_02_blizzard', 'shake_02_blizzard', [0.65, 2.55, 6.20], [0.0, 1.72, 0.0], 36],
  ['09_shake_03_settling', 'shake_03_settling', [0.62, 2.52, 6.10], [0.0, 1.72, 0.0], 36],
];

for (const [fileStub, shakeMode, camPos, camTarget, fov] of shakeFrames) {
  await page.evaluate(
    ([mode, pos, target, f]) => {
      window.__globe.setCamera(pos, target, f);
      window.__globe.setCaptureState(mode);
      window.__globe.advance(1 / 60, 1);
    },
    [shakeMode, camPos, camTarget, fov]
  );
  await page.waitForTimeout(180);
  const filePath = path.join(outDir, `${fileStub}.png`);
  await page.screenshot({ path: filePath });
  console.log('Captured:', filePath);
}

// 3. Measure real-time 1080p frame timing over 90 frames
const perf = await page.evaluate(async () => {
  window.__globe.setCameraPreset('hero_front');
  window.__globe.setCaptureState('shake_02_blizzard');
  const times = [];
  let last = performance.now();
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const now = performance.now();
    window.__globe.advance(1 / 60, 1);
    times.push(now - last);
    last = now;
  }
  times.sort((a, b) => a - b);
  const medianMs = times[Math.floor(times.length / 2)];
  const p95Ms = times[Math.floor(times.length * 0.95)];
  const stats = window.__globe.getStats();
  return {
    medianMs: Number(medianMs.toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
    approxFps: Math.round(1000 / Math.max(1, medianMs)),
    ...stats,
  };
});

console.log('Performance @ 1920x1080:', JSON.stringify(perf));
if (consoleLogs.length > 0) {
  console.log('Console warnings/errors:', consoleLogs.join('\n'));
}
fs.writeFileSync(path.join(outDir, 'perf.json'), JSON.stringify({ perf, consoleLogs }, null, 2));

// 4. Capture 1280x640 og.png mid-shake hero preview
await page.setViewportSize({ width: 1280, height: 640 });
await page.evaluate(() => {
  window.__globe.setCamera([0.62, 2.52, 6.22], [0.0, 1.72, 0.0], 35);
  window.__globe.setCaptureState('shake_02_blizzard');
  window.__globe.advance(1 / 60, 1);
});
await page.waitForTimeout(180);
const ogPath = path.resolve('og.png');
await page.screenshot({ path: ogPath });
fs.mkdirSync(path.resolve('public'), { recursive: true });
fs.copyFileSync(ogPath, path.resolve('public', 'og.png'));
console.log('Captured OG image (1280x640):', ogPath);

// 5. Capture live startup loader preview and post-fadeout live initial boot frame (without ?capture=1) at 1920x1080
await page.setViewportSize({ width: 1920, height: 1080 });
const liveUrl = baseUrl.replace(/\?.*$/, '');

// 5a. Capture the startup loader overlay mid-load (?pauseLoader=1 keeps #loader visible at 68% stage)
await page.goto(`${liveUrl}?pauseLoader=1`, { waitUntil: 'load' });
await page.waitForFunction(() => window.__globe && window.__globe.ready, null, { timeout: 60000 });
await page.evaluate(() => {
  const bar = document.getElementById('loader-bar');
  const status = document.getElementById('loader-status');
  if (bar) bar.style.width = '68%';
  if (status) status.textContent = 'Building miniature Manhattan & lighting windows…';
});
await page.waitForTimeout(300);
const loaderPreviewPath = path.join(outDir, 'loader_preview.png');
await page.screenshot({ path: loaderPreviewPath });
console.log('Captured loader preview:', loaderPreviewPath);

// 5b. Trigger the smooth fade-out transition on #loader and capture the clean live mid-shake globe after 800ms
await page.evaluate(() => {
  const bar = document.getElementById('loader-bar');
  const status = document.getElementById('loader-status');
  const loader = document.getElementById('loader');
  if (bar) bar.style.width = '100%';
  if (status) status.textContent = 'Ready';
  if (loader) {
    loader.classList.add('is-loaded');
    setTimeout(() => loader.remove(), 700);
  }
});
await page.waitForTimeout(820);
const liveBootPath = path.join(outDir, '00_live_initial_boot.png');
await page.screenshot({ path: liveBootPath });
console.log('Captured live initial boot:', liveBootPath);

await browser.close();
