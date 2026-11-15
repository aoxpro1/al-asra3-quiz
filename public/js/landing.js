import { $, toast, arNum } from "./common.js";

const codeInput = $("#join-code");
const form = $("#join-form");

const params = new URLSearchParams(window.location.search);
const incoming = (params.get("code") || "").replace(/\D/g, "").slice(0, 6);
if (incoming.length === 6) {
  window.location.replace(`/play?code=${incoming}`);
}

codeInput?.addEventListener("input", () => {
  const digits = codeInput.value.replace(/\D/g, "").slice(0, 6);
  if (codeInput.value !== digits) codeInput.value = digits;
});

codeInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    form?.requestSubmit();
  }
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = codeInput.value.replace(/\D/g, "");
  if (code.length !== 6) {
    toast(`رمز اللعبة يتكون من ٦ أرقام. أدخلت ${arNum(code.length)}.`, "error");
    codeInput.focus();
    return;
  }
  window.location.href = `/play?code=${code}`;
});

codeInput?.focus({ preventScroll: true });
