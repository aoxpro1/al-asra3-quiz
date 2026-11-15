"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { newId, recoverGame } = require("./game");
const { QUESTIONS } = require("./seed");

const MAX_HISTORY = 100;

function withIds(question) {
  const now = Date.now();
  return {
    id: newId("q"),
    text: question.text,
    options: [...question.options],
    correctIndex: question.correctIndex,
    timer: question.timer,
    category: question.category,
    explanation: question.explanation || "",
    createdAt: now,
    updatedAt: now,
  };
}

function freshDatabase() {
  return {
    version: 1,
    seeded: true,
    questions: QUESTIONS.map(withIds),
    games: [],
    activeGameId: null,
    meta: {
      createdAt: Date.now(),
      savedAt: Date.now(),
    },
  };
}

class Store {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, "db.json");
    this.db = null;
    this.timer = null;
    this.writing = false;
    this.pending = false;
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.db = freshDatabase();
      this.saveNow();
      return this.db;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid database");
      this.db = {
        version: 1,
        seeded: true,
        questions: Array.isArray(parsed.questions) ? parsed.questions : [],
        games: Array.isArray(parsed.games) ? parsed.games : [],
        activeGameId: parsed.activeGameId || null,
        meta: parsed.meta || {},
      };
    } catch (error) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(this.file, backup);
      } catch (_) {
        /* ignore */
      }
      console.error(`[store] تعذر قراءة قاعدة البيانات، تم إنشاء نسخة جديدة. النسخة القديمة: ${backup}`);
      this.db = freshDatabase();
      this.saveNow();
      return this.db;
    }

    const savedAt = Number(this.db.meta.savedAt) || Date.now();
    for (const game of this.db.games) {
      recoverGame(game, savedAt);
    }
    if (this.db.activeGameId && !this.getGame(this.db.activeGameId)) {
      this.db.activeGameId = null;
    }
    this.pruneHistory();
    this.saveNow();
    return this.db;
  }

  getGame(id) {
    return this.db.games.find((g) => g.id === id) || null;
  }

  getActiveGame() {
    if (!this.db.activeGameId) return null;
    return this.getGame(this.db.activeGameId);
  }

  setActiveGame(game) {
    this.db.activeGameId = game ? game.id : null;
    if (game && !this.getGame(game.id)) this.db.games.push(game);
  }

  removeGame(id) {
    const index = this.db.games.findIndex((g) => g.id === id);
    if (index >= 0) this.db.games.splice(index, 1);
    if (this.db.activeGameId === id) this.db.activeGameId = null;
  }

  history() {
    return this.db.games
      .filter((g) => g.status === "finished")
      .slice()
      .sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  }

  pruneHistory() {
    const finished = this.history();
    if (finished.length <= MAX_HISTORY) return;
    const keep = new Set(finished.slice(0, MAX_HISTORY).map((g) => g.id));
    this.db.games = this.db.games.filter(
      (g) => g.status !== "finished" || keep.has(g.id) || g.id === this.db.activeGameId,
    );
  }

  save() {
    if (!this.db) return;
    this.pending = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 180);
  }

  saveNow() {
    if (!this.db) return;
    if (this.writing) {
      this.pending = true;
      return;
    }
    this.writing = true;
    this.pending = false;
    try {
      this.db.meta.savedAt = Date.now();
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.db), "utf8");
      try {
        fs.renameSync(tmp, this.file);
      } catch (error) {
        // Windows may refuse replacing an existing file in rare cases.
        if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
        fs.renameSync(tmp, this.file);
      }
    } catch (error) {
      console.error("[store] تعذر حفظ قاعدة البيانات:", error.message);
    } finally {
      this.writing = false;
      if (this.pending) {
        this.pending = false;
        this.save();
      }
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.saveNow();
  }
}

function readOrCreateSecret(dataDir) {
  const envSecret = String(process.env.SESSION_SECRET || "").trim();
  if (envSecret) return envSecret;
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, ".session-secret");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch (_) {
    /* create below */
  }
  const secret = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(file, secret, { encoding: "utf8", mode: 0o600 });
  return secret;
}

module.exports = { Store, readOrCreateSecret };
