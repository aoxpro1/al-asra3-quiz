import {
  $,
  api,
  arNum,
  avatarHtml,
  createSocket,
  escapeHtml,
  formatSeconds,
  letterFor,
  playerWord,
  rankLabel,
  TimerRing,
} from "./common.js";
import { celebrate } from "./confetti.js";

/* ------------------------------------------------------------------ views */

const views = {
  loading: $("#view-loading"),
  welcome: $("#view-welcome"),
  lobby: $("#view-lobby"),
  ready: $("#view-ready"),
  stage: $("#view-stage"),
  leaderboard: $("#view-leaderboard"),
  podium: $("#view-podium"),
};

const screenPhase = $("#screen-phase");
const screenProgress = $("#screen-progress");
const footerMeta = $("#footer-meta");

const connPill = $("#display-conn");
const connDot = $("#display-conn-dot");
const connLabel = $("#display-conn-label");
const disconnected = $("#display-disconnected");

const fullscreenBtn = $("#fullscreen-btn");
const fsEnter = fullscreenBtn?.querySelector(".fs-enter");
const fsExit = fullscreenBtn?.querySelector(".fs-exit");

const lobbyCode = $("#lobby-code");
const lobbyUrl = $("#lobby-url");
const lobbyQr = $("#lobby-qr");
const lobbyQrFrame = $("#lobby-qr-frame");
const lobbyQrLoading = $("#lobby-qr-loading");
const lobbyQrFallback = $("#lobby-qr-fallback");
const lobbyLocalNote = $("#lobby-local-note");
const lobbyCount = $("#lobby-count");
const lobbyCapacity = $("#lobby-capacity");
const lobbyPlayers = $("#lobby-players");
const lobbyRosterNote = $("#lobby-roster-note");

const readyPlayers = $("#ready-players");

const stageCategory = $("#stage-category");
const stageQnum = $("#stage-qnum");
const stageTimer = $("#display-timer");
const stageResultBadge = $("#stage-result-badge");
const stageQuestion = $("#stage-question");
const stageStatus = $("#stage-status");
const stageOptions = $("#stage-options");
const stageReveal = $("#stage-reveal");
const revealLetter = $("#reveal-letter");
const revealText = $("#reveal-text");
const revealExplanation = $("#reveal-explanation");

const sideTitle = $("#stage-side-title");
const sideSub = $("#stage-side-sub");
const sideBadge = $("#stage-side-badge");
const sideBody = $("#stage-side-body");
const sideBoard = $("#stage-side-board");
const sideBoardSub = $("#side-board-sub");
const sideBoardList = $("#side-board-list");

const leaderboardSub = $("#leaderboard-sub");
const screenPodium = $("#screen-podium");
const leaderboardRest = $("#leaderboard-rest");

const podiumName = $("#podium-name");
const podiumScore = $("#podium-score");
const podiumStats = $("#podium-stats");
const podiumCode = $("#podium-code");
const podiumTable = $("#podium-table");

const timer = new TimerRing(stageTimer);

const state = {
  socket: null,
  connected: false,
  game: null,
  mode: "",
  questionKey: "",
  optionsKey: "",
  lastTimerKey: "",
  joinInfoCode: "",
  joinInfo: null,
  podiumCode: "",
  redirecting: false,
};

/* ------------------------------------------------------------------ utils */

function formatCode(code) {
  const value = String(code || "");
  if (value.length === 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  return value || "—";
}

function initialsAvatar(name) {
  return avatarHtml(name);
}

function showView(name) {
  for (const [key, element] of Object.entries(views)) {
    if (element) element.hidden = key !== name;
  }
}

function setConnection(online) {
  state.connected = Boolean(online);
  connPill?.classList.toggle("is-offline", !online);
  if (connDot) connDot.className = online ? "online-dot" : "offline-dot";
  if (connLabel) connLabel.textContent = online ? "متصل" : "غير متصل";
  if (disconnected) disconnected.hidden = Boolean(online);
}

function updateHeader(game, mode) {
  if (!screenPhase) return;

  if (!game) {
    screenPhase.textContent = "شاشة العرض";
    if (screenProgress) screenProgress.hidden = true;
    if (footerMeta) footerMeta.textContent = "لعبة صفّية تفاعلية";
    return;
  }

  const labels = {
    welcome: "شاشة العرض",
    lobby: "غرفة الانتظار",
    ready: "الاستعداد",
    question: `السؤال ${arNum(game.questionNumber)}`,
    revealed: "النتيجة",
    leaderboard: "المتصدرون",
    podium: "الختام",
  };
  screenPhase.textContent = labels[mode] || "شاشة العرض";

  const showProgress =
    ["question", "revealed", "leaderboard"].includes(mode) &&
    Number(game.totalQuestions) > 0;
  if (screenProgress) {
    screenProgress.hidden = !showProgress;
    if (showProgress) {
      screenProgress.textContent = `${arNum(Math.max(0, game.questionNumber))} من ${arNum(
        game.totalQuestions,
      )}`;
    }
  }

  if (footerMeta) {
    footerMeta.textContent = game.code
      ? `الغرفة ${formatCode(game.code)} • ${playerWord(game.playerCount || 0)}`
      : "لعبة صفّية تفاعلية";
  }
}

function stopStageTimer() {
  timer.destroy();
  state.lastTimerKey = "";
}

function setStageStatus(text, kind = "") {
  if (!stageStatus) return;
  stageStatus.className = `stage-status${kind ? ` ${kind}` : ""}`;
  stageStatus.textContent = text;
}

/* ------------------------------------------------------------------ welcome */

function renderWelcome() {
  stopStageTimer();
  showView("welcome");
}

/* ------------------------------------------------------------------ lobby */

async function loadJoinInfo(code) {
  state.joinInfoCode = code;
  state.joinInfo = null;

  if (lobbyUrl) lobbyUrl.textContent = "جارٍ تجهيز رابط الانضمام...";
  if (lobbyLocalNote) lobbyLocalNote.hidden = true;

  if (lobbyQr) {
    if (lobbyQrLoading) lobbyQrLoading.hidden = false;
    if (lobbyQrFallback) lobbyQrFallback.hidden = true;
    lobbyQr.hidden = false;
    lobbyQr.src = `/api/admin/qr.svg?game=${encodeURIComponent(code)}`;
  }

  try {
    const info = await api("/api/admin/join-info");
    if (info?.ok) {
      state.joinInfo = info;
      if (lobbyUrl) lobbyUrl.textContent = info.url || "—";
      if (lobbyLocalNote) {
        lobbyLocalNote.hidden = !info.local;
        if (info.local) {
          lobbyLocalNote.textContent =
            "رابط الانضمام محلي. افتح اللوحة عبر عنوان الشبكة أو نطاق Replit حتى يعمل رمز QR من الجوال.";
        }
      }
    }
  } catch (error) {
    if (error?.status !== 401 && lobbyUrl) {
      lobbyUrl.textContent = "تعذر تجهيز الرابط — استخدم رمز اللعبة.";
    }
  }
}

function renderLobby(game) {
  stopStageTimer();
  showView("lobby");

  if (lobbyCode) lobbyCode.textContent = formatCode(game.code);
  if (state.joinInfoCode !== game.code) loadJoinInfo(game.code);

  const players = game.players || [];
  const count = Number(game.playerCount) || players.length;
  const max = Number(game.maxPlayers) || players.length;

  if (lobbyCount) lobbyCount.textContent = `${arNum(count)} من ${arNum(max)}`;

  if (lobbyCapacity) {
    lobbyCapacity.innerHTML = Array.from({ length: Math.max(0, max) }, (_, index) => {
      return `<span class="${index < count ? "filled" : ""}"></span>`;
    }).join("");
  }

  if (lobbyPlayers) {
    if (players.length === 0) {
      lobbyPlayers.innerHTML = '<div class="roster-empty">لم ينضم أحد بعد — امسح الرمز للبدء</div>';
    } else {
      lobbyPlayers.innerHTML = players
        .map(
          (player) => `<div class="roster-player">
            ${initialsAvatar(player.name)}
            <span class="roster-player-name">${escapeHtml(player.name)}</span>
            <span class="${player.online ? "online-dot" : "offline-dot"}"></span>
          </div>`,
        )
        .join("");
    }
  }

  if (lobbyRosterNote) {
    let note = "بانتظار انضمام اللاعبين...";
    let ready = false;
    if (count === 1) {
      note = "يلزم لاعب آخر على الأقل حتى يتمكن المشرف من بدء الجولة.";
    } else if (count >= 2 && count < max) {
      note = "اللاعبون جاهزون — يمكن للمشرف بدء الجولة في أي لحظة.";
      ready = true;
    } else if (count >= 2 && count >= max) {
      note = "اكتمل عدد اللاعبين. يمكن للمشرف بدء الجولة.";
      ready = true;
    }
    lobbyRosterNote.textContent = note;
    lobbyRosterNote.classList.toggle("is-ready", ready);
  }
}

/* ------------------------------------------------------------------ ready */

function renderReady(game) {
  stopStageTimer();
  showView("ready");

  if (readyPlayers) {
    const players = game.players || [];
    if (players.length === 0) {
      readyPlayers.innerHTML = '<span class="pill">بانتظار اللاعبين...</span>';
    } else {
      readyPlayers.innerHTML = players
        .map((player) => `<span class="pill">${escapeHtml(player.name)}</span>`)
        .join("");
    }
  }
}

/* ------------------------------------------------------------------ stage */

function renderOptions(game, revealed) {
  if (!stageOptions) return;
  const options = game.question?.options || [];
  const counts = [0, 0, 0, 0];
  for (const row of game.results || []) {
    if (row.answered && Number.isInteger(row.optionIndex) && counts[row.optionIndex] != null) {
      counts[row.optionIndex] += 1;
    }
  }

  stageOptions.innerHTML = options
    .map((option, index) => {
      const isCorrect = revealed && index === game.correctIndex;
      const isDim = revealed && index !== game.correctIndex;
      return `<div class="answer-tile${isCorrect ? " is-correct" : ""}${
        isDim ? " is-dim" : ""
      }" data-index="${index}">
        <span class="answer-letter">${letterFor(index)}</span>
        <span class="answer-text">${escapeHtml(option)}</span>
        ${
          revealed && counts[index] > 0
            ? `<span class="option-count">${arNum(counts[index])}</span>`
            : ""
        }
      </div>`;
    })
    .join("");
}

function renderStageSideQuestion(game) {
  if (!sideTitle) return;
  const players = game.players || [];
  const answered = new Set(game.answeredNames || []);
  const count = Number(game.answerCount) || 0;
  const total = Number(game.playerCount) || players.length;
  const percent = total > 0 ? Math.min(100, (count / total) * 100) : 0;

  sideTitle.textContent = "من أجاب؟";
  sideSub.textContent = "تظهر الأسماء لحظة وصول الإجابة";
  sideBadge.textContent = `${arNum(count)} من ${arNum(total)}`;

  const roster = players
    .map((player) => {
      const hasAnswered = answered.has(player.name);
      let status;
      if (hasAnswered) {
        status = '<span class="side-check">✓</span><span>أجاب</span>';
      } else if (player.online) {
        status = '<span class="side-wait"><span></span><span></span><span></span></span><span>ينتظر</span>';
      } else {
        status = "غير متصل";
      }
      return `<div class="side-player${hasAnswered ? " is-answered" : ""}">
        ${initialsAvatar(player.name)}
        <span class="side-player-name">${escapeHtml(player.name)}</span>
        <span class="side-player-status">${status}</span>
      </div>`;
    })
    .join("");

  sideBody.innerHTML = `<div class="side-answer-progress">
      <span class="side-answer-big">${arNum(count)}</span>
      <div class="side-answer-copy">أجابوا من أصل <strong>${arNum(total)}</strong><br />بانتظار البقية</div>
    </div>
    <div class="answer-progress-track"><div class="answer-progress-fill" style="width:${percent}%"></div></div>
    <div class="side-roster">${
      roster || '<div class="side-empty">لم ينضم أي لاعب بعد.</div>'
    }</div>`;

  const rows = (game.leaderboard || []).slice(0, 3);
  const showBoard = rows.some((row) => Number(row.total) > 0);
  if (sideBoard) sideBoard.hidden = !showBoard;
  if (showBoard && sideBoardList) {
    if (sideBoardSub) sideBoardSub.textContent = "قبل السؤال الحالي";
    sideBoardList.innerHTML = rows
      .map(
        (row) => `<div class="side-board-row${row.rank === 1 ? " is-first" : ""}">
          <span class="side-board-rank">${arNum(row.rank)}</span>
          <span class="side-board-name">${escapeHtml(row.name)}</span>
          <span class="side-board-points">${arNum(row.total)}</span>
        </div>`,
      )
      .join("");
  }
}

function renderStageSideRevealed(game) {
  if (!sideTitle) return;
  const results = game.results || [];
  const correctCount = results.filter((row) => row.correct).length;

  sideTitle.textContent = "نتيجة السؤال";
  sideSub.textContent = "الإجابات مرتبة حسب سرعة الوصول";
  sideBadge.textContent = `${arNum(correctCount)} صحيحة`;

  sideBody.innerHTML = `<div class="side-results">${
    results
      .map((row) => {
        let kind = "is-none";
        let icon = "—";
        let sub = "لم يجب على السؤال";
        if (row.answered) {
          if (row.correct) {
            kind = "is-correct";
            icon = "✓";
            sub =
              row.speedRank === 1
                ? `أسرع إجابة صحيحة • ${formatSeconds(row.elapsedMs)}`
                : `${rankLabel(row.speedRank)} في السرعة • ${formatSeconds(row.elapsedMs)}`;
          } else {
            kind = "is-wrong";
            icon = "✕";
            sub = `اختار «${escapeHtml(row.optionLabel || "—")}» • ${formatSeconds(row.elapsedMs)}`;
          }
        }
        return `<div class="side-result ${kind}">
          <span class="side-result-icon">${icon}</span>
          ${initialsAvatar(row.name)}
          <div class="side-result-main">
            <div class="side-result-name">${escapeHtml(row.name)}</div>
            <div class="side-result-sub">${sub}</div>
          </div>
          <span class="side-result-points">${row.correct ? `+${arNum(row.points)}` : "٠"}</span>
        </div>`;
      })
      .join("") || '<div class="side-empty">لا توجد نتائج لهذا السؤال.</div>'
  }</div>`;

  if (sideBoard) sideBoard.hidden = true;
}

function renderStage(game, mode) {
  const revealed = mode === "revealed";
  showView("stage");

  const question = game.question;
  const key = `${game.currentIndex}:${question?.text || ""}`;
  const newQuestion = state.questionKey !== key;
  if (newQuestion) {
    state.questionKey = key;
    state.optionsKey = "";
    state.lastTimerKey = "";
  }

  if (stageCategory) stageCategory.textContent = question?.category || "عام";
  if (stageQnum) {
    stageQnum.textContent = `السؤال ${arNum(Math.max(1, game.questionNumber))} من ${arNum(
      game.totalQuestions,
    )}`;
  }

  if (stageQuestion) {
    const text = question?.text || "—";
    stageQuestion.textContent = text;
    stageQuestion.className = `stage-question${text.length > 150 ? " is-very-long" : text.length > 90 ? " is-long" : ""}`;
  }

  const optionsKey = `${key}:${revealed}`;
  if (state.optionsKey !== optionsKey) {
    state.optionsKey = optionsKey;
    renderOptions(game, revealed);
  }

  if (stageReveal) {
    stageReveal.hidden = !revealed;
    if (revealed) {
      if (revealLetter) revealLetter.textContent = letterFor(game.correctIndex);
      if (revealText) revealText.textContent = question?.options?.[game.correctIndex] || "—";
      if (revealExplanation) {
        const explanation = game.explanation || "";
        revealExplanation.hidden = !explanation;
        revealExplanation.textContent = explanation;
      }
    }
  }

  if (stageResultBadge) stageResultBadge.hidden = !revealed;

  if (revealed) {
    stopStageTimer();
    if (stageTimer) stageTimer.hidden = true;
    setStageStatus("ظهرت النتيجة — الإجابة الصحيحة مضاءة");
  } else {
    if (stageTimer) stageTimer.hidden = false;
    const timerKey = `${key}:${game.paused}:${game.timeUp}`;
    if (state.lastTimerKey !== timerKey) {
      state.lastTimerKey = timerKey;
      timer.sync({
        remainingMs: game.remainingMs,
        durationMs: game.durationMs,
        paused: game.paused,
        timeUp: game.timeUp,
      });
    }
    if (game.paused && !game.timeUp) {
      setStageStatus("المؤقت متوقف مؤقتًا — انتظر استئناف المشرف", "is-paused");
    } else if (game.timeUp) {
      setStageStatus("انتهى وقت السؤال — بانتظار إعلان النتيجة", "is-ended");
    } else {
      setStageStatus("اختر الإجابة الأسرع");
    }
  }

  if (revealed) renderStageSideRevealed(game);
  else renderStageSideQuestion(game);
}

/* ------------------------------------------------------------------ board */

function renderLeaderboard(game) {
  stopStageTimer();
  showView("leaderboard");

  if (leaderboardSub) {
    leaderboardSub.textContent = `بعد السؤال ${arNum(
      Math.max(0, game.questionNumber),
    )} من ${arNum(game.totalQuestions)}`;
  }

  const rows = game.leaderboard || [];
  const top = rows.slice(0, 3);

  if (screenPodium) {
    screenPodium.innerHTML = top
      .map(
        (row) => `<div class="screen-podium-card rank-${row.rank}">
          <span class="podium-rank-chip">${arNum(row.rank)}</span>
          ${initialsAvatar(row.name)}
          <span class="podium-card-name">${escapeHtml(row.name)}</span>
          <span class="podium-card-points">${arNum(row.total)}</span>
          <span class="podium-card-correct">${arNum(row.correctCount)} إجابة صحيحة</span>
        </div>`,
      )
      .join("");
  }

  if (leaderboardRest) {
    leaderboardRest.innerHTML = rows
      .slice(3)
      .map(
        (row) => `<div class="leaderboard-rest-row">
          <span class="leaderboard-rest-rank">${arNum(row.rank)}</span>
          ${initialsAvatar(row.name)}
          <span class="leaderboard-rest-name">${escapeHtml(row.name)}</span>
          <span class="leaderboard-rest-points">${arNum(row.total)}</span>
        </div>`,
      )
      .join("");
  }
}

/* ------------------------------------------------------------------ podium */

function renderPodium(game) {
  stopStageTimer();
  showView("podium");

  const winner = game.winner;
  const rows = game.leaderboard || [];

  if (podiumName) podiumName.textContent = winner?.name || rows[0]?.name || "—";
  if (podiumScore) {
    const total = winner?.total ?? rows[0]?.total ?? 0;
    podiumScore.textContent = `${arNum(total)} نقطة`;
  }
  if (podiumStats) {
    const correct = winner?.correctCount ?? rows[0]?.correctCount ?? 0;
    const answered = winner?.answersCount ?? rows[0]?.answersCount ?? 0;
    podiumStats.textContent = `${arNum(correct)} إجابة صحيحة من ${arNum(
      game.totalQuestions,
    )} • ${arNum(answered)} إجابة مسجّلة`;
  }
  if (podiumCode) podiumCode.textContent = formatCode(game.code);

  if (podiumTable) {
    podiumTable.innerHTML = rows
      .map(
        (row, index) => `<div class="podium-row${index === 0 ? " is-winner" : ""}">
          <span class="podium-row-rank">${arNum(row.rank)}</span>
          ${initialsAvatar(row.name)}
          <span class="podium-row-name">${escapeHtml(row.name)}</span>
          <span class="podium-row-correct">${arNum(row.correctCount)} صحيحة</span>
          <span class="podium-row-points">${arNum(row.total)}</span>
        </div>`,
      )
      .join("");
  }

  if (state.podiumCode !== game.code) {
    state.podiumCode = game.code;
    window.setTimeout(() => celebrate({ duration: 6800 }), 380);
  }
}

/* ------------------------------------------------------------------ state */

function renderState(game) {
  if (!game) return;
  state.game = game;
  const mode = game.mode || "welcome";
  const modeChanged = state.mode !== mode;
  state.mode = mode;

  updateHeader(game, mode);

  switch (mode) {
    case "lobby":
      renderLobby(game);
      break;
    case "ready":
      renderReady(game);
      break;
    case "question":
    case "revealed":
      renderStage(game, mode);
      break;
    case "leaderboard":
      renderLeaderboard(game);
      break;
    case "podium":
      renderPodium(game);
      break;
    default:
      stopStageTimer();
      renderWelcome();
      break;
  }

  if (modeChanged && ["welcome", "lobby"].includes(mode)) {
    state.questionKey = "";
    state.optionsKey = "";
    state.podiumCode = "";
  }
}

/* ------------------------------------------------------------------ socket */

function openSocket() {
  state.socket = createSocket();

  state.socket.on("connect", () => {
    setConnection(true);
    state.redirecting = false;
    state.socket.timeout(9000).emit("display:hello", {}, (error, response) => {
      if (error) return;
      if (response && response.ok === false) {
        const reason = String(response.error || "");
        if (reason === "unauthorized" || reason === "expired") {
          if (state.redirecting) return;
          state.redirecting = true;
          window.location.replace(`/login?next=${encodeURIComponent("/display")}`);
        }
      }
    });
  });

  state.socket.on("disconnect", () => setConnection(false));

  state.socket.on("connect_error", () => setConnection(false));

  state.socket.on("display:state", (game) => {
    if (!game) return;
    setConnection(true);
    renderState(game);
  });

  state.socket.on("timer:tick", (tick) => {
    const game = state.game;
    if (!tick || !game || state.mode !== "question") return;
    if (tick.phase && tick.phase !== "question") return;

    if (tick.timeUp && !game.timeUp) {
      game.timeUp = true;
      state.lastTimerKey = "";
      timer.sync({
        remainingMs: 0,
        durationMs: game.durationMs,
        paused: false,
        timeUp: true,
      });
      setStageStatus("انتهى وقت السؤال — بانتظار إعلان النتيجة", "is-ended");
    }
  });
}

/* ------------------------------------------------------------------ chrome */

let idleTimer = null;

function resetIdle() {
  document.body.classList.remove("is-idle");
  if (idleTimer) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!document.hidden) document.body.classList.add("is-idle");
  }, 3200);
}

function setupIdle() {
  ["mousemove", "mousedown", "touchstart", "keydown", "wheel"].forEach((event) => {
    window.addEventListener(event, resetIdle, { passive: true });
  });
  resetIdle();
}

function syncFullscreenUI() {
  const active = Boolean(document.fullscreenElement);
  if (fsEnter) fsEnter.hidden = active;
  if (fsExit) fsExit.hidden = !active;
  if (fullscreenBtn) {
    fullscreenBtn.setAttribute("aria-pressed", active ? "true" : "false");
    fullscreenBtn.title = active ? "إنهاء ملء الشاشة" : "ملء الشاشة";
    fullscreenBtn.setAttribute("aria-label", active ? "إنهاء ملء الشاشة" : "ملء الشاشة");
  }
}

function setupFullscreen() {
  if (!fullscreenBtn) return;
  if (!document.documentElement.requestFullscreen) {
    fullscreenBtn.hidden = true;
    return;
  }
  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (_) {
      /* the browser may refuse without a direct gesture */
    }
  });
  document.addEventListener("fullscreenchange", syncFullscreenUI);
  syncFullscreenUI();
}

function setupQr() {
  if (lobbyQr) {
    lobbyQr.addEventListener("load", () => {
      if (lobbyQrLoading) lobbyQrLoading.hidden = true;
      if (lobbyQrFallback) lobbyQrFallback.hidden = true;
      lobbyQr.hidden = false;
    });
    lobbyQr.addEventListener("error", () => {
      if (lobbyQrLoading) lobbyQrLoading.hidden = true;
      if (lobbyQrFallback) lobbyQrFallback.hidden = false;
      lobbyQr.hidden = true;
    });
  }
  if (lobbyQrFrame) {
    lobbyQrFrame.addEventListener("click", () => {
      if (state.joinInfoCode && state.mode === "lobby") {
        loadJoinInfo(state.joinInfoCode);
      }
    });
  }
}

/* ------------------------------------------------------------------ boot */

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    document.body.classList.remove("is-idle");
    return;
  }
  resetIdle();
  if (state.socket?.connected) {
    state.socket.timeout(7000).emit("display:sync", {}, () => {});
  }
});

showView("loading");
setConnection(false);
setupQr();
setupFullscreen();
setupIdle();
openSocket();
