import {
  $,
  $$,
  arNum,
  formatSeconds,
  formatDate,
  escapeHtml,
  avatarHtml,
  letterFor,
  rankLabel,
  playerWord,
  toast,
  confirmDialog,
  setBusy,
  createSocket,
  TimerRing,
  icon,
  copyText,
} from "./common.js";

/* ------------------------------------------------------------------ state */

const state = {
  socket: null,
  connected: false,
  socketReady: false,
  redirecting: false,
  questions: [],
  history: [],
  config: null,
  active: null,
  tab: "control",
  forceSetup: false,
  selectedIds: new Set(),
  maxPlayers: 6,
  shuffleQuestions: false,
  shuffleOptions: true,
  pickerSearch: "",
  bankSearch: "",
  editingId: null,
  modalTimer: 30,
  lastLiveKey: "",
  lastSideKey: "",
  lastAllAnsweredKey: "",
  joinInfo: null,
  joinInfoCode: "",
  joinInfoRequest: 0,
  qrCode: "",
};

const timer = new TimerRing($("#admin-timer"));
const timerWrap = $(".live-timer-wrap");

const ICON_UP =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
const ICON_DOWN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_EDIT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

/* ------------------------------------------------------------------ helpers */

function formatCode(code) {
  const value = String(code || "");
  if (value.length === 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  return value || "—";
}

function redirectToLogin() {
  if (state.redirecting) return;
  state.redirecting = true;
  window.location.replace("/login?next=/admin");
}

function updateConn(online) {
  state.connected = Boolean(online);
  const pill = $("#admin-conn");
  pill.classList.toggle("is-offline", !online);
  $("#admin-conn-dot").className = online ? "online-dot" : "offline-dot";
  $("#admin-conn-label").textContent = online ? "متصل" : "غير متصل";
}

function updateConnLabels() {
  updateConn(state.connected && state.socket?.connected);
}

function emitAck(event, payload = {}, timeoutMs = 9000) {
  return new Promise((resolve, reject) => {
    if (!state.socket || !state.socket.connected) {
      reject(new Error("لا يوجد اتصال بالخادم. تحقق من الشبكة."));
      return;
    }
    state.socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error("انتهت مهلة الطلب. حاول مرة أخرى."));
        return;
      }
      if (response && (response.error === "unauthorized" || response.error === "expired")) {
        redirectToLogin();
        reject(new Error("انتهت جلسة المشرف. أعد تسجيل الدخول."));
        return;
      }
      resolve(response || { ok: false, error: "تعذر تنفيذ الإجراء." });
    });
  });
}

function parseAck(response) {
  if (!response || response.ok === false) {
    throw new Error(response?.error || "تعذر تنفيذ الإجراء.");
  }
  return response;
}

async function runAction(button, event, payload = {}, successMessage = "") {
  if (button) button.disabled = true;
  try {
    const response = parseAck(await emitAck(event, payload));
    if (successMessage) toast(successMessage, "success");
    return response;
  } catch (error) {
    toast(error.message, "error");
    return null;
  } finally {
    if (button) button.disabled = false;
    if (state.tab === "control") renderControl();
  }
}

function normalizeForCompare(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[إأآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

/* ------------------------------------------------------------------ tabs */

function setTab(tab) {
  state.tab = tab;
  $$(".admin-tab-btn").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.tab === tab));
  });
  $("#tab-control").hidden = tab !== "control";
  $("#tab-questions").hidden = tab !== "questions";
  $("#tab-history").hidden = tab !== "history";
  if (tab === "control") renderControl();
  if (tab === "questions") renderBank();
  if (tab === "history") {
    renderHistory();
    loadHistory({ silent: true });
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$$(".admin-tab-btn").forEach((button) => {
  button.addEventListener("click", () => setTab(button.dataset.tab));
});

/* ------------------------------------------------------------------ boot */

async function loadBootstrap() {
  try {
    const data = await fetch("/api/admin/bootstrap", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (response.status === 401) {
        redirectToLogin();
        throw new Error("unauthorized");
      }
      const parsed = await response.json().catch(() => null);
      if (!response.ok) throw new Error(parsed?.error || "تعذر تحميل البيانات.");
      return parsed;
    });

    state.questions = Array.isArray(data.questions) ? data.questions : [];
    state.history = Array.isArray(data.history) ? data.history : [];
    state.config = data.config || {};
    state.active = data.activeGame || null;
    if (state.questions.length > 0) {
      state.selectedIds = new Set(state.questions.slice(0, 10).map((question) => question.id));
    }
    $("#admin-loading").hidden = true;
    $("#tab-control").hidden = false;
    renderAll();
    connectSocket();
  } catch (error) {
    if (error.message === "unauthorized") return;
    $("#admin-loading").innerHTML =
      '<div class="empty-state"><strong>تعذر تحميل لوحة التحكم</strong><p>تحقق من الاتصال ثم أعد تحميل الصفحة.</p></div>';
  }
}

/* ------------------------------------------------------------------ render */

function renderAll() {
  updateConnLabels();
  $("#bank-count-tab").textContent = arNum(state.questions.length);
  if (state.tab === "control") renderControl();
  if (state.tab === "questions") renderBank();
  if (state.tab === "history") renderHistory();
  renderSetupSummary();
}

function renderControl() {
  const active = state.active;
  const mode = active?.mode || "setup";

  if (state.forceSetup || !active || mode === "setup") {
    renderSetup();
    showControlView("setup");
    return;
  }
  if (mode === "lobby") {
    renderLobby();
    showControlView("lobby");
    return;
  }
  if (mode === "podium") {
    renderPodium();
    showControlView("podium");
    return;
  }
  renderLive();
  showControlView("live");
}

function showControlView(name) {
  $("#control-setup").hidden = name !== "setup";
  $("#control-lobby").hidden = name !== "lobby";
  $("#control-live").hidden = name !== "live";
  $("#control-podium").hidden = name !== "podium";
  if (name !== "live") {
    timer.destroy();
    timerWrap.hidden = true;
  }
}

/* ------------------------------------------------------------------ setup */

function selectedQuestions() {
  return state.questions.filter((question) => state.selectedIds.has(question.id));
}

function renderSetupSummary() {
  const selected = selectedQuestions();
  const durationSeconds =
    selected.reduce((total, question) => total + question.timer, 0) + selected.length * 12;
  const minutes = Math.max(0, Math.round(durationSeconds / 60));
  $("#setup-bank-total").textContent = arNum(state.questions.length);
  $("#setup-selected-total").textContent = arNum(selected.length);
  $("#summary-questions").textContent = arNum(selected.length);
  $("#summary-duration").textContent =
    selected.length === 0 ? "—" : minutes <= 1 ? "دقيقة تقريبًا" : `${arNum(minutes)} دقائق تقريبًا`;
  $("#picker-count-pill").textContent = `${arNum(selected.length)} مختار`;
  $("#picker-foot-note").textContent =
    selected.length === 0
      ? "اختر سؤالًا واحدًا على الأقل للبدء."
      : `${arNum(selected.length)} سؤالًا جاهزًا للجولة.`;
  const createButton = $("#create-game-btn");
  createButton.disabled = selected.length === 0;
  createButton.title = selected.length === 0 ? "اختر سؤالًا واحدًا على الأقل" : "";

  const count = Number(state.maxPlayers);
  $$("#player-count-options button").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.count) === count));
  });
  $("#shuffle-questions").checked = state.shuffleQuestions;
  $("#shuffle-options").checked = state.shuffleOptions;
}

function filteredQuestionsForPicker() {
  const query = state.pickerSearch.trim().toLocaleLowerCase("ar");
  if (!query) return state.questions.map((question, index) => ({ question, index }));
  return state.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      const haystack = [
        question.text,
        question.category,
        ...(question.options || []),
      ]
        .join(" ")
        .toLocaleLowerCase("ar");
      return haystack.includes(query);
    });
}

function renderPicker() {
  const container = $("#picker-list");
  const items = filteredQuestionsForPicker();
  if (items.length === 0) {
    container.innerHTML = `<div class="picker-empty">${
      state.questions.length === 0
        ? "بنك الأسئلة فارغ. أضف سؤالًا من تبويب «بنك الأسئلة»."
        : "لا توجد أسئلة مطابقة لبحثك."
    }</div>`;
    return;
  }
  container.innerHTML = items
    .map(({ question, index }) => {
      const selected = state.selectedIds.has(question.id);
      return `<label class="pick-row ${selected ? "is-selected" : ""}" data-id="${question.id}">
        <span class="checkbox"><input type="checkbox" ${selected ? "checked" : ""} /></span>
        <span class="pick-body">
          <span class="pick-text">${escapeHtml(question.text)}</span>
          <span class="pick-meta">
            ${question.category ? `<span class="badge badge-cyan">${escapeHtml(question.category)}</span>` : ""}
            <span>${arNum(question.timer)} ثانية</span>
            <span>•</span>
            <span>الإجابة: ${letterFor(question.correctIndex)}</span>
          </span>
        </span>
        <span class="pick-num">${arNum(index + 1)}</span>
      </label>`;
    })
    .join("");
}

function renderSetup() {
  if (!state.config) return;
  renderSetupSummary();
  renderPicker();
}

$("#picker-search").value = state.pickerSearch;
$("#picker-search").addEventListener("input", (event) => {
  state.pickerSearch = event.target.value;
  renderPicker();
});

$("#picker-list").addEventListener("change", (event) => {
  const checkbox = event.target.closest('input[type="checkbox"]');
  if (!checkbox) return;
  const row = checkbox.closest(".pick-row");
  const id = row?.dataset.id;
  if (!id) return;
  if (checkbox.checked) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  row.classList.toggle("is-selected", checkbox.checked);
  renderSetupSummary();
});

$("#pick-preset-10").addEventListener("click", () => {
  const source = filteredQuestionsForPicker();
  state.selectedIds = new Set(source.slice(0, 10).map(({ question }) => question.id));
  renderSetup();
});
$("#pick-all").addEventListener("click", () => {
  state.selectedIds = new Set(state.questions.map((question) => question.id));
  renderSetup();
});
$("#pick-clear").addEventListener("click", () => {
  state.selectedIds = new Set();
  renderSetup();
});
$("#picker-manage").addEventListener("click", () => setTab("questions"));

$("#player-count-options").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-count]");
  if (!button) return;
  state.maxPlayers = Number(button.dataset.count);
  renderSetupSummary();
});

$("#shuffle-questions").addEventListener("change", (event) => {
  state.shuffleQuestions = event.target.checked;
});
$("#shuffle-options").addEventListener("change", (event) => {
  state.shuffleOptions = event.target.checked;
});

$("#create-game-btn").addEventListener("click", async () => {
  const button = $("#create-game-btn");
  const selected = selectedQuestions();
  if (selected.length === 0) {
    toast("اختر سؤالًا واحدًا على الأقل.", "error");
    return;
  }
  setBusy(button, true, "جارٍ إنشاء الغرفة...");
  try {
    const data = await fetch("/api/admin/games", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-Asra-Admin": "1" },
      body: JSON.stringify({
        maxPlayers: state.maxPlayers,
        questionIds: selected.map((question) => question.id),
        shuffleQuestions: state.shuffleQuestions,
        shuffleOptions: state.shuffleOptions,
      }),
    }).then(async (response) => {
      if (response.status === 401) {
        redirectToLogin();
        throw new Error("unauthorized");
      }
      const parsed = await response.json().catch(() => null);
      if (!response.ok || !parsed?.ok) {
        throw new Error(parsed?.error || "تعذر إنشاء الغرفة.");
      }
      return parsed;
    });
    state.active = data.state;
    state.forceSetup = false;
    state.joinInfo = null;
    state.joinInfoCode = "";
    state.qrCode = "";
    state.lastLiveKey = "";
    toast(`أُنشئت الغرفة. رمز اللعبة ${formatCode(data.code)}.`, "success", 5200);
    renderControl();
    loadJoinInfo(data.code);
  } catch (error) {
    if (error.message !== "unauthorized") toast(error.message, "error");
  } finally {
    setBusy(button, false);
    renderSetupSummary();
  }
});

/* ------------------------------------------------------------------ lobby */

function renderLobby() {
  const game = state.active?.game;
  if (!game) return;
  const count = game.players.length;
  $("#lobby-code").textContent = formatCode(game.code);
  $("#lobby-players-count").textContent = `${arNum(count)} من ${arNum(game.maxPlayers)}`;
  $("#lobby-capacity").innerHTML = Array.from({ length: game.maxPlayers }, (_, index) => {
    return `<span class="${index < count ? "filled" : ""}"></span>`;
  }).join("");

  const list = $("#lobby-player-list");
  if (count === 0) {
    list.innerHTML = `<div class="lobby-empty">
      ${icon("users")}
      <span>لم ينضم أحد بعد.<br />اعرض رمز QR على شاشة العرض ليدخل اللاعبون.</span>
    </div>`;
  } else {
    list.innerHTML = game.players
      .map(
        (player, index) => `<div class="lobby-player-row ${player.online ? "" : "is-offline"}">
          ${avatarHtml(player.name)}
          <div class="lobby-player-main">
            <div class="lobby-player-name">${escapeHtml(player.name)}</div>
            <div class="lobby-player-meta">
              <span class="${player.online ? "online-dot" : "offline-dot"}"></span>
              <span>${player.online ? "متصل الآن" : "غير متصل"}</span>
              <span>•</span>
              <span>لاعب ${arNum(index + 1)}</span>
            </div>
          </div>
          <button class="icon-btn danger" type="button" data-remove-player="${player.id}" title="إزالة اللاعب" aria-label="إزالة ${escapeHtml(player.name)}">
            ${icon("x")}
          </button>
        </div>`,
      )
      .join("");
  }

  const enough = count >= 2;
  $("#start-game-btn").disabled = !enough;
  $("#lobby-start-hint").textContent = enough
    ? `كل شيء جاهز. سيبدأ ${playerWord(count)} الجولة عند ضغط الزر.`
    : count === 0
      ? "بانتظار انضمام اللاعبين."
      : "بانتظار لاعب آخر على الأقل لبدء الجولة.";

  loadJoinInfoIfNeeded(game.code);
  applyJoinInfo(game.code);
}

async function loadJoinInfoIfNeeded(code) {
  if (state.joinInfoCode === code && state.joinInfo) return;
  loadJoinInfo(code);
}

async function loadJoinInfo(code) {
  if (!code) return;
  const requestId = ++state.joinInfoRequest;
  try {
    const data = await fetch("/api/admin/join-info", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const parsed = await response.json().catch(() => null);
      if (!response.ok || !parsed?.ok) throw new Error(parsed?.error || "join-info");
      return parsed;
    });
    if (requestId !== state.joinInfoRequest || data.code !== code) return;
    if (state.joinInfo?.url !== data.url) {
      state.qrCode = "";
    }
    state.joinInfo = data;
    state.joinInfoCode = code;
    applyJoinInfo(code);
    refreshQr(code);
  } catch (_) {
    if (requestId !== state.joinInfoRequest) return;
    state.joinInfo = {
      code,
      url: `${window.location.origin}/play?code=${code}`,
      local:
        location.hostname === "localhost" ||
        location.hostname === "127.0.0.1" ||
        location.hostname === "::1",
      source: "fallback",
    };
    state.joinInfoCode = code;
    applyJoinInfo(code);
    refreshQr(code);
  }
}

function applyJoinInfo(code) {
  const info = state.joinInfoCode === code ? state.joinInfo : null;
  const fallback = `${window.location.origin}/play?code=${code}`;
  $("#join-url").textContent = info?.url || fallback;
  const note = $("#join-source-note");
  if (info?.local) {
    note.hidden = false;
    note.textContent =
      "الرابط الحالي محلي (localhost) ولن يفتح من الجوال. افتح التطبيق من رابط Replit العام أو اضبط المتغير PUBLIC_URL.";
  } else if (info?.source === "fallback") {
    note.hidden = false;
    note.textContent =
      "تعذر جلب الرابط العام من الخادم. استخدم رمز اللعبة اليدوي، أو تحقق من إعدادات النشر.";
  } else {
    note.hidden = true;
    note.textContent = "";
  }
}

function refreshQr(code) {
  if (state.qrCode === code) return;
  state.qrCode = code;
  const img = $("#lobby-qr");
  const loading = $("#qr-loading");
  const fallback = $("#qr-fallback");
  img.hidden = false;
  fallback.hidden = true;
  loading.hidden = false;
  img.onload = () => {
    loading.hidden = true;
  };
  img.onerror = () => {
    loading.hidden = true;
    img.hidden = true;
    fallback.hidden = false;
  };
  img.src = `/api/admin/qr.svg?v=${encodeURIComponent(code)}`;
}

$("#lobby-player-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-remove-player]");
  if (!button) return;
  const playerId = button.dataset.removePlayer;
  const game = state.active?.game;
  const player = game?.players.find((item) => item.id === playerId);
  if (!player) return;
  const confirmed = await confirmDialog({
    title: `إزالة ${player.name}؟`,
    message: "سيتمكن اللاعب من الانضمام مجددًا من نفس الجوال إذا كانت الغرفة ما زالت مفتوحة.",
    confirmText: "إزالة اللاعب",
    danger: true,
  });
  if (!confirmed) return;
  await runAction(button, "admin:player:remove", { playerId }, "أُزيل اللاعب من الغرفة.");
});

$("#start-game-btn").addEventListener("click", async () => {
  const game = state.active?.game;
  if (!game || game.players.length < 2) {
    toast("تحتاج إلى لاعبين اثنين على الأقل لبدء الجولة.", "error");
    return;
  }
  await runAction($("#start-game-btn"), "admin:start", {}, "بدأت الجولة. اعرض شاشة العرض!");
});

$("#cancel-game-btn").addEventListener("click", async () => {
  const game = state.active?.game;
  if (!game) return;
  const confirmed = await confirmDialog({
    title: "إلغاء غرفة الانتظار؟",
    message: "سيتم إخراج اللاعبين المتصلين وحذف رمز QR الحالي. يمكنك إنشاء غرفة جديدة مباشرة.",
    confirmText: "إلغاء الغرفة",
    danger: true,
  });
  if (!confirmed) return;
  const button = $("#cancel-game-btn");
  button.disabled = true;
  try {
    const response = await fetch(`/api/admin/games/${encodeURIComponent(game.id)}/cancel`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-Asra-Admin": "1" },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.error || "تعذر إلغاء الغرفة.");
    state.active = null;
    state.forceSetup = false;
    state.joinInfo = null;
    state.joinInfoCode = "";
    state.qrCode = "";
    toast("أُلغيت الغرفة.", "success");
    renderControl();
  } catch (error) {
    toast(error.message, "error");
  } finally {
    button.disabled = false;
  }
});

$("#copy-join-url").addEventListener("click", async () => {
  const text = $("#join-url").textContent;
  const ok = await copyText(text);
  if (ok) toast("نُسخ رابط الانضمام.", "success");
  else toast("تعذر نسخ الرابط. حدّده يدويًا.", "error");
});

/* ------------------------------------------------------------------ live */

function phaseInfo(mode, game) {
  if (mode === "ready") {
    return {
      eyebrow: "الاستعداد",
      status: "اللاعبون في أماكنهم. ابدأ السؤال الأول عندما تكون مستعدًا.",
    };
  }
  if (mode === "question") {
    if (game.paused && !game.timeUp) {
      return {
        eyebrow: `السؤال ${arNum(game.questionNumber)}`,
        status: "المؤقت متوقف مؤقتًا — الإجابات مقفلة حتى الاستئناف.",
      };
    }
    if (game.timeUp) {
      return {
        eyebrow: `السؤال ${arNum(game.questionNumber)}`,
        status: "انتهى وقت السؤال. اعرض النتيجة على شاشة العرض.",
      };
    }
    return {
      eyebrow: `السؤال ${arNum(game.questionNumber)}`,
      status: "السؤال مفتوح. تابع من أجاب أولًا وما إذا كانت إجابته صحيحة قبل العرض.",
    };
  }
  if (mode === "revealed") {
    return {
      eyebrow: "النتيجة",
      status: "النتيجة معروضة على شاشة العرض. يمكنك إظهار المتصدرين أو الانتقال للسؤال التالي.",
    };
  }
  return {
    eyebrow: "المتصدرون",
    status: "لوحة المتصدرين معروضة على شاشة العرض. انتقل للسؤال التالي عندما تكون جاهزًا.",
  };
}

function renderLive() {
  const active = state.active;
  const game = active?.game;
  if (!game) return;
  const mode = active.mode;
  const info = phaseInfo(mode, game);

  $("#live-phase-label").textContent = info.eyebrow;
  $("#live-status-text").textContent = info.status;
  $("#live-progress-text").textContent = `${arNum(Math.max(0, game.questionNumber))} من ${arNum(
    game.totalQuestions,
  )}`;
  const progress = game.totalQuestions
    ? (Math.max(0, game.questionNumber) / game.totalQuestions) * 100
    : 0;
  $("#live-progress-fill").style.width = `${Math.min(100, progress)}%`;

  const revealVisible = Boolean(game.resultVisible);
  const isLast = Boolean(game.isLastQuestion);

  $("#btn-start-question").hidden = mode !== "ready";
  $("#btn-pause").hidden = mode !== "question";
  $("#btn-reveal").hidden = mode !== "question";
  $("#btn-leaderboard").hidden = mode !== "revealed";
  $("#btn-next").hidden = !["revealed", "leaderboard"].includes(mode);
  $("#btn-finish").hidden = mode === "ready" ? false : false;

  const pause = $("#btn-pause");
  if (mode === "question") {
    pause.disabled = Boolean(game.timeUp);
    pause.innerHTML = game.paused
      ? '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z"/></svg> استئناف المؤقت'
      : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg> إيقاف المؤقت';
    pause.classList.toggle("btn-orange", !game.paused);
    pause.classList.toggle("btn-primary", game.paused);
  }

  const next = $("#btn-next");
  if (isLast) {
    next.innerHTML =
      'عرض النتيجة النهائية <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1.6 8.5L20 10h-6.5L13 2Z"/></svg>';
  } else {
    next.innerHTML =
      'السؤال التالي <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>';
  }

  timerWrap.hidden = mode !== "question";
  if (mode === "question") {
    timer.sync({
      remainingMs: game.remainingMs,
      durationMs: game.durationMs,
      paused: game.paused,
      timeUp: game.timeUp,
    });
  } else {
    timer.destroy();
  }

  const onlineCount = game.players.filter((player) => player.online).length;
  $("#live-online-count").textContent = `${playerWord(onlineCount)} ${
    onlineCount === 2 ? "متصلان" : onlineCount === 1 ? "متصل" : "متصلون"
  }`;

  renderQuestionContent(active);
  renderLiveSide(active);

  if (
    mode === "question" &&
    game.allAnswered &&
    game.playerCount > 0 &&
    state.lastAllAnsweredKey !== `${game.id || game.code}:${game.currentIndex}:${game.playerCount}`
  ) {
    state.lastAllAnsweredKey = `${game.id || game.code}:${game.currentIndex}:${game.playerCount}`;
    toast("أجاب جميع اللاعبين! يمكنك عرض النتيجة الآن.", "info");
  }

  if (mode !== "question") {
    state.lastAllAnsweredKey = "";
  }
  if (revealVisible && mode === "revealed" && state.lastLiveKey.startsWith("question:")) {
    // Nothing extra: the side panel already shows the result.
  }
}

function renderQuestionContent(active) {
  const game = active.game;
  const mode = active.mode;
  const container = $("#live-question-content");
  const key = `${mode}:${game.currentIndex}:${game.question?.text || ""}`;
  if (state.lastLiveKey === key) {
    updateOptionMarkers(game, mode);
    return;
  }
  state.lastLiveKey = key;

  if (mode === "ready") {
    const players = game.players
      .map((player) => `<span class="pill">${escapeHtml(player.name)}</span>`)
      .join("");
    container.innerHTML = `<div class="ready-panel">
      <img class="ready-logo" src="/assets/logo.svg" alt="" />
      <span class="eyebrow">كل شيء جاهز</span>
      <h2>ابدأ السؤال الأول</h2>
      <p>اضغط «ابدأ السؤال الأول» أعلاه. سيظهر السؤال على شاشة العرض ويبدأ المؤقت مباشرة.</p>
      <div class="ready-players">${players || '<span class="pill">بانتظار اللاعبين</span>'}</div>
    </div>`;
    return;
  }

  const question = game.question;
  if (!question) {
    container.innerHTML = '<div class="side-empty">لا يوجد سؤال لعرضه.</div>';
    return;
  }

  const revealed = ["revealed", "leaderboard"].includes(mode);
  const answers = Array.isArray(game.answers) ? game.answers : [];
  const chosenCounts = [0, 0, 0, 0];
  for (const answer of answers) {
    if (Number.isInteger(answer.optionIndex)) chosenCounts[answer.optionIndex] += 1;
  }

  const options = question.options
    .map((option, index) => {
      const correct = index === question.correctIndex;
      const chosen = chosenCounts[index];
      return `<div class="host-option ${correct ? "is-correct-host" : ""}" data-index="${index}">
        <span class="host-option-letter">${letterFor(index)}</span>
        <span class="host-option-text">${escapeHtml(option)}</span>
        ${
          correct
            ? '<span class="host-option-tag">الإجابة الصحيحة</span>'
            : ""
        }
        ${
          chosen > 0
            ? `<span class="host-option-chosen" data-chosen="${index}" hidden></span>`
            : ""
        }
      </div>`;
    })
    .join("");

  const banner = revealed
    ? `<div class="live-answer-banner">
        <span class="banner-letter">${letterFor(question.correctIndex)}</span>
        <div>
          <strong>${escapeHtml(question.options[question.correctIndex] || "—")}</strong>
          <span>الإجابة الصحيحة — ظاهرة الآن على شاشة العرض</span>
        </div>
      </div>
      ${
        question.explanation
          ? `<p class="live-explanation">${escapeHtml(question.explanation)}</p>`
          : ""
      }`
    : "";

  const hostNote = revealed
    ? ""
    : `<div class="tip-bar" style="margin-top:16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
        <span>هذه الشاشة للمشرف فقط: الإجابة الصحيحة وصحة إجابات اللاعبين لا تظهر على شاشة العرض قبل كشف النتيجة.</span>
      </div>`;

  container.innerHTML = `<div class="live-question-head">
      ${question.category ? `<span class="badge badge-cyan">${escapeHtml(question.category)}</span>` : ""}
      <span class="badge badge-muted">سؤال ${arNum(game.questionNumber)} من ${arNum(game.totalQuestions)}</span>
      <span class="badge badge-orange"><span class="dot"></span> خاص بالمشرف</span>
    </div>
    <h2 class="live-question-text">${escapeHtml(question.text)}</h2>
    <div class="host-options">${options}</div>
    ${banner}
    ${hostNote}`;

  updateOptionMarkers(game, mode);
}

function updateOptionMarkers(game, mode) {
  const answers = Array.isArray(game.answers) ? game.answers : [];
  const chosenCounts = [0, 0, 0, 0];
  for (const answer of answers) {
    if (Number.isInteger(answer.optionIndex)) chosenCounts[answer.optionIndex] += 1;
  }
  $$("#live-question-content .host-option").forEach((tile) => {
    const index = Number(tile.dataset.index);
    const marker = tile.querySelector(".host-option-chosen[data-chosen]");
    if (!marker) return;
    if (mode === "revealed" && chosenCounts[index] > 0) {
      marker.hidden = false;
      marker.textContent = `اختاره ${arNum(chosenCounts[index])}`;
    } else {
      marker.hidden = true;
    }
  });
}

function sortedAnswerRows(game) {
  const answered = (game.answers || [])
    .slice()
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  const rows = answered.map((answer) => ({ answer, player: null }));
  const missing = (game.notAnswered || []).slice();
  return { answered: rows, missing };
}

function renderLiveSide(active) {
  const game = active.game;
  const mode = active.mode;
  const title = $("#live-side-title");
  const sub = $("#live-side-sub");
  const badge = $("#live-side-badge");
  const body = $("#live-side-body");

  if (["ready", "question"].includes(mode)) {
    title.textContent = "الإجابات المباشرة";
    sub.textContent = "مرتبة حسب سرعة الإجابة — خاصة بالمشرف";
    badge.textContent = `${arNum(game.answerCount)} من ${arNum(game.playerCount)}`;
    const { answered, missing } = sortedAnswerRows(game);
    const hasAnswers = answered.length > 0;

    const rows = answered
      .map(({ answer }, index) => {
        const isFirst = index === 0;
        const cls = answer.correct ? "is-correct" : "is-wrong";
        return `<div class="answer-row ${cls}">
          <span class="answer-order">${arNum(index + 1)}</span>
          ${avatarHtml(answer.name)}
          <div class="answer-main">
            <div class="answer-name">${escapeHtml(answer.name)}</div>
            <div class="answer-sub">
              ${isFirst ? '<span class="badge badge-orange" style="padding:2px 6px;font-size:8px"><span class="dot"></span> الأسرع</span>' : ""}
              <span>${escapeHtml(answer.optionLabel)}</span>
              <span>•</span>
              <span>${formatSeconds(answer.elapsedMs)}</span>
              <span>•</span>
              <span>${answer.correct ? "صحيحة" : "خاطئة"}</span>
            </div>
          </div>
          <span class="answer-points">${answer.correct ? `+${arNum(answer.points)}` : "٠"}</span>
        </div>`;
      })
      .join("");

    const waitRows = missing
      .map(
        (player) => `<div class="answer-row is-waiting">
          <span class="answer-order">—</span>
          ${avatarHtml(player.name)}
          <div class="answer-main">
            <div class="answer-name">${escapeHtml(player.name)}</div>
            <div class="answer-sub">بانتظار الإجابة</div>
          </div>
          <span class="answer-wait-tag">لم يجب بعد</span>
        </div>`,
      )
      .join("");

    const projected = hasAnswers
      ? `<div class="projected-board">
          <div class="projected-title">الترتيب المبدئي <span>يشمل السؤال الحالي — للمشرف فقط</span></div>
          ${(game.projectedLeaderboard || [])
            .map(
              (row, index) => `<div class="projected-row ${index === 0 ? "is-first" : ""}">
                <span class="projected-rank">${arNum(row.rank)}</span>
                <span class="projected-name">${escapeHtml(row.name)}</span>
                <span class="projected-points">${arNum(row.total)}</span>
              </div>`,
            )
            .join("")}
        </div>`
      : "";

    if (!hasAnswers && missing.length === 0) {
      body.innerHTML = `<div class="side-empty">${icon("users")}<span>لا يوجد لاعبون بعد.</span></div>`;
    } else {
      body.innerHTML = `<div class="answers-meta"><strong>${arNum(game.answerCount)}</strong> أجابوا من أصل ${arNum(game.playerCount)}</div>${rows}${waitRows}${projected}`;
    }
    return;
  }

  if (mode === "revealed") {
    const revealedAnswers = game.players
      .map((player) => ({ player, answer: player.currentAnswer }))
      .sort((a, b) => {
        if (Boolean(a.answer) !== Boolean(b.answer)) return a.answer ? -1 : 1;
        if (!a.answer) return 0;
        return a.answer.elapsedMs - b.answer.elapsedMs;
      });
    const correctCount = revealedAnswers.filter(({ answer }) => answer?.correct).length;
    const wrongCount = revealedAnswers.filter(({ answer }) => answer && !answer.correct).length;
    const noneCount = revealedAnswers.filter(({ answer }) => !answer).length;
    title.textContent = "نتيجة السؤال";
    sub.textContent = "ما ظهر الآن على شاشة العرض";
    badge.textContent = `${arNum(correctCount)} صحيحة`;
    body.innerHTML = `<div class="answers-meta">
        <strong>${arNum(correctCount)}</strong> صحيحة
        <span>•</span><span>${arNum(wrongCount)} خاطئة</span>
        <span>•</span><span>${arNum(noneCount)} بدون إجابة</span>
      </div>
      ${revealedAnswers
        .map(({ player, answer }) => {
          const cls = answer ? (answer.correct ? "is-correct" : "is-wrong") : "is-waiting";
          return `<div class="answer-row ${cls}">
            ${avatarHtml(player.name)}
            <div class="answer-main">
              <div class="answer-name">${escapeHtml(player.name)}</div>
              <div class="answer-sub">${
                answer
                  ? `<span>${escapeHtml(answer.optionLabel)}</span><span>•</span><span>${formatSeconds(
                      answer.elapsedMs,
                    )}</span>`
                  : "<span>لم يجب على السؤال</span>"
              }</div>
            </div>
            <span class="badge ${answer ? (answer.correct ? "badge-green" : "badge-pink") : "badge-muted"}" style="padding: 3px 7px; font-size: 8.5px">${
              answer ? (answer.correct ? "صحيحة" : "خاطئة") : "بدون"
            }</span>
            <span class="answer-points ${answer?.correct ? "green" : ""}">${
              answer && answer.correct ? `+${arNum(answer.points)}` : "٠"
            }</span>
          </div>`;
        })
        .join("")}
      <div class="projected-board">
        <div class="projected-title">الترتيب الحالي <span>بعد السؤال ${arNum(game.questionNumber)}</span></div>
        ${(game.leaderboard || [])
          .slice(0, 4)
          .map(
            (row, index) => `<div class="projected-row ${index === 0 ? "is-first" : ""}">
              <span class="projected-rank">${arNum(row.rank)}</span>
              <span class="projected-name">${escapeHtml(row.name)}</span>
              <span class="projected-points">${arNum(row.total)}</span>
            </div>`,
          )
          .join("")}
      </div>`;
    return;
  }

  title.textContent = "المتصدرون";
  sub.textContent = `بعد السؤال ${arNum(game.questionNumber)} من ${arNum(game.totalQuestions)}`;
  badge.textContent = `${arNum(game.leaderboard?.length || 0)} لاعب`;
  body.innerHTML = `<div class="leaderboard-admin">
      ${(game.leaderboard || [])
        .map(
          (row) => `<div class="leaderboard-admin-row ${row.rank === 1 ? "is-first" : ""}">
            <span class="lb-rank">${arNum(row.rank)}</span>
            ${avatarHtml(row.name)}
            <span class="lb-name">${escapeHtml(row.name)}</span>
            <span class="lb-correct">${arNum(row.correctCount)} صحيحة</span>
            <span class="lb-points">${arNum(row.total)}</span>
          </div>`,
        )
        .join("") || '<div class="side-empty">لا توجد نتائج بعد.</div>'}
    </div>`;
}

/* live actions */

$("#btn-start-question").addEventListener("click", async () => {
  await runAction($("#btn-start-question"), "admin:question:start", {}, "");
});

$("#btn-pause").addEventListener("click", async () => {
  const game = state.active?.game;
  if (!game) return;
  const event = game.paused ? "admin:question:resume" : "admin:question:pause";
  await runAction($("#btn-pause"), event, {}, "");
});

$("#btn-reveal").addEventListener("click", async () => {
  await runAction($("#btn-reveal"), "admin:question:reveal", {}, "ظهرت النتيجة على شاشة العرض.");
});

$("#btn-leaderboard").addEventListener("click", async () => {
  await runAction($("#btn-leaderboard"), "admin:leaderboard:show", {}, "");
});

$("#btn-next").addEventListener("click", async () => {
  await runAction($("#btn-next"), "admin:question:next", {}, "");
});

$("#btn-finish").addEventListener("click", async () => {
  const confirmed = await confirmDialog({
    title: "إنهاء الجولة الآن؟",
    message:
      "سيتم إعلان الفائز بناءً على النقاط الحالية. لا يمكن استكمال الأسئلة المتبقية بعد ذلك.",
    confirmText: "إنهاء الجولة",
    danger: true,
  });
  if (!confirmed) return;
  await runAction($("#btn-finish"), "admin:finish", {}, "انتهت الجولة.");
});

/* ------------------------------------------------------------------ podium */

function renderPodium() {
  const game = state.active?.game;
  if (!game) return;
  const winner = game.winner;
  $("#podium-winner-name").textContent = winner?.name || "—";
  $("#podium-winner-score").textContent = winner
    ? `${arNum(winner.total)} نقطة • ${arNum(winner.correctCount)} إجابة صحيحة`
    : "";
  $("#podium-table-sub").textContent = `${playerWord(game.playerCount)} • ${arNum(
    game.totalQuestions,
  )} أسئلة • ${formatDate(state.active.serverNow)}`;
  $("#podium-game-code").textContent = formatCode(game.code);
  $("#podium-table").innerHTML = (game.leaderboard || [])
    .map(
      (row, index) => `<div class="final-row ${index === 0 ? "is-winner" : ""}">
        <span class="final-rank">${arNum(row.rank)}</span>
        ${avatarHtml(row.name)}
        <span class="final-name">${escapeHtml(row.name)}</span>
        <span class="final-stats">
          <span>${arNum(row.correctCount)} صحيحة</span>
          <span>${row.totalTime ? formatSeconds(row.totalTime) : "—"}</span>
        </span>
        <span class="final-points">${arNum(row.total)}</span>
      </div>`,
    )
    .join("");
}

$("#new-game-btn").addEventListener("click", () => {
  state.forceSetup = true;
  state.joinInfo = null;
  state.joinInfoCode = "";
  state.qrCode = "";
  state.lastLiveKey = "";
  renderControl();
});

$("#podium-history-btn").addEventListener("click", () => setTab("history"));

/* ------------------------------------------------------------------ question bank */

function filteredBankQuestions() {
  const query = state.bankSearch.trim().toLocaleLowerCase("ar");
  return state.questions
    .map((question, index) => ({ question, index }))
    .filter(({ question }) => {
      if (!query) return true;
      return [question.text, question.category, ...(question.options || [])]
        .join(" ")
        .toLocaleLowerCase("ar")
        .includes(query);
    });
}

function renderBank() {
  $("#bank-search").value = state.bankSearch;
  $("#bank-count-tab").textContent = arNum(state.questions.length);
  const items = filteredBankQuestions();
  $("#bank-count").textContent =
    state.bankSearch.trim().length > 0
      ? `${arNum(items.length)} من ${arNum(state.questions.length)}`
      : `${arNum(state.questions.length)} سؤال`;
  const list = $("#bank-list");
  if (items.length === 0) {
    list.innerHTML = `<div class="bank-empty"><strong>${
      state.questions.length === 0 ? "بنك الأسئلة فارغ" : "لا نتائج مطابقة"
    }</strong>${
      state.questions.length === 0
        ? "ابدأ بإضافة أول سؤال للمادة."
        : "جرّب كلمة بحث أخرى أو امسح حقل البحث."
    }</div>`;
    return;
  }
  list.innerHTML = items
    .map(({ question, index }) => {
      const isFirst = index === 0;
      const isLast = index === state.questions.length - 1;
      return `<article class="bank-item">
        <span class="bank-index">${arNum(index + 1)}</span>
        <div class="bank-main">
          <p class="bank-text">${escapeHtml(question.text)}</p>
          <div class="bank-meta">
            ${question.category ? `<span class="badge badge-cyan">${escapeHtml(question.category)}</span>` : ""}
            <span class="badge badge-muted">${arNum(question.timer)} ثانية</span>
            <span>•</span>
            <span>آخر تعديل ${formatDate(question.updatedAt)}</span>
          </div>
          <div class="bank-answer">
            <span>الإجابة الصحيحة:</span>
            <b>${letterFor(question.correctIndex)} — ${escapeHtml(question.options[question.correctIndex] || "")}</b>
          </div>
        </div>
        <div class="bank-actions">
          <button class="icon-btn" type="button" data-bank-action="up" data-id="${question.id}" title="تحريك لأعلى" aria-label="تحريك السؤال لأعلى" ${isFirst ? "disabled" : ""}>${ICON_UP}</button>
          <button class="icon-btn" type="button" data-bank-action="down" data-id="${question.id}" title="تحريك لأسفل" aria-label="تحريك السؤال لأسفل" ${isLast ? "disabled" : ""}>${ICON_DOWN}</button>
          <button class="icon-btn" type="button" data-bank-action="edit" data-id="${question.id}" title="تعديل" aria-label="تعديل السؤال">${ICON_EDIT}</button>
          <button class="icon-btn" type="button" data-bank-action="duplicate" data-id="${question.id}" title="نسخ السؤال" aria-label="نسخ السؤال">${icon("copy")}</button>
          <button class="icon-btn danger" type="button" data-bank-action="delete" data-id="${question.id}" title="حذف" aria-label="حذف السؤال">${icon("trash")}</button>
        </div>
      </article>`;
    })
    .join("");
}

$("#bank-search").addEventListener("input", (event) => {
  state.bankSearch = event.target.value;
  renderBank();
});

async function refreshQuestions() {
  const data = await fetch("/api/admin/questions", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }).then(async (response) => {
    if (response.status === 401) {
      redirectToLogin();
      throw new Error("unauthorized");
    }
    const parsed = await response.json().catch(() => null);
    if (!response.ok || !parsed?.ok) throw new Error(parsed?.error || "تعذر تحميل الأسئلة.");
    return parsed;
  });
  state.questions = Array.isArray(data.questions) ? data.questions : [];
  const existing = new Set(state.questions.map((question) => question.id));
  state.selectedIds = new Set([...state.selectedIds].filter((id) => existing.has(id)));
}

$("#bank-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-bank-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.bankAction;
  const id = button.dataset.id;
  const index = state.questions.findIndex((question) => question.id === id);
  if (index < 0) return;
  const question = state.questions[index];

  if (action === "edit") {
    openQuestionModal(question);
    return;
  }

  if (action === "delete") {
    const confirmed = await confirmDialog({
      title: "حذف السؤال؟",
      message: `سيُحذف السؤال من بنك الأسئلة. الجولات الجارية لا تتأثر لأنها تحتفظ بنسخة منها.`,
      confirmText: "حذف السؤال",
      danger: true,
    });
    if (!confirmed) return;
    button.disabled = true;
    try {
      await fetch(`/api/admin/questions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "X-Asra-Admin": "1" },
      }).then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.ok) throw new Error(data?.error || "تعذر حذف السؤال.");
      });
      state.selectedIds.delete(id);
      await refreshQuestions();
      renderAll();
      toast("حُذف السؤال.", "success");
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
    return;
  }

  if (action === "duplicate") {
    button.disabled = true;
    try {
      const data = await fetch(`/api/admin/questions/${encodeURIComponent(id)}/duplicate`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-Asra-Admin": "1" },
      }).then(async (response) => {
        const parsed = await response.json().catch(() => null);
        if (!response.ok || !parsed?.ok) throw new Error(parsed?.error || "تعذر نسخ السؤال.");
        return parsed;
      });
      await refreshQuestions();
      if (data.question?.id) state.selectedIds.add(data.question.id);
      renderAll();
      toast("نُسخ السؤال.", "success");
    } catch (error) {
      toast(error.message, "error");
      button.disabled = false;
    }
    return;
  }

  if (action === "up" || action === "down") {
    const target = action === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= state.questions.length) return;
    const ids = state.questions.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    button.disabled = true;
    try {
      const data = await fetch("/api/admin/questions/reorder", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Asra-Admin": "1" },
        body: JSON.stringify({ ids }),
      }).then(async (response) => {
        const parsed = await response.json().catch(() => null);
        if (!response.ok || !parsed?.ok) throw new Error(parsed?.error || "تعذر إعادة الترتيب.");
        return parsed;
      });
      state.questions = Array.isArray(data.questions) ? data.questions : state.questions;
      renderAll();
    } catch (error) {
      toast(error.message, "error");
      renderBank();
    }
  }
});

/* ------------------------------------------------------------------ question editor */

const questionModal = $("#question-modal");
const questionForm = $("#question-form");
const questionError = $("#question-form-error");
const optionInputs = $$(".option-input-row");

function updateOptionRows() {
  optionInputs.forEach((row) => {
    const radio = row.querySelector('input[name="q-correct"]');
    row.classList.toggle("is-correct", Boolean(radio?.checked));
  });
}

function setModalTimer(value) {
  state.modalTimer = value === 60 ? 60 : 30;
  $$("#q-timer-options button").forEach((button) => {
    button.setAttribute("aria-pressed", String(Number(button.dataset.timer) === state.modalTimer));
  });
}

function showQuestionError(message) {
  questionError.textContent = message;
  questionError.hidden = false;
}

function clearQuestionError() {
  questionError.hidden = true;
  questionError.textContent = "";
}

function openQuestionModal(question = null) {
  state.editingId = question?.id || null;
  $("#question-modal-title").textContent = question ? "تعديل السؤال" : "سؤال جديد";
  $("#save-question-btn").textContent = question ? "حفظ التعديلات" : "حفظ السؤال";
  $("#q-text").value = question?.text || "";
  $("#q-category").value = question?.category || "";
  $("#q-explanation").value = question?.explanation || "";
  for (let i = 0; i < 4; i += 1) {
    $(`#q-option-${i}`).value = question?.options?.[i] || "";
  }
  const correct = question?.correctIndex;
  $$('input[name="q-correct"]').forEach((radio) => {
    radio.checked = Number.isInteger(correct) && Number(radio.value) === correct;
  });
  setModalTimer(question?.timer || 30);
  updateOptionRows();
  clearQuestionError();
  questionModal.hidden = false;
  document.body.style.overflow = "hidden";
  setTimeout(() => $("#q-text").focus({ preventScroll: true }), 60);
}

function closeQuestionModal() {
  questionModal.hidden = true;
  state.editingId = null;
  document.body.style.overflow = "";
}

$("#add-question-btn").addEventListener("click", () => openQuestionModal(null));
$("#close-question-modal").addEventListener("click", closeQuestionModal);
$("#cancel-question-btn").addEventListener("click", closeQuestionModal);
questionModal.addEventListener("click", (event) => {
  if (event.target === questionModal) closeQuestionModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !questionModal.hidden) closeQuestionModal();
});

optionInputs.forEach((row) => {
  const radio = row.querySelector('input[name="q-correct"]');
  radio?.addEventListener("change", updateOptionRows);
});
$("#option-texts")?.addEventListener("input", clearQuestionError);

$$("#q-option-0, #q-option-1, #q-option-2, #q-option-3, #q-text").forEach((input) => {
  input.addEventListener("input", clearQuestionError);
});

$("#q-timer-options").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-timer]");
  if (!button) return;
  setModalTimer(Number(button.dataset.timer));
});

questionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearQuestionError();
  const text = $("#q-text").value.trim();
  const options = [0, 1, 2, 3].map((index) => $(`#q-option-${index}`).value.trim());
  const category = $("#q-category").value.trim() || "عام";
  const explanation = $("#q-explanation").value.trim();
  const correctRadio = questionForm.querySelector('input[name="q-correct"]:checked');
  const correctIndex = correctRadio ? Number(correctRadio.value) : -1;

  if (text.length < 3) {
    showQuestionError("اكتب نص السؤال (٣ أحرف على الأقل).");
    $("#q-text").focus();
    return;
  }
  if (options.some((option) => option.length < 1)) {
    showQuestionError("لا يمكن ترك أي خيار فارغًا.");
    const empty = options.findIndex((option) => option.length < 1);
    $(`#q-option-${empty}`).focus();
    return;
  }
  if (new Set(options.map(normalizeForCompare)).size !== 4) {
    showQuestionError("يجب أن تكون الخيارات الأربعة مختلفة.");
    return;
  }
  if (correctIndex < 0) {
    showQuestionError("حدّد الإجابة الصحيحة من الدائرة بجانب الخيار.");
    return;
  }

  const button = $("#save-question-btn");
  setBusy(button, true, "جارٍ الحفظ...");
  try {
    const body = {
      text,
      options,
      correctIndex,
      timer: state.modalTimer,
      category,
      explanation,
    };
    const editingId = state.editingId;
    const data = await fetch(
      editingId
        ? `/api/admin/questions/${encodeURIComponent(editingId)}`
        : "/api/admin/questions",
      {
        method: editingId ? "PUT" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-Asra-Admin": "1" },
        body: JSON.stringify(body),
      },
    ).then(async (response) => {
      if (response.status === 401) {
        redirectToLogin();
        throw new Error("unauthorized");
      }
      const parsed = await response.json().catch(() => null);
      if (!response.ok || !parsed?.ok) throw new Error(parsed?.error || "تعذر حفظ السؤال.");
      return parsed;
    });
    if (!editingId && data.question?.id) state.selectedIds.add(data.question.id);
    closeQuestionModal();
    await refreshQuestions();
    renderAll();
    toast(editingId ? "حُدّث السؤال." : "أُضيف السؤال إلى البنك.", "success");
  } catch (error) {
    if (error.message !== "unauthorized") showQuestionError(error.message);
  } finally {
    setBusy(button, false);
  }
});

/* ------------------------------------------------------------------ history */

function renderHistory() {
  const container = $("#history-list");
  if (state.history.length === 0) {
    container.innerHTML = `<div class="history-empty">
      ${icon("trophy")}
      <strong>لا توجد جولات منتهية بعد</strong>
      <span>ستظهر هنا نتائج الجولات بمجرد إعلان الفائز.</span>
    </div>`;
    return;
  }
  container.innerHTML = state.history
    .map(
      (game) => `<article class="history-card">
        <div class="history-head">
          <div class="history-winner">
            <span class="history-crown">${icon("crown")}</span>
            <div>
              <div class="history-name">${escapeHtml(game.winner?.name || "بدون فائز")}</div>
              <div class="history-meta">
                <span>${formatDate(game.finishedAt)}</span>
                <span>•</span>
                <span dir="ltr">${formatCode(game.code)}</span>
                <span>•</span>
                <span>${playerWord(game.playerCount)}</span>
                <span>•</span>
                <span>${arNum(game.totalQuestions)} أسئلة</span>
              </div>
            </div>
          </div>
          <span class="history-points">${game.winner ? `${arNum(game.winner.total)} نقطة` : "—"}</span>
          <div class="history-actions">
            <button class="icon-btn danger" type="button" data-delete-history="${game.id}" title="حذف من السجل" aria-label="حذف الجولة من السجل">${icon("trash")}</button>
          </div>
        </div>
        <details class="history-details">
          <summary>عرض الترتيب الكامل</summary>
          <div class="history-table">
            ${(game.leaderboard || [])
              .map(
                (row) => `<div class="history-row">
                  <span class="history-row-rank">${arNum(row.rank)}</span>
                  <span class="history-row-name">${escapeHtml(row.name)}</span>
                  <span class="history-row-correct">${arNum(row.correctCount)} صحيحة</span>
                  <span class="history-row-points">${arNum(row.total)}</span>
                </div>`,
              )
              .join("")}
          </div>
        </details>
      </article>`,
    )
    .join("");
}

$("#history-list").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete-history]");
  if (!button) return;
  const id = button.dataset.deleteHistory;
  const game = state.history.find((item) => item.id === id);
  const confirmed = await confirmDialog({
    title: "حذف الجولة من السجل؟",
    message: `ستُحذف نتيجة جولة ${formatCode(game?.code || "")} نهائيًا. لا يؤثر ذلك على اللاعبين الحاليين.`,
    confirmText: "حذف الجولة",
    danger: true,
  });
  if (!confirmed) return;
  button.disabled = true;
  try {
    await fetch(`/api/admin/history/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "X-Asra-Admin": "1" },
    }).then(async (response) => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) throw new Error(data?.error || "تعذر حذف الجولة.");
    });
    state.history = state.history.filter((item) => item.id !== id);
    if (state.active?.game?.id === id) {
      state.active = null;
      state.forceSetup = false;
      renderControl();
    }
    renderHistory();
    toast("حُذفت الجولة من السجل.", "success");
  } catch (error) {
    toast(error.message, "error");
    button.disabled = false;
  }
});

async function loadHistory({ silent = false } = {}) {
  const button = $("#refresh-history-btn");
  if (!silent) setBusy(button, true, "جارٍ التحديث...");
  try {
    const data = await fetch("/api/admin/history", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      if (response.status === 401) {
        redirectToLogin();
        throw new Error("unauthorized");
      }
      const parsed = await response.json().catch(() => null);
      if (!response.ok || !parsed?.ok) throw new Error(parsed?.error || "تعذر تحميل السجل.");
      return parsed;
    });
    state.history = Array.isArray(data.history) ? data.history : [];
    renderHistory();
    if (!silent) toast("تم تحديث السجل.", "success");
  } catch (error) {
    if (!silent && error.message !== "unauthorized") toast(error.message, "error");
  } finally {
    if (!silent) setBusy(button, false);
  }
}

$("#refresh-history-btn").addEventListener("click", () => loadHistory());

/* ------------------------------------------------------------------ socket */

function connectSocket() {
  state.socket = createSocket();

  state.socket.on("connect", () => {
    updateConn(true);
    state.socket.timeout(9000).emit("admin:hello", {}, (error, response) => {
      if (error) {
        updateConn(false);
        return;
      }
      if (!response?.ok) {
        if (response?.error === "unauthorized" || response?.error === "expired") {
          redirectToLogin();
        }
        return;
      }
      state.socketReady = true;
    });
  });

  state.socket.on("disconnect", () => {
    state.socketReady = false;
    updateConn(false);
  });

  state.socket.on("connect_error", () => {
    state.socketReady = false;
    updateConn(false);
  });

  state.socket.on("admin:state", (data) => {
    if (!data) return;
    const previousId = state.active?.game?.id;
    const previousCode = state.active?.game?.code;
    const nextId = data.game?.id;
    state.active = data;
    if (
      !data.game ||
      data.mode === "setup" ||
      ["lobby", "ready", "question", "revealed", "leaderboard"].includes(data.mode) ||
      (nextId && nextId !== previousId)
    ) {
      state.forceSetup = false;
    }
    if (data.game?.code !== previousCode) {
      state.joinInfoCode = "";
      state.qrCode = "";
    }
    renderAll();
  });

  state.socket.on("timer:tick", (tick) => {
    const active = state.active;
    const game = active?.game;
    if (!game || active.mode !== "question" || !tick) return;
    const changed =
      game.paused !== Boolean(tick.paused) || game.timeUp !== Boolean(tick.timeUp);
    game.paused = Boolean(tick.paused);
    game.timeUp = Boolean(tick.timeUp);
    game.remainingMs = Math.max(0, Number(tick.remainingMs) || 0);
    if (changed) renderLive();
  });
}

/* ------------------------------------------------------------------ logout */

$("#logout-btn").addEventListener("click", async () => {
  try {
    await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  } catch (_) {
    /* ignore */
  }
  window.location.replace("/");
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.socket?.connected && state.tab === "control") {
    state.socket.emit("admin:sync", {}, () => {});
  }
});

/* ------------------------------------------------------------------ start */

loadBootstrap();
