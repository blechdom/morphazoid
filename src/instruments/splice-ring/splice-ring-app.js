import { createProtoShell, renderDemoPhrase } from "../../proto-shell.js?v=proto-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

// The recording is never cut. Splices are markers on an intact loop; segments
// are the spans between consecutive markers; chords are alternative
// continuations. Removing every splice restores the original loop exactly.
let buffer = null;
let splices = [0, 0.25, 0.55, 0.78];   // normalised positions, always sorted
let chords = new Map();                 // spliceIndex -> destination splice index
let selected = 0;
let drag = null;
let linkFrom = null;
let rotor = new Map();                  // spliceIndex -> 0|1 alternating choice
let readerSeg = 0;
let readerT0 = 0;
let readerDur = 0;
let master = null;
let timer = null;
let waveform = new Float32Array(720);
const params = { speed: 1, crossfade: 0.02, useChords: true, alternate: true };

function sortSplices() {
  const sel = splices[selected];
  splices = [...new Set(splices.map((v) => Math.max(0, Math.min(0.999, v))))].sort((a, b) => a - b);
  selected = Math.max(0, splices.indexOf(sel));
  if (selected < 0) selected = 0;
}
function segCount() { return splices.length; }
function segSpan(i) {
  const a = splices[i];
  const b = splices[(i + 1) % splices.length];
  return { a, b, len: ((b - a) + 1) % 1 || 1 };
}
function loopSeconds() { return buffer ? buffer.duration : 4; }

function geometry() {
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 460;
  return { w, h, cx: w / 2, cy: h / 2, r: Math.max(60, Math.min(w, h) * 0.34) };
}
function ringXY(pos01, scale = 1) {
  const g = geometry();
  const a = pos01 * TAU - Math.PI / 2;
  return { x: g.cx + Math.cos(a) * g.r * scale, y: g.cy + Math.sin(a) * g.r * scale };
}
function pointerPos01(x, y) {
  const g = geometry();
  let a = Math.atan2(y - g.cy, x - g.cx) + Math.PI / 2;
  a = ((a % TAU) + TAU) % TAU;
  return a / TAU;
}

function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const g = geometry();
  canvas.width = Math.floor(g.w * dpr);
  canvas.height = Math.floor(g.h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw() {
  const g = geometry();
  ctx2d.clearRect(0, 0, g.w, g.h);

  // Segments drawn as arcs, each its own colour, so the graph is the ring.
  for (let i = 0; i < segCount(); i += 1) {
    const { a, b } = segSpan(i);
    const a0 = a * TAU - Math.PI / 2;
    const a1 = (b <= a ? b + 1 : b) * TAU - Math.PI / 2;
    ctx2d.beginPath();
    ctx2d.arc(g.cx, g.cy, g.r, a0, a1);
    const active = i === readerSeg && shell.running;
    ctx2d.strokeStyle = active ? "#ffd479" : `hsl(${(i * 61) % 360} 55% 58%)`;
    ctx2d.lineWidth = active ? 11 : 7;
    ctx2d.globalAlpha = active ? 1 : 0.75;
    ctx2d.stroke();
    ctx2d.globalAlpha = 1;
    const mid = ringXY(((a + (b <= a ? b + 1 : b)) / 2) % 1, 1.17);
    ctx2d.fillStyle = "rgba(255,255,255,0.75)";
    ctx2d.font = "11px system-ui, sans-serif";
    ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
    ctx2d.fillText(String.fromCharCode(65 + i), mid.x, mid.y);
  }

  // Waveform of the intact recording, inside the ring.
  ctx2d.beginPath();
  for (let i = 0; i <= waveform.length; i += 1) {
    const k = i % waveform.length;
    const a = (k / waveform.length) * TAU - Math.PI / 2;
    const rr = g.r * 0.82 * (1 + Math.max(-0.5, Math.min(0.5, waveform[k])) * 0.3);
    const x = g.cx + Math.cos(a) * rr, y = g.cy + Math.sin(a) * rr;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  ctx2d.closePath();
  ctx2d.strokeStyle = "rgba(160,200,230,0.4)";
  ctx2d.lineWidth = 1;
  ctx2d.stroke();

  // Chords: alternative continuations drawn across the interior.
  for (const [from, to] of chords) {
    const p = ringXY(splices[from] ?? 0);
    const q = ringXY(splices[to] ?? 0);
    ctx2d.beginPath();
    ctx2d.moveTo(p.x, p.y);
    ctx2d.quadraticCurveTo(g.cx, g.cy, q.x, q.y);
    ctx2d.strokeStyle = params.useChords ? "rgba(255,150,220,0.75)" : "rgba(255,150,220,0.2)";
    ctx2d.lineWidth = 2;
    ctx2d.stroke();
    const mid = { x: (p.x + q.x) / 2 * 0.5 + g.cx * 0.5, y: (p.y + q.y) / 2 * 0.5 + g.cy * 0.5 };
    ctx2d.fillStyle = "rgba(255,150,220,0.9)";
    ctx2d.beginPath(); ctx2d.arc(mid.x, mid.y, 3, 0, TAU); ctx2d.fill();
  }

  // Splice markers.
  splices.forEach((s, i) => {
    const p = ringXY(s);
    ctx2d.beginPath();
    ctx2d.arc(p.x, p.y, i === selected ? 10 : 7, 0, TAU);
    ctx2d.fillStyle = linkFrom === i ? "#ff96dc" : "#eef4ff";
    ctx2d.fill();
    ctx2d.strokeStyle = "#0b1520"; ctx2d.lineWidth = 2; ctx2d.stroke();
  });

  // Reader position.
  if (shell.running && readerDur > 0) {
    const t = (audioTime() - readerT0) / readerDur;
    const { a, b } = segSpan(readerSeg);
    const span = (b <= a ? b + 1 : b) - a;
    const pos = (a + Math.max(0, Math.min(1, t)) * span) % 1;
    const p = ringXY(pos, 1);
    ctx2d.beginPath(); ctx2d.arc(p.x, p.y, 6, 0, TAU);
    ctx2d.fillStyle = "#ffd479"; ctx2d.fill();
  }
}

function audioTime() { return shell.context ? shell.context.currentTime : performance.now() / 1000; }

function nextSegment(from) {
  const chord = chords.get(from);
  if (params.useChords && chord !== undefined) {
    if (!params.alternate) return chord;
    const r = (rotor.get(from) ?? 0);
    rotor.set(from, r + 1);
    return r % 2 === 0 ? chord : (from + 1) % segCount();
  }
  return (from + 1) % segCount();
}

function scheduleSegment(index, when) {
  if (!buffer || !master || !shell.context) return 0;
  const ctx = shell.context;
  const { a, b } = segSpan(index);
  const span = ((b <= a ? b + 1 : b) - a);
  const offset = a * buffer.duration;
  const dur = Math.max(0.02, span * buffer.duration) / Math.max(0.1, params.speed);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = params.speed;
  const g = ctx.createGain();
  const fade = Math.min(params.crossfade, dur / 3);
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + fade);
  g.gain.setValueAtTime(1, when + dur - fade);
  g.gain.linearRampToValueAtTime(0, when + dur);
  src.connect(g).connect(master);
  src.start(when, offset, span * buffer.duration);
  src.stop(when + dur + 0.02);
  return dur;
}

function pump() {
  if (!shell.running || !shell.armed || !buffer) return;
  const now = audioTime();
  if (readerT0 + readerDur > now + 0.08) return;
  const start = Math.max(now + 0.02, readerT0 + readerDur);
  readerSeg = readerT0 === 0 ? readerSeg : nextSegment(readerSeg);
  readerDur = scheduleSegment(readerSeg, start);
  readerT0 = start;
}

function tick() { pump(); draw(); requestAnimationFrame(tick); }

function hitSplice(x, y) {
  let best = null;
  splices.forEach((s, i) => {
    const p = ringXY(s);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < 18 && (!best || d < best.d)) best = { i, d };
  });
  return best?.i ?? null;
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  const hit = hitSplice(x, y);
  if (hit !== null) {
    if (linkFrom !== null && linkFrom !== hit) {
      chords.set(linkFrom, hit);
      shell.say(`Chord added: splice ${linkFrom + 1} can continue at splice ${hit + 1}. The recording is unchanged.`);
      linkFrom = null;
      refresh();
      return;
    }
    if (event.shiftKey) { linkFrom = hit; shell.say(`Chord from splice ${hit + 1} — now click its destination.`); return; }
    selected = hit;
    drag = hit;
    canvas.setPointerCapture(event.pointerId);
    refresh();
    return;
  }
  const g = geometry();
  const rad = Math.hypot(x - g.cx, y - g.cy) / g.r;
  if (rad > 0.86 && rad < 1.2 && splices.length < 12) {
    splices.push(pointerPos01(x, y));
    sortSplices();
    refresh();
    shell.say(`Splice added — ${splices.length} segments. Nothing was cut; the loop is intact.`);
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (drag === null) return;
  const rect = canvas.getBoundingClientRect();
  splices[drag] = pointerPos01(event.clientX - rect.left, event.clientY - rect.top);
  sortSplices();
  refresh();
});
const end = (e) => { if (drag !== null) { canvas.releasePointerCapture?.(e.pointerId); drag = null; } };
canvas.addEventListener("pointerup", end);
canvas.addEventListener("pointercancel", end);

canvas.addEventListener("keydown", (event) => {
  if (!splices.length) return;
  const step = event.shiftKey ? 0.005 : 0.02;
  if (event.key === "ArrowLeft") splices[selected] = (splices[selected] - step + 1) % 1;
  else if (event.key === "ArrowRight") splices[selected] = (splices[selected] + step) % 1;
  else if (event.key === "Tab") { selected = (selected + 1) % splices.length; }
  else if (event.key === "Delete" || event.key === "Backspace") { removeSelected(); }
  else return;
  event.preventDefault();
  sortSplices(); refresh();
});

function removeSelected() {
  if (splices.length <= 1) { shell.say("Keep at least one splice."); return; }
  splices.splice(selected, 1);
  chords.delete(selected);
  chords = new Map([...chords].filter(([f, t]) => f < splices.length && t < splices.length));
  selected = Math.min(selected, splices.length - 1);
  sortSplices(); refresh();
}

function refresh() {
  $("segmentCount").textContent = String(segCount());
  $("chordCount").textContent = String(chords.size);
  $("spliceTime").textContent = `${(splices[selected] * loopSeconds()).toFixed(2)} s`;
  const order = segCount() + chords.size;
  $("orderNote").textContent = chords.size === 0
    ? `Plain loop of ${segCount()} segments — order repeats every ${segCount()} segments.`
    : `${segCount()} segments, ${chords.size} chord${chords.size === 1 ? "" : "s"}. With alternation on, the order repeats every ${lcmPeriod()} segments.`;
}

// Honest period: simulate the actual traversal rule rather than asserting a number.
function lcmPeriod() {
  const saved = new Map(rotor);
  const startState = () => [...Array(segCount()).keys()].map((i) => (rotor.get(i) ?? 0) % 2).join("");
  rotor = new Map();
  let seg = 0;
  const seen = new Map();
  for (let step = 0; step < 4096; step += 1) {
    const key = `${seg}|${startState()}`;
    if (seen.has(key)) { const p = step - seen.get(key); rotor = saved; return p; }
    seen.set(key, step);
    seg = nextSegment(seg);
  }
  rotor = saved;
  return segCount();
}

const shell = createProtoShell({
  onArm: async (context) => {
    master = context.createGain();
    master.gain.value = 0.75;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6;
    master.connect(comp).connect(context.destination);
    if (!buffer) {
      buffer = renderDemoPhrase(context, 4, 23);
      const ch = buffer.getChannelData(0);
      for (let i = 0; i < waveform.length; i += 1) waveform[i] = ch[Math.floor((i / waveform.length) * ch.length)] ?? 0;
    }
    readerT0 = 0; readerDur = 0; readerSeg = 0;
    refresh();
  },
  onDisarm: () => { readerT0 = 0; readerDur = 0; },
  onTransport: (running) => { if (running) { readerT0 = 0; readerDur = 0; } },
});

for (const [id, key, fmt] of [["speed", "speed", (v) => `${v.toFixed(2)}×`], ["crossfade", "crossfade", (v) => `${(v * 1000).toFixed(0)} ms`]]) {
  const el = $(id);
  el.addEventListener("input", () => { params[key] = Number(el.value); $(`${id}Out`).textContent = fmt(params[key]); });
  $(`${id}Out`).textContent = fmt(params[key]);
}
$("useChords").addEventListener("change", (e) => { params.useChords = e.target.checked; refresh(); });
$("alternate").addEventListener("change", (e) => { params.alternate = e.target.checked; rotor = new Map(); refresh(); });
$("removeSplice").addEventListener("click", removeSelected);
$("restoreLoop").addEventListener("click", () => {
  splices = [0]; chords = new Map(); rotor = new Map(); selected = 0;
  refresh();
  shell.say("Original loop restored. The recording was never modified — only the markers were.");
});

globalThis.addEventListener("resize", resize);
resize(); refresh(); tick();
