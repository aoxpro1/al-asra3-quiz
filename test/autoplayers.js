"use strict";

/**
 * Development helper: joins N simulated players to a game and answers each
 * question automatically (player 2 deliberately answers wrong). Useful for
 * poking at the admin/display UI without opening several phones.
 *
 * Usage: node test/autoplayers.js <gameCode> <name1> <name2> [...]
 */

const fs = require("fs");
const path = require("path");
const { io } = require("socket.io-client");

const code = String(process.argv[2] || "").trim();
const names = process.argv.slice(3).filter(Boolean);
const DB_PATH = path.join(__dirname, "..", "data", "db.json");
const BASE = process.env.BASE_URL || "http://localhost:3000";

if (!/^\d{6}$/.test(code) || names.length === 0) {
  console.error("Usage: node test/autoplayers.js <6-digit-code> <name1> [name2 ...]");
  process.exit(1);
}

const scheduled = new Set();

function questionAt(index) {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
    const game = db.games.find((item) => item.code === code);
    return game?.questions?.[index] || null;
  } catch (error) {
    return null;
  }
}

names.forEach((name, index) => {
  const socket = io(BASE, {
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionDelay: 800,
  });

  socket.on("connect", () => {
    socket.timeout(8000).emit("player:join", { code, name }, (error, response) => {
      if (error) return console.log(`[${name}] join timeout`, error.message);
      if (!response?.ok) return console.log(`[${name}] join failed:`, response?.error);
      console.log(`[${name}] joined as ${response.playerId}`);
    });
  });

  socket.on("player:state", (state) => {
    if (!state || state.mode !== "question" || state.yourAnswer) return;
    const key = `${index}:${state.currentIndex}`;
    if (scheduled.has(key)) return;
    scheduled.add(key);

    const question = questionAt(state.currentIndex);
    const correct = question ? question.correctIndex : 0;
    const choice = index === 1 ? (correct + 2) % 4 : correct;
    const delay = index === 0 ? 950 : 1500 + index * 520;

    setTimeout(() => {
      socket.timeout(8000).emit("player:answer", { optionIndex: choice }, (error, response) => {
        if (error) return console.log(`[${name}] answer timeout`, error.message);
        console.log(
          `[${name}] q${state.currentIndex + 1} answered ${choice} (correct ${correct})`,
          response,
        );
      });
    }, delay);
  });

  socket.on("player:closed", (payload) => {
    console.log(`[${name}] closed:`, payload?.reason, payload?.message);
  });

  socket.on("connect_error", (error) => {
    console.log(`[${name}] connect_error:`, error.message);
  });
});

process.on("SIGINT", () => process.exit(0));
