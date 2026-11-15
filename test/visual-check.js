"use strict";

/**
 * Visual QA helper. Logs in, creates a fresh 3-player game, joins three mobile
 * players, drives the first question, and captures the main screens at desktop
 * resolutions. Requires a running server on http://localhost:3000 and Chrome.
 *
 * Usage: node test/visual-check.js
 */

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const BASE = process.env.BASE_URL || "http://localhost:3000";
const OUT = path.join(__dirname, "..", "_qa");
const CHROME =
  process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.type("#username", "admin");
  await page.type("#password", "9828");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2" }),
    page.click("#login-btn"),
  ]);
}

async function createGame(page) {
  return page.evaluate(async () => {
    const getJson = async (url, options = {}) => {
      const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.method && options.method !== "GET" ? { "X-Asra-Admin": "1" } : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data;
    };

    const bootstrap = await getJson("/api/admin/bootstrap");
    const active = bootstrap.activeGame?.game;
    if (active && bootstrap.activeGame.mode !== "setup" && active.status !== "finished") {
      await getJson(`/api/admin/games/${active.id}/cancel`, { method: "POST" });
    }

    const ids = bootstrap.questions.slice(0, 4).map((question) => question.id);
    const created = await getJson("/api/admin/games", {
      method: "POST",
      body: JSON.stringify({
        maxPlayers: 3,
        questionIds: ids,
        shuffleQuestions: false,
        shuffleOptions: false,
      }),
    });
    return { code: created.code, gameId: created.gameId };
  });
}

async function joinPlayer(browser, code, name) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
  await page.goto(`${BASE}/play?code=${code}`, { waitUntil: "networkidle2" });
  await page.waitForSelector("#view-join:not([hidden])", { timeout: 15000 });
  await page.type("#name-input", name);
  await Promise.all([
    page.waitForSelector("#view-lobby:not([hidden])", { timeout: 15000 }),
    page.click("#join-submit"),
  ]);
  return { context, page };
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("screenshot:", file);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--hide-scrollbars"],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
  });

  const errors = [];
  const attachErrors = (page, label) => {
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`[${label}] ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`[${label}] pageerror: ${error.message}`));
  };

  try {
    const context = await browser.createBrowserContext();
    const admin = await context.newPage();
    attachErrors(admin, "admin");
    await login(admin);
    await admin.waitForSelector("#control-setup:not([hidden])", { timeout: 15000 });
    await sleep(700);
    await shot(admin, "admin-setup-1920");
    const { code } = await createGame(admin);
    console.log("game code:", code);

    await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle2" });
    await admin.waitForSelector("#start-game-btn", { timeout: 15000 });
    await sleep(1200);
    await shot(admin, "admin-lobby-1920");

    const display = await context.newPage();
    attachErrors(display, "display");
    await display.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await display.goto(`${BASE}/display`, { waitUntil: "networkidle2" });
    await display.waitForSelector("#view-lobby:not([hidden])", { timeout: 15000 });
    await sleep(1800);
    await shot(display, "display-lobby-1920");

    for (const [width, height, label] of [
      [1440, 900, "display-lobby-1440"],
      [1280, 720, "display-lobby-1280"],
    ]) {
      await display.setViewport({ width, height, deviceScaleFactor: 1 });
      await sleep(450);
      await shot(display, label);
    }
    await display.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

    const players = [];
    players.push(await joinPlayer(browser, code, "ليان"));
    players.push(await joinPlayer(browser, code, "عمر"));
    players.push(await joinPlayer(browser, code, "نورة"));
    await sleep(1200);
    await shot(players[0].page, "player-lobby-390");
    await display.bringToFront();
    await sleep(600);
    await shot(display, "display-lobby-3players-1920");

    await admin.bringToFront();
    await admin.click("#start-game-btn");
    await sleep(500);
    await admin.waitForSelector("#btn-start-question:not([hidden])", { timeout: 10000 });
    await shot(admin, "admin-ready-1920");

    await display.bringToFront();
    await sleep(1400);
    await shot(display, "display-ready-1920");

    for (const [width, height, label] of [
      [1440, 900, "display-ready-1440"],
      [1280, 720, "display-ready-1280"],
    ]) {
      await display.setViewport({ width, height, deviceScaleFactor: 1 });
      await sleep(650);
      await shot(display, label);
    }
    await display.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await sleep(400);

    await admin.bringToFront();
    await admin.click("#btn-start-question");
    await sleep(500);
    await admin.waitForSelector("#btn-reveal:not([hidden])", { timeout: 10000 });

    const question = await admin.evaluate(async () => {
      const response = await fetch("/api/admin/active", { credentials: "same-origin" });
      const data = await response.json();
      return data.state?.game?.question || null;
    });
    console.log("question:", question?.text, "correct:", question?.correctIndex);

    await shot(admin, "admin-question-1920");
    await display.bringToFront();
    await sleep(1200);
    await shot(display, "display-question-1920");

    const displayBefore = await display.evaluate(() => ({
      revealHidden: document.querySelector("#stage-reveal").hidden,
      correctTiles: document.querySelectorAll("#stage-options .is-correct").length,
      sideText: document.querySelector("#stage-side-body").innerText,
    }));
    console.log("display before reveal:", displayBefore);

    await players[0].page.bringToFront();
    await sleep(500);
    await shot(players[0].page, "player-question-390");
    await players[0].page.click(`#answer-grid .answer-tile[data-index="${question.correctIndex}"]`);
    await sleep(250);
    await players[1].page.bringToFront();
    await players[1].page.click(`#answer-grid .answer-tile[data-index="${(question.correctIndex + 1) % 4}"]`);
    await sleep(250);
    await players[2].page.bringToFront();
    await players[2].page.click(`#answer-grid .answer-tile[data-index="${question.correctIndex}"]`);

    await sleep(1400);
    await display.bringToFront();
    await sleep(1800);
    await shot(display, "display-question-answered-1920");

    const displayAnswered = await display.evaluate(() => ({
      revealHidden: document.querySelector("#stage-reveal").hidden,
      correctTiles: document.querySelectorAll("#stage-options .is-correct").length,
      answeredRows: document.querySelectorAll(".side-player.is-answered").length,
      answered: [...document.querySelectorAll(".side-player.is-answered .side-player-name")].map(
        (node) => node.textContent,
      ),
      status: document.querySelector("#stage-status").textContent,
    }));
    console.log("display answered:", displayAnswered);

    await admin.bringToFront();
    await admin.click("#btn-reveal");
    await sleep(800);
    await display.bringToFront();
    await sleep(2000);
    await shot(display, "display-revealed-1920");

    const displayRevealed = await display.evaluate(() => ({
      revealHidden: document.querySelector("#stage-reveal").hidden,
      correctTiles: document.querySelectorAll("#stage-options .is-correct").length,
      correctText: document.querySelector("#reveal-text").textContent,
      results: [...document.querySelectorAll(".side-result")].map((node) => node.innerText),
    }));
    console.log("display revealed:", displayRevealed);

    for (const [width, height, label] of [
      [1440, 900, "display-revealed-1440"],
      [1280, 720, "display-revealed-1280"],
    ]) {
      await display.setViewport({ width, height, deviceScaleFactor: 1 });
      await sleep(700);
      await shot(display, label);
    }
    await display.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await sleep(400);

    await players[0].page.bringToFront();
    await sleep(500);
    await shot(players[0].page, "player-result-390");

    await admin.bringToFront();
    await admin.click("#btn-leaderboard");
    await sleep(2600);
    await display.bringToFront();
    await sleep(1800);
    await shot(display, "display-leaderboard-1920");

    for (const [width, height, label] of [
      [1440, 900, "display-leaderboard-1440"],
      [1280, 720, "display-leaderboard-1280"],
    ]) {
      await display.setViewport({ width, height, deviceScaleFactor: 1 });
      await sleep(700);
      await shot(display, label);
    }
    await display.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
    await sleep(400);

    await admin.bringToFront();
    await admin.click("#btn-finish");
    await admin.waitForSelector(".modal [data-confirm]:not([disabled])", { timeout: 5000 });
    await admin.click(".modal [data-confirm]");
    await sleep(1500);
    await display.bringToFront();
    await sleep(2400);
    await shot(display, "display-podium-1920");

    for (const [width, height, label] of [
      [1440, 900, "display-podium-1440"],
      [1280, 720, "display-podium-1280"],
    ]) {
      await display.setViewport({ width, height, deviceScaleFactor: 1 });
      await sleep(700);
      await shot(display, label);
    }

    await players[0].page.bringToFront();
    await sleep(900);
    await shot(players[0].page, "player-final-390");

    console.log("console errors:", errors.length ? errors : "none");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
