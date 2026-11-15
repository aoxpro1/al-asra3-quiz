"use strict";

const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--hide-scrollbars"],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });
  const context = await browser.createBrowserContext();
  const admin = await context.newPage();
  await admin.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await admin.type("#username", "admin");
  await admin.type("#password", "9828");
  await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle2" }), admin.click("#login-btn")]);

  const cancelled = await admin.evaluate(async () => {
    const bootstrap = await fetch("/api/admin/bootstrap", { credentials: "same-origin" }).then((r) =>
      r.json(),
    );
    const active = bootstrap.activeGame?.game;
    if (!active) return "none";
    const response = await fetch(`/api/admin/games/${active.id}/cancel`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Asra-Admin": "1" },
    });
    return `${active.code}: ${response.status}`;
  });
  console.log("cancel:", cancelled);

  const display = await context.newPage();
  await display.goto(`${BASE}/display`, { waitUntil: "networkidle2" });
  await display.waitForSelector("#view-welcome:not([hidden])", { timeout: 15000 });
  await sleep(900);

  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1024, 768],
  ]) {
    await display.setViewport({ width, height, deviceScaleFactor: 1 });
    await sleep(350);
    const boxes = await display.evaluate(() => {
      const box = (selector) => {
        const rect = document.querySelector(selector)?.getBoundingClientRect();
        return rect ? { top: Math.round(rect.top), bottom: Math.round(rect.bottom), height: Math.round(rect.height) } : null;
      };
      return {
        logo: box(".welcome-logo"),
        word: box(".screen-word"),
        tagline: box(".screen-tagline"),
        desc: box(".welcome-desc"),
        pills: box(".welcome-pills"),
        wait: box(".welcome-wait"),
        hint: box(".welcome-hint"),
        main: box(".screen-main"),
      };
    });
    console.log(`${width}x${height}`, JSON.stringify(boxes));
    await display.screenshot({
      path: path.join(__dirname, "..", "_qa", `welcome-${width}.png`),
    });
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
