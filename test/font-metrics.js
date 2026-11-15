"use strict";

const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE_URL || "http://localhost:3100";
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox"],
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
  await display.waitForSelector("#view-welcome:not([hidden])", { timeout: 15000 });
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
  ]) {
    await display.setViewport({ width, height, deviceScaleFactor: 1 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const metrics = await display.evaluate(async () => {
      await document.fonts.ready;
      const el = document.querySelector(".screen-word");
      const style = getComputedStyle(el);
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      ctx.font = `900 ${style.fontSize} "Thmanyah Sans", sans-serif`;
      const m = ctx.measureText("الأسرع");
      const rect = el.getBoundingClientRect();
      return {
        fontSize: style.fontSize,
        lineHeight: style.lineHeight,
        rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
        ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent,
        fontBoundingBoxAscent: m.fontBoundingBoxAscent,
        fontBoundingBoxDescent: m.fontBoundingBoxDescent,
        width: m.width,
      };
    });
    console.log(width, metrics);
  }
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
