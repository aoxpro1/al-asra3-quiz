import {
  $,
  arNum,
  letterFor,
  rankLabel,
  playerWord,
  formatSeconds,
  escapeHtml,
  initials,
  initialsColor,
  avatarHtml,
  toast,
  createSocket,
  TimerRing,
  icon,
  vibrate,
  setBusy,
} from "./common.js";

const views = {
  loading: $("#view-loading"),
  join: $("#view-join"),
  lobby: $("#view-lobby"),
  ready: $("#view-ready"),
  question: $("#view-question"),
  result: $("#view-result"),
  leaderboard: $("#view-leaderboard"),
  final: $("#view-final"),
  closed: $("#view-closed"),
};

const topCodePill = $("#top-code-pill");
const topCodeCode = $("#top-code-code");
const connPill = $("#conn-pill");
const connDot = $("#conn-dot");
const connLabel = $("#conn-label");
const connBanner = $("#conn-banner");
const connBannerText = $("#conn-banner-text");
const loadingText = $("#loading-text");

const joinForm = $("#join-form");
const codeInput = $("#code-input");
const nameInput = $("#name-input");
const joinError = $("#join-error");
const joinSubmit = $("#join-submit");

const lobbyHint = $("#lobby-hint");
const lobbyName = $("#lobby-name");
const lobbyAvatar = $("#lobby-avatar");
const lobbyCode = $("#lobby-code");
const lobbyCount = $("#lobby-count");
const lobbyPlayers = $("#lobby-players");
const capacityDots = $("#capacity-dots");
const readyPlayers = $("#ready-players");

const qCounter = $("#q-counter");
const qStatus = $("#q-status");
const qCategory = $("#q-category");
const qText = $("#q-text");
const answerGrid = $("#answer-grid");
const questionState = $("#question-state");
const answeredCount = $("#answered-count");
const playersCount = $("#players-count");

const resultCard = $("#result-card");
const resultIcon = $("#result-icon");
const resultTitle = $("#result-title");
const resultPoints = $("#result-points");
const resultSub = $("#result-sub");
const correctLetter = $("#correct-letter");
const correctText = $("#correct-text");
const explanation = $("#explanation");
const totalPoints = $("#total-points");
const totalRank = $("#total-rank");
const correctCount = $("#correct-count");
const miniAfter = $("#mini-after");
const miniLeaderboard = $("#mini-leaderboard");

const boardSub = $("#board-sub");
const leaderboardPodium = $("#leaderboard-podium");
const leaderboardList = $("#leaderboard-list");

const finalEyebrow = $("#final-eyebrow");
const finalWinner = $("#final-winner");
const finalScore = $("#final-score");
const finalSub = $("#final-sub");
const finalAvatar = $("#final-avatar");
const finalYouName = $("#final-you-name");
const finalRank = $("#final-rank");
const finalPoints = $("#final-points");
const finalCorrect = $("#final-correct");
const finalList = $("#final-list");

const closedTitle = $("#closed-title");
const closedMessage = $("#closed-message");

const timer = new TimerRing($("#player-timer"));

const state = {
  socket: null,
  connected: false,
  code: "",
  name: "",
  token: "",
  joined: false,
  game: null,
  pending: false,
  optimisticIndex: -1,
  questionKey: "",
  lastMode: "",
  lastQuestionIndex: null,
  lastPaused: null,
  lastTimeUp: null,
  lastRevealKey: "",
  autoResume: false,
  resuming: false,
  joinBusy: false,
  closed: false,
};

function formatCode(code) {
  const value = String(code || "");
  if (value.length === 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  return value || "—";
}

function identityKey(code) {
  return `asra.player.${code}`;
}

function saveIdentity(code, data) {
  try {
    localStorage.setItem(identityKey(code), JSON.stringify(data));
  } catch (_) {
    /* storage may be unavailable */
  }
}

function loadIdentity(code) {
  try {
    const raw = localStorage.getItem(identityKey(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed.token === "string" ? parsed : null;
  } catch (_) {
    return null;
  }
}

function clearIdentity(code) {
  try {
    localStorage.removeItem(identityKey(code));
  } catch (_) {
    /* ignore */
  }
}

function savedName() {
  try {
    return localStorage.getItem("asra.name") || "";
  } catch (_) {
    return "";
  }
}

function rememberName(name) {
  try {
    localStorage.setItem("asra.name", name);
  } catch (_) {
    /* ignore */
  }
}

function updateTopCode(code) {
  if (!code) {
    topCodePill.hidden = true;
    return;
  }
  topCodePill.hidden = false;
  topCodeCode.textContent = formatCode(code);
}

function showView(name) {
  for (const [key, element] of Object.entries(views)) {
    if (element) element.hidden = key !== name;
  }
}

function showLoading(text = "جارٍ الاتصال بالجولة...") {
  loadingText.textContent = text;
  showView("loading");
}

function showJoin(message = "") {
  state.closed = false;
  updateTopCode(state.code);
  if (state.code) codeInput.value = state.code;
  if (!nameInput.value) nameInput.value = state.name || savedName();
  if (message) {
    joinError.textContent = message;
    joinError.hidden = false;
  } else {
    joinError.hidden = true;
  }
  showView("join");
  updateConnUI(state.connected);
  setTimeout(() => {
    if (!codeInput.value.trim()) codeInput.focus({ preventScroll: true });
    else nameInput.focus({ preventScroll: true });
  }, 80);
}

function showJoinError(message) {
  joinError.textContent = message;
  joinError.hidden = false;
  joinError.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function updateConnUI(online) {
  state.connected = Boolean(online);
  connPill.classList.toggle("is-offline", !online);
  connDot.className = online ? "online-dot" : "offline-dot";
  connLabel.textContent = online ? "متصل" : "غير متصل";
  connBanner.hidden = online || state.closed;
  if (!online) {
    connBannerText.textContent = "انقطع الاتصال... جارٍ إعادة المحاولة";
  }
  if (!state.joinBusy) joinSubmit.disabled = !online;
}

function stopTimer() {
  timer.sync({ remainingMs: 0, durationMs: 1, paused: true, timeUp: false });
}

function showClosed(message, reason = "") {
  state.closed = true;
  state.joined = false;
  state.pending = false;
  state.optimisticIndex = -1;
  state.game = null;
  stopTimer();
  updateConnUI(state.connected);
  closedTitle.textContent =
    reason === "replaced" ? "فُتحت اللعبة في مكان آخر" : "انتهت الجولة";
  closedMessage.textContent = message || "شكرًا لمشاركتك.";
  showView("closed");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderJoinState() {
  stopTimer();
  showView("join");
  updateTopCode(state.code);
  updateConnUI(state.connected);
}

function emitWithTimeout(event, payload, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    if (!state.socket || !state.socket.connected) {
      reject(new Error("offline"));
      return;
    }
    state.socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

async function requestJoin({ code, name, token = "" }) {
  const response = await emitWithTimeout("player:join", { code, name, token }, 12000);
  if (!response || !response.ok) {
    return response || { ok: false, error: "تعذر الانضمام إلى الجولة." };
  }
  state.joined = true;
  state.closed = false;
  state.code = code;
  state.token = response.token;
  state.name = response.state?.you?.name || name;
  state.game = response.state;
  saveIdentity(code, { token: response.token, name: state.name });
  rememberName(state.name);
  renderState(response.state);
  connBanner.hidden = true;
  return response;
}

async function tryAutoResume() {
  if (state.resuming || state.joined || !state.autoResume) return;
  if (!state.token || !state.code) {
    state.autoResume = false;
    showJoin();
    return;
  }
  state.autoResume = false;
  state.resuming = true;
  showLoading("جارٍ استئناف جلستك...");
  try {
    await requestJoin({ code: state.code, name: state.name, token: state.token });
  } catch (error) {
    state.token = "";
    clearIdentity(state.code);
    showJoin("تعذر استئناف الجلسة. أدخل اسمك من جديد للانضمام.");
  } finally {
    state.resuming = false;
  }
}

async function resumeAfterReconnect() {
  if (state.resuming || !state.token || !state.code) return;
  state.resuming = true;
  try {
    await requestJoin({ code: state.code, name: state.name, token: state.token });
  } catch (error) {
    // The regular state sync will retry on the next reconnect; keep the screen as-is.
  } finally {
    state.resuming = false;
  }
}

function renderState(game) {
  if (!game || !game.mode) return;
  state.game = game;
  if (game.code) {
    state.code = game.code;
    updateTopCode(game.code);
  }
  if (game.yourAnswer) {
    state.pending = false;
    state.optimisticIndex = -1;
  }
  const modeChanged =
    state.lastMode !== game.mode || state.lastQuestionIndex !== game.currentIndex;
  switch (game.mode) {
    case "lobby":
      renderLobby(game);
      break;
    case "ready":
      renderReady(game);
      break;
    case "question":
      renderQuestion(game);
      break;
    case "revealed":
      renderResult(game);
      break;
    case "leaderboard":
      renderLeaderboard(game);
      break;
    case "podium":
      renderFinal(game);
      break;
    default:
      showJoin("ستظهر الجولة هنا عند بدء المشرف.");
      break;
  }
  state.lastMode = game.mode;
  state.lastQuestionIndex = game.currentIndex;
  if (modeChanged) window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderPlayerChips(players, container, youName) {
  if (!container) return;
  if (!players || players.length === 0) {
    container.innerHTML = '<p class="text-xs muted">لا يوجد لاعبون بعد.</p>';
    return;
  }
  container.innerHTML = players
    .map((player) => {
      const isYou = player.name === youName;
      return `<div class="player-chip ${isYou ? "is-you" : ""} ${player.online ? "" : "is-offline"}">
        ${avatarHtml(player.name)}
        <span class="player-chip-name">${escapeHtml(player.name)}${isYou ? " <small>(أنت)</small>" : ""}</span>
        <span class="${player.online ? "online-dot" : "offline-dot"} status-dot"></span>
      </div>`;
    })
    .join("");
}

function renderLobby(game) {
  stopTimer();
  showView("lobby");
  const name = game.you?.name || state.name;
  lobbyName.textContent = name;
  lobbyAvatar.textContent = initials(name);
  lobbyAvatar.style.setProperty("--avatar-bg", initialsColor(name));
  lobbyCode.textContent = formatCode(game.code);
  lobbyCount.textContent = `${arNum(game.playerCount)} من ${arNum(game.maxPlayers)}`;
  renderPlayerChips(game.players, lobbyPlayers, name);
  capacityDots.innerHTML = Array.from({ length: game.maxPlayers }, (_, index) => {
    return `<span class="${index < game.playerCount ? "filled" : ""}"></span>`;
  }).join("");
  lobbyHint.textContent =
    game.playerCount < 2
      ? "بانتظار لاعب آخر على الأقل حتى يتمكن المشرف من بدء الجولة."
      : "اللاعبون جاهزون، بانتظار أن يبدأ المشرف الجولة.";
}

function renderReady(game) {
  stopTimer();
  showView("ready");
  if (!readyPlayers) return;
  readyPlayers.innerHTML = (game.players || [])
    .map((player) => `<span class="pill">${escapeHtml(player.name)}</span>`)
    .join("");
}

function syncAnswerButtons(game) {
  const buttons = Array.from(answerGrid.querySelectorAll(".answer-tile"));
  const answeredIndex = game.yourAnswer ? game.yourAnswer.optionIndex : -1;
  const selected = answeredIndex >= 0 ? answeredIndex : state.pending ? state.optimisticIndex : -1;
  const locked = Boolean(game.yourAnswer);
  const disabled = locked || game.paused || game.timeUp || state.pending;
  buttons.forEach((button) => {
    const index = Number(button.dataset.index);
    button.classList.toggle("is-selected", index === selected);
    button.disabled = disabled;
    const slot = button.querySelector(".answer-mark-slot");
    if (slot) slot.innerHTML = index === selected ? `<span class="answer-mark">✓</span>` : "";
  });
}

function updateQuestionState(game) {
  if (!questionState) return;
  let text = "";
  let kind = "";
  let iconName = "info";
  if (game.paused && game.mode === "question" && !game.timeUp) {
    text = "أوقف المشرف المؤقت مؤقتًا. انتظر استئناف السؤال.";
    kind = "state-warn";
    iconName = "pause";
  } else if (game.yourAnswer) {
    text = `تم قفل إجابتك (${game.yourAnswer.optionLabel}) — ستُعلن النتيجة بعد عرض المشرف.`;
    kind = "state-lock";
    iconName = "check";
  } else if (game.timeUp) {
    text = "انتهى وقت السؤال — انتظر إعلان النتيجة من المشرف.";
    kind = "state-end";
    iconName = "clock";
  } else if (state.pending) {
    text = "جارٍ تسجيل إجابتك...";
    kind = "state-lock";
    iconName = "clock";
  }
  if (!text) {
    questionState.hidden = true;
    questionState.innerHTML = "";
    return;
  }
  questionState.hidden = false;
  questionState.className = `question-state ${kind}`;
  questionState.innerHTML = `${icon(iconName)}<span>${escapeHtml(text)}</span>`;
}

function renderQuestion(game) {
  showView("question");
  const key = `${game.currentIndex}:${game.question?.text || ""}`;
  const newQuestion = state.questionKey !== key;
  if (newQuestion) {
    state.questionKey = key;
    state.pending = false;
    state.optimisticIndex = -1;
    state.lastPaused = null;
    state.lastTimeUp = null;
  }
  qCounter.textContent = `السؤال ${arNum(game.questionNumber)} من ${arNum(game.totalQuestions)}`;
  qCategory.textContent = game.question?.category || "عام";
  qText.textContent = game.question?.text || "—";

  if (newQuestion) {
    answerGrid.innerHTML = (game.question?.options || [])
      .map(
        (option, index) =>
          `<button class="answer-tile" type="button" data-index="${index}">
            <span class="answer-letter">${letterFor(index)}</span>
            <span class="answer-text">${escapeHtml(option)}</span>
            <span class="answer-mark-slot"></span>
          </button>`,
      )
      .join("");
  }

  const timerNeedsSync =
    newQuestion || state.lastPaused !== game.paused || state.lastTimeUp !== game.timeUp;
  if (timerNeedsSync) {
    timer.sync({
      remainingMs: game.remainingMs,
      durationMs: game.durationMs,
      paused: game.paused,
      timeUp: game.timeUp,
    });
    state.lastPaused = game.paused;
    state.lastTimeUp = game.timeUp;
  }

  qStatus.textContent = game.paused
    ? "المؤقت متوقف مؤقتًا"
    : game.timeUp
      ? "انتهى وقت السؤال"
      : "اختر الإجابة قبل انتهاء الوقت";

  syncAnswerButtons(game);
  updateQuestionState(game);
  answeredCount.textContent = `أجاب ${arNum(game.answerCount)} من ${arNum(game.playerCount)}`;
  playersCount.textContent = playerWord(game.playerCount);
}

function renderMiniLeaderboard(game) {
  if (!miniLeaderboard) return;
  const rows = (game.leaderboard || []).slice(0, 3);
  if (rows.length === 0) {
    miniLeaderboard.innerHTML = '<p class="text-xs muted">لا توجد نتائج بعد.</p>';
    return;
  }
  miniLeaderboard.innerHTML = rows
    .map(
      (row) => `<div class="mini-row ${row.playerId === game.you?.id ? "is-you" : ""} ${row.rank === 1 ? "is-first" : ""}">
        <span class="mini-rank">${arNum(row.rank)}</span>
        ${avatarHtml(row.name)}
        <span class="mini-name">${escapeHtml(row.name)}${row.playerId === game.you?.id ? " (أنت)" : ""}</span>
        <span class="mini-points">${arNum(row.total)}</span>
      </div>`,
    )
    .join("");
}

function renderResult(game) {
  stopTimer();
  showView("result");
  const result = game.yourResult;
  const answered = Boolean(result?.answered);
  const correct = Boolean(result?.correct);
  resultCard.className = `result-hero card ${correct ? "is-correct" : answered ? "is-wrong" : "is-none"}`;
  resultIcon.innerHTML = icon(correct ? "check" : answered ? "x" : "clock");

  if (correct) {
    resultTitle.textContent = "إجابة صحيحة!";
    resultPoints.textContent = `+${arNum(result.points)}`;
    const speed =
      result.speedRank === 1
        ? "أسرع إجابة صحيحة"
        : `ترتيب السرعة: ${rankLabel(result.speedRank)}`;
    resultSub.textContent = `أجبت خلال ${formatSeconds(result.elapsedMs)} • ${speed}`;
  } else if (answered) {
    resultTitle.textContent = "إجابة غير صحيحة";
    resultPoints.textContent = "٠";
    resultSub.textContent = `اخترت «${result.optionLabel}» — الإجابة الصحيحة «${letterFor(game.correctIndex)}».`;
  } else {
    resultTitle.textContent = "لم تُجب على السؤال";
    resultPoints.textContent = "٠";
    resultSub.textContent = "انتهى وقت السؤال قبل أن تسجّل إجابتك.";
  }

  correctLetter.textContent = letterFor(game.correctIndex);
  correctText.textContent = game.question?.options?.[game.correctIndex] || "—";
  if (game.explanation) {
    explanation.hidden = false;
    explanation.textContent = game.explanation;
  } else {
    explanation.hidden = true;
    explanation.textContent = "";
  }

  totalPoints.textContent = arNum(game.you?.total || 0);
  totalRank.textContent = rankLabel(game.you?.rank || game.playerCount);
  correctCount.textContent = arNum(game.you?.correctCount || 0);
  miniAfter.textContent = `بعد السؤال ${arNum(game.questionNumber)}`;
  renderMiniLeaderboard(game);

  const revealKey = `${game.currentIndex}:${correct ? "correct" : answered ? "wrong" : "none"}`;
  if (state.lastRevealKey !== revealKey) {
    state.lastRevealKey = revealKey;
    if (correct) vibrate([25, 55, 25]);
    else if (answered) vibrate(90);
  }
}

function standingsRow(row, game) {
  const isYou = row.playerId === game.you?.id;
  return `<li class="standing-row ${isYou ? "is-you" : ""}">
    <span class="standing-rank">${arNum(row.rank)}</span>
    ${avatarHtml(row.name)}
    <span class="standing-name">${escapeHtml(row.name)}${isYou ? " (أنت)" : ""}</span>
    <span class="standing-correct">${arNum(row.correctCount)} صحيحة</span>
    <span class="standing-points">${arNum(row.total)}</span>
  </li>`;
}

function renderPodium(game, container) {
  if (!container) return;
  const rows = (game.leaderboard || []).slice(0, 3);
  container.style.gridTemplateColumns = `repeat(${Math.max(1, rows.length)}, 1fr)`;
  container.innerHTML = rows
    .map(
      (row) => `<div class="podium-card ${row.rank === 1 ? "is-first" : ""}">
        <span class="podium-rank">${arNum(row.rank)}</span>
        ${avatarHtml(row.name)}
        <span class="podium-name">${escapeHtml(row.name)}</span>
        <span class="podium-points">${arNum(row.total)}</span>
      </div>`,
    )
    .join("");
}

function renderLeaderboard(game) {
  stopTimer();
  showView("leaderboard");
  boardSub.textContent = `بعد السؤال ${arNum(game.questionNumber)} من ${arNum(game.totalQuestions)}`;
  renderPodium(game, leaderboardPodium);
  leaderboardList.innerHTML = (game.leaderboard || []).map((row) => standingsRow(row, game)).join("");
}

function renderFinal(game) {
  stopTimer();
  showView("final");
  const winner = game.winner;
  const you = game.you || {};
  finalEyebrow.textContent = winner?.youWon ? "أنت الفائز بالجولة" : "الفائز بالجولة";
  finalWinner.textContent = winner?.name || "—";
  finalScore.textContent = winner ? `${arNum(winner.total)} نقطة` : "";
  finalSub.textContent = winner?.youWon
    ? "تجاوزت بقية اللاعبين بالسرعة والدقة. أحسنت!"
    : "شكرًا لمشاركتك، وأعد المحاولة في الجولة القادمة.";
  finalAvatar.textContent = initials(you.name || "");
  finalAvatar.style.setProperty("--avatar-bg", initialsColor(you.name || ""));
  finalYouName.textContent = you.name || "—";
  finalRank.textContent = rankLabel(you.rank || 0);
  finalPoints.textContent = arNum(you.total || 0);
  finalCorrect.textContent = arNum(you.correctCount || 0);
  finalList.innerHTML = (game.leaderboard || []).map((row) => standingsRow(row, game)).join("");
}

function openSocket() {
  state.socket = createSocket();

  state.socket.on("connect", () => {
    updateConnUI(true);
    if (state.autoResume) {
      tryAutoResume();
    } else if (state.joined) {
      resumeAfterReconnect();
    }
  });

  state.socket.on("disconnect", () => {
    updateConnUI(false);
  });

  state.socket.on("connect_error", () => {
    updateConnUI(false);
    connBanner.hidden = state.closed;
    connBannerText.textContent = "تعذر الاتصال بالخادم... جارٍ إعادة المحاولة";
  });

  state.socket.on("player:state", (game) => {
    if (!game) return;
    renderState(game);
  });

  state.socket.on("player:closed", (payload = {}) => {
    const reason = payload.reason || "";
    if (reason !== "replaced") {
      state.token = "";
      if (state.code) clearIdentity(state.code);
    }
    showClosed(payload.message || "انتهت الجولة.", reason);
  });

  state.socket.on("timer:tick", (tick) => {
    if (!state.game || state.game.mode !== "question" || !tick) return;
    if (tick.timeUp && !state.game.timeUp) {
      state.game.timeUp = true;
      state.lastTimeUp = true;
      updateQuestionState(state.game);
      qStatus.textContent = "انتهى وقت السؤال";
      syncAnswerButtons(state.game);
    }
  });
}

joinForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.joinBusy) return;
  joinError.hidden = true;
  const code = codeInput.value.replace(/\D/g, "");
  const name = nameInput.value.trim();
  if (code.length !== 6) {
    showJoinError("رمز اللعبة يجب أن يتكون من ٦ أرقام.");
    codeInput.focus();
    return;
  }
  if (name.length < 1) {
    showJoinError("اكتب اسمك للانضمام.");
    nameInput.focus();
    return;
  }
  if (!state.connected) {
    showJoinError("لا يوجد اتصال بالخادم. انتظر لحظة ثم حاول مرة أخرى.");
    return;
  }
  state.joinBusy = true;
  setBusy(joinSubmit, true, "جارٍ الدخول...");
  state.code = code;
  state.name = name;
  updateTopCode(code);
  try {
    const response = await requestJoin({ code, name, token: state.token });
    if (!response.ok) {
      showJoinError(response.error || "تعذر الانضمام.");
      if (response.code === "bad_code" || response.code === "game_finished") {
        state.token = "";
        clearIdentity(code);
      }
    }
  } catch (error) {
    showJoinError("تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.");
  } finally {
    state.joinBusy = false;
    setBusy(joinSubmit, false);
    updateConnUI(state.connected);
  }
});

codeInput?.addEventListener("input", () => {
  const digits = codeInput.value.replace(/\D/g, "").slice(0, 6);
  if (codeInput.value !== digits) codeInput.value = digits;
});

nameInput?.addEventListener("input", () => {
  if (!joinError.hidden) joinError.hidden = true;
});

codeInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    nameInput.focus();
  }
});

nameInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    joinForm.requestSubmit();
  }
});

answerGrid?.addEventListener("click", async (event) => {
  const button = event.target.closest(".answer-tile");
  if (!button) return;
  const game = state.game;
  if (
    !game ||
    game.mode !== "question" ||
    game.paused ||
    game.timeUp ||
    game.yourAnswer ||
    state.pending
  ) {
    return;
  }
  const optionIndex = Number(button.dataset.index);
  if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 3) return;
  state.pending = true;
  state.optimisticIndex = optionIndex;
  syncAnswerButtons(game);
  updateQuestionState(game);
  vibrate(18);
  try {
    const response = await emitWithTimeout("player:answer", { optionIndex }, 9000);
    if (!response?.ok) {
      state.pending = false;
      state.optimisticIndex = -1;
      toast(response?.error || "تعذر تسجيل الإجابة.", "error");
      if (state.game) renderQuestion(state.game);
      state.socket.emit("player:sync", {}, () => {});
      return;
    }
    state.pending = false;
    if (state.game?.yourAnswer) {
      state.optimisticIndex = -1;
      syncAnswerButtons(state.game);
      updateQuestionState(state.game);
    } else {
      state.socket.emit("player:sync", {}, (error, result) => {
        if (!error && result?.state) renderState(result.state);
      });
    }
  } catch (error) {
    state.pending = false;
    state.optimisticIndex = -1;
    toast("تعذر إرسال الإجابة. تحقق من الاتصال.", "error");
    if (state.game) renderQuestion(state.game);
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.joined && state.socket?.connected) {
    state.socket.emit("player:sync", {}, (error, result) => {
      if (!error && result?.state) renderState(result.state);
    });
  }
});

// ------------------------------------------------------------ boot

const params = new URLSearchParams(window.location.search);
const queryCode = (params.get("code") || "").replace(/\D/g, "").slice(0, 6);
state.code = queryCode;
state.name = savedName();
if (queryCode) {
  codeInput.value = queryCode;
  updateTopCode(queryCode);
}
if (state.name) nameInput.value = state.name;

const identity = queryCode ? loadIdentity(queryCode) : null;
if (identity?.token) {
  state.token = identity.token;
  state.name = identity.name || state.name;
  state.autoResume = true;
  showLoading("جارٍ استئناف جلستك...");
} else if (queryCode) {
  showJoin();
} else {
  showJoin();
}

updateConnUI(false);
openSocket();

if (!queryCode) {
  setTimeout(() => codeInput.focus({ preventScroll: true }), 100);
}
