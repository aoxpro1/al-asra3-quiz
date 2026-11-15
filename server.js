"use strict";

const path = require("path");
const http = require("http");
const express = require("express");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const { Store, readOrCreateSecret } = require("./lib/store");
const { createAuth } = require("./lib/auth");
const gameLib = require("./lib/game");
const { projectAdminState, projectDisplayState, projectPlayerState } = require("./lib/state");
const {
  validateQuestion,
  validateGameConfig,
  cleanText,
  safeNextPath,
  RateLimiter,
} = require("./lib/validate");

const ROOT = __dirname;
const VIEWS = path.join(ROOT, "views");
const PUBLIC = path.join(ROOT, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const PORT = Number.parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "admin").trim() || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "9828";
const SESSION_HOURS = Math.max(1, Math.min(168, Number(process.env.SESSION_HOURS) || 24));

const store = new Store({ dataDir: DATA_DIR });
store.load();

const auth = createAuth({
  secret: readOrCreateSecret(DATA_DIR),
  username: ADMIN_USERNAME,
  password: ADMIN_PASSWORD,
  ttlMs: SESSION_HOURS * 60 * 60 * 1000,
});

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);

const loginLimiter = new RateLimiter();
const joinLimiter = new RateLimiter();

function secureRequest(req) {
  return (
    req.secure ||
    String(req.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim() === "https"
  );
}

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "media-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (secureRequest(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use(express.json({ limit: "256kb" }));

app.use("/api", (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(
  "/css",
  express.static(path.join(PUBLIC, "css"), { index: false, maxAge: 0, etag: true }),
);
app.use(
  "/js",
  express.static(path.join(PUBLIC, "js"), { index: false, maxAge: 0, etag: true }),
);
app.use(
  "/assets",
  express.static(path.join(PUBLIC, "assets"), { index: false, maxAge: "7d", etag: true }),
);
app.use(
  "/fonts",
  express.static(path.join(PUBLIC, "fonts"), {
    index: false,
    maxAge: "365d",
    immutable: true,
    etag: true,
  }),
);

const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 64 * 1024,
  pingInterval: 20000,
  pingTimeout: 25000,
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    if (!origin) return callback(null, true);
    try {
      return callback(null, new URL(origin).host === req.headers.host);
    } catch (_) {
      return callback(null, false);
    }
  },
});

const connectedPlayers = new Map();

function isOnline(playerId) {
  return connectedPlayers.has(playerId);
}

function activeGame() {
  return store.getActiveGame();
}

function broadcastAdminState() {
  const game = activeGame();
  io.to("admins").emit("admin:state", projectAdminState(game, isOnline));
}

function broadcastDisplayState() {
  const game = activeGame();
  io.to("displays").emit("display:state", projectDisplayState(game, isOnline));
}

function broadcastPlayerStates() {
  const game = activeGame();
  if (!game) return;
  for (const player of game.players) {
    const socketId = connectedPlayers.get(player.id);
    if (!socketId) continue;
    const socket = io.sockets.sockets.get(socketId);
    if (!socket) continue;
    socket.emit("player:state", projectPlayerState(game, player.id, isOnline));
  }
}

function broadcastAll({ players = true } = {}) {
  broadcastAdminState();
  broadcastDisplayState();
  if (players) broadcastPlayerStates();
}

function ensureGameRooms(game) {
  if (!game) return;
  io.in("admins").socketsJoin(`game:${game.id}`);
  io.in("displays").socketsJoin(`game:${game.id}`);
}

function clearSocketPlayer(socket) {
  if (socket.data.playerId && connectedPlayers.get(socket.data.playerId) === socket.id) {
    connectedPlayers.delete(socket.data.playerId);
  }
  socket.data.role = null;
  socket.data.playerId = null;
  socket.data.gameId = null;
}

function closeGamePlayers(game, message, reason = "ended") {
  if (!game) return;
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.role === "player" && socket.data.gameId === game.id) {
      socket.emit("player:closed", { message, reason });
      socket.leave(`game:${game.id}`);
      clearSocketPlayer(socket);
    }
  }
  for (const player of game.players || []) {
    if (connectedPlayers.get(player.id)) connectedPlayers.delete(player.id);
  }
}

function notifyOtherPlayersOfNewGame(game) {
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.role === "player" && socket.data.gameId !== game.id) {
      socket.emit("player:closed", {
        message: "بدأت جولة جديدة. أدخل رمز اللعبة الجديد من شاشة العرض.",
        reason: "new_game",
      });
      if (socket.data.gameId) socket.leave(`game:${socket.data.gameId}`);
      clearSocketPlayer(socket);
    }
  }
}

function resolvePublicBase(req) {
  const configured = String(process.env.PUBLIC_URL || "").trim();
  if (configured) {
    let base = configured.replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = `https://${base}`;
    return { base, source: "PUBLIC_URL" };
  }
  const replit = String(process.env.REPLIT_DOMAINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (replit[0]) {
    const domain = replit[0].replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    return { base: `https://${domain}`, source: "REPLIT_DOMAINS" };
  }
  const dev = String(process.env.REPLIT_DEV_DOMAIN || "").trim();
  if (dev) {
    const domain = dev.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    return { base: `https://${domain}`, source: "REPLIT_DEV_DOMAIN" };
  }
  return { base: `${req.protocol}://${req.get("host")}`, source: "request" };
}

function isLocalBase(base) {
  try {
    const host = new URL(base).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
  } catch (_) {
    return false;
  }
}

function sendPage(res, file) {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(VIEWS, file));
}

function requirePageAuth(req, res, next) {
  if (auth.isAuthenticated(req)) return next();
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function sameOrigin(req) {
  const origin = req.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === req.get("host");
  } catch (_) {
    return false;
  }
}

function requireAdminApi(req, res, next) {
  if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: "طلب غير مسموح." });
  if (!auth.isAuthenticated(req)) {
    return res.status(401).json({ ok: false, error: "يلزم تسجيل الدخول." });
  }
  if (!["GET", "HEAD"].includes(req.method) && req.get("x-asra-admin") !== "1") {
    return res.status(403).json({ ok: false, error: "طلب غير مسموح." });
  }
  return next();
}

function summaryFor(game) {
  const table = gameLib.standings(game);
  const winner = game.winnerId
    ? table.find((row) => row.playerId === game.winnerId) || table[0]
    : table[0];
  return {
    id: game.id,
    code: game.code,
    title: game.title,
    maxPlayers: game.maxPlayers,
    totalQuestions: game.questions.length,
    playerCount: game.players.length,
    createdAt: game.createdAt,
    finishedAt: game.finishedAt,
    winner: winner
      ? { name: winner.name, total: winner.total, correctCount: winner.correctCount }
      : null,
    leaderboard: table.map((row) => ({
      rank: row.rank,
      name: row.name,
      total: row.total,
      correctCount: row.correctCount,
      totalTime: row.totalTime,
    })),
  };
}

// ---------------------------------------------------------------- pages

app.get(["/", "/index.html"], (req, res) => sendPage(res, "index.html"));
app.get(["/play", "/play/"], (req, res) => sendPage(res, "play.html"));
app.get("/login", (req, res) => {
  if (auth.isAuthenticated(req)) {
    return res.redirect(safeNextPath(req.query.next));
  }
  return sendPage(res, "login.html");
});
app.get(["/admin", "/admin/"], requirePageAuth, (req, res) => sendPage(res, "admin.html"));
app.get(["/display", "/display/"], requirePageAuth, (req, res) => sendPage(res, "display.html"));
app.get("/healthz", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.type("text/plain").send("ok");
});

// ---------------------------------------------------------------- auth api

app.get("/api/session", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, authenticated: auth.isAuthenticated(req) });
});

app.post("/api/login", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const ip = req.ip || "unknown";
  const limit = loginLimiter.hit(`login:${ip}`, 12, 10 * 60 * 1000);
  if (!limit.allowed) {
    return res.status(429).json({
      ok: false,
      error: "محاولات دخول كثيرة. حاول بعد قليل.",
      retryAfterMs: limit.retryAfterMs,
    });
  }
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!auth.checkCredentials(username, password)) {
    return setTimeout(
      () => res.status(401).json({ ok: false, error: "اسم المستخدم أو كلمة المرور غير صحيحة." }),
      160,
    );
  }
  loginLimiter.reset(`login:${ip}`);
  auth.setCookie(res, req, auth.issue());
  return res.json({ ok: true, redirect: safeNextPath(req.body?.next) });
});

app.post("/api/logout", (req, res) => {
  auth.clearCookie(res, req);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin api

app.get("/api/admin/bootstrap", requireAdminApi, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const game = activeGame();
  res.json({
    ok: true,
    serverNow: Date.now(),
    questions: store.db.questions,
    activeGame: projectAdminState(game, isOnline),
    history: store.history().map(summaryFor),
    config: {
      playerCounts: gameLib.ALLOWED_PLAYER_COUNTS,
      timers: gameLib.ALLOWED_TIMERS,
      scoreTable: gameLib.SCORE_TABLE,
      title: gameLib.DEFAULT_TITLE,
      sessionHours: SESSION_HOURS,
    },
  });
});

app.get("/api/admin/active", requireAdminApi, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, state: projectAdminState(activeGame(), isOnline) });
});

app.get("/api/admin/questions", requireAdminApi, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, questions: store.db.questions });
});

app.post("/api/admin/questions", requireAdminApi, (req, res) => {
  const valid = validateQuestion(req.body);
  if (!valid.ok) return res.status(400).json(valid);
  const now = Date.now();
  const question = {
    id: gameLib.newId("q"),
    ...valid.value,
    createdAt: now,
    updatedAt: now,
  };
  store.db.questions.push(question);
  store.save();
  return res.status(201).json({ ok: true, question });
});

app.put("/api/admin/questions/:id", requireAdminApi, (req, res) => {
  const question = store.db.questions.find((item) => item.id === req.params.id);
  if (!question) return res.status(404).json({ ok: false, error: "السؤال غير موجود." });
  const valid = validateQuestion(req.body);
  if (!valid.ok) return res.status(400).json(valid);
  Object.assign(question, valid.value, { updatedAt: Date.now() });
  store.save();
  return res.json({ ok: true, question });
});

app.delete("/api/admin/questions/:id", requireAdminApi, (req, res) => {
  const index = store.db.questions.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: "السؤال غير موجود." });
  store.db.questions.splice(index, 1);
  store.save();
  return res.json({ ok: true });
});

app.post("/api/admin/questions/:id/duplicate", requireAdminApi, (req, res) => {
  const index = store.db.questions.findIndex((item) => item.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: "السؤال غير موجود." });
  const source = store.db.questions[index];
  const now = Date.now();
  const copy = {
    ...source,
    id: gameLib.newId("q"),
    text: cleanText(`${source.text} (نسخة)`, 300, { multiline: true }),
    options: [...source.options],
    createdAt: now,
    updatedAt: now,
  };
  store.db.questions.splice(index + 1, 0, copy);
  store.save();
  return res.status(201).json({ ok: true, question: copy });
});

app.post("/api/admin/questions/reorder", requireAdminApi, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ ok: false, error: "ترتيب غير صالح." });
  const current = store.db.questions;
  if (ids.length !== current.length || new Set(ids).size !== current.length) {
    return res.status(400).json({ ok: false, error: "ترتيب غير صالح." });
  }
  const byId = new Map(current.map((question) => [question.id, question]));
  if (ids.some((id) => !byId.has(id))) {
    return res.status(400).json({ ok: false, error: "ترتيب غير صالح." });
  }
  store.db.questions = ids.map((id) => byId.get(id));
  store.save();
  return res.json({ ok: true, questions: store.db.questions });
});

app.post("/api/admin/games", requireAdminApi, (req, res) => {
  const existing = activeGame();
  if (existing && existing.status !== "finished") {
    return res.status(409).json({
      ok: false,
      error:
        existing.status === "lobby"
          ? "توجد غرفة انتظار مفتوحة. ألغِها أو ابدأ الجولة الحالية."
          : "توجد جولة جارية. أنهِها قبل إنشاء جولة جديدة.",
    });
  }
  const valid = validateGameConfig(req.body, store.db.questions);
  if (!valid.ok) return res.status(400).json(valid);
  const code = gameLib.generateGameCode((candidate) =>
    store.db.games.some((game) => game.code === candidate),
  );
  const game = gameLib.createGame({ code, ...valid.value });
  store.setActiveGame(game);
  ensureGameRooms(game);
  notifyOtherPlayersOfNewGame(game);
  store.save();
  broadcastAll({ players: false });
  return res.status(201).json({
    ok: true,
    gameId: game.id,
    code: game.code,
    state: projectAdminState(game, isOnline),
  });
});

app.post("/api/admin/games/:id/cancel", requireAdminApi, (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game) return res.status(404).json({ ok: false, error: "الجولة غير موجودة." });
  if (game.status !== "lobby") {
    return res.status(400).json({ ok: false, error: "لا يمكن إلغاء جولة بدأت بالفعل." });
  }
  closeGamePlayers(game, "أُلغيت الجولة من قِبل المشرف.", "cancelled");
  store.removeGame(game.id);
  store.save();
  broadcastAll();
  return res.json({ ok: true });
});

app.get("/api/admin/join-info", requireAdminApi, (req, res) => {
  const game = activeGame();
  if (!game) return res.status(404).json({ ok: false, error: "لا توجد جولة نشطة." });
  const resolved = resolvePublicBase(req);
  const url = `${resolved.base}/play?code=${game.code}`;
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    ok: true,
    code: game.code,
    url,
    source: resolved.source,
    local: isLocalBase(resolved.base),
    status: game.status,
  });
});

app.get("/api/admin/qr.svg", requireAdminApi, async (req, res) => {
  const game = activeGame();
  if (!game) return res.status(404).type("text/plain").send("No active game");
  if (game.status !== "lobby") return res.status(409).type("text/plain").send("Game started");
  const resolved = resolvePublicBase(req);
  const url = `${resolved.base}/play?code=${game.code}`;
  try {
    const svg = await QRCode.toString(url, {
      type: "svg",
      errorCorrectionLevel: "Q",
      margin: 2,
      width: 680,
      color: { dark: "#071a2f", light: "#ffffff" },
    });
    res.setHeader("Cache-Control", "no-store");
    res.type("image/svg+xml").send(svg);
  } catch (error) {
    console.error("[qr] تعذر توليد رمز QR:", error.message);
    res.status(500).type("text/plain").send("QR error");
  }
});

app.get("/api/admin/history", requireAdminApi, (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, history: store.history().map(summaryFor) });
});

app.delete("/api/admin/history/:id", requireAdminApi, (req, res) => {
  const game = store.getGame(req.params.id);
  if (!game || game.status !== "finished") {
    return res.status(404).json({ ok: false, error: "الجولة غير موجودة." });
  }
  if (store.db.activeGameId === game.id) {
    closeGamePlayers(game, "انتهت الجولة وتم حذف سجلها.", "ended");
    store.db.activeGameId = null;
  }
  store.removeGame(game.id);
  store.save();
  broadcastAll();
  return res.json({ ok: true });
});

// ---------------------------------------------------------------- sockets

function socketSession(socket) {
  return auth.read({ headers: socket.handshake.headers });
}

function adminSocket(socket, ack, action) {
  const done = typeof ack === "function" ? ack : () => {};
  if (socket.data.role !== "admin") {
    return done({ ok: false, error: "unauthorized" });
  }
  if (!(Number(socket.data.sessionExp) > Date.now())) {
    return done({ ok: false, error: "expired" });
  }
  const game = activeGame();
  if (!game) return done({ ok: false, error: "لا توجد جولة نشطة." });
  let result;
  try {
    result = action(game);
  } catch (error) {
    console.error("[game] خطأ في إجراء المشرف:", error);
    return done({ ok: false, error: "حدث خطأ غير متوقع." });
  }
  if (result && result.ok === false) return done(result);
  store.save();
  broadcastAll();
  return done({ ok: true, finished: Boolean(result && result.finished) });
}

io.on("connection", (socket) => {
  socket.data.role = null;
  socket.data.playerId = null;
  socket.data.gameId = null;
  socket.data.sessionExp = 0;

  socket.on("admin:hello", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role === "player") return done({ ok: false, error: "unauthorized" });
    const session = socketSession(socket);
    if (!session) return done({ ok: false, error: "unauthorized" });
    socket.data.role = "admin";
    socket.data.sessionExp = Number(session.exp) || 0;
    socket.join("admins");
    const game = activeGame();
    if (game) socket.join(`game:${game.id}`);
    socket.emit("admin:state", projectAdminState(game, isOnline));
    return done({ ok: true });
  });

  socket.on("display:hello", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role === "player") return done({ ok: false, error: "unauthorized" });
    const session = socketSession(socket);
    if (!session) return done({ ok: false, error: "unauthorized" });
    socket.data.role = "display";
    socket.data.sessionExp = Number(session.exp) || 0;
    socket.join("displays");
    const game = activeGame();
    if (game) socket.join(`game:${game.id}`);
    socket.emit("display:state", projectDisplayState(game, isOnline));
    return done({ ok: true });
  });

  socket.on("player:join", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role && socket.data.role !== "player") {
      return done({ ok: false, error: "هذا الاتصال مخصص لصفحة الإدارة." });
    }
    const forwarded = String(socket.handshake.headers["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    const ip = forwarded || socket.handshake.address || "unknown";
    const rate = joinLimiter.hit(`join:${ip}`, 120, 10 * 60 * 1000);
    if (!rate.allowed) {
      return done({ ok: false, error: "محاولات انضمام كثيرة. حاول بعد قليل." });
    }
    const code = String(payload?.code || "").trim();
    if (!/^\d{6}$/.test(code)) {
      return done({ ok: false, error: "رمز اللعبة يجب أن يتكون من ٦ أرقام.", code: "bad_code" });
    }
    const name = gameLib.normalizePlayerName(payload?.name);
    if (name.length < 1) {
      return done({ ok: false, error: "اكتب اسمك للانضمام.", code: "bad_name" });
    }
    const token = typeof payload?.token === "string" ? payload.token.slice(0, 120) : "";
    const game = activeGame();
    if (!game || game.code !== code) {
      return done({
        ok: false,
        error: "رمز اللعبة غير صحيح أو انتهت الجولة. تحقق من شاشة العرض.",
        code: "bad_code",
      });
    }

    let player = token ? game.players.find((item) => item.token === token) : null;
    if (!player) {
      if (game.status === "lobby") {
        if (game.players.length >= game.maxPlayers) {
          return done({
            ok: false,
            error: `اكتمل عدد اللاعبين (${game.maxPlayers}).`,
            code: "full",
          });
        }
        const duplicate = game.players.some(
          (item) => item.name.toLocaleLowerCase("ar") === name.toLocaleLowerCase("ar"),
        );
        if (duplicate) {
          return done({
            ok: false,
            error: "هذا الاسم مستخدم في الجولة. اختر اسمًا آخر.",
            code: "duplicate_name",
          });
        }
        player = {
          id: gameLib.newId("p"),
          name,
          token: gameLib.newToken(),
          joinedAt: Date.now(),
        };
        game.players.push(player);
      } else if (game.status === "playing") {
        return done({
          ok: false,
          error: "بدأت الجولة بالفعل. انتظر الجولة القادمة.",
          code: "game_started",
        });
      } else {
        return done({
          ok: false,
          error: "انتهت هذه الجولة. افتح رمز QR الجديد للجولة القادمة.",
          code: "game_finished",
        });
      }
    }

    const previousSocket = connectedPlayers.get(player.id);
    if (previousSocket && previousSocket !== socket.id) {
      const old = io.sockets.sockets.get(previousSocket);
      if (old) {
        old.emit("player:closed", {
          message: "فُتحت اللعبة في جهاز آخر.",
          reason: "replaced",
        });
        old.disconnect(true);
      }
    }
    connectedPlayers.set(player.id, socket.id);
    socket.data.role = "player";
    socket.data.playerId = player.id;
    socket.data.gameId = game.id;
    socket.join(`game:${game.id}`);
    socket.join(`player:${player.id}`);

    store.save();
    const state = projectPlayerState(game, player.id, isOnline);
    done({ ok: true, playerId: player.id, token: player.token, state });
    broadcastAdminState();
    broadcastDisplayState();
    broadcastPlayerStates();
  });

  socket.on("player:answer", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role !== "player" || !socket.data.playerId) {
      return done({ ok: false, error: "unauthorized" });
    }
    const game = activeGame();
    if (!game || game.id !== socket.data.gameId) {
      return done({ ok: false, error: "انتهت الجولة.", code: "closed" });
    }
    const player = game.players.find((item) => item.id === socket.data.playerId);
    if (!player) return done({ ok: false, error: "لم تعد مشاركًا في الجولة.", code: "closed" });
    const optionIndex = Number(payload?.optionIndex);
    const result = gameLib.submitAnswer(game, player.id, optionIndex);
    if (!result.ok) return done(result);
    store.save();
    broadcastAll();
    return done({ ok: true });
  });

  socket.on("player:sync", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role !== "player" || !socket.data.playerId) {
      return done({ ok: false, error: "unauthorized" });
    }
    const game = activeGame();
    if (!game || game.id !== socket.data.gameId) {
      socket.emit("player:closed", { message: "انتهت الجولة.", reason: "ended" });
      return done({ ok: false, error: "closed" });
    }
    const state = projectPlayerState(game, socket.data.playerId, isOnline);
    socket.emit("player:state", state);
    return done({ ok: true, state });
  });

  socket.on("admin:start", (payload, ack) =>
    adminSocket(socket, ack, (game) => {
      if (game.status !== "lobby") return { ok: false, error: "بدأت الجولة بالفعل." };
      if (game.players.length < 2) {
        return { ok: false, error: "تحتاج إلى لاعبين اثنين على الأقل لبدء الجولة." };
      }
      game.status = "playing";
      game.phase = "ready";
      game.startedAt = Date.now();
      return { ok: true };
    }),
  );

  socket.on("admin:question:start", (payload, ack) =>
    adminSocket(socket, ack, (game) => gameLib.startQuestion(game)),
  );

  socket.on("admin:question:pause", (payload, ack) =>
    adminSocket(socket, ack, (game) => gameLib.pauseQuestion(game)),
  );

  socket.on("admin:question:resume", (payload, ack) =>
    adminSocket(socket, ack, (game) => gameLib.resumeQuestion(game)),
  );

  socket.on("admin:question:reveal", (payload, ack) =>
    adminSocket(socket, ack, (game) => gameLib.revealQuestion(game)),
  );

  socket.on("admin:leaderboard:show", (payload, ack) =>
    adminSocket(socket, ack, (game) => gameLib.showLeaderboard(game)),
  );

  socket.on("admin:question:next", (payload, ack) =>
    adminSocket(socket, ack, (game) => {
      if (game.status !== "playing") return { ok: false, error: "الجولة غير جارية." };
      if (!["revealed", "leaderboard"].includes(game.phase)) {
        return { ok: false, error: "اعرض نتيجة السؤال الحالي أولًا." };
      }
      if (game.currentIndex + 1 >= game.questions.length) {
        const result = gameLib.finishGame(game);
        return result.ok ? { ok: true, finished: true } : result;
      }
      return gameLib.startQuestion(game);
    }),
  );

  socket.on("admin:finish", (payload, ack) =>
    adminSocket(socket, ack, (game) => gameLib.finishGame(game)),
  );

  socket.on("admin:player:remove", (payload, ack) =>
    adminSocket(socket, ack, (game) => {
      if (game.status !== "lobby") {
        return { ok: false, error: "لا يمكن إزالة لاعب بعد بدء الجولة." };
      }
      const playerId = String(payload?.playerId || "");
      const index = game.players.findIndex((player) => player.id === playerId);
      if (index < 0) return { ok: false, error: "اللاعب غير موجود." };
      const [player] = game.players.splice(index, 1);
      game.answers = {};
      const socketId = connectedPlayers.get(player.id);
      if (socketId) {
        const target = io.sockets.sockets.get(socketId);
        if (target) {
          target.emit("player:closed", {
            message: "تمت إزالتك من الجولة من قِبل المشرف.",
            reason: "removed",
          });
          if (target.data.gameId) target.leave(`game:${target.data.gameId}`);
          clearSocketPlayer(target);
        }
        connectedPlayers.delete(player.id);
      }
      return { ok: true };
    }),
  );

  socket.on("admin:sync", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role !== "admin") return done({ ok: false, error: "unauthorized" });
    socket.emit("admin:state", projectAdminState(activeGame(), isOnline));
    return done({ ok: true });
  });

  socket.on("display:sync", (payload, ack) => {
    const done = typeof ack === "function" ? ack : () => {};
    if (socket.data.role !== "display") return done({ ok: false, error: "unauthorized" });
    socket.emit("display:state", projectDisplayState(activeGame(), isOnline));
    return done({ ok: true });
  });

  socket.on("disconnect", () => {
    if (socket.data.role !== "player" || !socket.data.playerId) return;
    if (connectedPlayers.get(socket.data.playerId) === socket.id) {
      connectedPlayers.delete(socket.data.playerId);
      const game = activeGame();
      if (game && game.id === socket.data.gameId) {
        broadcastAdminState();
        broadcastDisplayState();
        broadcastPlayerStates();
      }
    }
  });
});

// ---------------------------------------------------------------- timer

setInterval(() => {
  const game = activeGame();
  if (!game || game.status !== "playing" || game.phase !== "question") return;
  const remaining = gameLib.remainingMs(game);
  if (remaining <= 0 && !game.qTimeUp) {
    game.qTimeUp = true;
    store.save();
    broadcastAll();
    return;
  }
  io.to(`game:${game.id}`).emit("timer:tick", {
    serverNow: Date.now(),
    remainingMs: remaining,
    paused: Boolean(game.qPaused),
    timeUp: Boolean(game.qTimeUp),
    phase: game.phase,
  });
}, 500).unref();

// ---------------------------------------------------------------- errors

app.use("/api", (req, res) => {
  res.status(404).json({ ok: false, error: "المسار غير موجود." });
});

app.use((req, res) => {
  res.status(404);
  res.setHeader("Cache-Control", "no-store");
  res
    .type("html")
    .send(
      '<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير موجود</title><body style="background:#04101f;color:#eaf7ff;font-family:sans-serif;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>الصفحة غير موجودة</h1><p><a href="/" style="color:#49e2ff">العودة إلى الأسرع</a></p></div></body></html>',
    );
});

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error && error.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, error: "صيغة الطلب غير صالحة." });
  }
  console.error("[server] خطأ:", error);
  if (req.path.startsWith("/api/")) {
    return res.status(500).json({ ok: false, error: "حدث خطأ غير متوقع." });
  }
  return res.status(500).type("text/plain").send("Server error");
});

// ---------------------------------------------------------------- lifecycle

function shutdown(signal) {
  console.log(`\n[server] إيقاف (${signal})...`);
  store.flush();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("exit", () => store.flush());
process.on("uncaughtException", (error) => {
  console.error("[server] uncaughtException:", error);
  store.flush();
});
process.on("unhandledRejection", (error) => {
  console.error("[server] unhandledRejection:", error);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  الأسرع | العلوم الحيوية الطبية`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  دخول المشرف: ${ADMIN_USERNAME} / ${ADMIN_PASSWORD}`);
  if (ADMIN_PASSWORD === "9828") {
    console.log("  ملاحظة: غيّر كلمة المرور عبر ADMIN_PASSWORD قبل النشر العام.");
  }
  console.log("");
});
