import { createWaveLabShell } from "../../wave-lab-shell.js?v=wave-20260918-1";
import {
  INVOLUTIONS, involutionById, isOneSided, lapsPerPeriod, cutBand, compositePeriod,
} from "../../crab-loom.js?v=wave-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

const state = {
  halfTwists: 1,
  involution: "retrograde",
  seam: 0,
  headOffset: 0.5,
  hocket: 0,
  speed: 1,
  retain: 1,
  seconds: 4,
  phase01: 0,
  laps: 2,
  pieces: null,
};
let node = null;
let dragSeam = false;
let recordedSeconds = 0;

function geo() {
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 460;
  return { w, h, cx: w / 2, cy: h / 2, r: Math.max(56, Math.min(w, h) * 0.3), band: Math.max(14, Math.min(w, h) * 0.075) };
}
function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const g = geo();
  canvas.width = Math.floor(g.w * dpr); canvas.height = Math.floor(g.h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Band edge radius. On a one-sided band the two edges are one curve: they swap
// places at the seam, which is what the half twist does.
function edgeRadius(t01, which) {
  const g = geo();
  const twists = Math.abs(Math.round(state.halfTwists));
  const phase = ((t01 - state.seam) % 1 + 1) % 1;
  const swap = Math.sin(phase * Math.PI * twists);
  const sign = which === 0 ? 1 : -1;
  return g.r + sign * (g.band / 2) * Math.cos(phase * Math.PI * twists) * (twists ? 1 : 1) + sign * 0 * swap;
}

function draw() {
  const g = geo();
  ctx2d.clearRect(0, 0, g.w, g.h);
  const steps = 480;

  // Ribbon fill between the two edges.
  ctx2d.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps, a = t * TAU - Math.PI / 2;
    const r = edgeRadius(t, 0);
    const x = g.cx + Math.cos(a) * r, y = g.cy + Math.sin(a) * r;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  for (let i = steps; i >= 0; i -= 1) {
    const t = i / steps, a = t * TAU - Math.PI / 2;
    const r = edgeRadius(t, 1);
    ctx2d.lineTo(g.cx + Math.cos(a) * r, g.cy + Math.sin(a) * r);
  }
  ctx2d.closePath();
  ctx2d.fillStyle = "rgba(120,180,230,0.13)";
  ctx2d.fill();

  for (const which of [0, 1]) {
    ctx2d.beginPath();
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps, a = t * TAU - Math.PI / 2;
      const r = edgeRadius(t, which);
      const x = g.cx + Math.cos(a) * r, y = g.cy + Math.sin(a) * r;
      if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
    }
    ctx2d.strokeStyle = which === 0 ? "rgba(170,220,255,0.85)" : "rgba(255,190,140,0.8)";
    ctx2d.lineWidth = 2; ctx2d.stroke();
  }

  // Seam: where the involution is applied.
  const sa = state.seam * TAU - Math.PI / 2;
  ctx2d.beginPath();
  ctx2d.moveTo(g.cx + Math.cos(sa) * (g.r - g.band), g.cy + Math.sin(sa) * (g.r - g.band));
  ctx2d.lineTo(g.cx + Math.cos(sa) * (g.r + g.band), g.cy + Math.sin(sa) * (g.r + g.band));
  ctx2d.strokeStyle = "#ffd479"; ctx2d.lineWidth = 3; ctx2d.stroke();
  ctx2d.fillStyle = "#ffd479"; ctx2d.font = "11px system-ui, sans-serif";
  ctx2d.textAlign = "center";
  ctx2d.fillText("seam", g.cx + Math.cos(sa) * (g.r + g.band + 14), g.cy + Math.sin(sa) * (g.r + g.band + 14));

  // Heads. Stage 1 means the flipped face is being read.
  const laps = state.laps;
  const drawHead = (offset01, colour, label) => {
    const raw = (state.phase01 + offset01 * laps);
    const stage = laps === 2 ? (Math.floor(raw) % 2) : 0;
    const t = (raw % 1 + 1) % 1;
    const a = t * TAU - Math.PI / 2;
    const r = g.r + (stage === 1 ? g.band * 0.55 : -g.band * 0.55);
    const x = g.cx + Math.cos(a) * r, y = g.cy + Math.sin(a) * r;
    ctx2d.beginPath(); ctx2d.arc(x, y, 8, 0, TAU);
    ctx2d.fillStyle = colour; ctx2d.fill();
    ctx2d.fillStyle = "#08131d"; ctx2d.font = "10px system-ui, sans-serif";
    ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
    ctx2d.fillText(label, x, y + 0.5);
    if (stage === 1) {
      ctx2d.beginPath(); ctx2d.arc(x, y, 13, 0, TAU);
      ctx2d.strokeStyle = colour; ctx2d.lineWidth = 1; ctx2d.stroke();
    }
  };
  drawHead(0, "#9fdcff", "A");
  drawHead(state.headOffset, "#ffbe8c", "B");

  ctx2d.textAlign = "center"; ctx2d.textBaseline = "alphabetic";
  ctx2d.fillStyle = "rgba(255,255,255,0.55)"; ctx2d.font = "12px system-ui, sans-serif";
  ctx2d.fillText(isOneSided(state.halfTwists) ? "one-sided · two laps per period" : "two-sided · one lap per period", g.cx, g.cy + 4);
}
function tick() { draw(); requestAnimationFrame(tick); }

function push() {
  node?.port.postMessage({
    type: "param",
    speed: state.speed, halfTwists: state.halfTwists, seam: state.seam,
    headOffset: state.headOffset, hocket: state.hocket, retain: state.retain,
    involution: state.involution, running: shell.running,
  });
  state.laps = lapsPerPeriod(state.halfTwists);
  refresh();
}

function refresh() {
  const inv = involutionById(state.involution);
  $("involutionNote").textContent = inv.note;
  $("periodNote").textContent = isOneSided(state.halfTwists)
    ? `${state.halfTwists} half-twist${state.halfTwists === 1 ? "" : "s"} · one-sided · the loop repeats every ${(state.seconds * 2).toFixed(2)} s, not ${state.seconds.toFixed(2)} s.`
    : `${state.halfTwists} half-twist${state.halfTwists === 1 ? "" : "s"} · two-sided · the loop repeats every ${state.seconds.toFixed(2)} s.`;
  $("recordedNote").textContent = recordedSeconds > 0
    ? `Recorded ${recordedSeconds.toFixed(2)} s on the band.`
    : "No recording yet — press Record and make a sound, or use the demo take.";
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const g = geo();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  let a = Math.atan2(y - g.cy, x - g.cx) + Math.PI / 2;
  a = ((a % TAU) + TAU) % TAU;
  state.seam = a / TAU;
  dragSeam = true;
  canvas.setPointerCapture(event.pointerId);
  push();
  shell.say("Seam moved — the involution now happens here.");
});
canvas.addEventListener("pointermove", (event) => {
  if (!dragSeam) return;
  const rect = canvas.getBoundingClientRect();
  const g = geo();
  let a = Math.atan2(event.clientY - rect.top - g.cy, event.clientX - rect.left - g.cx) + Math.PI / 2;
  a = ((a % TAU) + TAU) % TAU;
  state.seam = a / TAU;
  push();
});
const endDrag = (e) => { if (dragSeam) { canvas.releasePointerCapture?.(e.pointerId); dragSeam = false; } };
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
canvas.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 0.005 : 0.02;
  if (event.key === "ArrowLeft") state.seam = (state.seam - step + 1) % 1;
  else if (event.key === "ArrowRight") state.seam = (state.seam + step) % 1;
  else return;
  event.preventDefault(); push();
});

function demoTake(context) {
  const rate = context.sampleRate;
  const seconds = state.seconds;
  const buf = context.createBuffer(1, Math.floor(seconds * rate), rate);
  const d = buf.getChannelData(0);
  // An ascending five-note line, so retrograde is unmistakable.
  const steps = [0, 3, 5, 7, 10];
  steps.forEach((semi, k) => {
    const f0 = 196 * (2 ** (semi / 12));
    const start = Math.floor((0.12 + k * 0.72) * rate);
    const len = Math.floor(0.55 * rate);
    for (let i = 0; i < len && start + i < d.length; i += 1) {
      const t = i / rate;
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 3.6);
      let v = 0;
      for (let h = 1; h <= 5; h += 1) v += Math.sin(TAU * f0 * h * t) / (h * h);
      d[start + i] += v * env * 0.5;
    }
  });
  return buf;
}

const shell = createWaveLabShell({
  onArm: async (context) => {
    await context.audioWorklet.addModule("src/crab-loom-processor.js?v=wave-20260918-1");
    node = new AudioWorkletNode(context, "morphazoid-crab-loom", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
    });
    node.port.onmessage = (e) => {
      if (e.data?.type === "snapshot") { state.phase01 = e.data.phase01; state.laps = e.data.laps; }
    };
    const wet = context.createGain(); wet.gain.value = 0.85;
    const dry = context.createGain(); dry.gain.value = 0.55;
    const master = context.createGain(); master.gain.value = 0.85;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.008; comp.release.value = 0.18;
    node.connect(wet).connect(master);
    dry.connect(master);
    master.connect(comp);
    shell.connectOutput(comp);
    const take = demoTake(context);
    node.port.postMessage({ type: "load", channel: take.getChannelData(0) });
    recordedSeconds = take.duration;
    push();
    return { input: node, dry };
  },
  onDisarm: () => node?.port.postMessage({ type: "param", running: false }),
  onTransport: (running) => node?.port.postMessage({ type: "param", running }),
  onRecording: (buffer) => {
    recordedSeconds = buffer.duration;
    state.seconds = buffer.duration;
    node?.port.postMessage({ type: "load", channel: buffer.getChannelData(0) });
    node?.port.postMessage({ type: "param", recording: false });
    push();
    shell.say(`Your take is on the band. It now repeats every ${(buffer.duration * lapsPerPeriod(state.halfTwists)).toFixed(2)} s.`);
  },
});

const sel = $("involution");
for (const inv of INVOLUTIONS) {
  const opt = document.createElement("option");
  opt.value = inv.id; opt.textContent = inv.label;
  sel.append(opt);
}
sel.value = state.involution;
sel.addEventListener("change", () => { state.involution = sel.value; push(); });

for (const [id, key, fmt] of [
  ["halfTwists", "halfTwists", (v) => `${v}`],
  ["headOffset", "headOffset", (v) => v.toFixed(2)],
  ["hocket", "hocket", (v) => (v < 0.02 ? "canon (both sound)" : v > 0.98 ? "hocket (strict alternation)" : v.toFixed(2))],
  ["speed", "speed", (v) => `${v.toFixed(2)}×`],
  ["retain", "retain", (v) => (v >= 0.999 ? "hold" : v <= 0.001 ? "wipe" : v.toFixed(2))],
]) {
  const el = $(id);
  el.addEventListener("input", () => {
    state[key] = Number(el.value);
    $(`${id}Out`).textContent = fmt(state[key]);
    push();
  });
  $(`${id}Out`).textContent = fmt(state[key]);
}

$("cutButton").addEventListener("click", () => {
  const offset = Number($("cutOffset").value);
  const result = cutBand(state.halfTwists, offset);
  state.pieces = result.pieces;
  const lengths = result.pieces.map((p) => `${p.lengthRatio}×`).join(" + ");
  $("cutResult").innerHTML =
    `<b>${result.description}</b><br />pieces: ${lengths}${result.linked ? " · linked" : ""}` +
    `<br />composite period: <b>${compositePeriod(result.pieces)}</b> laps`;
  shell.say(result.description);
});
$("clearBand").addEventListener("click", () => {
  node?.port.postMessage({ type: "clear" });
  recordedSeconds = 0; refresh();
  shell.say("Band cleared. Twists, seam and heads are kept.");
});
$("recordButton")?.addEventListener("click", () => {
  node?.port.postMessage({ type: "param", recording: !shell.state.recording });
});

globalThis.addEventListener("resize", resize);
resize(); refresh(); tick();
