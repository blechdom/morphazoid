import { createProtoShell } from "./src/proto-shell.js?v=proto-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

// Short-term synaptic plasticity, after the standard facilitation/depression model.
// Each edge has its own facilitation (F) and available resources (D). Effective
// strength is F*D, which is band-pass in PULSE RATE: too slow and F has decayed,
// too fast and D is depleted. The performer steers routing with tempo.
const NODE_COUNT = 7;
const nodes = Array.from({ length: NODE_COUNT }, (_, i) => {
  const a = (i / NODE_COUNT) * TAU - Math.PI / 2;
  return {
    id: i,
    x: 0.5 + Math.cos(a) * 0.33,
    y: 0.5 + Math.sin(a) * 0.33,
    freq: 180 * (2 ** (i / 7)) * (i % 2 ? 1.5 : 1),
    lit: 0,
  };
});

// A mesh with both ring steps and longer shortcuts, so branch points exist.
let edges = [];
function buildEdges() {
  edges = [];
  let id = 0;
  const add = (from, to, tauF, tauD, gain) => {
    const a = nodes[from], b = nodes[to];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    edges.push({
      id: id++, from, to,
      F: 1, D: 1, last: -99,
      tauF, tauD, gain,
      delay: 0.06 + dist * 0.55,
      flash: 0,
    });
  };
  for (let i = 0; i < NODE_COUNT; i += 1) {
    // Ring edges start strong and barely facilitate, but recover slowly: they
    // are at full strength when rested and collapse when hammered.
    add(i, (i + 1) % NODE_COUNT, 0.05, 0.40, 1.45);
    // Shortcuts start weak and recover fast, but facilitate strongly over a time
    // constant near a fast inter-pulse interval: they only wake up in bursts.
    add(i, (i + 3) % NODE_COUNT, 0.22, 0.06, 0.42);
  }
}
buildEdges();

const params = {
  rate: 4.0,        // pulses per second — the main gesture
  facil: 0.55,      // facilitation increment per pulse
  deplete: 0.42,    // fraction of resources consumed per pulse
  inhibition: 0.75, // mutual inhibition between sibling edges
  decay: 2.6,       // resonator decay seconds
  autoPulse: true,
};

let master = null;
let pending = [];        // {node, at, amp}
let nextPulseAt = 0;
let lookahead = 0.12;
let timer = null;
let seedNode = 0;
let litHistory = new Map();

function geometry() {
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 460;
  return { w, h };
}
function nodeXY(n) { const g = geometry(); return { x: n.x * g.w, y: n.y * g.h }; }

function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const g = geometry();
  canvas.width = Math.floor(g.w * dpr);
  canvas.height = Math.floor(g.h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// Update an edge's state to time t, then return its effective weight.
function weightAt(edge, t) {
  const dt = Math.max(0, t - edge.last);
  const F = 1 + (edge.F - 1) * Math.exp(-dt / edge.tauF);
  const D = 1 - (1 - edge.D) * Math.exp(-dt / edge.tauD);
  return { F, D, w: Math.max(0, Math.min(3.5, (edge.gain ?? 1) * F * D)) };
}

function fire(nodeId, t, amp) {
  if (amp < 0.02 || t > (audioTime() + 2.5)) return;
  nodes[nodeId].lit = Math.max(nodes[nodeId].lit, Math.min(1, amp));
  litHistory.set(nodeId, (litHistory.get(nodeId) ?? 0) + 1);
  ping(nodeId, t, amp);

  const outs = edges.filter((e) => e.from === nodeId);
  if (!outs.length) return;
  const evaluated = outs.map((e) => ({ e, ...weightAt(e, t) }));
  const maxW = Math.max(...evaluated.map((v) => v.w), 1e-6);

  for (const v of evaluated) {
    // Mutual inhibition: siblings suppress each other in proportion to the
    // strongest. At 1 this is winner-take-all; at 0 every branch transmits.
    const rel = v.w / maxW;
    const gated = v.w * (1 - params.inhibition) + v.w * params.inhibition * (rel >= 0.999 ? 1 : rel ** 4);
    const out = amp * gated * 0.55;
    // Commit the pulse's effect on this synapse.
    v.e.F = v.F + params.facil;
    v.e.D = v.D * (1 - params.deplete);
    v.e.last = t;
    v.e.flash = Math.max(v.e.flash, Math.min(1, gated));
    if (out > 0.02) pending.push({ node: v.e.to, at: t + v.e.delay, amp: out });
  }
}

function audioTime() { return shell.context ? shell.context.currentTime : performance.now() / 1000; }

function ping(nodeId, t, amp) {
  if (!shell.armed || !master || !shell.context) return;
  const ctx = shell.context;
  const n = nodes[nodeId];
  // A struck bandpass resonator — the read plane of the lattice.
  const src = ctx.createBufferSource();
  const len = Math.floor(ctx.sampleRate * 0.02);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = n.freq;
  bp.Q.value = 14 + params.decay * 6;
  const g = ctx.createGain();
  const a = Math.min(0.5, amp * 0.42);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(a, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + params.decay);
  const pan = ctx.createStereoPanner();
  pan.pan.value = (n.x - 0.5) * 1.6;
  src.connect(bp).connect(g).connect(pan).connect(master);
  src.start(t);
  src.stop(t + params.decay + 0.05);
}

function scheduler() {
  const now = audioTime();
  const horizon = now + lookahead;
  if (params.autoPulse) {
    if (nextPulseAt < now) nextPulseAt = now + 0.05;
    while (nextPulseAt < horizon) {
      fire(seedNode, nextPulseAt, 1);
      nextPulseAt += 1 / Math.max(0.2, params.rate);
    }
  }
  pending.sort((a, b) => a.at - b.at);
  while (pending.length && pending[0].at < horizon) {
    const p = pending.shift();
    fire(p.node, p.at, p.amp);
  }
  if (pending.length > 400) pending.length = 400;
}

function draw() {
  const g = geometry();
  ctx2d.clearRect(0, 0, g.w, g.h);
  const t = audioTime();

  for (const e of edges) {
    const a = nodeXY(nodes[e.from]);
    const b = nodeXY(nodes[e.to]);
    const { w } = weightAt(e, t);
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.13;
    const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.13;
    ctx2d.beginPath();
    ctx2d.moveTo(a.x, a.y);
    ctx2d.quadraticCurveTo(mx, my, b.x, b.y);
    const strength = Math.max(0, Math.min(1, w / 1.8));
    ctx2d.strokeStyle = `rgba(${120 + 120 * strength | 0}, ${90 + 150 * strength | 0}, 255, ${0.14 + 0.66 * strength})`;
    ctx2d.lineWidth = 0.8 + strength * 5.5 + e.flash * 3;
    ctx2d.stroke();
    e.flash *= 0.86;
  }

  for (const n of nodes) {
    const p = nodeXY(n);
    ctx2d.beginPath();
    ctx2d.arc(p.x, p.y, 13 + n.lit * 9, 0, TAU);
    ctx2d.fillStyle = n.id === seedNode ? "#ffd479" : "#9bb7ff";
    ctx2d.globalAlpha = 0.28 + n.lit * 0.72;
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = "rgba(255,255,255,0.35)";
    ctx2d.lineWidth = 1;
    ctx2d.stroke();
    ctx2d.fillStyle = "#06121b";
    ctx2d.font = "11px system-ui, sans-serif";
    ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
    ctx2d.fillText(String(n.id + 1), p.x, p.y + 0.5);
    n.lit *= 0.9;
  }
}

function tick() {
  if (shell.running) scheduler();
  draw();
  requestAnimationFrame(tick);
}

function updateReadout() {
  const t = audioTime();
  const ring = edges.filter((e) => e.to === (e.from + 1) % NODE_COUNT);
  const cut = edges.filter((e) => e.to === (e.from + 3) % NODE_COUNT);
  const avg = (list) => list.reduce((s, e) => s + weightAt(e, t).w, 0) / Math.max(1, list.length);
  const r = avg(ring), c = avg(cut);
  $("readoutRing").textContent = r.toFixed(2);
  $("readoutCut").textContent = c.toFixed(2);
  $("readoutWho").textContent = Math.abs(r - c) < 0.08
    ? "balanced"
    : (r > c ? "ring steps dominate" : "shortcuts dominate");
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  let best = null;
  for (const n of nodes) {
    const p = nodeXY(n);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < 26 && (!best || d < best.d)) best = { n, d };
  }
  if (!best) return;
  if (event.shiftKey) {
    seedNode = best.n.id;
    shell.say(`Auto pulses now enter at node ${seedNode + 1}.`);
  } else {
    fire(best.n.id, audioTime() + 0.02, 1);
    shell.say(`Struck node ${best.n.id + 1}. Repeat it at different speeds and watch which edges thicken.`);
  }
});

canvas.addEventListener("keydown", (event) => {
  const n = Number(event.key);
  if (Number.isInteger(n) && n >= 1 && n <= NODE_COUNT) {
    fire(n - 1, audioTime() + 0.02, 1);
    event.preventDefault();
  }
});

const shell = createProtoShell({
  onArm: async (context) => {
    master = context.createGain();
    master.gain.value = 0.55;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 8; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp).connect(context.destination);
    nextPulseAt = context.currentTime + 0.1;
  },
  onDisarm: () => { pending = []; },
  onTransport: (running) => {
    if (running) nextPulseAt = audioTime() + 0.05;
    else pending = [];
  },
});

for (const [id, key, fmt] of [
  ["rate", "rate", (v) => `${v.toFixed(2)} /s`],
  ["facil", "facil", (v) => v.toFixed(2)],
  ["deplete", "deplete", (v) => v.toFixed(2)],
  ["inhibition", "inhibition", (v) => (v > 0.9 ? "winner-take-all" : v < 0.1 ? "all branches" : v.toFixed(2))],
  ["decay", "decay", (v) => `${v.toFixed(2)} s`],
]) {
  const el = $(id);
  el.addEventListener("input", () => { params[key] = Number(el.value); $(`${id}Out`).textContent = fmt(params[key]); });
  $(`${id}Out`).textContent = fmt(params[key]);
}
$("autoPulse").addEventListener("change", (e) => { params.autoPulse = e.target.checked; });
$("resetSynapses").addEventListener("click", () => {
  buildEdges(); pending = []; litHistory.clear();
  shell.say("Synapses reset to rest. Parameters and transport are kept.");
});

setInterval(updateReadout, 120);
globalThis.addEventListener("resize", resize);
resize();
tick();
