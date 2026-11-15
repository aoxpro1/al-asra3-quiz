const COLORS = [
  "#49e2ff",
  "#a6ff3d",
  "#ff5d86",
  "#ffb12b",
  "#b97cff",
  "#ffd84a",
  "#ffffff",
];

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch (_) {
    return false;
  }
}

function makePiece({ x, y, vx, vy, delay = 0, ttl, w, h, color, round, rot, vr }) {
  return {
    x,
    y,
    vx,
    vy,
    delay,
    ttl,
    w,
    h,
    color,
    round: Boolean(round),
    rot: rot ?? Math.random() * Math.PI * 2,
    vr: vr ?? (Math.random() - 0.5) * 9,
    last: 0,
  };
}

/**
 * Launches a short, celebratory confetti burst from both bottom corners and
 * a gentle drizzle from the top. Safe to call repeatedly; only one canvas is
 * active at a time and reduced-motion users get no animation at all.
 */
export function celebrate({ duration = 7000 } = {}) {
  if (typeof document === "undefined" || prefersReducedMotion()) return;
  if (document.querySelector(".confetti-canvas")) return;

  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas.remove();
    return;
  }

  let width = 0;
  let height = 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const resize = () => {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener("resize", resize);

  const pieces = [];
  const start = performance.now();

  const addBurst = (side, delay) => {
    const count = 38;
    const originX = side === "left" ? -12 : width + 12;
    const originY = height * (0.74 + Math.random() * 0.08);
    for (let i = 0; i < count; i += 1) {
      const speed = 560 + Math.random() * 540;
      const spread = (Math.random() - 0.5) * 0.62;
      const angle = (side === "left" ? -Math.PI / 3.4 : -Math.PI + Math.PI / 3.4) + spread;
      pieces.push(
        makePiece({
          x: originX,
          y: originY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          delay: delay + Math.random() * 110,
          ttl: 3800 + Math.random() * 2200,
          w: 5 + Math.random() * 7,
          h: 9 + Math.random() * 12,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          round: Math.random() < 0.18,
          vr: (Math.random() - 0.5) * 14,
        }),
      );
    }
  };

  const addDrizzle = (count) => {
    for (let i = 0; i < count; i += 1) {
      pieces.push(
        makePiece({
          x: Math.random() * width,
          y: -16 - Math.random() * height * 0.3,
          vx: (Math.random() - 0.5) * 70,
          vy: 30 + Math.random() * 80,
          delay: 0,
          ttl: 4800 + Math.random() * 2000,
          w: 4 + Math.random() * 6,
          h: 7 + Math.random() * 9,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          round: Math.random() < 0.22,
          vr: (Math.random() - 0.5) * 10,
        }),
      );
    }
  };

  addBurst("left", 0);
  addBurst("right", 0);
  addBurst("left", 260);
  addBurst("right", 260);
  addDrizzle(28);

  let raf = null;
  let drizzleTimer = null;
  let drizzleStop = null;

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf);
    if (drizzleTimer) window.clearInterval(drizzleTimer);
    if (drizzleStop) window.clearTimeout(drizzleStop);
    raf = null;
    drizzleTimer = null;
    drizzleStop = null;
    window.removeEventListener("resize", resize);
    canvas.remove();
  };

  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, width, height);
    let alive = 0;

    for (const piece of pieces) {
      if (elapsed < piece.delay) {
        alive += 1;
        continue;
      }
      if (!piece.last) piece.last = now;
      const dt = Math.min(34, now - piece.last) / 1000;
      piece.last = now;

      piece.vy = Math.min(piece.vy + 760 * dt, 330);
      piece.vx *= 1 - 0.62 * dt;
      piece.x += piece.vx * dt;
      piece.y += piece.vy * dt;
      piece.rot += piece.vr * dt;

      const age = elapsed - piece.delay;
      if (age > piece.ttl || piece.y > height + 80) continue;
      alive += 1;

      const fadeFrom = piece.ttl * 0.72;
      const alpha =
        age > fadeFrom ? Math.max(0, 1 - (age - fadeFrom) / (piece.ttl - fadeFrom)) : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(piece.x, piece.y);
      ctx.rotate(piece.rot);
      ctx.fillStyle = piece.color;
      if (piece.round) {
        ctx.beginPath();
        ctx.arc(0, 0, piece.w * 0.55, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
      }
      ctx.restore();
    }

    if (alive > 0 && elapsed < duration) {
      raf = requestAnimationFrame(frame);
    } else {
      cleanup();
    }
  };

  drizzleTimer = window.setInterval(() => addDrizzle(6), 700);
  drizzleStop = window.setTimeout(
    () => {
      if (drizzleTimer) window.clearInterval(drizzleTimer);
      drizzleTimer = null;
    },
    Math.max(1200, Math.min(5200, duration - 1400)),
  );

  raf = requestAnimationFrame(frame);
}

export default celebrate;
