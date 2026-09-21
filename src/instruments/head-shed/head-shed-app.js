import { createProtoShell, renderDemoPhrase } from "../../proto-shell.js?v=proto-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const KINDS = ["play", "record", "erase"];
const KIND_COLOR = { play: "#7ee0a8", record: "#ff7a7a", erase: "#8fb4ff" };
const KIND_GLYPH = { play: "▶", record: "●", erase: "⌫" };

const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

let heads = [
  { id: 1, kind: "play", pos01: 0.0, level: 0.9, pan: -0.3 },
  { id: 2, kind: "play", pos01: 0.37, level: 0.7, pan: 0.3 },
  { id: 3, kind: "record", pos01: 0.72, level: 1.0, pan: 0 },
];
let nextId = 4;
let selected = 1;
let drag = null;
let phase01 = 0;
let node = null;
let micStream = null;
let micSource = null;
let dryGain = null;
let wetGain = null;
let tapeView = new Float32Array(720);

const params = { speed: 1, retain: 1, writeLevel: 0.9, genLoss: 0.12, rotorOnly: false, seconds: 4, dry: 0.7 };

function geometry() {
  const w = canvas.clientWidth || 640;
  const h = canvas.clientHeight || 460;
  return { w, h, cx: w / 2, cy: h / 2, r: Math.max(60, Math.min(w, h) * 0.34) };
}

function pointerAngle(x, y) {
  const g = geometry();
  let a = Math.atan2(y - g.cy, x - g.cx) + Math.PI / 2;
  a = ((a % TAU) + TAU) % TAU;
  return a / TAU;
}
function pointerRadius(x, y) {
  const g = geometry();
  return Math.hypot(x - g.cx, y - g.cy) / g.r;
}
function headXY(h) {
  const g = geometry();
  const a = h.pos01 * TAU - Math.PI / 2;
  const rr = g.r * (0.72 + 0.5 * Math.max(0, Math.min(1, h.level)));
  return { x: g.cx + Math.cos(a) * rr, y: g.cy + Math.sin(a) * rr };
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

  // The tape itself: a ring whose stored audio displaces its radius, rotating
  // with tape phase because the tape moves and the heads do not.
  ctx2d.save();
  ctx2d.translate(g.cx, g.cy);
  ctx2d.rotate(-phase01 * TAU);
  ctx2d.beginPath();
  for (let i = 0; i <= tapeView.length; i += 1) {
    const k = i % tapeView.length;
    const a = (k / tapeView.length) * TAU - Math.PI / 2;
    const rr = g.r * (1 + Math.max(-0.35, Math.min(0.35, tapeView[k] * 0.9)) * 0.22);
    const x = Math.cos(a) * rr;
    const y = Math.sin(a) * rr;
    if (i === 0) ctx2d.moveTo(x, y); else ctx2d.lineTo(x, y);
  }
  ctx2d.closePath();
  ctx2d.strokeStyle = "#2f6f8f";
  ctx2d.lineWidth = 2;
  ctx2d.stroke();
  ctx2d.restore();

  // Guide circle at nominal radius.
  ctx2d.beginPath();
  ctx2d.arc(g.cx, g.cy, g.r, 0, TAU);
  ctx2d.strokeStyle = "rgba(255,255,255,0.10)";
  ctx2d.lineWidth = 1;
  ctx2d.stroke();

  // Heads sit still; the tape passes them.
  for (const h of heads) {
    const p = headXY(h);
    const isSel = h.id === selected;
    ctx2d.beginPath();
    ctx2d.moveTo(g.cx + (p.x - g.cx) * 0.55, g.cy + (p.y - g.cy) * 0.55);
    ctx2d.lineTo(p.x, p.y);
    ctx2d.strokeStyle = "rgba(255,255,255,0.18)";
    ctx2d.lineWidth = 1;
    ctx2d.stroke();

    ctx2d.beginPath();
    ctx2d.arc(p.x, p.y, isSel ? 15 : 12, 0, TAU);
    ctx2d.fillStyle = KIND_COLOR[h.kind];
    ctx2d.globalAlpha = h.kind === "erase" ? 0.85 : 1;
    ctx2d.fill();
    ctx2d.globalAlpha = 1;
    if (isSel) { ctx2d.strokeStyle = "#fff"; ctx2d.lineWidth = 2; ctx2d.stroke(); }
    ctx2d.fillStyle = "#06121b";
    ctx2d.font = "12px system-ui, sans-serif";
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.fillText(KIND_GLYPH[h.kind], p.x, p.y + 0.5);
  }

  // Tape-motion marker so the direction of travel is visible.
  const ma = -Math.PI / 2 + phase01 * TAU;
  ctx2d.beginPath();
  ctx2d.arc(g.cx + Math.cos(ma) * g.r * 0.5, g.cy + Math.sin(ma) * g.r * 0.5, 4, 0, TAU);
  ctx2d.fillStyle = "#ffd479";
  ctx2d.fill();
}

function loop() { draw(); requestAnimationFrame(loop); }

function pushHeads() { node?.port.postMessage({ type: "heads", heads }); }
function pushParams() {
  node?.port.postMessage({ type: "param", ...params, running: shell.running });
  if (dryGain && shell.context) dryGain.gain.setTargetAtTime(params.dry, shell.context.currentTime, 0.02);
}

function hitHead(x, y) {
  let best = null;
  for (const h of heads) {
    const p = headXY(h);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= 20 && (!best || d < best.d)) best = { h, d };
  }
  return best?.h ?? null;
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const hit = hitHead(x, y);
  if (hit) {
    selected = hit.id;
    drag = { id: hit.id };
    canvas.setPointerCapture(event.pointerId);
    syncHeadPanel();
    return;
  }
  const rad = pointerRadius(x, y);
  if (rad > 0.55 && rad < 1.7 && heads.length < 8) {
    const h = { id: nextId++, kind: "play", pos01: pointerAngle(x, y), level: 0.8, pan: 0 };
    heads.push(h);
    selected = h.id;
    pushHeads();
    syncHeadPanel();
    status(`Added play head ${h.id}. Drag around the ring for position, in and out for level.`);
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const h = heads.find((v) => v.id === drag.id);
  if (!h) return;
  h.pos01 = pointerAngle(x, y);
  h.level = Math.max(0, Math.min(1, (pointerRadius(x, y) - 0.72) / 0.5));
  h.pan = Math.max(-1, Math.min(1, Math.sin(h.pos01 * TAU)));
  pushHeads();
  syncHeadPanel();
});

const endDrag = (event) => {
  if (!drag) return;
  canvas.releasePointerCapture?.(event.pointerId);
  drag = null;
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener("keydown", (event) => {
  const h = heads.find((v) => v.id === selected);
  if (!h) return;
  const step = event.shiftKey ? 0.01 : 0.05;
  if (event.key === "ArrowLeft") { h.pos01 = (h.pos01 - step + 1) % 1; }
  else if (event.key === "ArrowRight") { h.pos01 = (h.pos01 + step) % 1; }
  else if (event.key === "ArrowUp") { h.level = Math.min(1, h.level + 0.05); }
  else if (event.key === "ArrowDown") { h.level = Math.max(0, h.level - 0.05); }
  else if (event.key === "Tab") { return; }
  else if (event.key.toLowerCase() === "k") {
    h.kind = KINDS[(KINDS.indexOf(h.kind) + 1) % KINDS.length];
    status(`Head ${h.id} is now a ${h.kind} head.`);
  } else return;
  event.preventDefault();
  pushHeads();
  syncHeadPanel();
});

function status(text) { shell.say(text); }

function syncHeadPanel() {
  const h = heads.find((v) => v.id === selected);
  $("headList").textContent = heads.map((v) => `${v.id}${v.kind[0]}`).join(" · ") || "none";
  if (!h) { $("headKind").disabled = true; return; }
  $("headKind").disabled = false;
  $("headKind").value = h.kind;
  $("headPos").value = h.pos01.toFixed(3);
  $("headPosOut").textContent = `${(h.pos01 * params.seconds).toFixed(2)} s`;
  $("headLevel").value = h.level.toFixed(2);
  $("headLevelOut").textContent = h.level.toFixed(2);
  $("selectedHead").textContent = `Head ${h.id}`;
}

async function buildAudio(context) {
  await context.audioWorklet.addModule("src/head-shed-processor.js?v=proto-20260918-1");
  node = new AudioWorkletNode(context, "morphazoid-head-shed", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  node.port.onmessage = (e) => {
    if (e.data?.type === "snapshot") phase01 = e.data.phase01;
  };
  wetGain = context.createGain();
  wetGain.gain.value = 0.9;
  dryGain = context.createGain();
  dryGain.gain.value = params.dry;
  const master = context.createGain();
  master.gain.value = 0.9;
  const comp = context.createDynamicsCompressor();
  comp.threshold.value = -10; comp.ratio.value = 6; comp.attack.value = 0.008; comp.release.value = 0.18;
  node.connect(wetGain).connect(master);
  dryGain.connect(master);
  master.connect(comp).connect(context.destination);

  // Demo material is written onto the tape so the page is playable with no microphone.
  const demo = renderDemoPhrase(context, params.seconds, 11);
  const src = context.createBufferSource();
  src.buffer = demo;
  src.loop = false;
  src.connect(node);
  src.start();
  const ch = demo.getChannelData(0);
  for (let i = 0; i < tapeView.length; i += 1) {
    tapeView[i] = ch[Math.floor((i / tapeView.length) * ch.length)] ?? 0;
  }
  pushHeads();
  pushParams();
}

async function enableMic() {
  if (!shell.context) { status("Turn Audio on first, then enable the microphone."); return; }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    micSource = shell.context.createMediaStreamSource(micStream);
    micSource.connect(node);
    // A looper must always monitor live input. Default the dry path low but audible.
    micSource.connect(dryGain);
    $("micButton").setAttribute("aria-pressed", "true");
    $("micButton").textContent = "Microphone on";
    status("Microphone on. Live input is monitored through the dry path — use headphones.");
  } catch (error) {
    shell.fail(`Microphone unavailable: ${error?.message ?? "permission denied"}`);
  }
}

const shell = createProtoShell({
  onArm: buildAudio,
  onDisarm: () => { node?.port.postMessage({ type: "param", running: false }); },
  onTransport: (running) => { node?.port.postMessage({ type: "param", running }); },
});

for (const [id, key, fmt] of [
  ["speed", "speed", (v) => `${v.toFixed(2)}×`],
  ["retain", "retain", (v) => (v >= 0.999 ? "hold (sound-on-sound)" : v <= 0.001 ? "wipe (pure delay)" : v.toFixed(2))],
  ["dry", "dry", (v) => v.toFixed(2)],
  ["genLoss", "genLoss", (v) => v.toFixed(2)],
]) {
  const el = $(id);
  el.addEventListener("input", () => {
    params[key] = Number(el.value);
    $(`${id}Out`).textContent = fmt(params[key]);
    pushParams();
  });
  $(`${id}Out`).textContent = fmt(params[key]);
}

$("rotorOnly").addEventListener("change", (e) => {
  params.rotorOnly = e.target.checked;
  node?.port.postMessage({ type: "rotorReset" });
  pushParams();
  status(params.rotorOnly
    ? "One play head per lap. Listen for sequencing rather than dropouts — that is the experiment."
    : "All play heads sound together.");
});
$("headKind").addEventListener("change", (e) => {
  const h = heads.find((v) => v.id === selected);
  if (!h) return;
  h.kind = e.target.value;
  pushHeads();
  syncHeadPanel();
});
$("headPos").addEventListener("input", (e) => {
  const h = heads.find((v) => v.id === selected);
  if (!h) return;
  h.pos01 = Number(e.target.value);
  pushHeads(); syncHeadPanel();
});
$("headLevel").addEventListener("input", (e) => {
  const h = heads.find((v) => v.id === selected);
  if (!h) return;
  h.level = Number(e.target.value);
  pushHeads(); syncHeadPanel();
});
$("removeHead").addEventListener("click", () => {
  if (heads.length <= 1) { status("Keep at least one head."); return; }
  heads = heads.filter((v) => v.id !== selected);
  selected = heads[0].id;
  pushHeads(); syncHeadPanel();
  status("Head removed.");
});
$("clearTape").addEventListener("click", () => {
  node?.port.postMessage({ type: "clear" });
  tapeView.fill(0);
  status("Tape cleared. Heads and their positions are kept.");
});
$("micButton").addEventListener("click", enableMic);

globalThis.addEventListener("resize", resize);
resize();
syncHeadPanel();
loop();
