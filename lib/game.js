"use strict";

const crypto = require("crypto");

const SCORE_TABLE = [1000, 800, 650, 500, 400, 300];
const ALLOWED_PLAYER_COUNTS = [2, 3, 4, 5, 6];
const ALLOWED_TIMERS = [30, 60];
const LETTERS = ["أ", "ب", "ج", "د"];
const DEFAULT_TITLE = "تحدّي العلوم الحيوية الطبية";

function newId(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function newToken() {
  return crypto.randomBytes(18).toString("base64url");
}

function generateGameCode(isTaken) {
  for (let i = 0; i < 40; i += 1) {
    const code = String(crypto.randomInt(100000, 1000000));
    if (!isTaken || !isTaken(code)) return code;
  }
  return String(Date.now()).slice(-6);
}

function shuffle(items) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function normalizePlayerName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 18);
}

function cloneQuestionForGame(doc, shuffleOptions) {
  const indexes = [0, 1, 2, 3];
  const order = shuffleOptions ? shuffle(indexes) : indexes;
  const options = order.map((i) => doc.options[i]);
  return {
    sourceId: doc.id,
    text: doc.text,
    options,
    correctIndex: order.indexOf(doc.correctIndex),
    timer: doc.timer,
    category: doc.category,
    explanation: doc.explanation || "",
  };
}

function createGame({ code, maxPlayers, questionDocs, shuffleQuestions = false, shuffleOptions = true }) {
  const docs = shuffleQuestions ? shuffle(questionDocs) : questionDocs;
  return {
    id: newId("g"),
    code,
    title: DEFAULT_TITLE,
    maxPlayers,
    questions: docs.map((doc) => cloneQuestionForGame(doc, shuffleOptions)),
    players: [],
    answers: {},
    status: "lobby",
    phase: "lobby",
    currentIndex: -1,
    revealedThrough: -1,
    qStartedAt: null,
    qPausedElapsed: 0,
    qResumedAt: null,
    qPaused: false,
    qTimeUp: false,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    winnerId: null,
    winnerName: null,
    recovered: false,
  };
}

function durationMs(game) {
  const question = game.questions[game.currentIndex];
  return question ? question.timer * 1000 : 0;
}

function elapsedMs(game, now = Date.now()) {
  if (game.currentIndex < 0) return 0;
  if (game.qPaused) return Math.max(0, Number(game.qPausedElapsed) || 0);
  return Math.max(0, Number(game.qPausedElapsed) || 0) + Math.max(0, now - (game.qResumedAt || now));
}

function remainingMs(game, now = Date.now()) {
  if (game.status !== "playing" || game.phase !== "question") return 0;
  const duration = durationMs(game);
  return Math.max(0, Math.min(duration, duration - elapsedMs(game, now)));
}

function startQuestion(game, now = Date.now()) {
  if (game.status !== "playing") return { ok: false, error: "لم تبدأ اللعبة بعد." };
  if (game.phase === "question" && !game.qTimeUp) return { ok: false, error: "السؤال الحالي ما زال مفتوحًا." };
  if (["revealed", "leaderboard", "ready"].includes(game.phase) === false) {
    return { ok: false, error: "لا يمكن بدء سؤال جديد الآن." };
  }
  const next = game.currentIndex + 1;
  if (next < 0 || next >= game.questions.length) {
    return { ok: false, error: "لا توجد أسئلة متبقية." };
  }
  game.currentIndex = next;
  game.phase = "question";
  game.qStartedAt = now;
  game.qPausedElapsed = 0;
  game.qResumedAt = now;
  game.qPaused = false;
  game.qTimeUp = false;
  if (!Array.isArray(game.answers[next])) game.answers[next] = [];
  return { ok: true };
}

function pauseQuestion(game, now = Date.now()) {
  if (game.phase !== "question") return { ok: false, error: "السؤال غير نشط." };
  if (game.qPaused) return { ok: false, error: "المؤقت متوقف بالفعل." };
  game.qPausedElapsed = Math.min(durationMs(game), elapsedMs(game, now));
  game.qPaused = true;
  game.qResumedAt = null;
  return { ok: true };
}

function resumeQuestion(game, now = Date.now()) {
  if (game.phase !== "question") return { ok: false, error: "السؤال غير نشط." };
  if (!game.qPaused) return { ok: false, error: "المؤقت يعمل بالفعل." };
  if (game.qTimeUp || remainingMs(game, now) <= 0) return { ok: false, error: "انتهى وقت السؤال." };
  game.qPaused = false;
  game.qResumedAt = now;
  return { ok: true };
}

function revealQuestion(game, now = Date.now()) {
  if (game.phase !== "question") return { ok: false, error: "لا يوجد سؤال مفتوح لعرض إجابته." };
  game.qPausedElapsed = Math.min(durationMs(game), elapsedMs(game, now));
  game.qPaused = true;
  game.qResumedAt = null;
  game.qTimeUp = game.qPausedElapsed >= durationMs(game) - 30;
  game.phase = "revealed";
  game.revealedThrough = Math.max(game.revealedThrough, game.currentIndex);
  return { ok: true };
}

function showLeaderboard(game) {
  if (game.phase !== "revealed") return { ok: false, error: "اعرض نتيجة السؤال أولًا." };
  game.phase = "leaderboard";
  return { ok: true };
}

function currentAnswers(game) {
  if (game.currentIndex < 0) return [];
  const answers = game.answers[game.currentIndex];
  return Array.isArray(answers) ? answers : [];
}

function answerByPlayer(game, questionIndex, playerId) {
  const answers = game.answers[questionIndex];
  if (!Array.isArray(answers)) return null;
  return answers.find((a) => a.playerId === playerId) || null;
}

function submitAnswer(game, playerId, optionIndex, now = Date.now()) {
  if (game.status !== "playing" || game.phase !== "question") {
    return { ok: false, error: "انتظر بدء السؤال التالي." };
  }
  const question = game.questions[game.currentIndex];
  if (!question) return { ok: false, error: "لا يوجد سؤال نشط." };
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) {
    return { ok: false, error: "اختر أحد الخيارات الأربعة." };
  }
  if (game.qPaused) return { ok: false, error: "المؤقت متوقف مؤقتًا." };
  if (game.qTimeUp) return { ok: false, error: "انتهى وقت السؤال." };
  const elapsed = elapsedMs(game, now);
  if (elapsed >= question.timer * 1000) {
    game.qTimeUp = true;
    return { ok: false, error: "انتهى وقت السؤال." };
  }
  const answers = game.answers[game.currentIndex] || (game.answers[game.currentIndex] = []);
  if (answers.some((a) => a.playerId === playerId)) {
    return { ok: false, error: "سبق أن أجبت على هذا السؤال." };
  }
  const correct = optionIndex === question.correctIndex;
  const priorCorrect = answers.filter((a) => a.correct).length;
  const points = correct ? SCORE_TABLE[Math.min(priorCorrect, SCORE_TABLE.length - 1)] : 0;
  const answer = {
    playerId,
    optionIndex,
    correct,
    points,
    elapsedMs: Math.round(elapsed),
    at: now,
  };
  answers.push(answer);
  return { ok: true, answer };
}

function correctOrderFor(game, questionIndex) {
  const answers = game.answers[questionIndex];
  if (!Array.isArray(answers)) return [];
  return answers
    .filter((a) => a.correct)
    .slice()
    .sort((a, b) => a.elapsedMs - b.elapsedMs || a.at - b.at);
}

function speedRankFor(game, questionIndex, playerId) {
  const order = correctOrderFor(game, questionIndex);
  const index = order.findIndex((a) => a.playerId === playerId);
  return index < 0 ? 0 : index + 1;
}

function statsForPlayer(game, playerId, includeUnrevealed = false) {
  const lastIndex = includeUnrevealed ? game.questions.length - 1 : game.revealedThrough;
  let total = 0;
  let correctCount = 0;
  let totalTime = 0;
  let answersCount = 0;
  for (let i = 0; i <= lastIndex; i += 1) {
    const answer = answerByPlayer(game, i, playerId);
    if (!answer) continue;
    answersCount += 1;
    if (answer.correct) {
      total += answer.points;
      correctCount += 1;
      totalTime += answer.elapsedMs;
    }
  }
  return { total, correctCount, totalTime, answersCount };
}

function standings(game, { includeUnrevealed = false } = {}) {
  const rows = game.players.map((player) => {
    const stats = statsForPlayer(game, player.id, includeUnrevealed);
    return {
      playerId: player.id,
      name: player.name,
      joinedAt: player.joinedAt,
      ...stats,
    };
  });
  rows.sort(
    (a, b) =>
      b.total - a.total ||
      b.correctCount - a.correctCount ||
      a.totalTime - b.totalTime ||
      a.joinedAt - b.joinedAt,
  );
  let last = null;
  let lastRank = 0;
  rows.forEach((row, index) => {
    const tied =
      last &&
      row.total === last.total &&
      row.correctCount === last.correctCount &&
      row.totalTime === last.totalTime;
    row.rank = tied ? lastRank : index + 1;
    last = row;
    lastRank = row.rank;
  });
  return rows;
}

function finishGame(game, now = Date.now()) {
  if (game.status === "finished") return { ok: false, error: "انتهت اللعبة بالفعل." };
  if (game.status !== "playing") return { ok: false, error: "لم تبدأ اللعبة بعد." };
  if (game.phase === "question") {
    game.qPausedElapsed = Math.min(durationMs(game), elapsedMs(game, now));
    game.qPaused = true;
    game.qResumedAt = null;
  }
  if (game.currentIndex >= 0 && currentAnswers(game).length > 0) {
    game.revealedThrough = Math.max(game.revealedThrough, game.currentIndex);
  }
  const table = standings(game);
  game.status = "finished";
  game.phase = "podium";
  game.finishedAt = now;
  game.winnerId = table[0] ? table[0].playerId : null;
  game.winnerName = table[0] ? table[0].name : null;
  return { ok: true, winner: table[0] || null };
}

function recoverGame(game, savedAt = Date.now()) {
  if (!Array.isArray(game.questions)) game.questions = [];
  if (!Array.isArray(game.players)) game.players = [];
  if (!game.answers || typeof game.answers !== "object") game.answers = {};
  if (typeof game.revealedThrough !== "number") game.revealedThrough = -1;
  if (game.status === "playing" && game.phase === "question") {
    const froze = Math.min(durationMs(game), elapsedMs(game, savedAt));
    game.qPausedElapsed = froze;
    game.qPaused = true;
    game.qResumedAt = null;
    game.qTimeUp = froze >= durationMs(game) - 30;
    game.recovered = true;
  }
  return game;
}

function displayMode(game) {
  if (!game) return "welcome";
  if (game.status === "lobby") return "lobby";
  if (game.status === "finished" || game.phase === "podium") return "podium";
  if (game.phase === "ready") return "ready";
  if (game.phase === "question") return "question";
  if (game.phase === "revealed") return "revealed";
  if (game.phase === "leaderboard") return "leaderboard";
  return "welcome";
}

module.exports = {
  SCORE_TABLE,
  ALLOWED_PLAYER_COUNTS,
  ALLOWED_TIMERS,
  LETTERS,
  DEFAULT_TITLE,
  newId,
  newToken,
  generateGameCode,
  shuffle,
  normalizePlayerName,
  createGame,
  durationMs,
  elapsedMs,
  remainingMs,
  startQuestion,
  pauseQuestion,
  resumeQuestion,
  revealQuestion,
  showLeaderboard,
  currentAnswers,
  answerByPlayer,
  submitAnswer,
  correctOrderFor,
  speedRankFor,
  statsForPlayer,
  standings,
  finishGame,
  recoverGame,
  displayMode,
};
