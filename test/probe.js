"use strict";

const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = "http://localhost:3000";
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

  const display = await context.newPage();
  await display.goto(`${BASE}/display`, { waitUntil: "networkidle2" });
  await sleep(1200);

  await admin.bringToFront();
  const reveal = await admin.$("#btn-reveal");
  if (reveal && (await reveal.isVisible())) {
    await reveal.click();
    await sleep(1200);
  }
  const leader = await admin.$("#btn-leaderboard");
  console.log("leaderboard visible:", leader ? await leader.isVisible() : "missing");
  if (leader && (await leader.isVisible())) {
    await leader.click();
    await sleep(3000);
  }

  await display.bringToFront();
  await sleep(2500);
  const probe = await display.evaluate(() => {
    const center = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const stack = document.elementsFromPoint(window.innerWidth / 2, window.innerHeight / 2).map((el) => ({
      tag: el.tagName,
      id: el.id,
      cls: el.className?.baseVal ?? el.className,
      opacity: getComputedStyle(el).opacity,
      filter: getComputedStyle(el).filter,
      background: getComputedStyle(el).backgroundColor,
    }));
    const info = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const style = getComputedStyle(el);
      return {
        hidden: el.hidden,
        opacity: style.opacity,
        filter: style.filter,
        color: style.color,
        animation: style.animation,
        visibility: style.visibility,
      };
    };
    return {
      body: info("body"),
      shell: info(".screen-shell"),
      top: info(".screen-top"),
      phase: info(".screen-phase"),
      view: info("#view-leaderboard"),
      title: info("#view-leaderboard .screen-title"),
      center: center ? `${center.tagName}#${center.id}.${center.className}` : null,
      stack,
    };
  });
  console.log(JSON.stringify(probe, null, 2));
  await display.screenshot({ path: path.join(__dirname, "..", "_qa", "probe-leaderboard.png") });
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
