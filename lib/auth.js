"use strict";

const crypto = require("crypto");

const COOKIE_NAME = "asra_admin";

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    let value = part.slice(index + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      out[key] = decodeURIComponent(value);
    } catch (_) {
      out[key] = value;
    }
  }
  return out;
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a ?? "")).digest();
  const right = crypto.createHash("sha256").update(String(b ?? "")).digest();
  return crypto.timingSafeEqual(left, right);
}

function createAuth({ secret, username, password, ttlMs = 24 * 60 * 60 * 1000 }) {
  function issue(date = Date.now()) {
    const payload = Buffer.from(
      JSON.stringify({ u: username, iat: date, exp: date + ttlMs }),
      "utf8",
    ).toString("base64url");
    const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  function verify(token) {
    if (!token || typeof token !== "string") return false;
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return false;
    const payload = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
    const left = Buffer.from(signature);
    const right = Buffer.from(expected);
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
      return data.u === username && Number(data.exp) > Date.now();
    } catch (_) {
      return false;
    }
  }

  function tokenFromRequest(req) {
    return parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME] || "";
  }

  function read(req) {
    const token = tokenFromRequest(req);
    if (!verify(token)) return null;
    try {
      const payload = token.slice(0, token.lastIndexOf("."));
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    } catch (_) {
      return null;
    }
  }

  function isAuthenticated(req) {
    return Boolean(read(req));
  }

  function checkCredentials(givenUser, givenPass) {
    const userOk = safeEqual(givenUser, username);
    const passOk = safeEqual(givenPass, password);
    return userOk && passOk;
  }

  function cookieOptions(req) {
    const secure =
      req.secure ||
      String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    return {
      httpOnly: true,
      sameSite: "lax",
      secure,
      path: "/",
      maxAge: ttlMs,
    };
  }

  function setCookie(res, req, token) {
    const parts = [
      `${COOKIE_NAME}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(ttlMs / 1000)}`,
    ];
    if (cookieOptions(req).secure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  function clearCookie(res, req) {
    const parts = [`${COOKIE_NAME}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
    if (cookieOptions(req).secure) parts.push("Secure");
    res.setHeader("Set-Cookie", parts.join("; "));
  }

  return {
    issue,
    verify,
    read,
    tokenFromRequest,
    isAuthenticated,
    checkCredentials,
    setCookie,
    clearCookie,
    cookieName: COOKIE_NAME,
    ttlMs,
  };
}

module.exports = { createAuth, parseCookies, COOKIE_NAME };
