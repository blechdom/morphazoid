import {
  DEFAULT_ENVELOPER_PRESET_ID,
  ENVELOPER_MIN_SPLIT_GAP,
  ENVELOPER_PRESETS,
  createEnveloperState,
  deriveEnveloperTimeline,
  enveloperLeafFrequency,
  sampleEnveloperEnvelope,
  sanitizeEnveloperState,
  updateEnveloperNode,
} from "./src/enveloper.js";
import { EnveloperAudio } from "./src/enveloper-audio.js";

const $ = (id) => document.getElementById(id);
const clamp = (value, minimum = 0, maximum = 1) => (
  Math.min(maximum, Math.max(minimum, Number(value) || 0))
);
const lerp = (left, right, amount) => left + (right - left) * amount;
const midiToFrequency = (midi) => 440 * 2 ** ((midi - 69) / 12);
const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;

const PRESET_COPY = Object.freeze({
  balanced: "Three even limbs open into nine gently offset FM notes.",
  "long-middle": "A wide central limb holds three long tones between shorter side phrases.",
  "falling-glass": "Bright high leaves descend through shrinking, glassy branch gestures.",
  constellation: "Uneven limbs scatter nine distant pitches and contrasting FM colors.",
});

const DEFAULT_UI = Object.freeze({
  level: 0.46,
  baseMidi: 47,
  pitchSpan: 30,
  fmAmount: 1,
});

const audio = new EnveloperAudio(globalThis);
audio.setLevel(DEFAULT_UI.level);

const state = {
  tree: createEnveloperState(),
  level: DEFAULT_UI.level,
  baseMidi: DEFAULT_UI.baseMidi,
  pitchSpan: DEFAULT_UI.pitchSpan,
  fmAmount: DEFAULT_UI.fmAmount,
  activePresetId: DEFAULT_ENVELOPER_PRESET_ID,
  playing: false,
  audioOn: false,
  audioStarting: false,
  scoreSeconds: 0,
  scoreAnchorPerformance: performance.now(),
  lastProcessedScore: 0,
  selection: { kind: "leaf", leafIndex: 0 },
  drag: null,
  activeLeafIndex: 0,
};

const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let frameId = 0;
let hitRegions = [];
let latestLayout = null;
let lastUiFrame = -Infinity;

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function showError(error) {
  const message = error instanceof Error ? error.message : String(error);
  $("audioError").textContent = message;
  $("audioError").hidden = false;
  announce(`Audio error: ${message}`);
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function formatFrequency(frequency) {
  if (frequency >= 1_000) return `${(frequency / 1_000).toFixed(frequency >= 10_000 ? 1 : 2)} kHz`;
  return `${frequency.toFixed(frequency >= 100 ? 1 : 2)} Hz`;
}

function noteNameFromMidi(midi) {
  const names = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
  const rounded = Math.round(midi);
  return `${names[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

function noteNameFromFrequency(frequency) {
  const midi = 69 + 12 * Math.log2(frequency / 440);
  return noteNameFromMidi(midi);
}

function soundOptions() {
  return {
    minimumFrequencyHz: midiToFrequency(state.baseMidi),
    maximumFrequencyHz: midiToFrequency(state.baseMidi + state.pitchSpan),
    maximumModulationIndex: 12,
    stereoSpread: 0.72,
  };
}

function timeline() {
  return deriveEnveloperTimeline(state.tree, soundOptions());
}

function soundingEvent(event, durationSeconds = event.durationSeconds) {
  return {
    ...event,
    durationSeconds: Math.max(0.025, durationSeconds),
    amplitude: clamp(event.amplitude * 0.38, 0, 0.38),
    modulationIndex: clamp(event.modulationIndex * state.fmAmount, 0, 12),
  };
}

function currentScore(now = performance.now()) {
  if (!state.playing) return state.scoreSeconds;
  return state.scoreSeconds + Math.max(0, now - state.scoreAnchorPerformance) / 1_000;
}

function cyclePhase(score = currentScore()) {
  const cycle = state.tree.cycleSeconds;
  return ((score % cycle) + cycle) % cycle / cycle;
}

function eventAtPhase(events, phase) {
  return events.find((event, index) => (
    phase >= event.normalizedStart
    && (phase < event.normalizedEnd || index === events.length - 1)
  )) ?? events[0];
}

function selectedLeafIndex() {
  if (state.selection.kind === "leaf") return state.selection.leafIndex;
  if (state.selection.kind === "branch") return state.selection.branchIndex * 3;
  return 0;
}

function selectedNode() {
  if (state.selection.kind === "root") {
    return {
      envelope: state.tree.root,
      node: state.tree.root.nodes[state.selection.nodeIndex],
      branchIndex: null,
    };
  }
  if (state.selection.kind === "branch") {
    const envelope = state.tree.branches[state.selection.branchIndex];
    return {
      envelope,
      node: envelope.nodes[state.selection.nodeIndex],
      branchIndex: state.selection.branchIndex,
    };
  }
  return null;
}

function effectiveLeafFrequency(leaf) {
  return enveloperLeafFrequency(leaf.pitch, soundOptions());
}

function keepPhaseWhileChanging(mutator) {
  const now = performance.now();
  const phase = cyclePhase(currentScore(now));
  mutator();
  state.tree = sanitizeEnveloperState(state.tree);
  state.scoreSeconds = phase * state.tree.cycleSeconds;
  state.scoreAnchorPerformance = now;
  state.lastProcessedScore = state.scoreSeconds;
}

function replaceEnvelope(kind, branchIndex, envelope) {
  if (kind === "root") state.tree.root = envelope;
  else state.tree.branches[branchIndex] = envelope;
  state.tree = sanitizeEnveloperState(state.tree);
}

function updateSelectedLeaf(changes, { announceChange = false } = {}) {
  if (state.selection.kind !== "leaf") return;
  const index = state.selection.leafIndex;
  state.tree.leaves[index] = {
    ...state.tree.leaves[index],
    ...(Number.isFinite(changes.pitch) ? { pitch: clamp(changes.pitch) } : {}),
    ...(Number.isFinite(changes.timbre) ? { timbre: clamp(changes.timbre) } : {}),
  };
  state.tree = sanitizeEnveloperState(state.tree);
  state.activePresetId = null;
  syncUi();
  if (announceChange) {
    const leaf = state.tree.leaves[index];
    announce(`Leaf ${index + 1}: ${formatFrequency(effectiveLeafFrequency(leaf))}, timbre ${Math.round(leaf.timbre * 100)} percent.`);
  }
}

function updateSelectedNode(changes, { announceChange = false } = {}) {
  const selected = selectedNode();
  if (!selected) return;
  const next = updateEnveloperNode(selected.envelope, state.selection.nodeIndex, changes);
  replaceEnvelope(state.selection.kind, selected.branchIndex, next);
  state.activePresetId = null;
  syncUi();
  if (announceChange) {
    const node = selectedNode().node;
    announce(`${state.selection.kind === "root" ? "Parent" : `Child ${state.selection.branchIndex + 1}`} node ${state.selection.nodeIndex + 1}: ${Math.round(node.time * 100)} percent time, ${Math.round(node.level * 100)} percent level.`);
  }
}

function selectLeaf(index, { announceSelection = false } = {}) {
  state.selection = { kind: "leaf", leafIndex: clamp(Math.round(index), 0, 8) };
  syncUi();
  if (announceSelection) announce(`FM leaf ${state.selection.leafIndex + 1} selected.`);
}

function selectNode(kind, branchIndex, nodeIndex) {
  state.selection = kind === "root"
    ? { kind: "root", nodeIndex }
    : { kind: "branch", branchIndex, nodeIndex };
  syncUi();
}

function selectionBranch() {
  if (state.selection.kind === "leaf") return Math.floor(state.selection.leafIndex / 3);
  if (state.selection.kind === "branch") return state.selection.branchIndex;
  return null;
}

function layoutForStage() {
  const compact = cssHeight < 470 || cssWidth < 620;
  const left = compact ? 18 : Math.max(34, cssWidth * 0.045);
  const right = compact ? 16 : Math.max(28, cssWidth * 0.035);
  const topInset = compact ? 50 : 62;
  const bottomInset = compact ? 28 : 42;
  // Short-landscape layouts may leave only ~170 px for the complete stage.
  // Keep every generation visible instead of forcing a desktop-height tree
  // whose nine leaf pads would be clipped below the sticky stage.
  const usableHeight = Math.max(92, cssHeight - topInset - bottomInset);
  return {
    compact,
    left,
    right,
    width: Math.max(1, cssWidth - left - right),
    rootTop: topInset,
    rootBottom: topInset + usableHeight * 0.22,
    branchTop: topInset + usableHeight * 0.34,
    branchBottom: topInset + usableHeight * 0.57,
    leafTop: topInset + usableHeight * 0.68,
    leafBottom: topInset + usableHeight,
  };
}

function canvasX(layout, normalized) {
  return layout.left + normalized * layout.width;
}

function envelopeY(top, bottom, level) {
  return lerp(bottom, top, clamp(level));
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBackground(ctx, layout) {
  ctx.fillStyle = "#05060a";
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.save();
  ctx.strokeStyle = "rgba(221, 227, 238, 0.035)";
  ctx.lineWidth = 1;
  for (let x = layout.left; x <= cssWidth - layout.right; x += 44) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, cssHeight);
    ctx.stroke();
  }
  for (let y = layout.rootTop; y <= layout.leafBottom; y += 44) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(cssWidth, Math.round(y) + 0.5);
    ctx.stroke();
  }
  const glow = ctx.createRadialGradient(
    cssWidth * 0.5,
    (layout.branchTop + layout.branchBottom) * 0.5,
    0,
    cssWidth * 0.5,
    (layout.branchTop + layout.branchBottom) * 0.5,
    Math.max(cssWidth, cssHeight) * 0.56,
  );
  glow.addColorStop(0, "rgba(178,153,255,0.065)");
  glow.addColorStop(0.45, "rgba(85,217,255,0.025)");
  glow.addColorStop(1, "rgba(5,6,10,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
  ctx.restore();
}

function nodeCoordinates(envelope, xStart, xEnd, top, bottom) {
  return envelope.nodes.map((node) => ({
    x: lerp(xStart, xEnd, node.time),
    y: envelopeY(top, bottom, node.level),
    node,
  }));
}

function drawEnvelope(ctx, {
  envelope,
  xStart,
  xEnd,
  top,
  bottom,
  color,
  kind,
  branchIndex = null,
  label,
  focused,
}) {
  const points = nodeCoordinates(envelope, xStart, xEnd, top, bottom);
  ctx.save();
  ctx.globalAlpha = focused ? 1 : 0.58;
  ctx.beginPath();
  ctx.moveTo(points[0].x, bottom);
  for (const point of points) ctx.lineTo(point.x, point.y);
  ctx.lineTo(points.at(-1).x, bottom);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, bottom);
  fill.addColorStop(0, color.replace("1)", "0.16)"));
  fill.addColorStop(1, color.replace("1)", "0.015)"));
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = focused ? 2 : 1.25;
  ctx.shadowColor = color;
  ctx.shadowBlur = focused ? 9 : 3;
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (label && xEnd - xStart > 52) {
    ctx.fillStyle = color;
    ctx.font = `${focused ? 650 : 500} 7px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.letterSpacing = "0.08em";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(label, xStart + 3, top - 6);
  }

  points.forEach((point, nodeIndex) => {
    const selected = state.selection.kind === kind
      && state.selection.nodeIndex === nodeIndex
      && (kind === "root" || state.selection.branchIndex === branchIndex);
    ctx.save();
    ctx.translate(point.x, point.y);
    if (kind === "root") ctx.rotate(Math.PI / 4);
    ctx.fillStyle = selected ? color : "#07090e";
    ctx.strokeStyle = selected ? "#fff3d6" : color;
    ctx.lineWidth = selected ? 2 : 1.25;
    ctx.shadowColor = color;
    ctx.shadowBlur = selected ? 12 : 5;
    if (kind === "root") {
      ctx.fillRect(-5.5, -5.5, 11, 11);
      ctx.strokeRect(-5.5, -5.5, 11, 11);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
    hitRegions.push({
      kind: `${kind}-node`,
      branchIndex,
      nodeIndex,
      x: point.x,
      y: point.y,
      radius: 21,
      xStart,
      xEnd,
      top,
      bottom,
    });
  });
  ctx.restore();
  return points;
}

function leafColor(timbre, alpha = 1) {
  const hue = lerp(164, 24, clamp(timbre));
  return `hsla(${hue} 86% 69% / ${alpha})`;
}

function drawConnectors(ctx, layout, events, rootPoints) {
  const focusBranch = selectionBranch();
  ctx.save();
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 1;
  for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
    const rootStart = state.tree.root.nodes[branchIndex].time;
    const rootEnd = state.tree.root.nodes[branchIndex + 1].time;
    const rootMid = (rootStart + rootEnd) * 0.5;
    const rootLevel = sampleEnveloperEnvelope(state.tree.root, rootMid);
    const x = canvasX(layout, rootMid);
    ctx.beginPath();
    ctx.moveTo(x, envelopeY(layout.rootTop, layout.rootBottom, rootLevel) + 7);
    ctx.bezierCurveTo(
      x,
      layout.rootBottom + 8,
      x,
      layout.branchTop - 12,
      x,
      layout.branchTop - 3,
    );
    ctx.strokeStyle = focusBranch === null || focusBranch === branchIndex
      ? "rgba(125,180,255,0.48)"
      : "rgba(125,180,255,0.16)";
    ctx.stroke();
  }
  for (const event of events) {
    const branch = state.tree.branches[event.branchIndex];
    const localMid = (branch.nodes[event.leafInBranch].time + branch.nodes[event.leafInBranch + 1].time) * 0.5;
    const childLevel = sampleEnveloperEnvelope(branch, localMid);
    const x = canvasX(layout, (event.normalizedStart + event.normalizedEnd) * 0.5);
    ctx.beginPath();
    ctx.moveTo(x, envelopeY(layout.branchTop, layout.branchBottom, childLevel) + 6);
    ctx.lineTo(x, layout.leafTop - 5);
    const focused = focusBranch === null || focusBranch === event.branchIndex;
    ctx.strokeStyle = focused ? "rgba(95,232,196,0.38)" : "rgba(95,232,196,0.12)";
    ctx.stroke();
  }
  ctx.restore();
}

function drawLeaves(ctx, layout, events, activeIndex) {
  const leafHeight = Math.max(22, layout.leafBottom - layout.leafTop);
  for (const event of events) {
    const leaf = state.tree.leaves[event.index];
    const x = canvasX(layout, event.normalizedStart);
    const right = canvasX(layout, event.normalizedEnd);
    const width = Math.max(1, right - x);
    const selected = state.selection.kind === "leaf" && state.selection.leafIndex === event.index;
    const active = activeIndex === event.index;
    const color = leafColor(leaf.timbre, 1);
    const inset = width > 8 ? 2 : 0.5;

    ctx.save();
    roundedRectPath(ctx, x + inset, layout.leafTop, Math.max(1, width - inset * 2), leafHeight, 3);
    ctx.fillStyle = leafColor(leaf.timbre, active ? 0.18 : selected ? 0.12 : 0.055);
    ctx.fill();
    ctx.strokeStyle = selected ? "#fff3d6" : active ? color : leafColor(leaf.timbre, 0.38);
    ctx.lineWidth = selected ? 2 : active ? 1.7 : 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = active || selected ? 11 : 0;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (width > 26) {
      ctx.strokeStyle = leafColor(leaf.timbre, 0.11);
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(x + width * 0.5, layout.leafTop + 6);
      ctx.lineTo(x + width * 0.5, layout.leafBottom - 6);
      ctx.moveTo(x + 7, layout.leafTop + leafHeight * 0.5);
      ctx.lineTo(right - 7, layout.leafTop + leafHeight * 0.5);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const padX = Math.min(12, width * 0.22);
    const padY = Math.min(12, leafHeight * 0.2);
    const orbX = lerp(x + padX, right - padX, leaf.timbre);
    const orbY = lerp(layout.leafBottom - padY, layout.leafTop + padY, leaf.pitch);
    ctx.beginPath();
    ctx.arc(orbX, orbY, active ? 7 : 6, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#fff3d6" : color;
    ctx.shadowColor = color;
    ctx.shadowBlur = active || selected ? 13 : 7;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#07090e";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = active ? "#fff3d6" : selected ? "rgba(255,243,214,0.86)" : "rgba(219,228,224,0.5)";
    ctx.font = "600 7px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(String(event.index + 1).padStart(2, "0"), x + 7, layout.leafTop + 6);
    if (!layout.compact && width > 76) {
      ctx.fillStyle = "rgba(219,228,224,0.38)";
      ctx.font = "500 6px ui-monospace, SFMono-Regular, Menlo, monospace";
      ctx.fillText(`${event.durationSeconds.toFixed(2)}s`, x + 7, layout.leafTop + 17);
    }
    ctx.restore();

    hitRegions.push({
      kind: "leaf",
      leafIndex: event.index,
      x,
      right,
      top: layout.leafTop,
      bottom: layout.leafBottom,
      orbX,
      orbY,
    });
  }
}

function drawPlayhead(ctx, layout, phase) {
  const x = canvasX(layout, phase);
  ctx.save();
  ctx.strokeStyle = "rgba(255,243,214,0.78)";
  ctx.lineWidth = 1;
  ctx.shadowColor = "#fff3d6";
  ctx.shadowBlur = reducedMotion ? 0 : 8;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, layout.rootTop - 13);
  ctx.lineTo(x + 0.5, layout.leafBottom + 9);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff3d6";
  ctx.beginPath();
  ctx.moveTo(x - 4, layout.rootTop - 14);
  ctx.lineTo(x + 4, layout.rootTop - 14);
  ctx.lineTo(x, layout.rootTop - 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function draw() {
  const layout = layoutForStage();
  const events = timeline();
  const phase = cyclePhase();
  const active = eventAtPhase(events, phase);
  state.activeLeafIndex = active.index;
  latestLayout = layout;
  hitRegions = [];
  context.save();
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  drawBackground(context, layout);

  const rootFocused = state.selection.kind === "root";
  const rootPoints = drawEnvelope(context, {
    envelope: state.tree.root,
    xStart: layout.left,
    xEnd: layout.left + layout.width,
    top: layout.rootTop,
    bottom: layout.rootBottom,
    color: "rgba(178,153,255,1)",
    kind: "root",
    label: "PARENT ENVELOPE · 4 NODES / 3 LIMBS",
    focused: rootFocused || state.selection.kind === "leaf",
  });
  drawConnectors(context, layout, events, rootPoints);

  const focusBranch = selectionBranch();
  for (let branchIndex = 0; branchIndex < 3; branchIndex += 1) {
    const xStart = canvasX(layout, state.tree.root.nodes[branchIndex].time);
    const xEnd = canvasX(layout, state.tree.root.nodes[branchIndex + 1].time);
    drawEnvelope(context, {
      envelope: state.tree.branches[branchIndex],
      xStart,
      xEnd,
      top: layout.branchTop,
      bottom: layout.branchBottom,
      color: "rgba(85,217,255,1)",
      kind: "branch",
      branchIndex,
      label: `CHILD ${branchIndex + 1} · 4 NODES`,
      focused: focusBranch === null || focusBranch === branchIndex,
    });
  }

  drawLeaves(context, layout, events, active.index);
  drawPlayhead(context, layout, phase);
  context.restore();
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  cssWidth = Math.max(1, Math.round(bounds.width));
  cssHeight = Math.max(1, Math.round(bounds.height));
  const budgetRatio = Math.sqrt(4_000_000 / Math.max(1, cssWidth * cssHeight));
  pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1, budgetRatio));
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  draw();
}

function selectedEvent(events = timeline()) {
  return events[selectedLeafIndex()] ?? events[0];
}

function syncPresetButtons() {
  for (const button of $("presetButtons").querySelectorAll("[data-preset]")) {
    button.setAttribute("aria-pressed", String(button.dataset.preset === state.activePresetId));
  }
  $("presetDescription").textContent = state.activePresetId
    ? PRESET_COPY[state.activePresetId] ?? "A nested envelope tree."
    : "Custom tree — timing, inheritance, or leaf sound has been edited.";
}

function syncSelectionUi() {
  const events = timeline();
  const leafIndex = selectedLeafIndex();
  const event = events[leafIndex];
  const isLeaf = state.selection.kind === "leaf";
  $("leafInspector").hidden = !isLeaf;
  $("nodeInspector").hidden = isLeaf;

  for (const button of $("leafSelector").querySelectorAll("[data-leaf]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.leaf) === leafIndex && isLeaf));
  }

  if (isLeaf) {
    const leaf = state.tree.leaves[leafIndex];
    $("selectedTimbre").value = String(leaf.timbre);
    $("selectedPitch").value = String(leaf.pitch);
    $("selectedTimbreOut").textContent = `${Math.round(leaf.timbre * 100)}%`;
    $("selectedPitchOut").textContent = `${noteNameFromFrequency(event.frequencyHz)} · ${formatFrequency(event.frequencyHz)}`;
    $("selectionSummary").textContent = `leaf ${String(leafIndex + 1).padStart(2, "0")} · pitch + timbre`;
    $("selectedShort").textContent = `leaf ${String(leafIndex + 1).padStart(2, "0")}`;
  } else {
    const selected = selectedNode();
    const nodeIndex = state.selection.nodeIndex;
    const node = selected.node;
    $("selectedNodeTime").value = String(node.time);
    $("selectedNodeLevel").value = String(node.level);
    $("selectedNodeTime").disabled = nodeIndex === 0 || nodeIndex === 3;
    $("selectedNodeTime").min = nodeIndex === 0
      ? "0"
      : String(selected.envelope.nodes[nodeIndex - 1].time + ENVELOPER_MIN_SPLIT_GAP);
    $("selectedNodeTime").max = nodeIndex === 3
      ? "1"
      : String(selected.envelope.nodes[nodeIndex + 1].time - ENVELOPER_MIN_SPLIT_GAP);
    $("selectedNodeTimeOut").textContent = nodeIndex === 0 || nodeIndex === 3
      ? `${Math.round(node.time * 100)}% · anchored`
      : `${Math.round(node.time * 100)}%`;
    $("selectedNodeLevelOut").textContent = `${Math.round(node.level * 100)}%`;
    const owner = state.selection.kind === "root"
      ? "parent"
      : `child ${state.selection.branchIndex + 1}`;
    $("selectionSummary").textContent = `${owner} · node ${nodeIndex + 1}`;
    $("selectedShort").textContent = `${owner} n${nodeIndex + 1}`;
  }

  $("selectedDuration").textContent = `${event.durationSeconds.toFixed(2)} s`;
  $("selectedVoice").textContent = formatFrequency(event.frequencyHz);
  canvas.setAttribute(
    "aria-label",
    isLeaf
      ? `Nested envelope tree. Leaf ${leafIndex + 1} selected at ${formatFrequency(event.frequencyHz)} and ${Math.round(state.tree.leaves[leafIndex].timbre * 100)} percent FM timbre.`
      : `Nested envelope tree. ${$("selectionSummary").textContent} selected.`,
  );
}

function syncGlobalControls() {
  $("level").value = String(state.level);
  $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  $("cycleSeconds").value = String(state.tree.cycleSeconds);
  $("cycleSecondsOut").textContent = `${state.tree.cycleSeconds.toFixed(2)} s`;
  $("baseMidi").value = String(state.baseMidi);
  $("pitchSpan").value = String(state.pitchSpan);
  $("fmAmount").value = String(state.fmAmount);
  $("baseMidiOut").textContent = `${noteNameFromMidi(state.baseMidi)} · ${formatFrequency(midiToFrequency(state.baseMidi))}`;
  $("pitchSpanOut").textContent = `${state.pitchSpan} st`;
  $("fmAmountOut").textContent = `${Math.round(state.fmAmount * 100)}%`;
  $("soundSummary").textContent = `${noteNameFromMidi(state.baseMidi)} · ${state.pitchSpan} semitone span`;
  $("stageTimeReadout").textContent = `${state.tree.cycleSeconds.toFixed(2)} S CYCLE`;
  $("playSummary").textContent = `${state.playing ? "playing" : "paused"} · ${state.tree.cycleSeconds.toFixed(2)} s`;
  $("treeState").textContent = state.playing ? "growing" : state.activePresetId ? "ready" : "custom";
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playButton").setAttribute("aria-label", state.playing ? "Pause the envelope tree" : "Play the envelope tree");
}

function syncUi() {
  syncPresetButtons();
  syncGlobalControls();
  syncSelectionUi();
  draw();
}

function updateFrameUi(now) {
  if (now - lastUiFrame < 70) return;
  lastUiFrame = now;
  const score = currentScore(now);
  const phase = cyclePhase(score);
  const events = timeline();
  const active = eventAtPhase(events, phase);
  $("position").value = String(phase);
  $("positionOut").textContent = `${Math.round(phase * 100)}%`;
  $("stageLeafReadout").textContent = `LEAF ${String(active.index + 1).padStart(2, "0")} · ${formatFrequency(active.frequencyHz).toUpperCase()} · FM ${Math.round(active.timbre * 100)}%`;
}

function triggerEvent(event, durationSeconds = event.durationSeconds) {
  if (!state.audioOn || !audio.engineRunning) return;
  void audio.triggerLeaf(
    soundingEvent(event, durationSeconds),
    audio.currentTime + 0.004,
  ).catch(showError);
}

function joinCurrentLeaf() {
  if (!state.playing || !state.audioOn || !audio.engineRunning) return;
  const events = timeline();
  const phase = cyclePhase();
  const event = eventAtPhase(events, phase);
  const remaining = Math.max(0.025, (event.normalizedEnd - phase) * state.tree.cycleSeconds);
  triggerEvent(event, remaining);
}

function processAudioCrossings(score) {
  if (!state.playing) {
    state.lastProcessedScore = score;
    return;
  }
  const previous = state.lastProcessedScore;
  state.lastProcessedScore = score;
  if (!state.audioOn || !audio.engineRunning || score <= previous) return;
  const cycle = state.tree.cycleSeconds;
  if (score - previous > Math.max(1, cycle * 1.5)) {
    joinCurrentLeaf();
    return;
  }
  const events = timeline();
  const firstCycle = Math.floor(previous / cycle);
  const lastCycle = Math.floor(score / cycle);
  for (let cycleIndex = firstCycle; cycleIndex <= lastCycle; cycleIndex += 1) {
    for (const event of events) {
      const boundary = cycleIndex * cycle + event.startSeconds;
      if (boundary > previous + 1e-5 && boundary <= score + 1e-5) triggerEvent(event);
    }
  }
}

function animate(now) {
  const score = currentScore(now);
  processAudioCrossings(score);
  updateFrameUi(now);
  draw();
  frameId = requestAnimationFrame(animate);
}

function setPlaying(playing) {
  const now = performance.now();
  if (state.playing === Boolean(playing)) return;
  if (state.playing) state.scoreSeconds = currentScore(now) % state.tree.cycleSeconds;
  state.playing = Boolean(playing);
  state.scoreAnchorPerformance = now;
  state.lastProcessedScore = state.scoreSeconds;
  if (state.playing) {
    joinCurrentLeaf();
    announce(state.audioOn ? "Envelope tree playing." : "Audio is off — turn it on to hear playback");
  } else {
    audio.silence();
    announce("Envelope tree paused.");
  }
  syncGlobalControls();
  draw();
}

function restartTransport() {
  const now = performance.now();
  state.scoreSeconds = 0;
  state.scoreAnchorPerformance = now;
  state.lastProcessedScore = 0;
  audio.silence();
  if (state.playing) triggerEvent(timeline()[0]);
  updateFrameUi(now);
  draw();
  announce(state.playing ? "Envelope tree restarted at leaf 1." : "Cycle position returned to the beginning.");
}

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  if (state.audioOn) {
    state.audioOn = false;
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    audio.silence();
    await audio.close();
    announce("Enveloper audio off. The tree clock is unchanged.");
    return;
  }
  state.audioStarting = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = "starting";
  try {
    await audio.start();
    audio.setLevel(state.level);
    state.audioOn = true;
    $("audioButton").setAttribute("aria-pressed", "true");
    $("audioState").textContent = "on";
    joinCurrentLeaf();
    announce(state.playing
      ? "Enveloper audio on, joined at the current leaf."
      : "Enveloper audio on. Press play or preview a leaf.");
  } catch (error) {
    state.audioOn = false;
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    showError(error);
    await audio.close();
  } finally {
    state.audioStarting = false;
    $("audioButton").disabled = false;
  }
}

function previewSelectedLeaf() {
  if (!state.audioOn || !audio.engineRunning) {
    announce("Audio is off — turn it on to hear the selected leaf");
    return;
  }
  const event = selectedEvent();
  triggerEvent(event, Math.min(0.85, Math.max(0.18, event.durationSeconds)));
  announce(`Previewing leaf ${event.index + 1}, ${formatFrequency(event.frequencyHz)}.`);
}

function applyPreset(id) {
  const preset = ENVELOPER_PRESETS.find((item) => item.id === id);
  if (!preset) return;
  const now = performance.now();
  const wasPlaying = state.playing;
  audio.silence();
  state.tree = createEnveloperState(id);
  state.activePresetId = id;
  state.scoreSeconds = 0;
  state.scoreAnchorPerformance = now;
  state.lastProcessedScore = 0;
  state.selection = { kind: "leaf", leafIndex: 0 };
  syncUi();
  if (wasPlaying) triggerEvent(timeline()[0]);
  announce(`${preset.label} envelope tree selected.`);
}

function evenSplits() {
  const times = [0, 1 / 3, 2 / 3, 1];
  state.tree.root.nodes.forEach((node, index) => { node.time = times[index]; });
  state.tree.branches.forEach((branch) => {
    branch.nodes.forEach((node, index) => { node.time = times[index]; });
  });
  state.tree = sanitizeEnveloperState(state.tree);
  state.activePresetId = null;
  audio.silence();
  state.lastProcessedScore = currentScore();
  syncUi();
  announce("All parent and child timing splits are even.");
}

function resetAll() {
  audio.silence();
  state.tree = createEnveloperState();
  Object.assign(state, {
    level: DEFAULT_UI.level,
    baseMidi: DEFAULT_UI.baseMidi,
    pitchSpan: DEFAULT_UI.pitchSpan,
    fmAmount: DEFAULT_UI.fmAmount,
    activePresetId: DEFAULT_ENVELOPER_PRESET_ID,
    scoreSeconds: 0,
    scoreAnchorPerformance: performance.now(),
    lastProcessedScore: 0,
    selection: { kind: "leaf", leafIndex: 0 },
  });
  audio.setLevel(state.level);
  syncUi();
  if (state.playing) triggerEvent(timeline()[0]);
  announce("Enveloper reset to the balanced canopy.");
}

function pointFromEvent(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: clamp(event.clientX - bounds.left, 0, bounds.width),
    y: clamp(event.clientY - bounds.top, 0, bounds.height),
  };
}

function hitTest(point) {
  let closest = null;
  let closestDistance = Infinity;
  for (const region of hitRegions) {
    if (region.kind === "leaf") continue;
    const distance = Math.hypot(point.x - region.x, point.y - region.y);
    if (distance <= region.radius && distance < closestDistance) {
      closest = region;
      closestDistance = distance;
    }
  }
  if (closest) return closest;
  return hitRegions.find((region) => (
    region.kind === "leaf"
    && point.x >= region.x
    && point.x <= region.right
    && point.y >= region.top
    && point.y <= region.bottom
  )) ?? null;
}

function updateDrag(point) {
  const drag = state.drag;
  if (!drag) return;
  if (drag.kind === "leaf") {
    const region = hitRegions.find((candidate) => candidate.kind === "leaf" && candidate.leafIndex === drag.leafIndex);
    if (!region) return;
    const padX = Math.min(12, (region.right - region.x) * 0.22);
    const padY = Math.min(12, (region.bottom - region.top) * 0.2);
    updateSelectedLeaf({
      timbre: (point.x - region.x - padX) / Math.max(1, region.right - region.x - padX * 2),
      pitch: (region.bottom - padY - point.y) / Math.max(1, region.bottom - region.top - padY * 2),
    });
    return;
  }
  const time = (point.x - drag.xStart) / Math.max(1, drag.xEnd - drag.xStart);
  const level = (drag.bottom - point.y) / Math.max(1, drag.bottom - drag.top);
  updateSelectedNode({ time, level });
}

function beginPointer(event) {
  if (event.button !== 0) return;
  const point = pointFromEvent(event);
  const hit = hitTest(point);
  if (!hit) return;
  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus({ preventScroll: true });
  if (hit.kind === "leaf") {
    selectLeaf(hit.leafIndex);
    state.drag = { kind: "leaf", leafIndex: hit.leafIndex, pointerId: event.pointerId };
  } else if (hit.kind === "root-node") {
    selectNode("root", null, hit.nodeIndex);
    state.drag = { ...hit, kind: "root", pointerId: event.pointerId };
  } else {
    selectNode("branch", hit.branchIndex, hit.nodeIndex);
    state.drag = { ...hit, kind: "branch", pointerId: event.pointerId };
  }
  stageWrap.classList.add("is-editing");
  updateDrag(point);
}

function movePointer(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  event.preventDefault();
  updateDrag(pointFromEvent(event));
}

function endPointer(event) {
  if (!state.drag || state.drag.pointerId !== event.pointerId) return;
  const completed = state.drag;
  state.drag = null;
  stageWrap.classList.remove("is-editing");
  canvas.releasePointerCapture?.(event.pointerId);
  if (completed.kind === "leaf") updateSelectedLeaf({}, { announceChange: true });
  else updateSelectedNode({}, { announceChange: true });
}

function nudgeSelection(key, large) {
  const amount = large ? 0.05 : 0.01;
  if (state.selection.kind === "leaf") {
    const leaf = state.tree.leaves[state.selection.leafIndex];
    if (key === "ArrowLeft") updateSelectedLeaf({ timbre: leaf.timbre - amount });
    if (key === "ArrowRight") updateSelectedLeaf({ timbre: leaf.timbre + amount });
    if (key === "ArrowUp") updateSelectedLeaf({ pitch: leaf.pitch + amount });
    if (key === "ArrowDown") updateSelectedLeaf({ pitch: leaf.pitch - amount });
    return;
  }
  const selected = selectedNode();
  const node = selected.node;
  if (key === "ArrowLeft") updateSelectedNode({ time: node.time - amount });
  if (key === "ArrowRight") updateSelectedNode({ time: node.time + amount });
  if (key === "ArrowUp") updateSelectedNode({ level: node.level + amount });
  if (key === "ArrowDown") updateSelectedNode({ level: node.level - amount });
}

function bindControls() {
  $("audioButton").addEventListener("click", () => { void toggleAudio(); });
  $("playButton").addEventListener("click", () => setPlaying(!state.playing));
  $("restartButton").addEventListener("click", restartTransport);
  $("previewButton").addEventListener("click", previewSelectedLeaf);
  $("evenSplitsButton").addEventListener("click", evenSplits);
  $("resetAll").addEventListener("click", resetAll);

  $("level").addEventListener("input", (event) => {
    state.level = Number(event.target.value);
    audio.setLevel(state.level);
    $("levelOut").textContent = `${Math.round(state.level * 100)}%`;
  });
  $("position").addEventListener("input", (event) => {
    const now = performance.now();
    state.scoreSeconds = clamp(Number(event.target.value)) * state.tree.cycleSeconds;
    state.scoreAnchorPerformance = now;
    state.lastProcessedScore = state.scoreSeconds;
    audio.silence();
    if (state.playing) joinCurrentLeaf();
    updateFrameUi(now);
    draw();
  });
  $("cycleSeconds").addEventListener("input", (event) => {
    keepPhaseWhileChanging(() => { state.tree.cycleSeconds = Number(event.target.value); });
    state.activePresetId = null;
    audio.silence();
    if (state.playing) joinCurrentLeaf();
    syncUi();
  });
  $("baseMidi").addEventListener("input", (event) => {
    state.baseMidi = Math.round(Number(event.target.value));
    state.activePresetId = null;
    syncUi();
  });
  $("pitchSpan").addEventListener("input", (event) => {
    state.pitchSpan = Math.round(Number(event.target.value));
    state.activePresetId = null;
    syncUi();
  });
  $("fmAmount").addEventListener("input", (event) => {
    state.fmAmount = Number(event.target.value);
    state.activePresetId = null;
    syncUi();
  });
  $("selectedTimbre").addEventListener("input", (event) => {
    updateSelectedLeaf({ timbre: Number(event.target.value) });
  });
  $("selectedPitch").addEventListener("input", (event) => {
    updateSelectedLeaf({ pitch: Number(event.target.value) });
  });
  $("selectedNodeTime").addEventListener("input", (event) => {
    updateSelectedNode({ time: Number(event.target.value) });
  });
  $("selectedNodeLevel").addEventListener("input", (event) => {
    updateSelectedNode({ level: Number(event.target.value) });
  });

  $("presetButtons").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (button) applyPreset(button.dataset.preset);
  });
  $("leafSelector").addEventListener("click", (event) => {
    const button = event.target.closest("[data-leaf]");
    if (button) selectLeaf(Number(button.dataset.leaf), { announceSelection: true });
  });

  canvas.addEventListener("pointerdown", beginPointer);
  canvas.addEventListener("pointermove", movePointer);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("keydown", (event) => {
    if (/^[1-9]$/.test(event.key)) {
      event.preventDefault();
      selectLeaf(Number(event.key) - 1, { announceSelection: true });
      return;
    }
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      nudgeSelection(event.key, event.shiftKey);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      previewSelectedLeaf();
    }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    audio.silence();
    return;
  }
  state.lastProcessedScore = currentScore();
  joinCurrentLeaf();
});

window.addEventListener("pagehide", () => {
  if (frameId) cancelAnimationFrame(frameId);
  void audio.close();
}, { once: true });

bindControls();
syncUi();
if (typeof ResizeObserver === "function") new ResizeObserver(resizeCanvas).observe(stageWrap);
else window.addEventListener("resize", resizeCanvas);
resizeCanvas();
frameId = requestAnimationFrame(animate);
