import { createWaveLabShell } from "./src/wave-lab-shell.js?v=wave-20260918-1";
import {
  eigenmodes, responseToPerturbation, proximity, safeGamma, decaySeconds,
} from "./src/exceptional.js?v=wave-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

const params = { gamma: 0, kappa: 40, centre: 320, decay: 2.2 };
let master = null, dryGain = null, inputGain = null;
let filters = [];
let history = [];
let lastNudge = 0;

// Balance is a ratio of the coupling, so it must be scaled into Hz before the
// eigenvalue model sees it. gamma = kappa is the exceptional point.
function gammaHz() { return params.gamma * params.kappa; }
function modes() { return eigenmodes(params.centre, params.kappa, gammaHz()); }

function geo() {
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 460;
  return { w, h, cx: w / 2, cy: h / 2, sx: w * 0.34, sy: h * 0.3 };
}
function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const g = geo();
  canvas.width = Math.floor(g.w * dpr); canvas.height = Math.floor(g.h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  const g = geo();
  ctx2d.clearRect(0, 0, g.w, g.h);
  // Complex plane: horizontal is frequency offset, vertical is growth or decay.
  ctx2d.strokeStyle = "rgba(255,255,255,0.12)"; ctx2d.lineWidth = 1;
  ctx2d.beginPath(); ctx2d.moveTo(g.cx - g.sx, g.cy); ctx2d.lineTo(g.cx + g.sx, g.cy); ctx2d.stroke();
  ctx2d.beginPath(); ctx2d.moveTo(g.cx, g.cy - g.sy); ctx2d.lineTo(g.cx, g.cy + g.sy); ctx2d.stroke();
  ctx2d.fillStyle = "rgba(255,255,255,0.4)"; ctx2d.font = "10px system-ui, sans-serif";
  ctx2d.textAlign = "center";
  ctx2d.fillText("frequency →", g.cx + g.sx - 40, g.cy - 6);
  ctx2d.save(); ctx2d.translate(g.cx - 8, g.cy - g.sy + 36); ctx2d.rotate(-Math.PI / 2);
  ctx2d.fillText("growth →", 0, 0); ctx2d.restore();

  const m = modes();
  const scale = g.sx / Math.max(20, params.kappa * 1.35);
  // Trail of recent eigenvalue positions.
  history.push(m);
  if (history.length > 90) history.shift();
  history.forEach((h, i) => {
    const alpha = (i / history.length) * 0.25;
    for (const mode of h.modes) {
      const x = g.cx + (mode.hz - params.centre) * scale;
      const y = g.cy - mode.growth * (g.sy / 8);
      ctx2d.beginPath(); ctx2d.arc(x, y, 3, 0, TAU);
      ctx2d.fillStyle = `rgba(255,168,200,${alpha})`; ctx2d.fill();
    }
  });

  // The exceptional point sits where the two would meet.
  ctx2d.beginPath(); ctx2d.arc(g.cx, g.cy, 7, 0, TAU);
  ctx2d.strokeStyle = "rgba(255,255,255,0.35)"; ctx2d.setLineDash([3, 3]); ctx2d.stroke(); ctx2d.setLineDash([]);

  m.modes.forEach((mode, i) => {
    const x = g.cx + (mode.hz - params.centre) * scale;
    const y = g.cy - mode.growth * (g.sy / 8);
    ctx2d.beginPath(); ctx2d.arc(x, y, 11, 0, TAU);
    ctx2d.fillStyle = i === 0 ? "#ffa8c8" : "#8fd3ff";
    ctx2d.globalAlpha = m.broken ? 0.9 : 1; ctx2d.fill(); ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = "rgba(255,255,255,0.4)"; ctx2d.lineWidth = 1; ctx2d.stroke();
  });

  const prox = proximity(params.kappa, gammaHz());
  ctx2d.fillStyle = prox > 0.96 ? "#ffb4a2" : "rgba(255,255,255,0.55)";
  ctx2d.font = "12px system-ui, sans-serif"; ctx2d.textAlign = "center";
  ctx2d.fillText(
    m.broken ? "beyond the point — one frequency, two decay rates"
      : prox > 0.96 ? "at the exceptional point — the modes have coalesced"
      : "two distinct modes",
    g.cx, g.h - 10,
  );
}
function tick() { draw(); requestAnimationFrame(tick); }

function rebuildFilters() {
  if (!shell.armed || !master) return;
  const ctx = shell.context;
  for (const f of filters) { try { f.input.disconnect(); f.bp.disconnect(); f.gain.disconnect(); } catch { /* fresh */ } }
  filters = [];
  const m = modes();
  m.modes.forEach((mode, i) => {
    const input = ctx.createGain(); input.gain.value = 1;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = Math.max(20, Math.min(ctx.sampleRate * 0.45, mode.hz));
    // Growth shortens the effective loss, lengthening the ring, bounded by the model.
    const ring = decaySeconds(Math.max(0, mode.growth), params.decay);
    bp.Q.value = Math.max(1, Math.min(240, ring * 26));
    const gain = ctx.createGain();
    gain.gain.value = 0.5 / Math.sqrt(m.modes.length);
    input.connect(bp).connect(gain).connect(master);
    if (inputGain) inputGain.connect(input);
    filters.push({ input, bp, gain });
  });
  refresh();
}

function strike(amp = 0.8) {
  if (!shell.armed) { shell.say("Turn Audio on first."); return; }
  const ctx = shell.context;
  const len = Math.floor(ctx.sampleRate * 0.012);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * amp;
  const src = ctx.createBufferSource(); src.buffer = buf;
  for (const f of filters) src.connect(f.input);
  src.start();
}

function refresh() {
  const m = modes();
  $("splitOut").textContent = m.broken ? "0 (coalesced)" : (m.split * 2).toFixed(1);
  const prox = proximity(params.kappa, gammaHz());
  $("proxOut").textContent = prox.toFixed(3);
  $("regimeNote").textContent = m.broken
    ? "beyond the point — one frequency, two decay rates"
    : m.atEP || prox > 0.98 ? "at the point — the two modes have merged"
    : "two distinct modes";
  $("regimeNote").className = prox > 0.96 ? "warn" : "";
  const r = responseToPerturbation(params.kappa, gammaHz(), 1);
  $("nudgeOut").textContent = `${r.toFixed(2)}×${lastNudge ? ` (last ${lastNudge.toFixed(2)}×)` : ""}`;
}

const shell = createWaveLabShell({
  onArm: async (context) => {
    master = context.createGain(); master.gain.value = 0.55;
    dryGain = context.createGain(); dryGain.gain.value = 0.5;
    inputGain = context.createGain(); inputGain.gain.value = 0.6;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.12;
    dryGain.connect(master);
    master.connect(limiter);
    shell.connectOutput(limiter);
    rebuildFilters();
    return { input: inputGain, dry: dryGain };
  },
  onDisarm: () => {},
  onTransport: () => {},
  onRecording: (buffer) => {
    const ctx = shell.context;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    for (const f of filters) src.connect(f.input);
    src.start();
    shell.say("Your take is exciting both modes on a loop. Now raise the balance slowly.");
  },
});

for (const [id, key, fmt] of [
  ["gamma", "gamma", (v) => v.toFixed(3)],
  ["kappa", "kappa", (v) => `${v.toFixed(0)} Hz`],
  ["centre", "centre", (v) => `${v.toFixed(0)} Hz`],
  ["decay", "decay", (v) => `${v.toFixed(2)} s`],
]) {
  const el = $(id);
  el.addEventListener("input", () => {
    params[key] = Number(el.value);
    // Keep gain strictly below the self-oscillation ceiling.
    if (key === "gamma") params.gamma = Math.min(params.gamma, safeGamma(1, 0.9));
    $(`${id}Out`).textContent = fmt(params[key]);
    rebuildFilters();
  });
  $(`${id}Out`).textContent = fmt(params[key]);
}
$("strikeButton").addEventListener("click", () => strike(0.85));
$("nudgeButton").addEventListener("click", () => {
  lastNudge = responseToPerturbation(params.kappa, gammaHz(), 1);
  const before = params.centre;
  params.centre = Math.max(60, Math.min(2000, params.centre + 2));
  rebuildFilters();
  strike(0.7);
  setTimeout(() => { params.centre = before; rebuildFilters(); }, 420);
  shell.say(`Same 2 Hz nudge, response ${lastNudge.toFixed(2)}×. Move the balance up and try it again.`);
});

globalThis.addEventListener("resize", resize);
resize(); refresh(); tick();
