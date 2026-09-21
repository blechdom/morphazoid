import { createWaveLabShell } from "../../families/wave-lab/wave-lab-shell.js?v=wave-20260918-1";
import { createLattice, participationRatio, findThreshold, siteFrequency } from "./freeze-point.js?v=wave-20260918-1";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const canvas = $("stage");
const ctx2d = canvas.getContext("2d");

let lattice = createLattice({ side: 8, seed: 11 });
let node = null;
let energy = new Float32Array(lattice.sites.length);
let inputSite = Math.floor(lattice.sites.length / 2);
let threshold = 1.2;
const params = { disorder: 0.4, coupling: 0.55, damping: 2.4, inputGain: 0.8 };

function geo() {
  const w = canvas.clientWidth || 640, h = canvas.clientHeight || 460;
  const pad = 26;
  const cell = Math.min((w - pad * 2) / lattice.side, (h - pad * 2) / lattice.side);
  const ox = (w - cell * lattice.side) / 2, oy = (h - cell * lattice.side) / 2;
  return { w, h, cell, ox, oy };
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
  for (const site of lattice.sites) {
    const x = g.ox + site.x * g.cell, y = g.oy + site.y * g.cell;
    const e = Math.min(1, (energy[site.index] ?? 0) * 26);
    const hz = siteFrequency(site, params.disorder);
    const hue = 190 + Math.min(120, Math.log2(hz / 120) * 42);
    ctx2d.fillStyle = `hsl(${hue} 70% ${8 + e * 48}%)`;
    ctx2d.fillRect(x + 1, y + 1, g.cell - 2, g.cell - 2);
    if (e > 0.02) {
      ctx2d.strokeStyle = `hsla(${hue} 90% 72% / ${Math.min(0.9, e)})`;
      ctx2d.lineWidth = 1 + e * 2;
      ctx2d.strokeRect(x + 1, y + 1, g.cell - 2, g.cell - 2);
    }
    if (site.index === inputSite) {
      ctx2d.strokeStyle = "#ffd479"; ctx2d.lineWidth = 2;
      ctx2d.strokeRect(x + 2, y + 2, g.cell - 4, g.cell - 4);
    }
  }
  // Threshold marker relative to the current disorder.
  const frozen = params.disorder > threshold;
  ctx2d.fillStyle = frozen ? "#ffb4a2" : "rgba(255,255,255,0.5)";
  ctx2d.font = "12px system-ui, sans-serif";
  ctx2d.textAlign = "center";
  ctx2d.fillText(frozen ? "localized — energy is trapped" : "extended — energy spreads", g.w / 2, g.h - 8);
}
function tick() { draw(); requestAnimationFrame(tick); }

function push() {
  node?.port.postMessage({ type: "param", ...params, inputSite, running: shell.running });
  refresh();
}

let refreshTimer = null;
function refresh() {
  $("disorderOut").textContent = params.disorder.toFixed(2);
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const pr = participationRatio(lattice, inputSite, params.disorder, params.coupling);
    threshold = findThreshold(lattice, inputSite, params.coupling);
    $("prOut").textContent = pr.toFixed(1);
    $("thresholdOut").textContent = threshold.toFixed(2);
    $("regime").textContent = params.disorder > threshold ? "localized" : "extended";
    $("regime").className = params.disorder > threshold ? "warn" : "";
  }, 60);
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const g = geo();
  const x = Math.floor((event.clientX - rect.left - g.ox) / g.cell);
  const y = Math.floor((event.clientY - rect.top - g.oy) / g.cell);
  if (x < 0 || y < 0 || x >= lattice.side || y >= lattice.side) return;
  const index = y * lattice.side + x;
  if (event.shiftKey) {
    inputSite = index;
    push();
    shell.say(`Microphone now enters the lattice at cell ${x + 1},${y + 1}.`);
  } else {
    node?.port.postMessage({ type: "strike", index, amp: 0.9 });
    shell.say(`Struck cell ${x + 1},${y + 1}. Move Disorder across the threshold and strike again.`);
  }
});
canvas.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  node?.port.postMessage({ type: "strike", index: inputSite, amp: 0.9 });
  event.preventDefault();
});

const shell = createWaveLabShell({
  onArm: async (context) => {
    await context.audioWorklet.addModule("src/instruments/freeze-point/freeze-point-processor.js?v=wave-20260918-1");
    node = new AudioWorkletNode(context, "morphazoid-freeze-point", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: {
        side: lattice.side,
        offsets: Float32Array.from(lattice.sites.map((s) => s.offset)),
        base: Float32Array.from(lattice.sites.map((s) => s.baseHz)),
      },
    });
    node.port.onmessage = (e) => {
      if (e.data?.type === "energy") energy = Float32Array.from(e.data.energy);
    };
    const wet = context.createGain(); wet.gain.value = 0.9;
    const dry = context.createGain(); dry.gain.value = 0.5;
    const master = context.createGain(); master.gain.value = 0.8;
    const comp = context.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 8; comp.attack.value = 0.006; comp.release.value = 0.2;
    node.connect(wet).connect(master);
    dry.connect(master);
    master.connect(comp);
    shell.connectOutput(comp);
    push();
    return { input: node, dry };
  },
  onDisarm: () => node?.port.postMessage({ type: "param", running: false }),
  onTransport: (running) => node?.port.postMessage({ type: "param", running }),
  onRecording: (buffer) => {
    // A recorded take is replayed into the lattice at the input cell.
    const ctx = shell.context;
    const src = ctx.createBufferSource();
    src.buffer = buffer; src.loop = true;
    src.connect(node);
    src.start();
    shell.say(`Your take is now feeding cell ${inputSite % lattice.side + 1},${Math.floor(inputSite / lattice.side) + 1} on a loop.`);
  },
});

for (const [id, key] of [["disorder", "disorder"], ["coupling", "coupling"], ["damping", "damping"], ["inputGain", "inputGain"]]) {
  const el = $(id);
  el.addEventListener("input", () => {
    params[key] = Number(el.value);
    const out = $(`${id}Out`);
    if (out) out.textContent = key === "damping" ? `${params[key].toFixed(2)} s` : params[key].toFixed(2);
    push();
  });
  const out = $(`${id}Out`);
  if (out) out.textContent = key === "damping" ? `${params[key].toFixed(2)} s` : params[key].toFixed(2);
}
$("sizeSelect").addEventListener("change", (e) => {
  lattice = createLattice({ side: Number(e.target.value), seed: 11 });
  energy = new Float32Array(lattice.sites.length);
  inputSite = Math.floor(lattice.sites.length / 2);
  shell.say("Lattice resized — turn Audio off and on to rebuild the engine.");
  refresh();
});
$("silenceButton").addEventListener("click", () => {
  node?.port.postMessage({ type: "silence" });
  shell.say("Lattice silenced. Disorder, coupling and the input cell are kept.");
});

globalThis.addEventListener("resize", resize);
resize(); refresh(); tick();
