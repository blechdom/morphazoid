/** Native control model. Geometry follows the original browser instrument. */
import { DEFAULT_MASTERING, sanitizeMastering, randomMastering } from './mastering.js';
export const L_SYSTEM_TYPES = Object.freeze(['pythagorean', 'plant', 'coral', 'dragon', 'koch', 'sierpinski', 'hilbert', 'gosper', 'cantor', 'levy', 'terdragon']);
export const DEFAULT_PARAMETERS = Object.freeze({ lSystemType: 'pythagorean', generations: 13, intervalMs: 240,
  timeRatio: .72, angle: 45, asymmetry: 0, mutation: 0, pitchScale: 1, pruningBias: 0, depth: .72, spread: .9 });
export const DEFAULT_PERFORMANCE = Object.freeze({ source: 'mic', level: .58, wet: .76, dry: 0,
  frozen: false, inputGain: .85, frequency: 173, pulseRate: 2, voiceCeiling: 0, automatic: true, mastering: DEFAULT_MASTERING });
export const PARAMETER_LIMITS = Object.freeze({ generations: [1, 52], intervalMs: [1, 3000], timeRatio: [.2, 2],
  angle: [0, 180], asymmetry: [-.8, .8], mutation: [0, 1], pitchScale: [0, 4], pruningBias: [-1, 1], depth: [0, .96], spread: [0, 1] });
export const PERFORMANCE_LIMITS = Object.freeze({ level: [0, 1], wet: [0, 1], dry: [0, .5], inputGain: [0, 1.5], frequency: [40, 1200], pulseRate: [.1, 12], voiceCeiling: [0, Number.MAX_SAFE_INTEGER] });
export const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const round = value => Number(value.toFixed(6));
export function sanitizeParameters(candidate = {}) {
  const next = { lSystemType: L_SYSTEM_TYPES.includes(candidate.lSystemType) ? candidate.lSystemType : DEFAULT_PARAMETERS.lSystemType };
  for (const [key, [low, high]] of Object.entries(PARAMETER_LIMITS)) {
    const value = Number(candidate[key]);
    next[key] = clamp(Number.isFinite(value) ? value : DEFAULT_PARAMETERS[key], low, high);
  }
  next.generations = Math.round(next.generations);
  return next;
}
export function sanitizePerformance(candidate = {}) {
  const next = { ...DEFAULT_PERFORMANCE, ...candidate };
  for (const [key, [low, high]] of Object.entries(PERFORMANCE_LIMITS)) {
    const value = Number(next[key]);
    next[key] = round(clamp(Number.isFinite(value) ? value : DEFAULT_PERFORMANCE[key], low, high));
  }
  next.voiceCeiling = Math.round(next.voiceCeiling);
  next.source = next.source === 'mic' ? 'mic' : 'seed';
  next.automatic = Boolean(next.automatic); next.frozen = Boolean(next.frozen);
  next.mastering = sanitizeMastering(next.mastering);
  return next;
}
export function captureScene(parameters, performance) {
  return { parameters: sanitizeParameters(parameters), performance: { wet: performance.wet, dry: performance.dry,
    inputGain: performance.inputGain, level: performance.level, mastering: sanitizeMastering(performance.mastering) } };
}
/** Complete musical recalls never inherit another scene's mix or mastering. */
export function presetState(preset, performance) {
  const snapshot = preset.snapshot ?? preset;
  const saved = snapshot.performance ?? {}, next = { ...performance };
  for (const key of ['wet', 'dry', 'inputGain', 'level', 'mastering']) next[key] = saved[key] ?? DEFAULT_PERFORMANCE[key];
  // Older snapshots may include seed controls. Capture, freeze and device
  // policy belong to the current session even when a legacy file includes them.
  for (const key of ['frequency', 'pulseRate']) if (Object.hasOwn(saved, key)) next[key] = saved[key];
  return { parameters: sanitizeParameters(snapshot.parameters), performance: sanitizePerformance(next) };
}
export function randomState(parameters, performance, random = Math.random) {
  const unit = () => clamp(Number(random()) || 0);
  const between = (a, b) => a + (b - a) * unit();
  return { parameters: sanitizeParameters({ ...parameters, lSystemType: L_SYSTEM_TYPES[Math.min(10, Math.floor(unit() * 11))],
    generations: Math.floor(between(3, 14)), intervalMs: 10 ** between(0, 3.1), timeRatio: between(.2, 2), angle: between(0, 180),
    asymmetry: between(-.8, .8), mutation: unit(), pitchScale: between(0, 4), pruningBias: unit(), depth: between(.25, .92), spread: unit() }),
  performance: sanitizePerformance({ ...performance, wet: between(.4, .9), dry: between(0, .25), inputGain: between(.45, .85), mastering: randomMastering(random) }) };
}
export function gestureParameters(start, dx, dy, width, height, fine = false) {
  const scale = fine ? .15 : 1;
  return sanitizeParameters({ ...start, intervalMs: start.intervalMs * Math.exp(clamp(dx / Math.max(1, width) * 8 * scale, -30, 30)),
    angle: start.angle - dy / Math.max(1, height) * 180 * scale });
}
export function isVoiceActive(node, limit) { return Number.isInteger(node.priority) && node.priority >= 0 && node.priority < limit && node.gain > 0; }
/** Draw every admitted branch; visual pressure only changes frame/detail budgets. */
export function admittedPreviewNodes(nodes, limit) { return nodes.filter(n => n.generation === 0 || isVoiceActive(n, limit)); }
export function topologyIdentity(parameters) { return `${parameters.lSystemType}:${parameters.generations}`; }
/** Coherent meters are keyed by pool slots, never mutable pruning ranks. */
export function tapActivityFrame(reply, parameters) {
  const status = reply?.status, revision = reply?.topologyRevision;
  if (!status || !Number.isSafeInteger(revision) || revision < 1 || status.topologyRevision !== revision
    || topologyIdentity(reply.parameters ?? {}) !== topologyIdentity(parameters)
    || !Array.isArray(status.tapActivity) || !Array.isArray(status.tapVoiceIndices)) return null;
  const wetBusGain = Number.isFinite(status.wetBusGain) ? Math.max(0, status.wetBusGain) : 0, levels = new Map();
  for (let rank = 0; rank < Math.min(status.tapActivity.length, status.tapVoiceIndices.length); rank++) {
    const slot = status.tapVoiceIndices[rank], rms = status.tapActivity[rank];
    if (Number.isSafeInteger(slot) && slot >= 0 && Number.isFinite(rms)) levels.set(slot, Math.max(0, rms) * wetBusGain);
  }
  return { revision, identity: topologyIdentity(parameters), levels };
}
/** Continuous response makes faint voices visible without an on/off threshold. */
export function activityEnergy(level) { return Number.isFinite(level) ? clamp(1 - Math.exp(-Math.sqrt(Math.max(0, level)) * 6)) : 0; }
export function smoothActivity(current, target, elapsedMs) {
  const elapsed = clamp(Number.isFinite(elapsedMs) ? elapsedMs : 0, 0, 1000), timeConstant = target > current ? 25 : 110;
  const level = current + (target - current) * (1 - Math.exp(-elapsed / timeConstant));
  return target === 0 && level < 1e-5 ? 0 : level;
}
/** Native input envelopes use their own sample clock, independent of tap ranks. */
export function inputEnvelopeReader(snapshot) {
  const values = snapshot?.values, interval = Number(snapshot?.interval), end = Number(snapshot?.endTime);
  if (!Array.isArray(values) || !values.length || !Number.isFinite(end) || !Number.isFinite(interval) || interval <= 0) return null;
  const start = end - (values.length - 1) * interval;
  return time => {
    if (!Number.isFinite(time) || time < start) return 0;
    // Predict only the original release beyond the latest recorded sample;
    // missing packets cannot invent new attacks or hold a bright root forever.
    if (time >= end) return Math.max(0, Number(values.at(-1)) || 0) * Math.exp(-(time - end) / .16);
    const position = clamp((time - start) / interval, 0, values.length - 1), before = Math.floor(position), after = Math.min(before + 1, values.length - 1);
    return Math.max(0, Number(values[before]) || 0) + ((Number(values[after]) || 0) - (Number(values[before]) || 0)) * (position - before);
  };
}
/** Recording survives topology edits and a temporarily unavailable tap snapshot. */
export function inputHistoryFrame(reply, previous = {}, receivedAt = 0) {
  const status = reply?.status, elapsed = status?.elapsedSeconds;
  if (!Number.isFinite(elapsed) || elapsed < 0) return previous;
  const reset = reply.audio === false || status.sampleRate === 0 || elapsed + 1 < (previous.clock ?? 0);
  const next = { ...previous, clock: reset ? elapsed : Math.max(previous.clock ?? 0, elapsed),
    clockReceivedAt: reset || elapsed >= (previous.clock ?? 0) ? receivedAt : previous.clockReceivedAt };
  if (reset) Object.assign(next, { reader: null, receivedAt: -Infinity, endTime: -Infinity });
  if (reply.audio === false || status.sampleRate === 0) return next;
  const reader = inputEnvelopeReader(status.inputEnvelope), endTime = status.inputEnvelope?.endTime;
  if (reader && (reset || endTime >= (previous.endTime ?? -Infinity))) {
    Object.assign(next, { reader, receivedAt, endTime });
  }
  return next;
}
/** Keep short branches legible without inventing activity at zero input.
 * Rendered tap energy takes precedence on transit times below visual resolution.
 * Longer edges retain the traveling input packet, with their endpoint anchored
 * to the measured output instead of a prediction of granular playback.
 */
export function branchWavePoints(node, start, end, envelope, detailSteps = 14, reducedMotion = false, nowSeconds = 0) {
  const dx = end.x - start.x, dy = end.y - start.y, length = Math.hypot(dx, dy);
  const normalX = length > 1e-6 ? -dy / length : 0, normalY = length > 1e-6 ? dx / length : 0;
  const steps = Math.max(5, Math.min(Math.max(5, Math.floor(detailSteps)), Math.max(5, Math.ceil(length / 14))));
  const shortness = clamp(1 - length / 64), offsetMaximum = clamp(length * .055, 1.5, 8) + shortness * 16;
  const fromHistory = typeof envelope === 'function';
  const startDelay = node.generation === 0 ? 0 : Math.max(0, node.startDelay ?? node.delay ?? 0);
  const endDelay = node.generation === 0 ? 0 : Math.max(startDelay, node.delay ?? 0);
  const measured = Number.isFinite(node.measuredEnergy), measuredEnergy = clamp(node.measuredEnergy ?? 0);
  const parentMeasured = Number.isFinite(node.parentEnergy), parentEnergy = clamp(node.parentEnergy ?? 0);
  const transit = endDelay - startDelay;
  const rate = Math.sqrt(clamp(node.rate ?? 1, .25, 4));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps, delayedTime = nowSeconds - (startDelay + (endDelay - startDelay) * progress);
    let strength = fromHistory ? clamp(1 - Math.exp(-Math.max(0, envelope(delayedTime)) * 5)) * clamp(node.voiceLevel ?? 1) : clamp(envelope);
    if (measured) {
      if (!fromHistory || transit <= .1) strength = measuredEnergy;
      else {
        // The input packet can travel through a long edge before reaching its
        // tap. Only actual output can brighten the audible endpoint.
        const arrival = clamp((progress - .8) / .2), blend = arrival * arrival * (3 - 2 * arrival);
        strength += (measuredEnergy - strength) * blend;
        if (parentMeasured) {
          const departure = clamp(progress / .2), outgoing = departure * departure * (3 - 2 * departure);
          strength = parentEnergy + (strength - parentEnergy) * outgoing;
        }
      }
    }
    const deflection = strength + (Math.sqrt(strength) - strength) * Math.sqrt(shortness);
    const carrier = Math.sin(nowSeconds * 9 * rate + progress * Math.PI * (3 + node.generation * .35) + (node.index ?? node.voiceIndex ?? 0) * .71);
    const offset = reducedMotion ? 0 : Math.sin(Math.PI * progress) * deflection * offsetMaximum * carrier;
    const point = { x: start.x + dx * progress + normalX * offset, y: start.y + dy * progress + normalY * offset };
    if (fromHistory || measured) point.energy = strength;
    points.push(point);
  }
  // Preserve connection exactly while keeping the endpoint's signal energy.
  points[0] = { ...points[0], ...start }; points[points.length - 1] = { ...points.at(-1), ...end };
  return points;
}

export function hashUnit(value) {
  let hash = 2166136261; const text = String(value);
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) / 0xffffffff;
}
let binaryTemplate = null;
function binaryNodes(p) {
  if (!binaryTemplate) {
    binaryTemplate = [{ id: 'trunk', parentIndex: -1, generation: 0, index: 0 }];
    let start = 0, count = 1;
    for (let g = 1; g <= 13; g++) {
      const next = binaryTemplate.length;
      for (let i = start; i < start + count; i++) for (const rule of ['A', 'B']) {
        const id = `${binaryTemplate[i].id}/${rule}`;
        binaryTemplate.push({ id, parentIndex: i, parentId: binaryTemplate[i].id, generation: g, index: binaryTemplate.length - next, rule,
          turnHash: hashUnit(`${id}:turn`), lengthHash: hashUnit(`${id}:length`) });
      }
      start = next; count *= 2;
    }
  }
  const visualRatio = p.timeRatio <= 1 ? p.timeRatio : 1 + Math.log2(p.timeRatio) * .08;
  const nodes = [{ ...binaryTemplate[0], parentId: null, rule: 'T', startX: 0, startY: 0, x: 1, y: 0, headingDegrees: 0, turnDegrees: 0, length: 1, timeScale: 0 }];
  const length = 2 ** (p.generations + 1) - 1;
  for (let i = 1; i < length; i++) {
    const n = binaryTemplate[i], parent = nodes[n.parentIndex];
    const turnDegrees = (n.rule === 'A' ? -p.angle * (1 - p.asymmetry) : p.angle * (1 + p.asymmetry)) + (n.turnHash * 2 - 1) * p.angle * p.mutation * .5;
    const headingDegrees = parent.headingDegrees + turnDegrees, heading = headingDegrees * Math.PI / 180;
    const variation = 1 - n.lengthHash * p.mutation * .3;
    const segmentLength = Math.max(.02, visualRatio ** n.generation * variation);
    nodes.push({ ...n, turnDegrees, headingDegrees, timeScale: p.timeRatio ** n.generation * variation, length: segmentLength,
      startX: parent.x, startY: parent.y, x: parent.x + Math.cos(heading) * segmentLength, y: parent.y + Math.sin(heading) * segmentLength });
  }
  return nodes;
}
/** Exact connected breadth/depth blend from the original pruning algorithm. */
export function priorityOrder(voices, bias = 0) {
  if (bias <= 0) return voices;
  const byId = new Map(voices.map(n => [n.id, n])), seen = new Set(), deepest = Math.max(0, ...voices.map(n => n.generation));
  const depthOrder = [];
  for (const target of voices.filter(n => n.generation === deepest).sort((a, b) => hashUnit(`audible:${a.id}`) - hashUnit(`audible:${b.id}`))) {
    const path = []; let cursor = target;
    while (cursor) { if (!seen.has(cursor.id)) path.unshift(cursor); cursor = byId.get(cursor.parentId); }
    for (const n of path) if (!seen.has(n.id)) { seen.add(n.id); depthOrder.push(n); }
  }
  for (const n of voices) if (!seen.has(n.id) && (n.parentId === 'trunk' || seen.has(n.parentId))) { seen.add(n.id); depthOrder.push(n); }
  if (bias >= 1) return depthOrder;
  const breadthRank = new Map(voices.map((n, i) => [n.id, i])), depthRank = new Map(depthOrder.map((n, i) => [n.id, i]));
  const children = new Map(), heap = [], result = [];
  for (const n of voices) { const list = children.get(n.parentId) ?? []; list.push(n); children.set(n.parentId, list); }
  const compare = (a, b) => (breadthRank.get(a.id) * (1 - bias) + depthRank.get(a.id) * bias) - (breadthRank.get(b.id) * (1 - bias) + depthRank.get(b.id) * bias) || breadthRank.get(a.id) - breadthRank.get(b.id);
  const push = n => { heap.push(n); let i = heap.length - 1; while (i > 0) { const parent = Math.floor((i - 1) / 2); if (compare(heap[parent], heap[i]) <= 0) break; [heap[parent], heap[i]] = [heap[i], heap[parent]]; i = parent; } };
  const pop = () => { const first = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; while (true) { let smallest = i; const a = i * 2 + 1, b = a + 1; if (a < heap.length && compare(heap[a], heap[smallest]) < 0) smallest = a; if (b < heap.length && compare(heap[b], heap[smallest]) < 0) smallest = b; if (smallest === i) break; [heap[i], heap[smallest]] = [heap[smallest], heap[i]]; i = smallest; } } return first; };
  for (const n of children.get('trunk') ?? []) push(n);
  while (heap.length) { const n = pop(); result.push(n); for (const child of children.get(n.id) ?? []) push(child); }
  return result;
}
/** Shared classic builder is supplied by the boundary; no browser import here. */
export function buildPreview(parameters, canonicalTopology) {
  const p = sanitizeParameters(parameters);
  // Visual detail is independent of audio demand. Larger trees retain their
  // full native topology while this preview follows a bounded ancestor tree.
  const preview = { ...p, generations: Math.min(13, p.generations) };
  const nodes = p.lSystemType === 'pythagorean' ? binaryNodes(preview) : canonicalTopology({ lSystemType: p.lSystemType, generations: preview.generations,
    branching: 1, mutation: p.mutation, timeRatio: p.timeRatio, angle: p.angle, asymmetry: p.asymmetry });
  const byId = new Map(), voices = [], counts = new Map();
  let maxY = .001;
  for (const n of nodes) maxY = Math.max(maxY, Math.abs(n.y));
  for (let index = 0; index < nodes.length; index++) {
    const n = nodes[index];
    const parent = byId.get(n.parentId), delay = (parent?.delay ?? 0) + (n.generation === 0 ? 0 : p.intervalMs / 1000 * (n.timeScale ?? n.length));
    const semitones = (parent?.semitones ?? 0) + n.turnDegrees / 180 * 12 * p.pitchScale;
    Object.assign(n, { voiceIndex: index - 1, delay, semitones, rate: clamp(2 ** (semitones / 12), .125, 8), pan: clamp(n.y / maxY * p.spread, -1, 1), gain: n.generation === 0 ? 1 : .5 * p.depth ** (n.generation * .72), priority: null });
    byId.set(n.id, n);
    if (n.generation > 0 && delay <= 39 + 1e-9 && n.gain > 0) { voices.push(n); counts.set(n.generation, (counts.get(n.generation) ?? 0) + 1); }
  }
  if (p.lSystemType !== 'pythagorean') voices.sort((a, b) => a.generation - b.generation);
  priorityOrder(voices, p.pruningBias).forEach((n, i) => { n.priority = i; n.gain /= Math.sqrt(counts.get(n.generation)); });
  return nodes;
}
/** Continuous preview targets settle in 80 ms even with delayed native replies. */
export function interpolateParameters(from, to, fraction) {
  const t = clamp(fraction), eased = t * t * (3 - 2 * t), next = { ...to };
  for (const key of Object.keys(PARAMETER_LIMITS)) if (key !== 'generations') next[key] = from[key] + (to[key] - from[key]) * eased;
  return next;
}
export function topologyBounds(nodes) {
  const b = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const n of nodes) { b.minX = Math.min(b.minX, n.startX, n.x); b.maxX = Math.max(b.maxX, n.startX, n.x); b.minY = Math.min(b.minY, n.startY, n.y); b.maxY = Math.max(b.maxY, n.startY, n.y); }
  return b;
}
export function fitTransform(bounds, width, height) {
  const margin = Math.max(30, Math.min(width, height) * .075), dx = Math.max(1e-9, bounds.maxX - bounds.minX), dy = Math.max(1e-9, bounds.maxY - bounds.minY);
  const scale = Math.min(Math.max(1, width - 2 * margin) / dx, Math.max(1, height - 2 * margin) / dy);
  return { scale, x: (width - dx * scale) / 2 - bounds.minX * scale, y: (height - dy * scale) / 2 + bounds.maxY * scale };
}

/** Visual backoff starts before audio approaches its processing deadline. */
export function visualBudget(load = 0, peak = 0, gesture = false, audio = true) {
  const pressure = load >= .85 || peak >= .95 ? 2 : load >= .65 || peak >= .85 ? 1 : 0;
  return { fps: !audio ? 60 : gesture ? pressure ? 30 : 60 : pressure === 2 ? 8 : pressure === 1 ? 15 : 30,
    branches: pressure === 2 ? 64 : pressure === 1 ? 160 : 640, pressure };
}


export function nativePreviewNodes(nodes) {
  return nodes.map(n => ({ ...n, id: n.key.replace(/^generation:/, ''), parentId: n.parentKey ? n.parentKey.replace(/^generation:/, '') : null, index: n.voiceIndex }));
}
export function interpolatePreviewNodes(nodes, previous, fraction) {
  const t = clamp(fraction), eased = t * t * (3 - 2 * t);
  return nodes.map(n => {
    const from = previous.get(n.id); if (!from) return n;
    const next = { ...n };
    for (const key of ['x', 'y', 'startX', 'startY']) next[key] = from[key] + (n[key] - from[key]) * eased;
    return next;
  });
}
