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
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type("#username", "admin");
  await page.type("#password", "9828");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("#login-btn")]);
  const display = await context.newPage();
  await display.goto(`${BASE}/display`, { waitUntil: "networkidle2" });
  await sleep(1600);
  const info = await display.evaluate(() => {
    const canvas = document.querySelector(".confetti-canvas");
    let nonEmpty = 0;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      const data = ctx.getImageData(0, 0, Math.min(canvas.width, 800), Math.min(canvas.height, 600)).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) nonEmpty += 1;
    }
    return {
      reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      canvas: canvas
        ? {
            width: canvas.width,
            height: canvas.height,
            css: getComputedStyle(canvas).cssText,
            zIndex: getComputedStyle(canvas).zIndex,
            opacity: getComputedStyle(canvas).opacity,
          }
        : null,
      nonEmpty,
      view: [...document.querySelectorAll(".screen-view")].find((el) => !el.hidden)?.id,
    };
  });
  console.log(info);
  await sleep(800);
  await display.screenshot({ path: path.join(__dirname, "..", "_qa", "confetti-probe.png") });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
