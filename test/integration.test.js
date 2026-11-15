"use strict";

/**
 * Integration test suite for "الأسرع" (al-asra3) interactive quiz game.
 * Tests: lib modules (game, validate, auth, store, state) + HTTP endpoints + Socket.IO flows.
 *
 * Run: node test/integration.test.js
 */

const http = require("http");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ---------------------------------------------------------------- helpers

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    const detail = `${message}  — expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)}`;
    failures.push(detail);
    console.error(`  ✗ ${detail}`);
  }
}

function assertIncludes(arr, value, message) {
  assert(Array.isArray(arr) && arr.includes(value), message);
}

function section(name) {
  console.log(`\n── ${name} ──`);
}

// ---------------------------------------------------------------- 1. game.js unit tests

section("lib/game.js");

const gameLib = require("../lib/game");

// newId
{
  const id1 = gameLib.newId("q");
  const id2 = gameLib.newId("q");
  assert(id1.startsWith("q_"), "newId returns prefixed id");
  assert(id1 !== id2, "newId returns unique ids");
}

// newToken
{
  const t1 = gameLib.newToken();
  const t2 = gameLib.newToken();
  assert(typeof t1 === "string" && t1.length > 10, "newToken returns non-trivial string");
  assert(t1 !== t2, "newToken returns unique tokens");
}

// generateGameCode
{
  const code = gameLib.generateGameCode(() => false);
  assert(/^\d{6}$/.test(code), "generateGameCode returns 6-digit code");

  // collision avoidance
  const taken = new Set();
  let lastCode;
  for (let i = 0; i < 5; i++) {
    lastCode = gameLib.generateGameCode((c) => taken.has(c));
    taken.add(lastCode);
  }
  assertEqual(taken.size, 5, "generateGameCode avoids collisions");
}

// shuffle
{
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const shuffled = gameLib.shuffle(items);
  assertEqual(shuffled.length, items.length, "shuffle preserves length");
  assert(shuffled.every((n) => items.includes(n)), "shuffle preserves elements");
  // original unchanged
  assertEqual(items[0], 1, "shuffle does not mutate original");
}

// normalizePlayerName
{
  assertEqual(gameLib.normalizePlayerName("  أحمد  "), "أحمد", "normalizePlayerName trims");
  assertEqual(
    gameLib.normalizePlayerName("اسم   طويل   جداً"),
    "اسم طويل جداً",
    "normalizePlayerName collapses spaces",
  );
  const long = "أ".repeat(30);
  assert(gameLib.normalizePlayerName(long).length <= 18, "normalizePlayerName truncates at 18");
  assertEqual(gameLib.normalizePlayerName(null), "", "normalizePlayerName handles null");
}

// createGame
{
  const questions = [
    {
      id: "q1",
      text: "ما هو الحمض النووي؟",
      options: ["DNA", "RNA", "ATP", "ADP"],
      correctIndex: 0,
      timer: 30,
      category: "وراثة",
      explanation: "DNA هو الحمض النووي",
    },
    {
      id: "q2",
      text: "ما هو البروتين؟",
      options: ["إنزيم", "هرمون", "حمض أميني", "نيوكليوتيد"],
      correctIndex: 2,
      timer: 60,
      category: "كيمياء حيوية",
      explanation: "",
    },
  ];
  const game = gameLib.createGame({
    code: "123456",
    maxPlayers: 4,
    questionDocs: questions,
    shuffleQuestions: false,
    shuffleOptions: false,
  });
  assert(game.id.startsWith("g_"), "createGame returns game with id");
  assertEqual(game.code, "123456", "createGame sets code");
  assertEqual(game.maxPlayers, 4, "createGame sets maxPlayers");
  assertEqual(game.questions.length, 2, "createGame copies questions");
  assertEqual(game.status, "lobby", "createGame starts in lobby");
  assertEqual(game.phase, "lobby", "createGame phase is lobby");
  assertEqual(game.currentIndex, -1, "createGame currentIndex is -1");
  assertEqual(game.players.length, 0, "createGame has no players");
  assert(typeof game.createdAt === "number", "createGame sets createdAt");
  assertEqual(game.questions[0].correctIndex, 0, "options not shuffled when disabled");
}

// createGame with shuffleOptions
{
  const questions = [
    {
      id: "q1",
      text: "سؤال",
      options: ["أ", "ب", "ج", "د"],
      correctIndex: 0,
      timer: 30,
      category: "عام",
    },
  ];
  const game = gameLib.createGame({
    code: "111111",
    maxPlayers: 4,
    questionDocs: questions,
    shuffleOptions: true,
  });
  const q = game.questions[0];
  // correctIndex should point to the option that was originally at index 0 ("أ")
  assertEqual(q.options[q.correctIndex], "أ", "shuffled options correctIndex still maps to correct answer");
}

// Game flow: start → question → answer → reveal → leaderboard → finish
section("Game flow (startQuestion → submitAnswer → revealQuestion → standings → finishGame)");

{
  const questions = [
    {
      id: "q1",
      text: "سؤال 1",
      options: ["أ", "ب", "ج", "د"],
      correctIndex: 1,
      timer: 30,
      category: "عام",
      explanation: "الجواب ب",
    },
    {
      id: "q2",
      text: "سؤال 2",
      options: ["أ", "ب", "ج", "د"],
      correctIndex: 2,
      timer: 30,
      category: "عام",
      explanation: "",
    },
  ];
  const game = gameLib.createGame({
    code: "999999",
    maxPlayers: 4,
    questionDocs: questions,
    shuffleOptions: false,
  });

  // Add players
  game.players.push(
    { id: "p1", name: "أحمد", token: "t1", joinedAt: Date.now() },
    { id: "p2", name: "فاطمة", token: "t2", joinedAt: Date.now() + 1 },
  );

  // Can't start question before game starts
  const earlyStart = gameLib.startQuestion(game);
  assertEqual(earlyStart.ok, false, "can't startQuestion before game is playing");

  // Start game
  game.status = "playing";
  game.phase = "ready";
  game.startedAt = Date.now();

  // Start Q1
  const now = Date.now();
  const sq1 = gameLib.startQuestion(game, now);
  assertEqual(sq1.ok, true, "startQuestion Q1 succeeds");
  assertEqual(game.currentIndex, 0, "currentIndex is 0 after first startQuestion");
  assertEqual(game.phase, "question", "phase is question");

  // Duration & remaining
  assertEqual(gameLib.durationMs(game), 30000, "durationMs is 30000 for 30s timer");
  assert(gameLib.remainingMs(game, now) <= 30000, "remainingMs <= 30000");

  // Submit answers
  const a1 = gameLib.submitAnswer(game, "p1", 1, now + 2000); // correct, 2s
  assertEqual(a1.ok, true, "p1 submitAnswer succeeds");
  assertEqual(a1.answer.correct, true, "p1 answer is correct");
  assertEqual(a1.answer.points, 1000, "p1 gets 1000 points (first correct)");

  const a2 = gameLib.submitAnswer(game, "p2", 1, now + 4000); // correct, 4s
  assertEqual(a2.ok, true, "p2 submitAnswer succeeds");
  assertEqual(a2.answer.correct, true, "p2 answer is correct");
  assertEqual(a2.answer.points, 800, "p2 gets 800 points (second correct)");

  // Can't answer twice
  const dup = gameLib.submitAnswer(game, "p1", 0, now + 5000);
  assertEqual(dup.ok, false, "duplicate answer rejected");

  // Reveal
  const rev = gameLib.revealQuestion(game, now + 6000);
  assertEqual(rev.ok, true, "revealQuestion succeeds");
  assertEqual(game.phase, "revealed", "phase is revealed");
  assertEqual(game.revealedThrough, 0, "revealedThrough updated");

  // Leaderboard
  const lb = gameLib.showLeaderboard(game);
  assertEqual(lb.ok, true, "showLeaderboard succeeds");
  assertEqual(game.phase, "leaderboard", "phase is leaderboard");

  // Standings check
  const table = gameLib.standings(game);
  assertEqual(table.length, 2, "standings has 2 rows");
  assertEqual(table[0].name, "أحمد", "أحمد is first (more points)");
  assertEqual(table[0].total, 1000, "أحمد has 1000 points");
  assertEqual(table[1].name, "فاطمة", "فاطمة is second");
  assertEqual(table[1].total, 800, "فاطمة has 800 points");
  assertEqual(table[0].rank, 1, "rank 1");
  assertEqual(table[1].rank, 2, "rank 2");

  // Start Q2
  const sq2 = gameLib.startQuestion(game, now + 10000);
  assertEqual(sq2.ok, true, "startQuestion Q2 succeeds");
  assertEqual(game.currentIndex, 1, "currentIndex is 1");

  // p2 answers correctly first this time
  const a3 = gameLib.submitAnswer(game, "p2", 2, now + 11000);
  assertEqual(a3.ok, true, "p2 answers Q2");
  assertEqual(a3.answer.correct, true, "p2 Q2 correct");
  assertEqual(a3.answer.points, 1000, "p2 gets 1000 for first correct Q2");

  // p1 answers wrong
  const a4 = gameLib.submitAnswer(game, "p1", 0, now + 12000);
  assertEqual(a4.ok, true, "p1 answers Q2");
  assertEqual(a4.answer.correct, false, "p1 Q2 wrong");
  assertEqual(a4.answer.points, 0, "p1 gets 0 for wrong answer");

  // Reveal Q2
  gameLib.revealQuestion(game, now + 15000);
  assertEqual(game.revealedThrough, 1, "revealedThrough is 1 after Q2 reveal");

  // Final standings
  const finalTable = gameLib.standings(game);
  assertEqual(finalTable[0].name, "فاطمة", "فاطمة leads (800+1000=1800)");
  assertEqual(finalTable[0].total, 1800, "فاطمة total = 1800");
  assertEqual(finalTable[1].name, "أحمد", "أحمد second (1000+0=1000)");
  assertEqual(finalTable[1].total, 1000, "أحمد total = 1000");

  // Finish
  const fin = gameLib.finishGame(game, now + 20000);
  assertEqual(fin.ok, true, "finishGame succeeds");
  assertEqual(game.status, "finished", "game status is finished");
  assertEqual(game.phase, "podium", "game phase is podium");
  assertEqual(game.winnerName, "فاطمة", "winner is فاطمة");

  // Can't finish again
  const dup2 = gameLib.finishGame(game);
  assertEqual(dup2.ok, false, "can't finish already finished game");
}

// Pause / Resume
section("Pause / Resume");
{
  const questions = [
    { id: "q1", text: "سؤال", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 30, category: "عام" },
  ];
  const game = gameLib.createGame({ code: "222222", maxPlayers: 4, questionDocs: questions, shuffleOptions: false });
  game.players.push({ id: "p1", name: "لاعب", token: "t", joinedAt: Date.now() });
  game.status = "playing";
  game.phase = "ready";
  const now = Date.now();
  gameLib.startQuestion(game, now);

  // Check remaining
  const rem1 = gameLib.remainingMs(game, now + 5000);
  assert(rem1 <= 25000 && rem1 >= 24000, `remaining after 5s ≈ 25s (got ${rem1})`);

  // Pause
  const p = gameLib.pauseQuestion(game, now + 5000);
  assertEqual(p.ok, true, "pause succeeds");
  assertEqual(game.qPaused, true, "qPaused is true");

  // Can't pause again
  const p2 = gameLib.pauseQuestion(game, now + 6000);
  assertEqual(p2.ok, false, "double pause fails");

  // Remaining should freeze
  const rem2 = gameLib.remainingMs(game, now + 10000);
  const rem3 = gameLib.remainingMs(game, now + 20000);
  assertEqual(rem2, rem3, "remaining stays frozen while paused");

  // Can't answer while paused
  const ans = gameLib.submitAnswer(game, "p1", 0, now + 7000);
  assertEqual(ans.ok, false, "can't answer while paused");

  // Resume
  const r = gameLib.resumeQuestion(game, now + 10000);
  assertEqual(r.ok, true, "resume succeeds");
  assertEqual(game.qPaused, false, "qPaused is false after resume");

  // Can answer now
  const ans2 = gameLib.submitAnswer(game, "p1", 0, now + 11000);
  assertEqual(ans2.ok, true, "can answer after resume");
}

// Time up
section("Time up");
{
  const questions = [
    { id: "q1", text: "سؤال", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 30, category: "عام" },
  ];
  const game = gameLib.createGame({ code: "333333", maxPlayers: 4, questionDocs: questions, shuffleOptions: false });
  game.players.push({ id: "p1", name: "لاعب", token: "t", joinedAt: Date.now() });
  game.status = "playing";
  game.phase = "ready";
  const now = Date.now();
  gameLib.startQuestion(game, now);

  // Try to answer after time is up
  const ans = gameLib.submitAnswer(game, "p1", 0, now + 31000);
  assertEqual(ans.ok, false, "answer after timer expires is rejected");
  assertEqual(game.qTimeUp, true, "qTimeUp set to true");
}

// recoverGame
section("recoverGame");
{
  const questions = [
    { id: "q1", text: "سؤال", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 30, category: "عام" },
  ];
  const game = gameLib.createGame({ code: "444444", maxPlayers: 4, questionDocs: questions, shuffleOptions: false });
  game.status = "playing";
  game.phase = "question";
  game.currentIndex = 0;
  game.qStartedAt = Date.now() - 10000;
  game.qResumedAt = game.qStartedAt;
  game.qPaused = false;
  game.qPausedElapsed = 0;
  game.answers = {};

  const recovered = gameLib.recoverGame(game, Date.now());
  assertEqual(recovered.qPaused, true, "recoverGame pauses the question");
  assertEqual(recovered.recovered, true, "recoverGame sets recovered flag");
}

// displayMode
section("displayMode");
{
  assertEqual(gameLib.displayMode(null), "welcome", "displayMode(null) = welcome");
  assertEqual(gameLib.displayMode({ status: "lobby" }), "lobby", "displayMode lobby");
  assertEqual(gameLib.displayMode({ status: "finished" }), "podium", "displayMode finished");
  assertEqual(gameLib.displayMode({ status: "playing", phase: "ready" }), "ready", "displayMode ready");
  assertEqual(gameLib.displayMode({ status: "playing", phase: "question" }), "question", "displayMode question");
  assertEqual(gameLib.displayMode({ status: "playing", phase: "revealed" }), "revealed", "displayMode revealed");
  assertEqual(gameLib.displayMode({ status: "playing", phase: "leaderboard" }), "leaderboard", "displayMode leaderboard");
}

// ---------------------------------------------------------------- 2. validate.js unit tests

section("lib/validate.js");

const { cleanText, validateQuestion, validateGameConfig, safeNextPath, RateLimiter } = require("../lib/validate");

// cleanText
{
  assertEqual(cleanText("  hello  world  ", 100), "hello world", "cleanText trims and collapses");
  assertEqual(cleanText("line1\nline2", 100, { multiline: true }), "line1\nline2", "cleanText preserves newlines in multiline");
  assertEqual(cleanText("a".repeat(200), 50), "a".repeat(50), "cleanText truncates");
  assertEqual(cleanText(null, 100), "", "cleanText handles null");
  assertEqual(cleanText(undefined, 100), "", "cleanText handles undefined");
}

// validateQuestion
{
  const good = validateQuestion({
    text: "ما هو الحمض النووي؟",
    options: ["DNA", "RNA", "ATP", "ADP"],
    correctIndex: 0,
    timer: 30,
    category: "وراثة",
    explanation: "DNA هو الحمض النووي",
  });
  assertEqual(good.ok, true, "valid question passes");
  assertEqual(good.value.text, "ما هو الحمض النووي؟", "question text preserved");
  assertEqual(good.value.options.length, 4, "4 options");

  // Too short text
  const short = validateQuestion({ text: "أب", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 30 });
  assertEqual(short.ok, false, "short text rejected");

  // Wrong number of options
  const threeOpts = validateQuestion({ text: "سؤال طويل كفاية", options: ["أ", "ب", "ج"], correctIndex: 0, timer: 30 });
  assertEqual(threeOpts.ok, false, "3 options rejected");

  // Empty option
  const emptyOpt = validateQuestion({ text: "سؤال طويل", options: ["أ", "", "ج", "د"], correctIndex: 0, timer: 30 });
  assertEqual(emptyOpt.ok, false, "empty option rejected");

  // Duplicate options (Arabic normalization)
  const dupOpts = validateQuestion({ text: "سؤال", options: ["إبراهيم", "ابراهيم", "ج", "د"], correctIndex: 0, timer: 30 });
  assertEqual(dupOpts.ok, false, "duplicate Arabic-normalized options rejected");

  // Bad correctIndex
  const badIdx = validateQuestion({ text: "سؤال طويل", options: ["أ", "ب", "ج", "د"], correctIndex: 5, timer: 30 });
  assertEqual(badIdx.ok, false, "correctIndex out of range rejected");

  // Bad timer
  const badTimer = validateQuestion({ text: "سؤال طويل", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 45 });
  assertEqual(badTimer.ok, false, "invalid timer rejected");

  // Null body
  assertEqual(validateQuestion(null).ok, false, "null body rejected");
}

// validateGameConfig
{
  const questions = [
    { id: "q1", text: "سؤال", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 30, category: "عام" },
    { id: "q2", text: "سؤال ٢", options: ["أ", "ب", "ج", "د"], correctIndex: 1, timer: 60, category: "عام" },
  ];

  const good = validateGameConfig({ maxPlayers: 4, questionIds: ["q1", "q2"] }, questions);
  assertEqual(good.ok, true, "valid game config passes");
  assertEqual(good.value.maxPlayers, 4, "maxPlayers set");
  assertEqual(good.value.questionDocs.length, 2, "2 question docs");

  // Bad maxPlayers
  const badPlayers = validateGameConfig({ maxPlayers: 10, questionIds: ["q1"] }, questions);
  assertEqual(badPlayers.ok, false, "invalid maxPlayers rejected");

  // No questions
  const noQ = validateGameConfig({ maxPlayers: 4, questionIds: [] }, questions);
  assertEqual(noQ.ok, false, "empty questionIds rejected");

  // Missing question id
  const badId = validateGameConfig({ maxPlayers: 4, questionIds: ["q999"] }, questions);
  assertEqual(badId.ok, false, "non-existent question id rejected");

  // Null body
  assertEqual(validateGameConfig(null, questions).ok, false, "null body rejected");
}

// safeNextPath
{
  assertEqual(safeNextPath("/admin"), "/admin", "safeNextPath /admin");
  assertEqual(safeNextPath("/display"), "/display", "safeNextPath /display");
  assertEqual(safeNextPath("/admin?tab=q"), "/admin?tab=q", "safeNextPath /admin with query");
  assertEqual(safeNextPath("/evil"), "/admin", "safeNextPath rejects unknown paths");
  assertEqual(safeNextPath("https://evil.com"), "/admin", "safeNextPath rejects external URLs");
  assertEqual(safeNextPath(null), "/admin", "safeNextPath handles null");
}

// RateLimiter
{
  const limiter = new RateLimiter();
  const r1 = limiter.hit("test-key", 3, 60000);
  assertEqual(r1.allowed, true, "first hit allowed");
  assertEqual(r1.remaining, 2, "remaining is 2");

  limiter.hit("test-key", 3, 60000);
  limiter.hit("test-key", 3, 60000);
  const r4 = limiter.hit("test-key", 3, 60000);
  assertEqual(r4.allowed, false, "4th hit blocked");
  assertEqual(r4.remaining, 0, "remaining is 0");
  assert(r4.retryAfterMs > 0, "retryAfterMs > 0");

  limiter.reset("test-key");
  const r5 = limiter.hit("test-key", 3, 60000);
  assertEqual(r5.allowed, true, "after reset, hit is allowed");

  // Cleanup
  clearInterval(limiter.timer);
}

// ---------------------------------------------------------------- 3. auth.js unit tests

section("lib/auth.js");

const { createAuth, parseCookies, COOKIE_NAME } = require("../lib/auth");

// parseCookies
{
  const cookies = parseCookies("foo=bar; baz=qux; asra_admin=token123");
  assertEqual(cookies.foo, "bar", "parseCookies parses foo");
  assertEqual(cookies.baz, "qux", "parseCookies parses baz");
  assertEqual(cookies.asra_admin, "token123", "parseCookies parses asra_admin");
  const empty = parseCookies("");
  assertEqual(Object.keys(empty).length, 0, "parseCookies empty string");
  const undef = parseCookies(undefined);
  assertEqual(Object.keys(undef).length, 0, "parseCookies undefined");
}

// createAuth
{
  const auth = createAuth({ secret: "test-secret-key-1234567890", username: "admin", password: "pass123" });

  // Issue token
  const token = auth.issue();
  assert(typeof token === "string" && token.includes("."), "issue returns dotted token");

  // Verify
  assertEqual(auth.verify(token), true, "verify valid token");
  assertEqual(auth.verify("garbage"), false, "verify rejects garbage");
  assertEqual(auth.verify(""), false, "verify rejects empty");
  assertEqual(auth.verify(null), false, "verify rejects null");

  // Tampered token
  const tampered = token.slice(0, -3) + "abc";
  assertEqual(auth.verify(tampered), false, "verify rejects tampered token");

  // isAuthenticated via mock request
  const req = { headers: { cookie: `${COOKIE_NAME}=${token}` } };
  assertEqual(auth.isAuthenticated(req), true, "isAuthenticated with valid cookie");

  const badReq = { headers: { cookie: `${COOKIE_NAME}=badtoken` } };
  assertEqual(auth.isAuthenticated(badReq), false, "isAuthenticated with bad cookie");

  // checkCredentials
  assertEqual(auth.checkCredentials("admin", "pass123"), true, "correct credentials");
  assertEqual(auth.checkCredentials("admin", "wrong"), false, "wrong password");
  assertEqual(auth.checkCredentials("wrong", "pass123"), false, "wrong username");

  // read
  const session = auth.read(req);
  assert(session !== null, "read returns session for valid token");
  assertEqual(session.u, "admin", "session contains username");
  assert(typeof session.exp === "number", "session has expiry");

  // Expired token
  const expired = auth.issue(Date.now() - 2 * 24 * 60 * 60 * 1000);
  assertEqual(auth.verify(expired), false, "verify rejects expired token");
}

// ---------------------------------------------------------------- 4. state.js unit tests

section("lib/state.js");

const { projectDisplayState, projectAdminState, projectPlayerState } = require("../lib/state");

{
  // No game
  const ds = projectDisplayState(null);
  assertEqual(ds.mode, "welcome", "display state no game = welcome");

  const as = projectAdminState(null);
  assertEqual(as.mode, "setup", "admin state no game = setup");

  const ps = projectPlayerState(null, "p1");
  assertEqual(ps.mode, "closed", "player state no game = closed");

  // With game
  const questions = [
    { id: "q1", text: "سؤال", options: ["أ", "ب", "ج", "د"], correctIndex: 0, timer: 30, category: "عام", explanation: "" },
  ];
  const game = gameLib.createGame({ code: "555555", maxPlayers: 4, questionDocs: questions, shuffleOptions: false });
  game.players.push(
    { id: "p1", name: "أحمد", token: "t1", joinedAt: Date.now() },
    { id: "p2", name: "فاطمة", token: "t2", joinedAt: Date.now() },
  );
  const onlineSet = new Set(["p1"]);
  const isOnline = (id) => onlineSet.has(id);

  // Lobby state
  const lobbyDisplay = projectDisplayState(game, isOnline);
  assertEqual(lobbyDisplay.mode, "lobby", "display lobby mode");
  assertEqual(lobbyDisplay.playerCount, 2, "display shows 2 players");
  assertEqual(lobbyDisplay.code, "555555", "display shows game code");

  const lobbyAdmin = projectAdminState(game, isOnline);
  assertEqual(lobbyAdmin.mode, "lobby", "admin lobby mode");
  assert(lobbyAdmin.game !== null, "admin state has game object");
  assertEqual(lobbyAdmin.game.players.length, 2, "admin sees 2 players");
  assertEqual(lobbyAdmin.game.players[0].online, true, "p1 is online");
  assertEqual(lobbyAdmin.game.players[1].online, false, "p2 is offline");

  const lobbyPlayer = projectPlayerState(game, "p1", isOnline);
  assertEqual(lobbyPlayer.mode, "lobby", "player lobby mode");
  assertEqual(lobbyPlayer.you.name, "أحمد", "player sees own name");
  assertEqual(lobbyPlayer.you.online, true, "player sees self online");

  // Missing player
  const missingPlayer = projectPlayerState(game, "p999", isOnline);
  assertEqual(missingPlayer.mode, "closed", "missing player → closed");

  // Playing state
  game.status = "playing";
  game.phase = "ready";
  game.startedAt = Date.now();
  gameLib.startQuestion(game);

  const qDisplay = projectDisplayState(game, isOnline);
  assertEqual(qDisplay.mode, "question", "display question mode");
  assert(qDisplay.question !== null, "display has question");
  assertEqual(qDisplay.correctIndex, null, "display doesn't show correct answer during question");

  const qAdmin = projectAdminState(game, isOnline);
  assertEqual(qAdmin.mode, "question", "admin question mode");
  assert(qAdmin.game.question !== null, "admin sees question");
  assertEqual(qAdmin.game.question.correctIndex, 0, "admin sees correct index");

  // Submit answer
  gameLib.submitAnswer(game, "p1", 0, Date.now());
  
  // Reveal
  gameLib.revealQuestion(game);
  const revDisplay = projectDisplayState(game, isOnline);
  assertEqual(revDisplay.mode, "revealed", "display revealed mode");
  assert(revDisplay.correctIndex !== null, "display shows correct after reveal");
  assert(revDisplay.results.length > 0, "display has results");

  const revPlayer = projectPlayerState(game, "p1", isOnline);
  assertEqual(revPlayer.mode, "revealed", "player revealed mode");
  assert(revPlayer.yourResult !== null, "player sees their result");
  assertEqual(revPlayer.yourResult.correct, true, "player result is correct");

  // Finish
  gameLib.finishGame(game);
  const finDisplay = projectDisplayState(game, isOnline);
  assertEqual(finDisplay.mode, "podium", "display podium mode");
  assert(finDisplay.winner !== null, "display has winner");

  const finPlayer = projectPlayerState(game, "p1", isOnline);
  assertEqual(finPlayer.mode, "podium", "player podium mode");
  assert(finPlayer.winner !== null, "player sees winner");
}

// ---------------------------------------------------------------- 5. store.js unit tests

section("lib/store.js (with temp directory)");

const { Store, readOrCreateSecret } = require("../lib/store");

{
  const tmpDir = path.join(__dirname, `_tmp_test_${Date.now()}`);
  try {
    // readOrCreateSecret
    const secret1 = readOrCreateSecret(tmpDir);
    assert(typeof secret1 === "string" && secret1.length >= 32, "readOrCreateSecret creates secret");
    const secret2 = readOrCreateSecret(tmpDir);
    assertEqual(secret1, secret2, "readOrCreateSecret returns same secret on second read");

    // Store
    const store = new Store({ dataDir: tmpDir });
    store.load();
    assert(store.db !== null, "store loads successfully");
    assert(Array.isArray(store.db.questions), "store has questions array");
    assert(store.db.questions.length > 0, "store seeds default questions");
    assert(Array.isArray(store.db.games), "store has games array");

    // Test active game management
    const questions = store.db.questions.slice(0, 2);
    const game = gameLib.createGame({
      code: "666666",
      maxPlayers: 4,
      questionDocs: questions,
      shuffleOptions: false,
    });
    store.setActiveGame(game);
    assert(store.getActiveGame() !== null, "getActiveGame returns game after set");
    assertEqual(store.getActiveGame().id, game.id, "active game id matches");

    // Save and reload
    store.flush();
    assert(fs.existsSync(path.join(tmpDir, "db.json")), "db.json file created");

    const store2 = new Store({ dataDir: tmpDir });
    store2.load();
    assert(store2.getActiveGame() !== null, "reloaded store has active game");
    assertEqual(store2.getActiveGame().code, "666666", "reloaded game has correct code");

    // Remove game
    store2.removeGame(game.id);
    assertEqual(store2.getActiveGame(), null, "active game null after removal");
    store2.flush();

    // History
    const finishedGame = gameLib.createGame({
      code: "777777",
      maxPlayers: 4,
      questionDocs: questions,
      shuffleOptions: false,
    });
    finishedGame.players.push({ id: "p1", name: "لاعب", token: "t", joinedAt: Date.now() });
    finishedGame.status = "finished";
    finishedGame.phase = "podium";
    finishedGame.finishedAt = Date.now();
    store2.db.games.push(finishedGame);
    store2.flush();

    const history = store2.history();
    assert(history.length >= 1, "history contains finished game");
    assertEqual(history[0].code, "777777", "history game has correct code");
  } finally {
    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

// ---------------------------------------------------------------- 6. HTTP Server Integration Tests

section("HTTP Server Integration (Express + Socket.IO)");

async function runServerTests() {
  const DATA_DIR = path.join(__dirname, `_tmp_server_${Date.now()}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });

  // Set up environment
  process.env.DATA_DIR = DATA_DIR;
  process.env.PORT = "0"; // let OS assign port
  process.env.ADMIN_USERNAME = "testadmin";
  process.env.ADMIN_PASSWORD = "testpass123";

  // We'll test by making HTTP requests directly
  const serverModule = path.join(__dirname, "..", "server.js");

  // Instead of requiring server.js (which starts listening), we'll start it as a subprocess
  const { spawn } = require("child_process");

  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverModule], {
      env: { ...process.env, DATA_DIR, PORT: "3999", ADMIN_USERNAME: "testadmin", ADMIN_PASSWORD: "testpass123" },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));

    // Wait for server to be ready
    const waitReady = setTimeout(async () => {
      try {
        await testHTTPEndpoints(3999, DATA_DIR);
      } catch (err) {
        console.error("  ✗ Server test error:", err.message);
        failed++;
        failures.push(`Server test error: ${err.message}`);
      } finally {
        child.kill("SIGTERM");
        setTimeout(() => {
          try {
            fs.rmSync(DATA_DIR, { recursive: true, force: true });
          } catch (_) {}
          resolve();
        }, 500);
      }
    }, 2000);
  });
}

function httpGet(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path, headers }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body, json: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, body, json: null });
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function httpPost(port, path, data, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), ...headers },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (d) => (responseBody += d));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, headers: res.headers, body: responseBody, json: JSON.parse(responseBody) });
          } catch (_) {
            resolve({ status: res.statusCode, headers: res.headers, body: responseBody, json: null });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

async function testHTTPEndpoints(port, dataDir) {
  // Health check
  const health = await httpGet(port, "/healthz");
  assertEqual(health.status, 200, "GET /healthz returns 200");
  assertEqual(health.body, "ok", "GET /healthz body is 'ok'");

  // Security headers
  assert(health.headers["x-content-type-options"] === "nosniff", "security header X-Content-Type-Options");
  assert(health.headers["x-frame-options"] === "DENY", "security header X-Frame-Options");
  assert(health.headers["referrer-policy"] === "no-referrer", "security header Referrer-Policy");
  assert(health.headers["content-security-policy"]?.includes("default-src 'self'"), "CSP header present");

  // Pages
  const home = await httpGet(port, "/");
  assertEqual(home.status, 200, "GET / returns 200");

  const play = await httpGet(port, "/play");
  assertEqual(play.status, 200, "GET /play returns 200");

  const login = await httpGet(port, "/login");
  assertEqual(login.status, 200, "GET /login returns 200");

  // Admin page without auth → redirect
  const adminNoAuth = await httpGet(port, "/admin");
  assertEqual(adminNoAuth.status, 302, "GET /admin without auth redirects");

  // Display page without auth → redirect
  const displayNoAuth = await httpGet(port, "/display");
  assertEqual(displayNoAuth.status, 302, "GET /display without auth redirects");

  // 404 page
  const notFound = await httpGet(port, "/nonexistent");
  assertEqual(notFound.status, 404, "GET /nonexistent returns 404");

  // API 404
  const apiNotFound = await httpGet(port, "/api/nonexistent");
  assertEqual(apiNotFound.status, 404, "GET /api/nonexistent returns 404");
  assertEqual(apiNotFound.json?.ok, false, "API 404 returns ok: false");

  // Session check (not logged in)
  const session = await httpGet(port, "/api/session");
  assertEqual(session.status, 200, "GET /api/session returns 200");
  assertEqual(session.json.authenticated, false, "not authenticated initially");

  // Login with wrong credentials
  const badLogin = await httpPost(port, "/api/login", { username: "admin", password: "wrong" });
  // Note: login has a 160ms delay for wrong credentials
  assertEqual(badLogin.status, 401, "POST /api/login wrong creds returns 401");

  // Login with correct credentials
  const goodLogin = await httpPost(port, "/api/login", { username: "testadmin", password: "testpass123" });
  assertEqual(goodLogin.status, 200, "POST /api/login correct creds returns 200");
  assertEqual(goodLogin.json.ok, true, "login response ok: true");
  const setCookie = goodLogin.headers["set-cookie"];
  const setCookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : String(setCookie || "");
  assert(setCookieStr.includes("asra_admin"), "login sets cookie");

  // Extract cookie for subsequent requests
  const cookieEntry = Array.isArray(setCookie) ? setCookie[0] : setCookieStr;
  const cookie = cookieEntry.split(";")[0];

  // Session check (logged in)
  const session2 = await httpGet(port, "/api/session", { cookie });
  assertEqual(session2.json.authenticated, true, "authenticated after login");

  // Admin bootstrap
  const bootstrap = await httpGet(port, "/api/admin/bootstrap", { cookie });
  assertEqual(bootstrap.status, 200, "GET /api/admin/bootstrap returns 200");
  assertEqual(bootstrap.json.ok, true, "bootstrap ok: true");
  assert(Array.isArray(bootstrap.json.questions), "bootstrap has questions array");
  assert(bootstrap.json.questions.length > 0, "bootstrap has seeded questions");
  assert(bootstrap.json.config !== undefined, "bootstrap has config");
  assertIncludes(bootstrap.json.config.playerCounts, 4, "config has player count 4");

  // Get questions
  const questions = await httpGet(port, "/api/admin/questions", { cookie });
  assertEqual(questions.status, 200, "GET /api/admin/questions returns 200");
  assert(Array.isArray(questions.json.questions), "questions response has array");

  // Create a new question
  const newQ = await httpPost(
    port,
    "/api/admin/questions",
    {
      text: "سؤال اختبار جديد من الاختبار",
      options: ["خيار أ", "خيار ب", "خيار ج", "خيار د"],
      correctIndex: 0,
      timer: 30,
      category: "اختبار",
      explanation: "هذا سؤال اختبار",
    },
    { cookie, "x-asra-admin": "1" },
  );
  assertEqual(newQ.status, 201, "POST /api/admin/questions creates question");
  assertEqual(newQ.json.ok, true, "create question ok: true");
  assert(newQ.json.question.id.startsWith("q_"), "new question has id");

  // Create a game
  const qIds = questions.json.questions.slice(0, 3).map((q) => q.id);
  const newGame = await httpPost(
    port,
    "/api/admin/games",
    { maxPlayers: 4, questionIds: qIds },
    { cookie, "x-asra-admin": "1" },
  );
  assertEqual(newGame.status, 201, "POST /api/admin/games creates game");
  assertEqual(newGame.json.ok, true, "create game ok: true");
  assert(newGame.json.gameId?.startsWith("g_"), "new game has id");
  assert(/^\d{6}$/.test(newGame.json.code), "new game has 6-digit code");

  // Can't create another game while one is active
  const dupGame = await httpPost(
    port,
    "/api/admin/games",
    { maxPlayers: 4, questionIds: qIds },
    { cookie, "x-asra-admin": "1" },
  );
  assertEqual(dupGame.status, 409, "duplicate game returns 409");

  // Join info
  const joinInfo = await httpGet(port, "/api/admin/join-info", { cookie });
  assertEqual(joinInfo.status, 200, "GET /api/admin/join-info returns 200");
  assertEqual(joinInfo.json.ok, true, "join-info ok");
  assertEqual(joinInfo.json.code, newGame.json.code, "join-info has correct code");

  // QR code
  const qr = await httpGet(port, "/api/admin/qr.svg", { cookie });
  assertEqual(qr.status, 200, "GET /api/admin/qr.svg returns 200");
  assert(qr.body.includes("<svg"), "QR response contains SVG");

  // Admin active state
  const active = await httpGet(port, "/api/admin/active", { cookie });
  assertEqual(active.status, 200, "GET /api/admin/active returns 200");
  assert(active.json.state !== undefined, "active state exists");

  // Cancel game
  const cancel = await httpPost(
    port,
    `/api/admin/games/${newGame.json.gameId}/cancel`,
    {},
    { cookie, "x-asra-admin": "1" },
  );
  assertEqual(cancel.status, 200, "cancel game returns 200");
  assertEqual(cancel.json.ok, true, "cancel ok");

  // History (should be empty since we cancelled, not finished)
  const history = await httpGet(port, "/api/admin/history", { cookie });
  assertEqual(history.status, 200, "GET /api/admin/history returns 200");
  assert(Array.isArray(history.json.history), "history is array");

  // Logout
  const logout = await httpPost(port, "/api/logout", {});
  assertEqual(logout.status, 200, "POST /api/logout returns 200");

  // Admin API without auth
  const noAuth = await httpGet(port, "/api/admin/bootstrap");
  assertEqual(noAuth.status, 401, "admin API without auth returns 401");

  console.log("  ✓ HTTP endpoint tests completed");
}

// ---------------------------------------------------------------- 7. Seed questions validation

section("lib/seed.js (question data integrity)");

{
  const { QUESTIONS } = require("../lib/seed");
  assert(Array.isArray(QUESTIONS), "QUESTIONS is an array");
  assert(QUESTIONS.length > 0, `QUESTIONS has ${QUESTIONS.length} items`);

  let allValid = true;
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i];
    if (!q.text || q.text.length < 3) {
      console.error(`  ✗ Question ${i}: text too short`);
      allValid = false;
      continue;
    }
    if (!Array.isArray(q.options) || q.options.length !== 4) {
      console.error(`  ✗ Question ${i}: needs exactly 4 options`);
      allValid = false;
      continue;
    }
    if (q.options.some((o) => !o || o.length < 1)) {
      console.error(`  ✗ Question ${i}: has empty option`);
      allValid = false;
      continue;
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      console.error(`  ✗ Question ${i}: bad correctIndex`);
      allValid = false;
      continue;
    }
    if (![30, 60].includes(q.timer)) {
      console.error(`  ✗ Question ${i}: bad timer`);
      allValid = false;
      continue;
    }
    if (!q.category) {
      console.error(`  ✗ Question ${i}: missing category`);
      allValid = false;
    }
  }
  if (allValid) passed++;
  else failed++;
  assert(allValid, "all seed questions are valid");
}

// ---------------------------------------------------------------- 8. Views existence check

section("Views & Public assets existence");

{
  const viewsDir = path.join(__dirname, "..", "views");
  const expectedViews = ["index.html", "play.html", "login.html", "admin.html", "display.html"];
  for (const view of expectedViews) {
    const exists = fs.existsSync(path.join(viewsDir, view));
    assert(exists, `views/${view} exists`);
  }

  const publicDir = path.join(__dirname, "..", "public");
  assert(fs.existsSync(path.join(publicDir, "css")), "public/css exists");
  assert(fs.existsSync(path.join(publicDir, "js")), "public/js exists");
}

// ---------------------------------------------------------------- Run all

async function main() {
  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  الأسرع - Integration Test Suite             ║");
  console.log("╚══════════════════════════════════════════════╝");

  // Server tests run async
  try {
    await runServerTests();
  } catch (err) {
    console.error("  ✗ Server tests failed:", err.message);
    failed++;
    failures.push(`Server tests: ${err.message}`);
  }

  // Summary
  console.log("\n══════════════════════════════════════════════");
  console.log(`  Total: ${passed + failed}  |  ✓ Passed: ${passed}  |  ✗ Failed: ${failed}`);
  if (failures.length > 0) {
    console.log("\n  Failures:");
    failures.forEach((f, i) => console.log(`    ${i + 1}. ${f}`));
  }
  console.log("══════════════════════════════════════════════\n");

  process.exit(failed > 0 ? 1 : 0);
}

main();
