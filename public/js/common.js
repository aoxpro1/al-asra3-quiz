export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

export function arDigits(value) {
  return String(value ?? "").replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

export function arNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "٠";
  return arDigits(n.toLocaleString("en-US", { useGrouping: false }));
}

export function arDecimal(value, digits = 1) {
  return arDigits(Number(value).toFixed(digits)).replace(".", "٫");
}

export function formatSeconds(ms) {
  if (ms == null) return "—";
  return `${arDecimal(Number(ms) / 1000, 1)} ث`;
}

export function formatCountdown(ms) {
  const seconds = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  return arNum(seconds);
}

export function formatPoints(points) {
  return arNum(points);
}

export function letterFor(index) {
  return ["أ", "ب", "ج", "د"][index] || "—";
}

export function rankLabel(rank) {
  const labels = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس", "السادس"];
  return labels[Number(rank) - 1] || `المركز ${arNum(rank)}`;
}

export function playerWord(count) {
  const n = Number(count);
  if (n === 1) return "لاعب واحد";
  if (n === 2) return "لاعبان";
  return `${arNum(n)} لاعبين`;
}

export function initials(name) {
  const text = String(name || "").trim();
  if (!text) return "؟";
  return text.slice(0, 1);
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[char];
  });
}

export function getQuery(name) {
  return new URLSearchParams(window.location.search).get(name) || "";
}

export function formatDate(timestamp) {
  if (!timestamp) return "—";
  try {
    return new Intl.DateTimeFormat("ar-EG", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(timestamp));
  } catch (_) {
    return new Date(timestamp).toLocaleString("ar");
  }
}

export async function copyText(text) {
  const value = String(text ?? "");
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_) {
    /* fall through */
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {
    ok = false;
  }
  area.remove();
  return ok;
}

export class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

export async function api(url, { method = "GET", body, admin = true, redirectOn401 = true } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && admin) headers["X-Asra-Admin"] = "1";
  const response = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await response.json();
  } catch (_) {
    data = null;
  }
  if (response.status === 401 && admin && redirectOn401) {
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    throw new ApiError("يلزم تسجيل الدخول.", 401, data);
  }
  if (!response.ok || (data && data.ok === false)) {
    throw new ApiError(
      (data && data.error) || "تعذر تنفيذ الطلب. حاول مرة أخرى.",
      response.status,
      data,
    );
  }
  return data;
}

const ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 4.5 4.5L19 6.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5h.01"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4.5 13.5H11l-1.6 8.5L20 10h-6.5L13 2Z"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  qr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14h1M14 20h1M18 18h3v3h-3z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.87l11-6.5a1 1 0 0 0 0-1.74l-11-6.5A1 1 0 0 0 8 5.5Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v6a5 5 0 0 1-10 0V4Z"/><path d="M7 6H4v2a3 3 0 0 0 3 3M17 6h3v2a3 3 0 0 1-3 3"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>',
  external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3h7v7M21 3l-9 9"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/></svg>',
  logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m3 7 4.5 4L12 4l4.5 7L21 7l-2 12H5L3 7Z"/><path d="M5 19h14v2H5z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  linkedin: "",
};

export function icon(name) {
  return ICONS[name] || ICONS.info;
}

export function toast(message, type = "info", timeout = 3800) {
  let container = $(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    container.setAttribute("role", "status");
    container.setAttribute("aria-live", "polite");
    document.body.appendChild(container);
  }
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `${icon(type === "success" ? "check" : type === "error" ? "x" : "info")}<div>${escapeHtml(message)}</div>`;
  container.appendChild(node);
  const remove = () => {
    node.classList.add("out");
    setTimeout(() => node.remove(), 220);
  };
  const timer = setTimeout(remove, timeout);
  node.addEventListener("click", () => {
    clearTimeout(timer);
    remove();
  });
  return node;
}

export function confirmDialog({
  title,
  message,
  confirmText = "تأكيد",
  cancelText = "إلغاء",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.innerHTML = `
      <div class="modal-card">
        <h3></h3>
        <p></p>
        <div class="modal-actions">
          <button type="button" class="btn ${danger ? "btn-pink" : "btn-primary"}" data-confirm></button>
          <button type="button" class="btn btn-ghost" data-cancel></button>
        </div>
      </div>`;
    overlay.querySelector("h3").textContent = title || "تأكيد";
    overlay.querySelector("p").textContent = message || "";
    const confirmBtn = overlay.querySelector("[data-confirm]");
    const cancelBtn = overlay.querySelector("[data-cancel]");
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    const close = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === "Escape") close(false);
      if (event.key === "Enter") close(true);
    };
    confirmBtn.addEventListener("click", () => close(true));
    cancelBtn.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    setTimeout(() => confirmBtn.focus(), 30);
  });
}

export function setBusy(button, busy, label = "جارٍ...") {
  if (!button) return;
  if (busy) {
    if (!button.dataset.original) button.dataset.original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = `<span class="spinner"></span><span>${escapeHtml(label)}</span>`;
  } else {
    button.disabled = false;
    if (button.dataset.original) {
      button.innerHTML = button.dataset.original;
      delete button.dataset.original;
    }
  }
}

export function createSocket() {
  if (!window.io) throw new Error("Socket.IO غير محمّل");
  return window.io({
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 4000,
    timeout: 15000,
  });
}

export class TimerRing {
  constructor(element) {
    this.element = element;
    this.progress = element.querySelector(".timer-progress");
    this.value = element.querySelector(".timer-value");
    this.unit = element.querySelector(".timer-unit");
    this.circumference = 326.73;
    this.duration = 0;
    this.baseRemaining = 0;
    this.baseAt = 0;
    this.paused = true;
    this.timeUp = false;
    this.raf = null;
    this.lastRendered = -1;
    this.loop = this.loop.bind(this);
  }

  sync({ remainingMs = 0, durationMs = 0, paused = false, timeUp = false }) {
    this.duration = Math.max(1, Number(durationMs) || 0);
    this.baseRemaining = Math.max(0, Number(remainingMs) || 0);
    this.baseAt = performance.now();
    this.paused = Boolean(paused || timeUp);
    this.timeUp = Boolean(timeUp);
    this.element.classList.toggle("is-paused", Boolean(paused) && !timeUp);
    this.element.classList.toggle("is-done", Boolean(timeUp));
    this.render(this.baseRemaining);
    this.start();
  }

  start() {
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  }

  loop(now) {
    if (!this.paused && this.duration > 0) {
      const remaining = Math.max(0, this.baseRemaining - (now - this.baseAt));
      this.render(remaining);
      if (remaining <= 0) this.paused = true;
    }
    this.raf = requestAnimationFrame(this.loop);
  }

  render(remaining) {
    const seconds = Math.max(0, Math.ceil(remaining / 1000));
    if (seconds !== this.lastRendered) {
      this.value.textContent = arNum(seconds);
      this.lastRendered = seconds;
    }
    const ratio = Math.max(0, Math.min(1, remaining / this.duration));
    if (this.progress) {
      this.progress.style.strokeDashoffset = String(this.circumference * (1 - ratio));
    }
    const percent = ratio * 100;
    this.element.classList.toggle("is-warning", percent <= 50 && percent > 20);
    this.element.classList.toggle("is-danger", percent <= 20 && !this.timeUp);
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }
}

export function vibrate(pattern = 15) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch (_) {
    /* ignore */
  }
}

export function initialsColor(name) {
  const colors = [
    "rgba(73,226,255,.16)",
    "rgba(166,255,61,.14)",
    "rgba(255,177,43,.15)",
    "rgba(185,124,255,.15)",
    "rgba(255,93,134,.14)",
  ];
  let sum = 0;
  for (const char of String(name || "")) sum += char.codePointAt(0);
  return colors[sum % colors.length];
}

export function avatarHtml(name) {
  return `<span class="avatar" style="--avatar-bg:${initialsColor(name)}">${escapeHtml(initials(name))}</span>`;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
