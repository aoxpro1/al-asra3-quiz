import { $, toast, setBusy, ApiError } from "./common.js";

const form = $("#login-form");
const username = $("#username");
const password = $("#password");
const nextPath = $("#next-path");
const errorBox = $("#login-error");
const errorText = $("#login-error-text");
const card = $(".login-card");
const button = $("#login-btn");
const toggle = $("#toggle-password");

const params = new URLSearchParams(window.location.search);
const requestedNext = params.get("next") || "";
if (requestedNext === "/display" || requestedNext.startsWith("/display?")) {
  nextPath.value = "/display";
} else {
  nextPath.value = "/admin";
}

const eyeOpen = toggle?.querySelector(".eye-open");
const eyeOff = toggle?.querySelector(".eye-off");

toggle?.addEventListener("click", () => {
  const isPassword = password.type === "password";
  password.type = isPassword ? "text" : "password";
  toggle.setAttribute("aria-label", isPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور");
  eyeOpen.hidden = isPassword;
  eyeOff.hidden = !isPassword;
  password.focus();
});

function showError(message) {
  errorText.textContent = message;
  errorBox.hidden = false;
  card.classList.remove("shake");
  void card.offsetWidth;
  card.classList.add("shake");
}

function hideError() {
  errorBox.hidden = true;
}

username?.addEventListener("input", hideError);
password?.addEventListener("input", hideError);

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideError();
  const user = username.value.trim();
  const pass = password.value;
  if (!user || !pass) {
    showError("أدخل اسم المستخدم وكلمة المرور.");
    (!user ? username : password).focus();
    return;
  }
  setBusy(button, true, "جارٍ التحقق...");
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username: user, password: pass, next: nextPath.value }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        data?.error ||
        (response.status === 429 ? "محاولات كثيرة. حاول بعد قليل." : "تعذر تسجيل الدخول.");
      showError(message);
      setBusy(button, false);
      password.select();
      return;
    }
    window.location.replace(data?.redirect || nextPath.value);
  } catch (error) {
    showError("تعذر الاتصال بالخادم. تحقق من الشبكة وحاول مرة أخرى.");
    setBusy(button, false);
    toast("تعذر الاتصال بالخادم.", "error");
  }
});

// If a valid session already exists (for example when the page was restored from cache).
fetch("/api/session", { credentials: "same-origin" })
  .then((response) => response.json())
  .then((data) => {
    if (data?.authenticated) {
      window.location.replace(nextPath.value);
    }
  })
  .catch(() => {});

username?.focus({ preventScroll: true });
