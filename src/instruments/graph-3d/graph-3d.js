import { generateGraph, edgeAudioParameters, graphEdgeSwitchMultipliers } from "../graph-delay/graph-delay.js";
import { graphSynthVoice } from "../../families/graph/graph-instruments.js";
import { rotatePoint3, projectPoint3 } from "../../solid.js";

export const TAU = Math.PI * 2;
export const clamp = (x, a = 0, b = 1, fallback = a) =>
  Math.max(a, Math.min(b, Number.isFinite(Number(x)) ? Number(x) : fallback));
export const GRAPH_3D_LIMITS = Object.freeze({ nodes: 24, edges: 192, pending: 1024, arrivalsPerRun: 160, hops: 48, laps: 8, horizon: 16, runs: 12 });
export const GRAPH_3D_TOPOLOGIES = Object.freeze(["chain", "tree", "dag", "ring", "smallworld", "mesh", "modular"]);
export const GRAPH_3D_LAYOUTS = Object.freeze(["sphere", "helix", "layers", "cube"]);
export const GRAPH_3D_SOURCES = Object.freeze({
  x: "X · left / right", height: "Y · height", depth: "Z · depth",
  distance: "Route length · XYZ", radius: "Radius · from center",
  strain: "Route stretch", none: "Off · fixed",
});
export const GRAPH_3D_DEFAULTS = Object.freeze({
  topology: "smallworld", nodeCount: 12, density: 0.25, seed: 17, layout: "sphere",
  depth: 0.85, twist: 0.3, repel: 0.3, spring: 0.42, gravity: 0.35, shell: 0.25,
  motion: false, tempo: 104, pulseBeats: 2, baseDelay: 95, distanceRatio: 4,
  feedback: 0.62, feedbackTone: 0.8, rootMidiNote: 68, pitchRange: 2,
  mapping: "height", soundMode: "fm", modulationIndex: 0.8, strain: 0.4,
  depthTone: 0.35, spread: 0.8, attack: 0.008, decay: 0.24, tuning: "free",
  timeSource: "distance", timbreSource: "strain", shadeSource: "depth", panSource: "x",
});
export const GRAPH_3D_SCENES = Object.freeze({
  "Orbital branches": { ...GRAPH_3D_DEFAULTS },
  "Helical return": { ...GRAPH_3D_DEFAULTS, topology: "ring", layout: "helix", twist: 0.8, nodeCount: 10, depth: 1, mapping: "depth", tempo: 90, pulseBeats: 4, feedback: 0.76 },
  "Floating canopy": { ...GRAPH_3D_DEFAULTS, topology: "tree", layout: "layers", nodeCount: 15, gravity: 0.15, repel: 0.52, shell: 0, depth: 0.7, mapping: "height", baseDelay: 155, decay: 0.48, soundMode: "sine" },
  "Elastic cube": { ...GRAPH_3D_DEFAULTS, topology: "mesh", layout: "cube", nodeCount: 18, depth: 1, motion: true, spring: 0.35, repel: 0.6, gravity: 0.22, shell: 0.35, strain: 0.85, mapping: "radius", tempo: 80, pulseBeats: 4 },
  "Flat to folded": { ...GRAPH_3D_DEFAULTS, topology: "dag", layout: "layers", depth: 0.08, twist: -0.65, nodeCount: 14, mapping: "depth", soundMode: "pm", pulseBeats: 4 },
  "Turning constellation": { ...GRAPH_3D_DEFAULTS, topology: "modular", layout: "sphere", nodeCount: 16, depth: 1.15, twist: -0.8, mapping: "bend", pitchRange: 1, feedback: 0.48, tempo: 112, pulseBeats: 4 },
  "Glass meridian": { ...GRAPH_3D_DEFAULTS, topology: "chain", layout: "helix", nodeCount: 9, seed: 23, depth: 1.1, twist: 0, timeSource: "height", mapping: "x", timbreSource: "depth", shadeSource: "height", panSource: "depth", modulationIndex: 0.3, strain: 0.45, tempo: 72, pulseBeats: 8, baseDelay: 180, decay: 0.65 },
  "Low orbit": { ...GRAPH_3D_DEFAULTS, topology: "ring", nodeCount: 7, seed: 31, rootMidiNote: 36, pitchRange: 0.7, mapping: "radius", soundMode: "sine", tempo: 62, pulseBeats: 4, baseDelay: 220, distanceRatio: 3, decay: 0.9, feedback: 0.8, shadeSource: "radius", depthTone: 0.7 },
  "Wire rain": { ...GRAPH_3D_DEFAULTS, topology: "dag", layout: "layers", nodeCount: 21, seed: 41, density: 0.48, timeSource: "depth", mapping: "height", timbreSource: "x", soundMode: "pm", modulationIndex: 2.3, strain: 0.65, baseDelay: 35, distanceRatio: 2.4, decay: 0.065, tempo: 160, pulseBeats: 1 },
  "Slow prism": { ...GRAPH_3D_DEFAULTS, topology: "tree", layout: "cube", nodeCount: 8, seed: 53, mapping: "distance", timbreSource: "radius", shadeSource: "distance", panSource: "height", soundMode: "triangle", baseDelay: 380, distanceRatio: 6, attack: 0.22, decay: 1.4, tempo: 42, pulseBeats: 8, pitchRange: 1.2 },
  "Crosswind": { ...GRAPH_3D_DEFAULTS, topology: "smallworld", layout: "layers", nodeCount: 17, seed: 61, timeSource: "x", mapping: "depth", timbreSource: "height", panSource: "depth", depth: 1.3, twist: -0.3, tempo: 132, pulseBeats: 2, baseDelay: 65, distanceRatio: 7, modulationIndex: 0.2, strain: 0.75 },
  "Equal crossings": { ...GRAPH_3D_DEFAULTS, topology: "ring", layout: "cube", nodeCount: 8, seed: 71, timeSource: "none", mapping: "radius", soundMode: "triangle", baseDelay: 125, decay: 0.1, tempo: 120, pulseBeats: 4, feedback: 0.84, shadeSource: "x", depthTone: 0.8 },
  "Shell choir": { ...GRAPH_3D_DEFAULTS, topology: "tree", layout: "sphere", nodeCount: 19, seed: 83, motion: true, shell: 0.9, gravity: 0, repel: 0.65, spring: 0.7, mapping: "radius", pitchRange: 0.65, soundMode: "sine", attack: 0.3, decay: 1.5, baseDelay: 250, tempo: 48, pulseBeats: 8, shadeSource: "radius" },
  "Taut metal": { ...GRAPH_3D_DEFAULTS, topology: "mesh", layout: "cube", nodeCount: 12, seed: 97, spring: 0.18, timeSource: "strain", mapping: "strain", pitchRange: 0.6, soundMode: "fm", modulationIndex: 2.6, strain: 0.9, shadeSource: "strain", depthTone: 0.75, decay: 0.12, baseDelay: 45, tempo: 138, pulseBeats: 2 },
  "Velvet helix": { ...GRAPH_3D_DEFAULTS, topology: "chain", layout: "helix", nodeCount: 14, seed: 103, twist: -0.8, mapping: "depth", timeSource: "radius", soundMode: "sine", rootMidiNote: 56, pitchRange: 1.3, attack: 0.14, decay: 1.1, baseDelay: 210, tempo: 54, pulseBeats: 8, panSource: "height", depthTone: 0.85 },
  "Sideways clock": { ...GRAPH_3D_DEFAULTS, topology: "ring", layout: "layers", nodeCount: 11, seed: 113, timeSource: "x", mapping: "none", timbreSource: "height", shadeSource: "x", panSource: "depth", soundMode: "pm", baseDelay: 70, distanceRatio: 8, modulationIndex: 0.4, strain: 0.85, decay: 0.08, tempo: 105, pulseBeats: 4 },
  "Depth pebbles": { ...GRAPH_3D_DEFAULTS, topology: "smallworld", layout: "sphere", nodeCount: 9, seed: 127, timeSource: "depth", mapping: "distance", timbreSource: "depth", soundMode: "fm", rootMidiNote: 44, pitchRange: 0.8, modulationIndex: 1.4, strain: 0.8, baseDelay: 60, distanceRatio: 5, decay: 0.09, tempo: 144, pulseBeats: 1 },
  "Folded fan": { ...GRAPH_3D_DEFAULTS, topology: "dag", layout: "layers", nodeCount: 16, seed: 137, depth: 0.15, twist: 1, timeSource: "height", mapping: "bend", pitchRange: 0.8, soundMode: "triangle", baseDelay: 110, distanceRatio: 5, attack: 0.035, decay: 0.4, panSource: "radius", tempo: 92, pulseBeats: 4 },
  "Polar lanterns": { ...GRAPH_3D_DEFAULTS, topology: "modular", layout: "sphere", nodeCount: 20, seed: 149, density: 0.15, depth: 1.25, mapping: "height", timbreSource: "radius", shadeSource: "height", panSource: "depth", modulationIndex: 0.15, strain: 0.35, attack: 0.09, decay: 0.85, tempo: 58, pulseBeats: 8, baseDelay: 240, feedback: 0.78 },
  "Spring insects": { ...GRAPH_3D_DEFAULTS, topology: "mesh", layout: "helix", nodeCount: 15, seed: 157, motion: true, spring: 0.2, repel: 0.85, gravity: 0.08, shell: 0.6, mapping: "strain", timeSource: "strain", pitchRange: 1.1, rootMidiNote: 76, soundMode: "pm", modulationIndex: 1.6, strain: 0.85, decay: 0.045, baseDelay: 25, distanceRatio: 2, tempo: 188, pulseBeats: 1 },
  "Hollow cube": { ...GRAPH_3D_DEFAULTS, topology: "tree", layout: "cube", nodeCount: 8, seed: 167, depth: 1.3, twist: 0, mapping: "depth", timeSource: "x", soundMode: "sine", rootMidiNote: 40, pitchRange: 1.4, shadeSource: "distance", depthTone: 0.85, panSource: "height", attack: 0.015, decay: 0.8, baseDelay: 290, tempo: 44, pulseBeats: 8 },
  "Spiral mirage": { ...GRAPH_3D_DEFAULTS, topology: "ring", layout: "helix", nodeCount: 13, seed: 179, mapping: "bend", pitchRange: 1.2, soundMode: "shepard", timeSource: "depth", shadeSource: "height", depthTone: 0.2, baseDelay: 160, distanceRatio: 3, decay: 0.42, feedback: 0.82, tempo: 70, pulseBeats: 8 },
  "Long shadows": { ...GRAPH_3D_DEFAULTS, topology: "chain", layout: "layers", nodeCount: 6, seed: 191, mapping: "x", pitchRange: 2.5, timeSource: "radius", shadeSource: "depth", depthTone: 1, soundMode: "triangle", panSource: "none", attack: 0.35, decay: 1.4, baseDelay: 400, distanceRatio: 7, tempo: 35, pulseBeats: 8 },
  "Bright splinters": { ...GRAPH_3D_DEFAULTS, topology: "dag", layout: "cube", nodeCount: 22, seed: 199, density: 0.6, mapping: "distance", timeSource: "none", baseDelay: 45, rootMidiNote: 80, pitchRange: 0.75, soundMode: "fm", timbreSource: "x", shadeSource: "none", modulationIndex: 3.2, strain: 0.45, decay: 0.055, tempo: 176, pulseBeats: 2 },
  "Breathing islands": { ...GRAPH_3D_DEFAULTS, topology: "modular", layout: "layers", nodeCount: 18, seed: 211, density: 0.22, motion: true, repel: 0.45, gravity: 0.1, shell: 0.8, spring: 0.75, mapping: "radius", timeSource: "radius", soundMode: "sine", rootMidiNote: 60, pitchRange: 1.4, attack: 0.25, decay: 1.25, baseDelay: 270, tempo: 50, pulseBeats: 8 },
  "Inside out": { ...GRAPH_3D_DEFAULTS, topology: "smallworld", layout: "cube", nodeCount: 12, seed: 223, mapping: "strain", timeSource: "height", timbreSource: "distance", shadeSource: "radius", panSource: "strain", pitchRange: 1.2, spring: 0.85, modulationIndex: 0, strain: 1, depthTone: 0.9, baseDelay: 85, tempo: 115, pulseBeats: 2 },
  "Zigzag relay": { ...GRAPH_3D_DEFAULTS, topology: "chain", layout: "sphere", nodeCount: 23, seed: 227, mapping: "bend", pitchRange: 0.45, timeSource: "x", timbreSource: "depth", soundMode: "pm", modulationIndex: 0.6, strain: 0.5, panSource: "height", baseDelay: 40, distanceRatio: 4, decay: 0.13, tempo: 150, pulseBeats: 8 },
  "Still frequency": { ...GRAPH_3D_DEFAULTS, topology: "tree", layout: "helix", nodeCount: 15, seed: 239, mapping: "none", timeSource: "distance", timbreSource: "height", shadeSource: "depth", panSource: "x", modulationIndex: 0.05, strain: 0.9, depthTone: 0.85, pitchRange: 0, baseDelay: 150, distanceRatio: 6, decay: 0.32, tempo: 76, pulseBeats: 8 },
  "Orbit dust": { ...GRAPH_3D_DEFAULTS, topology: "mesh", layout: "sphere", nodeCount: 24, seed: 251, motion: true, gravity: 0.75, shell: 0.15, repel: 0.3, spring: 0.3, mapping: "depth", timeSource: "depth", soundMode: "shepard", pitchRange: 0.7, shadeSource: "strain", depthTone: 0.65, baseDelay: 30, distanceRatio: 2.5, decay: 0.07, feedback: 0.42, tempo: 190, pulseBeats: 0.5 },
  "Wide apart": { ...GRAPH_3D_DEFAULTS, topology: "ring", layout: "layers", nodeCount: 5, seed: 263, depth: 1.3, twist: -1, mapping: "x", timeSource: "distance", soundMode: "triangle", pitchRange: 3.2, shadeSource: "height", panSource: "depth", spread: 1, baseDelay: 360, distanceRatio: 8, attack: 0.12, decay: 1.1, tempo: 38, pulseBeats: 8, feedback: 0.72 },
});
const ranges = {
  nodeCount: [3, 24], density: [0, 0.65], seed: [1, 9999], depth: [0, 1.3], twist: [-1, 1],
  repel: [0, 1], spring: [0.15, 0.95], gravity: [0, 1], shell: [0, 1],
  tempo: [35, 220], pulseBeats: [0.5, 8], baseDelay: [25, 400], distanceRatio: [1, 8],
  feedback: [0, 0.88], feedbackTone: [0.25, 1], rootMidiNote: [24, 84], pitchRange: [0, 4],
  modulationIndex: [0, 6], strain: [0, 1], depthTone: [0, 1], spread: [0, 1],
  attack: [0.002, 0.4], decay: [0.04, 1.5],
};
export function sanitize3DSettings(source = {}) {
  const s = { ...GRAPH_3D_DEFAULTS };
  for (const [k, [lo, hi]] of Object.entries(ranges)) s[k] = clamp(source[k], lo, hi, s[k]);
  for (const k of ["nodeCount", "seed", "rootMidiNote"]) s[k] = Math.round(s[k]);
  for (const [k, values] of Object.entries({
    topology: GRAPH_3D_TOPOLOGIES, layout: GRAPH_3D_LAYOUTS,
    mapping: [...Object.keys(GRAPH_3D_SOURCES), "bend"],
    timeSource: Object.keys(GRAPH_3D_SOURCES), timbreSource: Object.keys(GRAPH_3D_SOURCES),
    shadeSource: Object.keys(GRAPH_3D_SOURCES), panSource: Object.keys(GRAPH_3D_SOURCES),
    soundMode: ["sine", "triangle", "fm", "pm", "shepard"],
    tuning: ["free", "chromatic", "pentatonic", "minor"],
  })) if (values.includes(source[k])) s[k] = source[k];
  s.motion = Boolean(source.motion);
  return s;
}
export const magnitude = (p) => Math.hypot(p.x, p.y, p.z);
export const subtract = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const copyPoint = ({ x, y, z }) => ({ x, y, z });

export function layoutPoint(index, count, s) {
  const t = index / Math.max(1, count - 1);
  const phase = (s.seed % 31) * 0.047;
  let x, y, z;
  if (s.layout === "helix") {
    const a = t * TAU * 1.7 + phase;
    x = Math.cos(a) * 0.65; y = (t - 0.5) * 1.55; z = Math.sin(a) * 0.65;
  } else if (s.layout === "layers") {
    x = (t - 0.5) * 1.55; y = Math.sin(index * 2.399 + phase) * 0.55; z = Math.cos(index * 1.61 + phase) * 0.65;
  } else if (s.layout === "cube") {
    const side = Math.ceil(Math.cbrt(count));
    x = ((index % side) / Math.max(1, side - 1) - 0.5) * 1.4;
    y = ((Math.floor(index / side) % side) / Math.max(1, side - 1) - 0.5) * 1.4;
    z = (Math.floor(index / (side * side)) / Math.max(1, side - 1) - 0.5) * 1.4;
  } else {
    y = 0.82 * (1 - 2 * (index + 0.5) / count);
    const r = Math.sqrt(Math.max(0, 0.82 ** 2 - y ** 2)), a = index * 2.3999632297 + phase;
    x = r * Math.cos(a); z = r * Math.sin(a);
  }
  return { x, y, z };
}

/** Persistent 3D layout state. View/camera state intentionally lives elsewhere. */
export class Graph3DModel {
  constructor(settings = {}) {
    this.settings = sanitize3DSettings(settings); this.revision = 0; this.forceTime = 0;
    this.generate();
  }
  generate() {
    const s = this.settings;
    const base = generateGraph({ type: s.topology, nodeCount: s.nodeCount, maxNodes: 24, density: s.density, seed: s.seed });
    this.nodes = base.nodes.map((n, i) => ({ id: i, ...layoutPoint(i, base.nodes.length, s),
      vx: 0, vy: 0, vz: 0, pinned: false }));
    // The selected generator family fits this budget; never silently prune edges.
    if (base.edges.length > GRAPH_3D_LIMITS.edges) throw new Error("This topology exceeds the 3D route budget.");
    this.edges = base.edges.map((e) => ({ ...e, enabled: true }));
    this.indegree = [...base.indegree]; this.outdegree = [...base.outdegree]; this.entries = [...base.entries];
    this.cyclic = base.cyclic; this.forceTime = 0; this.revision++;
  }
  set(values) {
    const before = this.settings, next = sanitize3DSettings({ ...before, ...values });
    this.settings = next;
    if (["topology", "nodeCount", "density", "seed"].some((k) => before[k] !== next[k])) { this.generate(); return true; }
    if (before.layout !== next.layout) this.arrange();
    if (before.depth !== next.depth || before.twist !== next.twist) this.revision++;
    return false;
  }
  arrange() {
    this.nodes.forEach((n, i) => { if (!n.pinned) Object.assign(n, layoutPoint(i, this.nodes.length, this.settings), { vx: 0, vy: 0, vz: 0 }); });
    this.revision++;
  }
  /** Depth stretches local z; helical twist rotates slices around vertical y. */
  worldPoint(n) {
    const a = this.settings.twist * n.y * Math.PI, co = Math.cos(a), si = Math.sin(a);
    const z = n.z * this.settings.depth;
    return { id: n.id, x: n.x * co + z * si, y: n.y, z: -n.x * si + z * co, pinned: n.pinned };
  }
  setWorldPoint(id, point, { pin = true } = {}) {
    const n = this.nodes[id]; if (!n) return;
    const y = clamp(point.y, -0.92, 0.92), a = this.settings.twist * y * Math.PI;
    const x = clamp(point.x, -1.2, 1.2), z = clamp(point.z, -1.2, 1.2);
    n.x = clamp(x * Math.cos(a) - z * Math.sin(a), -0.92, 0.92);
    n.y = y;
    if (this.settings.depth > 0.005) n.z = clamp((x * Math.sin(a) + z * Math.cos(a)) / this.settings.depth, -0.92, 0.92);
    n.vx = n.vy = n.vz = 0;
    if (pin) n.pinned = true;
    this.revision++;
  }
  toggleEdge(index) {
    if (!this.edges[index]) return;
    this.edges[index].enabled = !this.edges[index].enabled; this.revision++;
  }
  step(dt) {
    if (!this.settings.motion) return;
    const steps = Math.max(1, Math.ceil(clamp(dt, 0, 0.1) * 120)), h = clamp(dt, 0, 0.1) / steps;
    const s = this.settings, force = this.nodes.map(() => ({ x: 0, y: 0, z: 0 }));
    for (let step = 0; step < steps; step++) {
      force.forEach((v) => { v.x = v.y = v.z = 0; });
      // Softened inverse-square repulsion, bounded near coincident nodes.
      for (let i = 0; i < this.nodes.length; i++) for (let j = i + 1; j < this.nodes.length; j++) {
        const d = subtract(this.nodes[i], this.nodes[j]), r = magnitude(d);
        if (r < 1e-6) { d.x = 0.03; d.z = (i % 2 ? -1 : 1) * 0.02; }
        const gain = Math.min(5, s.repel * 0.028 / Math.max(0.015, magnitude(d) ** 3));
        for (const axis of ["x", "y", "z"]) { force[i][axis] += d[axis] * gain; force[j][axis] -= d[axis] * gain; }
      }
      const pairs = new Set();
      for (const e of this.edges) {
        if (!e.enabled) continue;
        const key = `${Math.min(e.from, e.to)}:${Math.max(e.from, e.to)}`;
        if (pairs.has(key)) continue; pairs.add(key);
        const d = subtract(this.nodes[e.to], this.nodes[e.from]), r = Math.max(0.005, magnitude(d));
        const gain = clamp((r - s.spring) * 2.3 / r, -8, 8);
        for (const axis of ["x", "y", "z"]) { force[e.from][axis] += d[axis] * gain; force[e.to][axis] -= d[axis] * gain; }
      }
      for (let i = 0; i < this.nodes.length; i++) {
        const n = this.nodes[i], f = force[i], r = Math.max(0.03, magnitude(n));
        if (n.pinned) continue;
        for (const axis of ["x", "y", "z"]) {
          f[axis] += -n[axis] * s.gravity * 1.8 + n[axis] / r * (0.72 - r) * s.shell * 3;
          n[`v${axis}`] = clamp((n[`v${axis}`] + clamp(f[axis], -6, 6) * h) * Math.exp(-h * 3.2), -0.8, 0.8);
          n[axis] = clamp(n[axis] + n[`v${axis}`] * h, -0.92, 0.92);
          if (Math.abs(n[axis]) >= 0.92) n[`v${axis}`] *= -0.25;
        }
      }
      this.forceTime += h;
    }
    this.revision++;
  }
  graph() {
    const nodes = this.nodes.map((n) => this.worldPoint(n));
    return { nodes, edges: this.edges, indegree: this.indegree, outdegree: this.outdegree,
      entries: this.entries.length ? this.entries : [0], cyclic: this.cyclic };
  }
  snapshot() { return { version: 1, settings: { ...this.settings }, nodes: this.nodes.map((n) => ({ ...n })), enabled: this.edges.map((e) => e.enabled) }; }
  restore(data) {
    if (data?.version !== 1 || !data.settings || !Array.isArray(data.nodes)) throw new Error("Not a 3D Graph patch.");
    const next = new Graph3DModel(data.settings);
    if (data.nodes.length !== next.nodes.length || !data.nodes.every((p) => p && ["x", "y", "z"].every((k) => Number.isFinite(p[k])))) throw new Error("Invalid saved node positions.");
    data.nodes.forEach((p, i) => Object.assign(next.nodes[i], {
      x: clamp(p.x, -0.92, 0.92), y: clamp(p.y, -0.92, 0.92), z: clamp(p.z, -0.92, 0.92), pinned: Boolean(p.pinned),
    }));
    if (data.enabled !== undefined && (!Array.isArray(data.enabled) || data.enabled.length !== next.edges.length || !data.enabled.every((v) => typeof v === "boolean"))) throw new Error("Invalid saved route switches.");
    next.edges.forEach((e, i) => { e.enabled = data.enabled?.[i] ?? true; });
    Object.assign(this, next); this.revision++;
  }
}

/** A fixed-world signal: axes are signed; route/radius/stretch become bipolar. */
export function graph3DSource(source, point, event = {}) {
  if (source === "x") return clamp(point.x, -1, 1);
  if (source === "height") return clamp(point.y, -1, 1);
  if (source === "depth") return clamp(point.z, -1, 1);
  if (source === "radius") return clamp((magnitude(point) - 0.55) * 1.5, -1, 1);
  if (source === "distance") return clamp((event.length ?? 0) / (2 * Math.sqrt(3))) * 2 - 1;
  if (source === "strain") return clamp((event.strain ?? 0) / 2) * 2 - 1;
  return 0;
}

/** Reuse Graph Synth split/merge/feedback gains; assign timing from 3D data. */
export function graph3DEdgeParameters(graph, source = {}) {
  const s = sanitize3DSettings(source);
  const parameters = edgeAudioParameters(graph, { ...s, nodePass: 0.96 });
  const switchGains = graphEdgeSwitchMultipliers(graph, graph.edges.map((e) => e.enabled !== false));
  return parameters.map((e, i) => {
    const from = graph.nodes[e.from], to = graph.nodes[e.to], delta = subtract(to, from);
    const length = magnitude(delta);
    const normalizedLength = clamp(length / (2 * Math.sqrt(3)));
    const strain = clamp(Math.abs(length - s.spring) / Math.max(0.15, s.spring), 0, 2);
    const timingSignal = s.timeSource === "distance" ? normalizedLength
      : s.timeSource === "x" ? clamp(Math.abs(delta.x) / 2.6)
      : s.timeSource === "height" ? clamp(Math.abs(delta.y) / 2)
      : s.timeSource === "depth" ? clamp(Math.abs(delta.z) / 2.6)
      : s.timeSource === "radius" ? clamp(magnitude(to) / Math.sqrt(3))
      : s.timeSource === "strain" ? strain / 2 : 0;
    return { ...e, length, normalizedLength, timingSignal,
      delaySeconds: clamp(s.baseDelay / 1000 * (1 + timingSignal * (s.distanceRatio - 1)), 0.025, 2),
      gain: e.gain * switchGains[i], strain };
  });
}

/** Full spatial bend magnitude, signed by the bend normal's vertical component. */
export function signedBend3D(incoming, outgoing) {
  const la = magnitude(incoming), lb = magnitude(outgoing);
  if (la < 1e-8 || lb < 1e-8) return 0;
  const n = cross(incoming, outgoing), angle = Math.atan2(magnitude(n), dot(incoming, outgoing));
  return angle * (n.y < -1e-10 ? -1 : 1);
}

export function graph3DVoice(event, graph, source = {}) {
  const s = sanitize3DSettings(source), n = graph.nodes[event.nodeId];
  if (!n) return null;
  let interval = graph3DSource(s.mapping, n, event) * s.pitchRange * 12;
  if (s.mapping === "bend") interval = event.cumulativeSemitones ?? 0;
  const timbre = s.timbreSource === "none" ? 0 : (graph3DSource(s.timbreSource, n, event) + 1) / 2;
  const normalized = { ...graph, nodes: graph.nodes.map((p) => ({ x: clamp((p.x + 1.3) / 2.6), y: clamp((1 - p.y) / 2) })) };
  const voice = graphSynthVoice({ ...event, cumulativeSemitones: interval }, normalized, {
    mappingMode: "turn", soundMode: s.soundMode, rootMidiNote: event.rootMidiNote ?? s.rootMidiNote,
    quantize: s.tuning !== "free", scale: s.tuning === "free" ? "chromatic" : s.tuning,
    pitchRange: s.pitchRange, level: 0.25, modulationIndex: s.modulationIndex + timbre * s.strain * 6,
    modulationRatio: 1.5, feedbackTone: s.feedbackTone, attack: s.attack, duration: s.decay,
  });
  voice.pan = graph3DSource(s.panSource, n, event) * s.spread;
  const shade = s.shadeSource === "none" ? 0 : (1 - graph3DSource(s.shadeSource, n, event)) / 2;
  voice.brightness = clamp((0.95 - shade * s.depthTone * 0.7) * s.feedbackTone ** (event.feedbackCount ?? 0), 0.08, 1);
  // Keep the shared voice's descriptive aliases consistent with this mapping,
  // rather than retaining Graph Synth's unrelated 2D shading metadata.
  voice.tone = voice.brightness;
  voice.cutoff = 9000 * (0.3 + voice.brightness * 0.7);
  voice.gain *= 1 - shade * s.depthTone * 0.28; voice.level = voice.gain;
  return voice;
}

// Native event scheduling: the renderer is never the clock. In-flight hops
// keep departure positions/timing; the next hop reads the current 3D graph.
export class Graph3DTraversal {
  constructor() { this.queue = []; this.runs = new Map(); this.serial = 0; this.nextRun = 0; this.arrivals = 0; this.dropped = 0; }
  insert(e) {
    if (this.queue.length >= GRAPH_3D_LIMITS.pending) { this.dropped++; return false; }
    e.serial = this.serial++;
    let lo = 0, hi = this.queue.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (this.queue[mid].time <= e.time) lo = mid + 1; else hi = mid; }
    this.queue.splice(lo, 0, e); return true;
  }
  inject(graph, time, nodeId = 0, amplitude = 1, rootMidiNote = GRAPH_3D_DEFAULTS.rootMidiNote) {
    if (this.runs.size >= GRAPH_3D_LIMITS.runs || !graph.nodes[nodeId]) { this.dropped++; return false; }
    const run = this.nextRun++;
    this.runs.set(run, { count: 1, start: time });
    this.insert({ nodeId, time, departTime: time, amplitude: clamp(amplitude), depth: 0, feedbackCount: 0,
      cumulativeSemitones: 0, strain: 0, length: 0, run, arrivalEdgeId: null, previousNodeId: null, incoming: null, rootMidiNote });
    return true;
  }
  process(now, until, graph, settings, emit) {
    const edges = graph3DEdgeParameters(graph, settings);
    let scanned = 0, audible = 0;
    while (this.queue.length && this.queue[0].time <= until && scanned++ < 192) {
      const e = this.queue.shift(), run = this.runs.get(e.run), node = graph.nodes[e.nodeId];
      if (!run || !node) continue;
      if (e.arrivalEdgeId !== null && !graph.edges.some((edge) => edge.id === e.arrivalEdgeId && edge.enabled !== false)) continue;
      // Discard past attacks after a stall; never dump them onto "now".
      if (e.time < now - 0.025) { this.dropped++; continue; }
      if (audible++ < 24) { emit(e, graph3DVoice(e, graph, settings)); this.arrivals++; }
      if (e.depth >= GRAPH_3D_LIMITS.hops) continue;
      for (const edge of edges) {
        if (edge.from !== e.nodeId || edge.enabled === false || edge.gain <= 0) continue;
        const feedbackCount = e.feedbackCount + Number(Boolean(edge.feedbackEdge));
        const amplitude = e.amplitude * edge.gain, time = e.time + edge.delaySeconds;
        if (amplitude < 0.004 || feedbackCount > GRAPH_3D_LIMITS.laps || time - run.start > GRAPH_3D_LIMITS.horizon || run.count >= GRAPH_3D_LIMITS.arrivalsPerRun) continue;
        const target = graph.nodes[edge.to], outgoing = subtract(target, node);
        const bend = e.incoming ? signedBend3D(e.incoming, outgoing) : 0;
        if (this.insert({ nodeId: edge.to, time, departTime: e.time, amplitude, feedbackCount, depth: e.depth + 1, run: e.run,
          rootMidiNote: e.rootMidiNote, previousNodeId: e.nodeId, arrivalEdgeId: edge.id, incoming: outgoing,
          fromPoint: copyPoint(node), toPoint: copyPoint(target), strain: edge.strain, length: edge.length,
          cumulativeSemitones: e.cumulativeSemitones + bend / TAU * settings.pitchRange * 12 })) run.count++;
      }
    }
    const active = new Set(this.queue.map((e) => e.run));
    for (const run of this.runs.keys()) if (!active.has(run)) this.runs.delete(run);
  }
  shift(delta) { for (const e of this.queue) { e.time += delta; e.departTime += delta; } for (const r of this.runs.values()) r.start += delta; }
  clear() { this.queue = []; this.runs.clear(); }
}

export const DEFAULT_VIEW = Object.freeze({ yaw: -24, pitch: 18, zoom: 1, auto: false });
export function projectGraphPoint(point, view = DEFAULT_VIEW, width = 900, height = 650) {
  const rotated = rotatePoint3(point, { x: view.pitch, y: view.yaw });
  const projected = projectPoint3(rotated, 4.5), scale = Math.min(width, height) * 0.30 * view.zoom;
  return { x: width / 2 + projected.x * scale, y: height / 2 - projected.y * scale, depth: rotated.z, scale: projected.scale, viewPoint: rotated };
}
export function dragGraphPoint(point, dx, dy, view, width, height, depthDrag = false) {
  const p = projectGraphPoint(point, view, width, height), v = { ...p.viewPoint };
  const scale = Math.max(1, Math.min(width, height) * 0.30 * view.zoom * p.scale);
  if (depthDrag) v.z += -dy / scale;
  else { v.x += dx / scale; v.y -= dy / scale; }
  // Inverse rotation order: undo Y, then X.
  return rotatePoint3(rotatePoint3(v, { y: -view.yaw }), { x: -view.pitch });
}
