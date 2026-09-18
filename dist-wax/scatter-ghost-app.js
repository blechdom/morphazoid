import { createWaveLabShell } from "./src/wave-lab-shell.js?v=wave-20260918-1";
import {
  createScatterers, paths, renderImpulseResponse, refocusQuality, reverseChannel,
} from "./src/scatter-ghost.js?v=wave-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

let scatterers = createScatterers(18, 5);
let source = { x: 0.22, y: 0.5 };
let focus = { x: 0.78, y: 0.5 };
let recorded = null;          // AudioBuffer of the take
let recordedPaths = null;     // path set at the moment of recording
let drag = null;
let wave = null;              // {t0, inward}
const params = { size: 6, wet: 1 };
let master = null, wetGain = null, dryGain = null;

function geo() {
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 460;
  const s = Math.min(w, h) - 30;
  return { w, h, s, ox: (w - s) / 2, oy: (h - s) / 2 };
}
function toPx(p) { const g = geo(); return { x: g.ox + p.x * g.s, y: g.oy + p.y * g.s }; }
function toUnit(x, y) { const g = geo(); return { x: (x - g.ox) / g.s, y: (y - g.oy) / g.s }; }
function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const g = geo();
  canvas.width = Math.floor(g.w * dpr); canvas.height = Math.floor(g.h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  const g = geo();
  ctx2d.clearRect(0, 0, g.w, g.h);
  ctx2d.strokeStyle = "rgba(255,255,255,0.1)";
  ctx2d.strokeRect(g.ox, g.oy, g.s, g.s);

  if (wave) {
    const age = (performance.now() - wave.t0) / 1000;
    const span = 1.6;
    if (age > span) wave = null;
    else {
      const k = wave.inward ? 1 - age / span : age / span;
      const centre = toPx(wave.inward ? focus : source);
      for (let r = 0; r < 3; r += 1) {
        const rad = Math.max(0, (k - r * 0.12)) * g.s * 0.8;
        if (rad <= 0) continue;
        ctx2d.beginPath(); ctx2d.arc(centre.x, centre.y, rad, 0, TAU);
        ctx2d.strokeStyle = `rgba(201,167,255,${Math.max(0, 0.45 - r * 0.12) * (1 - Math.abs(0.5 - k) * 1.2)})`;
        ctx2d.lineWidth = 2; ctx2d.stroke();
      }
    }
  }

  for (const s of scatterers) {
    const p = toPx(s);
    const moved = recordedPaths && s.moved;
    ctx2d.beginPath(); ctx2d.arc(p.x, p.y, 5 + s.strength * 4, 0, TAU);
    ctx2d.fillStyle = moved ? "#ffb4a2" : "rgba(180,200,230,0.8)";
    ctx2d.fill();
  }
  const sp = toPx(source), fp = toPx(focus);
  ctx2d.beginPath(); ctx2d.arc(sp.x, sp.y, 9, 0, TAU);
  ctx2d.fillStyle = "#ffd479"; ctx2d.fill();
  ctx2d.fillStyle = "#08131d"; ctx2d.font = "10px system-ui, sans-serif";
  ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
  ctx2d.fillText("S", sp.x, sp.y);
  ctx2d.beginPath(); ctx2d.arc(fp.x, fp.y, 9, 0, TAU);
  ctx2d.strokeStyle = "#c9a7ff"; ctx2d.lineWidth = 2; ctx2d.stroke();
  ctx2d.fillStyle = "#c9a7ff";
  ctx2d.fillText("F", fp.x, fp.y);
}
function tick() { draw(); requestAnimationFrame(tick); }

function currentPaths() { return paths(source, focus, scatterers, params.size); }

function buildConvolver(reversed) {
  const ctx = shell.context;
  const set = currentPaths();
  const ir = renderImpulseResponse(set, ctx.sampleRate, { reversed });
  const buf = ctx.createBuffer(1, ir.data.length, ctx.sampleRate);
  buf.getChannelData(0).set(ir.data);
  const conv = ctx.createConvolver();
  conv.normalize = false;
  conv.buffer = buf;
  return conv;
}

function playThrough(buffer, reversed) {
  if (!shell.armed || !buffer) { shell.say("Turn Audio on and record a phrase first."); return; }
  const ctx = shell.context;
  const src = ctx.createBufferSource();
  if (reversed) {
    const rev = ctx.createBuffer(1, buffer.length, ctx.sampleRate);
    rev.getChannelData(0).set(reverseChannel(buffer.getChannelData(0)));
    src.buffer = rev;
  } else {
    src.buffer = buffer;
  }
  const conv = buildConvolver(reversed);
  const g = ctx.createGain(); g.gain.value = params.wet;
  src.connect(conv).connect(g).connect(master);
  src.start();
  wave = { t0: performance.now(), inward: reversed };
  updateQuality();
  shell.say(reversed
    ? "Reversed. Listen for the phrase reassembling at the focus marker."
    : "Scattered. That smear is your phrase with its arrival times spread out.");
}

function updateQuality() {
  if (!recordedPaths) { $("qualityOut").textContent = "—"; return; }
  const q = refocusQuality(recordedPaths, currentPaths());
  $("qualityOut").textContent = q.toFixed(2);
  $("qualityNote").textContent = q > 0.92
    ? "Medium unchanged — refocus is intact."
    : q > 0.6
      ? "Medium perturbed — the refocus is degrading."
      : "Medium badly mismatched — the phrase will not reassemble.";
  $("qualityNote").className = q > 0.92 ? "" : "warn";
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const u = toUnit(x, y);
  const near = (p) => Math.hypot(toPx(p).x - x, toPx(p).y - y) < 16;
  if (near(source)) drag = { kind: "source" };
  else if (near(focus)) drag = { kind: "focus" };
  else {
    let best = null;
    for (const s of scatterers) {
      const d = Math.hypot(toPx(s).x - x, toPx(s).y - y);
      if (d < 16 && (!best || d < best.d)) best = { s, d };
    }
    if (best) drag = { kind: "scatterer", s: best.s };
  }
  if (drag) canvas.setPointerCapture(event.pointerId);
  else { focus = u; updateQuality(); }
});
canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const u = toUnit(event.clientX - rect.left, event.clientY - rect.top);
  const c = { x: Math.max(0.03, Math.min(0.97, u.x)), y: Math.max(0.03, Math.min(0.97, u.y)) };
  if (drag.kind === "source") source = c;
  else if (drag.kind === "focus") focus = c;
  else { drag.s.x = c.x; drag.s.y = c.y; drag.s.moved = true; }
  updateQuality();
});
const end = (e) => { if (drag) { canvas.releasePointerCapture?.(e.pointerId); drag = null; } };
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", end);

const shell = createWaveLabShell({
  onArm: async (context) => {
    master = context.createGain(); master.gain.value = 0.8;
    wetGain = context.createGain(); wetGain.gain.value = 0.9;
    dryGain = context.createGain(); dryGain.gain.value = 0.5;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6;
    dryGain.connect(master);
    master.connect(comp);
    shell.connectOutput(comp);
    updateQuality();
    return { input: wetGain, dry: dryGain };
  },
  onDisarm: () => {},
  onTransport: () => {},
  onRecording: (buffer) => {
    recorded = buffer;
    recordedPaths = currentPaths();
    for (const s of scatterers) s.moved = false;
    updateQuality();
    shell.say(`Kept ${buffer.duration.toFixed(2)} s. Press Play scattered, then Reverse.`);
  },
});

$("scatterButton").addEventListener("click", () => playThrough(recorded, false));
$("reverseButton").addEventListener("click", () => playThrough(recorded, true));
$("reseed").addEventListener("click", () => {
  scatterers = createScatterers(Number($("count").value), Math.floor(performance.now()) % 9973);
  updateQuality();
  shell.say("Chamber reseeded. A recording made before this will no longer refocus.");
});
for (const [id, key, fmt] of [["size", "size", (v) => `${v.toFixed(1)} m`], ["wet", "wet", (v) => v.toFixed(2)]]) {
  const el = $(id);
  el.addEventListener("input", () => { params[key] = Number(el.value); $(`${id}Out`).textContent = fmt(params[key]); updateQuality(); });
  $(`${id}Out`).textContent = fmt(params[key]);
}
$("count").addEventListener("input", (e) => {
  $("countOut").textContent = e.target.value;
  scatterers = createScatterers(Number(e.target.value), 5);
  updateQuality();
});

globalThis.addEventListener("resize", resize);
resize(); tick();
