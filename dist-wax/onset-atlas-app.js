import { createProtoShell, renderDemoPhrase } from "./src/proto-shell.js?v=proto-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

// Phrase -> segments -> families -> transition graph, with the ACTUAL order
// period measured by simulating the traversal. Earlier work in this line failed
// by advertising an event count that was far larger than the audible order.
let buffer = null;
let segments = [];     // {start, end, rms, centroid, family}
let families = [];     // {id, members:[segIndex], colour}
let graphEdges = [];   // {from, to, count}
let accepted = false;
let master = null;
let walkNode = 0;
let walkT0 = 0, walkDur = 0;
let rotor = new Map();
let envelope = new Float32Array(900);

const params = { sensitivity: 0.45, minSeg: 0.08, similarity: 0.45, speed: 1 };

function resize() {
  const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 460;
  canvas.width = Math.floor(w * dpr); canvas.height = Math.floor(h * dpr);
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function audioTime() { return shell.context ? shell.context.currentTime : performance.now() / 1000; }

function analyse() {
  if (!buffer) return;
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  const hop = Math.floor(rate * 0.01);
  const win = hop * 2;
  const frames = [];
  for (let i = 0; i + win < data.length; i += hop) {
    let sum = 0, zc = 0, prev = data[i];
    for (let k = 0; k < win; k += 1) {
      const v = data[i + k];
      sum += v * v;
      if ((v >= 0) !== (prev >= 0)) zc += 1;
      prev = v;
    }
    frames.push({ at: i / rate, rms: Math.sqrt(sum / win), zcr: zc / win });
  }
  for (let i = 0; i < envelope.length; i += 1) {
    envelope[i] = frames[Math.floor((i / envelope.length) * frames.length)]?.rms ?? 0;
  }
  const peak = Math.max(1e-6, ...frames.map((f) => f.rms));
  const thresh = peak * (0.06 + params.sensitivity * 0.5);

  // Onsets: rising through threshold, with a minimum segment length.
  segments = [];
  let open = null;
  for (let i = 1; i < frames.length; i += 1) {
    const f = frames[i], p = frames[i - 1];
    if (!open && f.rms > thresh && p.rms <= thresh) open = { start: f.at, frames: [] };
    if (open) open.frames.push(f);
    if (open && f.rms <= thresh * 0.6 && (f.at - open.start) >= params.minSeg) {
      finishSegment(open, f.at);
      open = null;
    }
  }
  if (open) finishSegment(open, buffer.duration);

  function finishSegment(seg, end) {
    const rms = seg.frames.reduce((s, f) => s + f.rms, 0) / Math.max(1, seg.frames.length);
    const zcr = seg.frames.reduce((s, f) => s + f.zcr, 0) / Math.max(1, seg.frames.length);
    segments.push({ start: seg.start, end, rms, centroid: zcr, family: -1, dur: end - seg.start });
  }

  clusterFamilies();
  buildGraph();
  refresh();
}

function clusterFamilies() {
  families = [];
  const feat = (s) => [s.centroid * 8, Math.min(1, s.dur * 2), Math.min(1, s.rms * 6)];
  for (let i = 0; i < segments.length; i += 1) {
    const f = feat(segments[i]);
    let best = null;
    for (const fam of families) {
      const c = fam.centroidFeat;
      const d = Math.hypot(f[0] - c[0], f[1] - c[1], f[2] - c[2]);
      if (d < params.similarity && (!best || d < best.d)) best = { fam, d };
    }
    if (best) {
      best.fam.members.push(i);
      const m = best.fam.members.map((k) => feat(segments[k]));
      best.fam.centroidFeat = [0, 1, 2].map((j) => m.reduce((s, v) => s + v[j], 0) / m.length);
      segments[i].family = best.fam.id;
    } else {
      const fam = { id: families.length, members: [i], centroidFeat: f };
      families.push(fam);
      segments[i].family = fam.id;
    }
  }
}

function buildGraph() {
  const map = new Map();
  for (let i = 0; i + 1 < segments.length; i += 1) {
    const a = segments[i].family, b = segments[i + 1].family;
    const k = `${a}>${b}`;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  // Wrap the phrase so the graph is closed and can be walked indefinitely.
  if (segments.length > 1) {
    const k = `${segments.at(-1).family}>${segments[0].family}`;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  graphEdges = [...map].map(([k, count]) => {
    const [from, to] = k.split(">").map(Number);
    return { from, to, count };
  });
}

// Measure the real traversal period rather than asserting it.
function measureOrderPeriod() {
  if (!graphEdges.length) return 0;
  const local = new Map();
  const outs = (n) => graphEdges.filter((e) => e.from === n);
  let node = segments[0]?.family ?? 0;
  const seen = new Map();
  const seq = [];
  for (let step = 0; step < 4096; step += 1) {
    const stateKey = `${node}|${[...local.entries()].sort().map(([k, v]) => `${k}:${v}`).join(",")}`;
    if (seen.has(stateKey)) return step - seen.get(stateKey);
    seen.set(stateKey, step);
    const o = outs(node);
    if (!o.length) return step + 1;
    const r = local.get(node) ?? 0;
    local.set(node, r + 1);
    const chosen = o[r % o.length];
    seq.push(chosen);
    node = chosen.to;
  }
  return graphEdges.length;
}

function refresh() {
  const events = segments.length;
  const nodeCount = families.length;
  const edgeCount = graphEdges.length;
  const period = measureOrderPeriod();
  $("statEvents").textContent = String(events);
  $("statNodes").textContent = String(nodeCount);
  $("statEdges").textContent = String(edgeCount);
  $("statPeriod").textContent = String(period);
  const warn = $("periodWarning");
  if (events === 0) {
    warn.textContent = "No events detected — lower the onset threshold.";
    warn.className = "starting-note warn";
  } else if (period < events) {
    warn.innerHTML = `<b>You will hear less than you recorded.</b> ${events} events collapse to an order period of ${period}. Raise <b>Distinctness</b> so fewer events merge into the same family, or record a less repetitive phrase.`;
    warn.className = "starting-note warn";
  } else {
    warn.textContent = `Order period ${period} is at least the ${events} events recorded — nothing is lost in the traversal.`;
    warn.className = "starting-note";
  }
  $("acceptButton").disabled = events === 0;
  $("acceptState").textContent = accepted ? "Graph accepted — Play walks it." : "Proposal only — Play walks the original phrase in order.";
}

function draw() {
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 460;
  ctx2d.clearRect(0, 0, w, h);
  const stripH = 76;

  // Envelope + segment strip: the recording, always shown intact.
  ctx2d.beginPath();
  for (let i = 0; i < envelope.length; i += 1) {
    const x = (i / envelope.length) * w;
    const y = 12 + stripH / 2 - envelope[i] * stripH * 1.4;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  ctx2d.strokeStyle = "rgba(150,190,220,0.5)";
  ctx2d.lineWidth = 1; ctx2d.stroke();

  const dur = buffer?.duration || 1;
  for (const s of segments) {
    const x0 = (s.start / dur) * w, x1 = (s.end / dur) * w;
    ctx2d.fillStyle = `hsl(${(s.family * 67) % 360} 60% 55% / 0.75)`;
    ctx2d.fillRect(x0, 12 + stripH - 16, Math.max(2, x1 - x0), 14);
    ctx2d.fillStyle = "rgba(255,255,255,0.85)";
    ctx2d.font = "10px system-ui, sans-serif";
    ctx2d.textAlign = "left"; ctx2d.textBaseline = "middle";
    ctx2d.fillText(String.fromCharCode(65 + s.family), x0 + 2, 12 + stripH - 9);
  }
  ctx2d.strokeStyle = "rgba(255,255,255,0.12)";
  ctx2d.strokeRect(0.5, 12.5, w - 1, stripH);

  // The proposed graph.
  const cx = w / 2, cy = 12 + stripH + (h - stripH - 24) / 2 + 6;
  const r = Math.max(50, Math.min(w, h - stripH) * 0.27);
  const pos = (id) => {
    const a = (id / Math.max(1, families.length)) * TAU - Math.PI / 2;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  for (const e of graphEdges) {
    const a = pos(e.from), b = pos(e.to);
    ctx2d.beginPath();
    if (e.from === e.to) {
      ctx2d.arc(a.x, a.y - 20, 15, 0, TAU);
    } else {
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.18;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.18;
      ctx2d.moveTo(a.x, a.y);
      ctx2d.quadraticCurveTo(mx, my, b.x, b.y);
    }
    ctx2d.strokeStyle = `rgba(255,212,121,${0.25 + Math.min(0.6, e.count * 0.2)})`;
    ctx2d.lineWidth = 1 + Math.min(4, e.count);
    ctx2d.stroke();
  }
  families.forEach((fam) => {
    const p = pos(fam.id);
    const active = accepted && shell.running && fam.id === walkNode;
    ctx2d.beginPath(); ctx2d.arc(p.x, p.y, active ? 20 : 15, 0, TAU);
    ctx2d.fillStyle = `hsl(${(fam.id * 67) % 360} 60% 55%)`;
    ctx2d.globalAlpha = active ? 1 : 0.8; ctx2d.fill(); ctx2d.globalAlpha = 1;
    ctx2d.strokeStyle = "rgba(255,255,255,0.4)"; ctx2d.lineWidth = 1; ctx2d.stroke();
    ctx2d.fillStyle = "#0b1520"; ctx2d.font = "12px system-ui, sans-serif";
    ctx2d.textAlign = "center"; ctx2d.textBaseline = "middle";
    ctx2d.fillText(`${String.fromCharCode(65 + fam.id)}·${fam.members.length}`, p.x, p.y);
  });
}

function playSegment(segIndex, when) {
  if (!buffer || !master || !shell.context) return 0;
  const s = segments[segIndex];
  if (!s) return 0;
  const ctx = shell.context;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = params.speed;
  const g = ctx.createGain();
  const d = (s.end - s.start) / params.speed;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(1, when + 0.008);
  g.gain.setValueAtTime(1, when + d - 0.012);
  g.gain.linearRampToValueAtTime(0, when + d);
  src.connect(g).connect(master);
  src.start(when, s.start, s.end - s.start);
  src.stop(when + d + 0.02);
  return d;
}

let linearIndex = 0;
function pump() {
  if (!shell.running || !shell.armed || !segments.length) return;
  const now = audioTime();
  if (walkT0 + walkDur > now + 0.08) return;
  const start = Math.max(now + 0.02, walkT0 + walkDur);
  let segIndex;
  if (!accepted) {
    segIndex = linearIndex % segments.length;
    linearIndex += 1;
  } else {
    const outs = graphEdges.filter((e) => e.from === walkNode);
    const fam = families[walkNode];
    segIndex = fam ? fam.members[(rotor.get(`m${walkNode}`) ?? 0) % fam.members.length] : 0;
    rotor.set(`m${walkNode}`, (rotor.get(`m${walkNode}`) ?? 0) + 1);
    if (outs.length) {
      const r = rotor.get(walkNode) ?? 0;
      rotor.set(walkNode, r + 1);
      walkNode = outs[r % outs.length].to;
    }
  }
  walkDur = playSegment(segIndex, start);
  walkT0 = start;
}

function tick() { pump(); draw(); requestAnimationFrame(tick); }

const shell = createProtoShell({
  onArm: async (context) => {
    master = context.createGain(); master.gain.value = 0.8;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 6;
    master.connect(comp).connect(context.destination);
    if (!buffer) { buffer = renderDemoPhrase(context, 4, 5); analyse(); }
    walkT0 = 0; walkDur = 0; linearIndex = 0;
  },
  onDisarm: () => { walkT0 = 0; walkDur = 0; },
  onTransport: () => { walkT0 = 0; walkDur = 0; linearIndex = 0; rotor = new Map(); walkNode = segments[0]?.family ?? 0; },
});

for (const [id, key, fmt] of [
  ["sensitivity", "sensitivity", (v) => v.toFixed(2)],
  ["minSeg", "minSeg", (v) => `${(v * 1000).toFixed(0)} ms`],
  ["similarity", "similarity", (v) => v.toFixed(2)],
  ["speed", "speed", (v) => `${v.toFixed(2)}×`],
]) {
  const el = $(id);
  el.addEventListener("input", () => {
    params[key] = Number(el.value);
    $(`${id}Out`).textContent = fmt(params[key]);
    if (key !== "speed") analyse();
  });
  $(`${id}Out`).textContent = fmt(params[key]);
}
$("acceptButton").addEventListener("click", () => {
  accepted = !accepted;
  rotor = new Map(); walkNode = segments[0]?.family ?? 0; walkT0 = 0; walkDur = 0;
  $("acceptButton").textContent = accepted ? "Reject graph" : "Accept graph";
  refresh();
  shell.say(accepted
    ? "Graph accepted. Play now walks it. The recording and every individual event are retained."
    : "Back to the original phrase, in the order you recorded it.");
});
$("reanalyse").addEventListener("click", () => { analyse(); shell.say("Re-analysed. The recording itself is unchanged."); });

globalThis.addEventListener("resize", resize);
resize(); refresh(); tick();
