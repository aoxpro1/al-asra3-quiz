"use strict";

const { ALLOWED_PLAYER_COUNTS, ALLOWED_TIMERS } = require("./game");

function cleanText(value, maxLength, { multiline = false } = {}) {
  let text = String(value ?? "").replace(/\r\n?/g, "\n");
  text = multiline
    ? text.replace(/[^\S\n]+/g, " ")
    : text.replace(/\s+/g, " ");
  text = text
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e]/g, "")
    .trim();
  return text.slice(0, maxLength);
}

function validateQuestion(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "بيانات السؤال غير صالحة." };
  const text = cleanText(body.text, 300, { multiline: true });
  if (text.length < 3) return { ok: false, error: "اكتب نص السؤال (٣ أحرف على الأقل)." };
  if (!Array.isArray(body.options) || body.options.length !== 4) {
    return { ok: false, error: "يجب إدخال أربعة خيارات." };
  }
  const options = body.options.map((option) => cleanText(option, 100));
  if (options.some((option) => option.length < 1)) {
    return { ok: false, error: "لا يمكن ترك أي خيار فارغًا." };
  }
  const normalized = options.map((option) => option.toLocaleLowerCase("ar").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه"));
  if (new Set(normalized).size !== 4) {
    return { ok: false, error: "يجب أن تكون الخيارات الأربعة مختلفة." };
  }
  const correctIndex = Number(body.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex > 3) {
    return { ok: false, error: "حدّد الإجابة الصحيحة." };
  }
  const timer = Number(body.timer);
  if (!ALLOWED_TIMERS.includes(timer)) return { ok: false, error: "مدة السؤال يجب أن تكون ٣٠ أو ٦٠ ثانية." };
  const category = cleanText(body.category, 40) || "عام";
  const explanation = cleanText(body.explanation, 500, { multiline: true });
  return { ok: true, value: { text, options, correctIndex, timer, category, explanation } };
}

function validateGameConfig(body, availableQuestions) {
  if (!body || typeof body !== "object") return { ok: false, error: "بيانات الجولة غير صالحة." };
  const maxPlayers = Number(body.maxPlayers);
  if (!ALLOWED_PLAYER_COUNTS.includes(maxPlayers)) {
    return { ok: false, error: "اختر عدد لاعبين صالحًا: من ٢ إلى ٦." };
  }
  if (!Array.isArray(body.questionIds) || body.questionIds.length === 0) {
    return { ok: false, error: "اختر سؤالًا واحدًا على الأقل." };
  }
  const ids = [...new Set(body.questionIds.filter((id) => typeof id === "string"))];
  const byId = new Map(availableQuestions.map((question) => [question.id, question]));
  if (ids.length === 0 || ids.some((id) => !byId.has(id))) {
    return { ok: false, error: "تتضمن الأسئلة المختارة سؤالًا غير موجود." };
  }
  return {
    ok: true,
    value: {
      maxPlayers,
      questionDocs: ids.map((id) => byId.get(id)),
      shuffleQuestions: Boolean(body.shuffleQuestions),
      shuffleOptions: body.shuffleOptions !== false,
    },
  };
}

function safeNextPath(value) {
  const next = String(value || "");
  if (next === "/admin" || next === "/display") return next;
  if (next.startsWith("/admin?") || next.startsWith("/display?")) return next;
  return "/admin";
}

class RateLimiter {
  constructor() {
    this.buckets = new Map();
    this.timer = setInterval(() => this.cleanup(), 60 * 1000);
    this.timer.unref?.();
  }

  hit(key, limit, windowMs) {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return {
      allowed: bucket.count <= limit,
      remaining: Math.max(0, limit - bucket.count),
      retryAfterMs: Math.max(0, bucket.resetAt - now),
    };
  }

  reset(key) {
    this.buckets.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

module.exports = {
  cleanText,
  validateQuestion,
  validateGameConfig,
  safeNextPath,
  RateLimiter,
};
