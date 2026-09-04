import { VoicePool } from "./src/audio.js";
import {
  DEFAULT_MAZE_SETTINGS,
  MAZE_ALGORITHMS,
  clamp,
  createMazeWalk,
  createWallWalk,
  generateMaze,
  mazeAlgorithmLabel,
  mazePassageBetween,
  mazeTopologyLabel,
  mazeWallEdgeBetween,
  sanitizeMazeSettings,
  shortestMazePath,
} from "./src/algorithmic-mazes.js";

const $ = (id) => document.getElementById(id);
const TAU = Math.PI * 2;
const COLORS = Object.freeze({
  wall: "#efc86f",
  passage: "#62dfd0",
  solution: "#ff7f93",
  paper: "#edf4ef",
  violet: "#b598ff",
});
const PASSAGE_HEAD_COLORS = Object.freeze(["#62dfd0", "#83e18d", "#76b8ff", "#b598ff", "#ff8797"]);
const WALL_HEAD_COLORS = Object.freeze(["#efc86f", "#ff9c78", "#f0e2a0", "#d99eff"]);
const MODES = Object.freeze({
  carve: "Build",
  wander: "Trace",
  solve: "Solve",
  survey: "Tour",
});
const CARVE_PROFILES = Object.freeze({
  backtracker: Object.freeze({
    accent: "#b598ff",
    passage: Object.freeze({ waveform: "sine", ratio: 1.51, index: 2.2, drive: 0.3 }),
    wall: Object.freeze({ waveform: "triangle", ratio: 2.67, index: 5, drive: 0.65 }),
    strikeRatio: 1,
    strikeDecay: 0.18,
    attackNoise: 0.02,
  }),
  prim: Object.freeze({
    accent: "#62dfd0",
    passage: Object.freeze({ waveform: "triangle", ratio: 2.03, index: 3.8, drive: 0.5 }),
    wall: Object.freeze({ waveform: "triangle", ratio: 3.01, index: 7.2, drive: 0.8 }),
    strikeRatio: 1.25,
    strikeDecay: 0.08,
    attackNoise: 0.16,
  }),
  kruskal: Object.freeze({
    accent: "#ff8797",
    passage: Object.freeze({ waveform: "sine", ratio: 1, index: 1.8, drive: 0.58 }),
    wall: Object.freeze({ waveform: "triangle", ratio: 2, index: 3.6, drive: 0.72 }),
    strikeRatio: 0.75,
    strikeDecay: 0.13,
    attackNoise: 0.08,
  }),
  wilson: Object.freeze({
    accent: "#76b8ff",
    passage: Object.freeze({ waveform: "sine", ratio: 1.618, index: 4.8, drive: 0.4 }),
    wall: Object.freeze({ waveform: "triangle", ratio: 2.414, index: 6.4, drive: 0.56 }),
    strikeRatio: 1.125,
    strikeDecay: 0.24,
    attackNoise: 0.01,
  }),
});
const DEFAULTS = Object.freeze({
  ...DEFAULT_MAZE_SETTINGS,
  algorithm: "backtracker",
  mode: "carve",
  playing: true,
  direction: 1,
  cycleBehavior: "hold",
  position: 0,
  speed: 0.045,
  bend: 0.28,
  twist: 0.13,
  fieldMotion: 0.34,
  showPotential: true,
  showSolution: false,
  passageHeads: 1,
  wallHeads: 1,
  passageLevel: 0.72,
  wallLevel: 0.54,
  voiceEngine: "fm",
  passagePitch: "depth",
  wallPitch: "orientation",
  rootFrequency: 82.5,
  pitchRange: 24,
  wallOffset: 12,
  nodeAccent: 0.38,
  level: 0.52,
});

const canvas = $("stage");
const context = canvas.getContext("2d");
const stageWrap = $("stageWrap");
const voicePool = new VoicePool(24, { continuousPeakCeiling: 0.64 });

const state = {
  ...DEFAULTS,
  audio: false,
  maze: generateMaze(DEFAULTS),
  startNode: 0,
  targetNode: 0,
  solution: [],
  passageRoutes: [],
  wallRoutes: [],
};

let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameAt = performance.now();
let pointer = null;
let hoverCell = -1;
let lastHeadSegments = new Map();
let statusTimer = 0;

const controls = {
  level: $("level"),
  position: $("position"),
  speed: $("speed"),
  cycleBehavior: $("cycleBehavior"),
  algorithm: $("algorithm"),
  size: $("size"),
  seed: $("seed"),
  braid: $("braid"),
  bend: $("bend"),
  twist: $("twist"),
  fieldMotion: $("fieldMotion"),
  showPotential: $("showPotential"),
  showSolution: $("showSolution"),
  passageHeads: $("passageHeads"),
  passageLevel: $("passageLevel"),
  wallHeads: $("wallHeads"),
  wallLevel: $("wallLevel"),
  voiceEngine: $("voiceEngine"),
  passagePitch: $("passagePitch"),
  wallPitch: $("wallPitch"),
  rootFrequency: $("rootFrequency"),
  pitchRange: $("pitchRange"),
  wallOffset: $("wallOffset"),
  nodeAccent: $("nodeAccent"),
};

function setText(id, value) {
  const element = $(id);
  if (element) element.textContent = String(value);
}

function setPressed(element, pressed) {
  element?.setAttribute("aria-pressed", pressed ? "true" : "false");
}

function percent(value) {
  return `${Math.round(value * 100)}%`;
}

function compact(value, digits = 1) {
  return Number(value).toFixed(digits).replace(/\.0+$/, "");
}

function wrap01(value) {
  return ((value % 1) + 1) % 1;
}

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function hashUnit(value, salt = 0) {
  let number = (Math.trunc(value) + 1) * 0x9e3779b1 ^ (salt + 1) * 0x85ebca6b;
  number ^= number >>> 16;
  number = Math.imul(number, 0x7feb352d);
  number ^= number >>> 15;
  return (number >>> 0) / 4294967295;
}

function scheduleFrame() {
  if (!scheduledFrame) scheduledFrame = requestAnimationFrame(frame);
}

function announce(message) {
  setText("liveStatus", message);
}

function showError(error) {
  const element = $("audioError");
  if (!element) return;
  element.hidden = false;
  element.textContent = error instanceof Error ? error.message : String(error);
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => { element.hidden = true; }, 6000);
}

function fieldSettings() {
  return sanitizeMazeSettings({
    algorithm: state.algorithm,
    topology: state.topology,
    size: state.size,
    seed: state.seed,
    braid: state.braid,
  });
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    const data = new Uint32Array(1);
    globalThis.crypto.getRandomValues(data);
    return 1 + data[0] % 99999;
  }
  return 1 + Math.floor(Math.random() * 99999);
}

function layerPoint(layer, node) {
  if (layer === "wall") {
    const vertex = state.maze.wallGraph.vertices[node];
    return vertex ? { x: vertex.x, y: vertex.y } : { x: 0, y: 0 };
  }
  return state.maze.cells[node]?.center ?? { x: 0, y: 0 };
}

function edgeForNodes(layer, from, to) {
  return layer === "wall"
    ? mazeWallEdgeBetween(state.maze, from, to)
    : mazePassageBetween(state.maze, from, to);
}

function routeRecord(nodes, layer, component = 0) {
  const segments = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const fromNode = nodes[index];
    const toNode = nodes[index + 1];
    const edge = edgeForNodes(layer, fromNode, toNode);
    if (!edge) continue;
    const from = layerPoint(layer, fromNode);
    const to = layerPoint(layer, toNode);
    segments.push({
      edge,
      from,
      to,
      fromNode,
      toNode,
      length: Math.max(1e-6, Math.hypot(to.x - from.x, to.y - from.y)),
    });
  }
  let total = 0;
  const cumulative = segments.map((segment) => {
    total += segment.length;
    return total;
  });
  return { layer, nodes, segments, cumulative, total, component };
}

function rebuildRoutes() {
  const passageLength = Math.max(80, state.maze.cells.length * 6);
  state.passageRoutes = Array.from({ length: state.passageHeads }, (_value, index) => {
    let route;
    if (state.mode === "solve") {
      route = index % 2 ? [...state.solution].reverse() : state.solution;
    } else if (state.mode === "survey") {
      route = index % 2 ? [...state.maze.tour].reverse() : state.maze.tour;
    } else {
      const start = Math.round(index / Math.max(1, state.passageHeads - 1) * (state.maze.cells.length - 1));
      route = createMazeWalk(state.maze, {
        seed: state.seed + 101 * (index + 1),
        start,
        length: passageLength,
      });
    }
    return routeRecord(route, "passage");
  });

  const wallLength = Math.max(100, state.maze.wallGraph.vertices.length * 5);
  state.wallRoutes = Array.from({ length: state.wallHeads }, (_value, index) => {
    const componentIndex = index % Math.max(1, state.maze.wallGraph.components.length);
    const component = state.maze.wallGraph.components[componentIndex] ?? [];
    let route;
    if (state.mode === "survey" && componentIndex === 0) {
      route = index % 2 ? [...state.maze.wallGraph.tour].reverse() : state.maze.wallGraph.tour;
    } else {
      route = createWallWalk(state.maze, {
        seed: state.seed + 809 * (index + 1),
        start: component[0],
        length: wallLength,
      });
    }
    return routeRecord(route, "wall", componentIndex);
  });
  lastHeadSegments = new Map();
}

function regenerate({ resetTime = false, announceChange = true } = {}) {
  Object.assign(state, fieldSettings());
  state.maze = generateMaze(fieldSettings());
  state.startNode = state.maze.start;
  state.targetNode = state.maze.goal;
  state.solution = shortestMazePath(state.maze, state.startNode, state.targetNode);
  if (resetTime) {
    state.position = state.direction > 0 ? 0 : 1;
    if (state.mode === "carve") {
      state.playing = true;
      lastFrameAt = performance.now();
    }
  }
  rebuildRoutes();
  syncControls();
  updateReadouts([]);
  scheduleFrame();
  if (announceChange) {
    announce(`${state.maze.topology.label} maze generated with ${state.maze.algorithm.label}, seed ${state.seed}.`);
  }
}

function updateSolution(start, target, announceChange = true) {
  state.startNode = clamp(Math.round(start), 0, state.maze.cells.length - 1);
  state.targetNode = clamp(Math.round(target), 0, state.maze.cells.length - 1);
  state.solution = shortestMazePath(state.maze, state.startNode, state.targetNode);
  if (state.mode === "solve") rebuildRoutes();
  if (announceChange) {
    announce(`Solver route updated: ${Math.max(0, state.solution.length - 1)} passage edges.`);
  }
  scheduleFrame();
}

function warpPoint(current) {
  const radius = Math.hypot(current.x, current.y);
  const angle = Math.atan2(current.y, current.x);
  const time = state.position;
  const twist = state.twist * Math.PI * 1.12 * radius * radius;
  const pulse = state.fieldMotion * 0.055 * Math.sin(TAU * (time + radius * 0.64));
  const angleDrift = state.fieldMotion * 0.065 * Math.sin(TAU * (time * 0.72 + radius));
  const warpedRadius = radius * (1 + pulse);
  return {
    x: Math.cos(angle + twist + angleDrift) * warpedRadius
      + state.fieldMotion * 0.018 * Math.sin(TAU * (time + current.y * 0.7)),
    y: Math.sin(angle + twist + angleDrift) * warpedRadius
      + state.fieldMotion * 0.018 * Math.cos(TAU * (time * 0.83 + current.x * 0.7)),
  };
}

function curveWorld(layer, edge, from, to) {
  const a = warpPoint(from);
  const b = warpPoint(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(1e-6, Math.hypot(dx, dy));
  const edgeSeed = edge?.wallId ?? edge?.id ?? 0;
  const direction = hashUnit(edgeSeed, layer === "wall" ? 41 : 73) > 0.5 ? 1 : -1;
  const variation = 0.48 + hashUnit(edgeSeed, 113) * 0.52;
  const breathing = 1 + state.fieldMotion * 0.22 * Math.sin(TAU * (state.position + hashUnit(edgeSeed, 17)));
  const bend = state.bend * length * 0.42 * direction * variation * breathing;
  return {
    a,
    b,
    c: {
      x: (a.x + b.x) / 2 - dy / length * bend,
      y: (a.y + b.y) / 2 + dx / length * bend,
    },
  };
}

function curvePoint(curve, amount) {
  const t = clamp(amount, 0, 1);
  const inverse = 1 - t;
  return {
    x: inverse * inverse * curve.a.x + 2 * inverse * t * curve.c.x + t * t * curve.b.x,
    y: inverse * inverse * curve.a.y + 2 * inverse * t * curve.c.y + t * t * curve.b.y,
  };
}

function curveTangent(curve, amount) {
  const t = clamp(amount, 0, 1);
  return {
    x: 2 * (1 - t) * (curve.c.x - curve.a.x) + 2 * t * (curve.b.x - curve.c.x),
    y: 2 * (1 - t) * (curve.c.y - curve.a.y) + 2 * t * (curve.b.y - curve.c.y),
  };
}

function partialCurve(curve, amount) {
  const t = clamp(amount, 0, 1);
  return {
    a: curve.a,
    c: {
      x: curve.a.x + (curve.c.x - curve.a.x) * t,
      y: curve.a.y + (curve.c.y - curve.a.y) * t,
    },
    b: curvePoint(curve, t),
  };
}

function screenPoint(current) {
  const margin = Math.max(38, Math.min(cssWidth, cssHeight) * 0.075);
  const scale = Math.max(1, Math.min(cssWidth - margin * 2, cssHeight - margin * 2) / 2);
  return {
    x: cssWidth / 2 + current.x * scale,
    y: cssHeight / 2 - current.y * scale,
  };
}

function routeSample(record, phase) {
  if (!record?.segments.length || !record.total) return null;
  const bounded = phase === 1 ? 1 : wrap01(phase);
  const distance = bounded * record.total;
  let index = record.cumulative.findIndex((end) => end >= distance);
  if (index < 0) index = record.segments.length - 1;
  const segment = record.segments[index];
  const startDistance = index ? record.cumulative[index - 1] : 0;
  const amount = segment.length ? clamp((distance - startDistance) / segment.length, 0, 1) : 0;
  const curve = curveWorld(record.layer, segment.edge, segment.from, segment.to);
  const world = curvePoint(curve, amount);
  const tangent = curveTangent(curve, amount);
  const previous = record.segments[Math.max(0, index - 1)];
  const firstAngle = Math.atan2(previous.to.y - previous.from.y, previous.to.x - previous.from.x);
  const secondAngle = Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x);
  const turn = wrap01((secondAngle - firstAngle) / TAU + 0.5);
  const orientation = wrap01(Math.atan2(tangent.y, tangent.x) / Math.PI) % 1;
  const nearNode = amount < 0.5 ? segment.fromNode : segment.toNode;
  return {
    layer: record.layer,
    record,
    segment,
    segmentIndex: index,
    segmentKey: `${record.layer}:${pairKey(segment.fromNode, segment.toNode)}`,
    amount,
    phase: bounded,
    world,
    tangent,
    turn,
    orientation,
    component: record.component,
    depth: record.layer === "passage"
      ? (state.maze.depth[nearNode] ?? 0) / Math.max(1, state.maze.maxDepth)
      : 0,
  };
}

function carveState() {
  const steps = state.maze.buildSteps;
  const scaled = clamp(state.position, 0, 1) * steps.length;
  const completed = Math.min(steps.length, Math.floor(scaled));
  const index = Math.min(steps.length - 1, completed);
  return {
    completed,
    step: steps[index] ?? null,
    amount: completed >= steps.length ? 1 : scaled - completed,
  };
}

function carveHeads() {
  const build = carveState();
  if (!build.step) return [];
  const passage = state.maze.passages[build.step.edgeId];
  const wall = state.maze.allWalls[build.step.wallId];
  const passageCurve = curveWorld(
    "passage",
    passage,
    state.maze.cells[build.step.from].center,
    state.maze.cells[build.step.to].center,
  );
  const wallCurve = curveWorld("wall", wall, wall.a, wall.b);
  const passageWorld = curvePoint(passageCurve, build.amount);
  const wallWorld = curvePoint(wallCurve, 1 - build.amount);
  const process = {
    process: build.step.process ?? "carve",
    carveValue: clamp(Number(build.step.algorithmValue) || 0, 0, 1),
    frontierRatio: clamp(Number(build.step.frontierRatio) || 0, 0, 1),
    mergeBalance: clamp(Number(build.step.mergeBalance) || 0, 0, 1),
    walkId: build.step.walkId ?? 0,
    walkIndex: build.step.walkIndex ?? 0,
    walkLength: build.step.walkLength ?? 1,
  };
  return [
    ...(state.passageHeads ? [{
      ...process,
      layer: "passage",
      headIndex: 0,
      segmentKey: `carve:passage:${build.completed}`,
      segmentIndex: build.completed,
      phase: state.position,
      amount: build.amount,
      world: passageWorld,
      tangent: curveTangent(passageCurve, build.amount),
      orientation: wrap01(Math.atan2(
        passageCurve.b.y - passageCurve.a.y,
        passageCurve.b.x - passageCurve.a.x,
      ) / Math.PI),
      turn: 0.5,
      depth: (state.maze.depth[build.step.to] ?? 0) / Math.max(1, state.maze.maxDepth),
      component: 0,
      curve: passageCurve,
    }] : []),
    ...(state.wallHeads ? [{
      ...process,
      layer: "wall",
      headIndex: 0,
      segmentKey: `carve:wall:${build.completed}`,
      segmentIndex: build.completed,
      phase: state.position,
      amount: 1 - build.amount,
      world: wallWorld,
      tangent: curveTangent(wallCurve, 1 - build.amount),
      orientation: wrap01(Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) / Math.PI),
      turn: 0.5,
      depth: 0,
      component: 0,
      curve: wallCurve,
    }] : []),
  ];
}

function playheads() {
  if (state.mode === "carve") return carveHeads();
  const heads = [];
  state.passageRoutes.forEach((route, index) => {
    const offset = index / Math.max(1, state.passageRoutes.length);
    const sample = routeSample(route, wrap01(state.position + offset));
    if (sample) heads.push({ ...sample, headIndex: index });
  });
  state.wallRoutes.forEach((route, index) => {
    const offset = (index + 0.5) / Math.max(1, state.wallRoutes.length);
    const sample = routeSample(route, wrap01(state.position + offset));
    if (sample) heads.push({ ...sample, headIndex: index });
  });
  return heads;
}

function canvasCurve(curve) {
  return {
    a: screenPoint(curve.a),
    b: screenPoint(curve.b),
    c: screenPoint(curve.c),
  };
}

function strokeCurve(curve, {
  color,
  alpha = 1,
  width = 1,
  dash = [],
  shadow = 0,
} = {}) {
  const screen = canvasCurve(curve);
  context.save();
  context.beginPath();
  context.moveTo(screen.a.x, screen.a.y);
  context.quadraticCurveTo(screen.c.x, screen.c.y, screen.b.x, screen.b.y);
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = width;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dash);
  if (shadow) {
    context.shadowColor = color;
    context.shadowBlur = shadow;
  }
  context.stroke();
  context.restore();
}

function wallCurve(wall) {
  return curveWorld("wall", wall, wall.a, wall.b);
}

function passageCurve(passage, from = passage.a, to = passage.b) {
  return curveWorld(
    "passage",
    passage,
    state.maze.cells[from].center,
    state.maze.cells[to].center,
  );
}

function drawWorldRing(world, { color, radius = 4, alpha = 0.5, width = 1, shadow = 0 } = {}) {
  const point = screenPoint(warpPoint(world));
  context.save();
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, TAU);
  context.strokeStyle = color;
  context.globalAlpha = alpha;
  context.lineWidth = width;
  if (shadow) {
    context.shadowColor = color;
    context.shadowBlur = shadow;
  }
  context.stroke();
  context.restore();
}

function backtrackerSpine(build) {
  const stepByChild = new Map();
  state.maze.buildSteps.slice(0, build.completed).forEach((step) => {
    if (step.process === "depth") stepByChild.set(step.to, step);
  });
  let node = build.completed >= state.maze.buildSteps.length
    ? build.step?.to
    : build.step?.from;
  const spine = [];
  while (stepByChild.has(node) && spine.length < state.maze.cells.length) {
    const step = stepByChild.get(node);
    spine.push(step);
    node = step.from;
  }
  return spine.reverse();
}

function primFrontier(build) {
  const visited = new Set();
  state.maze.buildSteps.slice(0, build.completed).forEach((step) => {
    visited.add(step.from);
    visited.add(step.to);
  });
  if (build.step) visited.add(build.step.from);
  return state.maze.candidateEdges.filter((edge) => (
    visited.has(edge.a) !== visited.has(edge.b)
  ));
}

function kruskalRoots(build) {
  const parent = Array.from({ length: state.maze.cells.length }, (_value, index) => index);
  const find = (value) => {
    let root = value;
    while (parent[root] !== root) root = parent[root];
    while (parent[value] !== value) {
      const next = parent[value];
      parent[value] = root;
      value = next;
    }
    return root;
  };
  state.maze.buildSteps.slice(0, build.completed).forEach((step) => {
    const left = find(step.from);
    const right = find(step.to);
    if (left !== right) parent[right] = left;
  });
  return parent.map((_value, index) => find(index));
}

function drawCarveProcess() {
  if (state.mode !== "carve") return;
  const build = carveState();
  if (!build.step) return;
  const profile = CARVE_PROFILES[state.algorithm] ?? CARVE_PROFILES.backtracker;

  if (state.algorithm === "backtracker") {
    const spine = backtrackerSpine(build);
    spine.forEach((step, index) => {
      const passage = state.maze.passages[step.edgeId];
      const amount = (index + 1) / Math.max(1, spine.length);
      strokeCurve(passageCurve(passage, step.from, step.to), {
        color: profile.accent,
        alpha: 0.12 + amount * 0.34,
        width: 1.1 + amount * 0.8,
        shadow: index === spine.length - 1 ? 5 : 0,
      });
    });
    return;
  }

  if (state.algorithm === "prim") {
    const frontier = primFrontier(build);
    const frontierNodes = new Set();
    frontier.forEach((edge) => {
      strokeCurve(passageCurve(edge, edge.a, edge.b), {
        color: profile.accent,
        alpha: 0.11,
        width: 0.8,
        dash: [2, 6],
      });
      frontierNodes.add(edge.a);
      frontierNodes.add(edge.b);
    });
    [...frontierNodes].slice(0, 72).forEach((node) => {
      drawWorldRing(state.maze.cells[node].center, {
        color: profile.accent,
        radius: 2.2,
        alpha: 0.32,
      });
    });
    return;
  }

  if (state.algorithm === "kruskal") {
    const radius = 4 + (build.step.mergeBalance ?? 0) * 5;
    drawWorldRing(state.maze.cells[build.step.from].center, {
      color: profile.accent,
      radius,
      alpha: 0.72,
      width: 1.4,
      shadow: 7,
    });
    drawWorldRing(state.maze.cells[build.step.to].center, {
      color: COLORS.violet,
      radius,
      alpha: 0.72,
      width: 1.4,
      shadow: 7,
    });
    return;
  }

  const walkSteps = state.maze.buildSteps
    .slice(0, build.completed)
    .filter((step) => step.walkId === build.step.walkId);
  walkSteps.forEach((step) => {
    const passage = state.maze.passages[step.edgeId];
    strokeCurve(passageCurve(passage, step.from, step.to), {
      color: profile.accent,
      alpha: 0.72,
      width: 2.15,
      shadow: 5,
    });
  });
  const walkStart = walkSteps[0]?.from ?? build.step.from;
  drawWorldRing(state.maze.cells[walkStart].center, {
    color: profile.accent,
    radius: 5.5,
    alpha: 0.58,
    width: 1.25,
  });
}

function drawCellWash() {
  const showBuild = state.mode === "carve";
  const build = showBuild ? carveState() : null;
  const arrived = new Set();
  if (build) {
    for (let index = 0; index < build.completed; index += 1) {
      arrived.add(state.maze.buildSteps[index].from);
      arrived.add(state.maze.buildSteps[index].to);
    }
  }
  state.maze.cells.forEach((cell) => {
    if (showBuild && !arrived.has(cell.id)) return;
    const polygon = cell.polygon.map((vertex) => screenPoint(warpPoint(vertex)));
    context.beginPath();
    context.moveTo(polygon[0].x, polygon[0].y);
    polygon.slice(1).forEach(({ x, y }) => context.lineTo(x, y));
    context.closePath();
    const depth = (state.maze.depth[cell.id] ?? 0) / Math.max(1, state.maze.maxDepth);
    context.fillStyle = depth > 0.62 ? "rgba(181, 152, 255, 0.020)" : "rgba(98, 223, 208, 0.018)";
    context.fill();
  });
}

function drawPotentialWalls() {
  if (!state.showPotential) return;
  state.maze.allWalls.forEach((wall) => {
    strokeCurve(wallCurve(wall), {
      color: COLORS.paper,
      alpha: wall.boundary ? 0.105 : 0.052,
      width: wall.boundary ? 1.05 : 0.7,
      dash: wall.boundary ? [] : [1.5, 5],
    });
  });
}

function drawWalls() {
  if (state.mode !== "carve") {
    state.maze.walls.forEach((wall) => {
      strokeCurve(wallCurve(wall), {
        color: COLORS.wall,
        alpha: wall.boundary ? 0.88 : 0.64,
        width: wall.boundary ? 2.05 : 1.35,
      });
    });
    return;
  }

  const build = carveState();
  const opened = new Set(
    state.maze.buildSteps.slice(0, build.completed).map(({ wallId }) => wallId),
  );
  state.maze.allWalls.forEach((wall) => {
    if (opened.has(wall.id)) return;
    const current = build.step?.wallId === wall.id;
    const curve = wallCurve(wall);
    strokeCurve(current ? partialCurve(curve, 1 - build.amount) : curve, {
      color: current ? COLORS.solution : COLORS.wall,
      alpha: current ? 0.88 : (wall.boundary ? 0.88 : 0.64),
      width: current ? 2.6 : (wall.boundary ? 2.05 : 1.35),
      shadow: current ? 10 : 0,
    });
  });
}

function drawPassages() {
  if (state.mode !== "carve") {
    state.maze.passages.forEach((passage) => {
      strokeCurve(passageCurve(passage), {
        color: COLORS.passage,
        alpha: 0.49,
        width: 1.25,
      });
    });
    return;
  }

  const build = carveState();
  const roots = state.algorithm === "kruskal" ? kruskalRoots(build) : null;
  const activeWalk = state.algorithm === "wilson" ? build.step?.walkId : null;
  state.maze.buildSteps.slice(0, build.completed).forEach((step) => {
    const passage = state.maze.passages[step.edgeId];
    let color = step.kind === "braid" ? COLORS.violet : COLORS.passage;
    let alpha = 0.72;
    let width = 1.45;
    if (roots && step.process === "merge") {
      const root = roots[step.to];
      const colorIndex = Math.floor(hashUnit(root, 211) * PASSAGE_HEAD_COLORS.length)
        % PASSAGE_HEAD_COLORS.length;
      color = PASSAGE_HEAD_COLORS[colorIndex];
      alpha = 0.68;
    } else if (activeWalk != null && step.walkId === activeWalk) {
      color = CARVE_PROFILES.wilson.accent;
      alpha = 0.92;
      width = 1.85;
    }
    strokeCurve(passageCurve(passage, step.from, step.to), {
      color,
      alpha,
      width,
    });
  });
  if (build.step && build.completed < state.maze.buildSteps.length) {
    const passage = state.maze.passages[build.step.edgeId];
    const curve = passageCurve(passage, build.step.from, build.step.to);
    strokeCurve(partialCurve(curve, build.amount), {
      color: build.step.kind === "braid" ? COLORS.violet : COLORS.passage,
      alpha: 1,
      width: 2.8,
      shadow: 12,
    });
  }
}

function drawRoute(record, color, width, alpha, dash = []) {
  record?.segments.forEach((segment) => {
    strokeCurve(curveWorld(record.layer, segment.edge, segment.from, segment.to), {
      color,
      width,
      alpha,
      dash,
    });
  });
}

function drawSolution() {
  if (!state.showSolution || state.mode === "carve") return;
  drawRoute(routeRecord(state.solution, "passage"), COLORS.solution, 2.1, 0.78, [4, 7]);
}

function drawMarker(node, color, diamond = false) {
  const current = screenPoint(warpPoint(state.maze.cells[node]?.center ?? { x: 0, y: 0 }));
  context.save();
  context.translate(current.x, current.y);
  if (diamond) context.rotate(Math.PI / 4);
  context.fillStyle = "#050708";
  context.strokeStyle = color;
  context.lineWidth = 1.7;
  context.shadowColor = color;
  context.shadowBlur = 9;
  context.beginPath();
  if (diamond) context.rect(-4.5, -4.5, 9, 9);
  else context.arc(0, 0, 4.8, 0, TAU);
  context.fill();
  context.stroke();
  context.restore();
}

function drawHoverCell() {
  if (hoverCell < 0 || pointer?.moved) return;
  const cell = state.maze.cells[hoverCell];
  const polygon = cell.polygon.map((vertex) => screenPoint(warpPoint(vertex)));
  context.save();
  context.beginPath();
  context.moveTo(polygon[0].x, polygon[0].y);
  polygon.slice(1).forEach(({ x, y }) => context.lineTo(x, y));
  context.closePath();
  context.strokeStyle = COLORS.violet;
  context.globalAlpha = 0.72;
  context.lineWidth = 1.2;
  context.stroke();
  context.restore();
}

function drawHead(head) {
  const colorSet = head.layer === "wall" ? WALL_HEAD_COLORS : PASSAGE_HEAD_COLORS;
  const color = colorSet[(head.headIndex ?? 0) % colorSet.length];
  if (head.curve) {
    strokeCurve(partialCurve(head.curve, head.amount), {
      color,
      alpha: 0.9,
      width: 2.7,
      shadow: 9,
    });
  } else if (head.segment) {
    const curve = curveWorld(head.layer, head.segment.edge, head.segment.from, head.segment.to);
    strokeCurve(partialCurve(curve, head.amount), {
      color,
      alpha: 0.82,
      width: head.layer === "wall" ? 2.35 : 2.65,
      shadow: 8,
    });
  }
  const screen = screenPoint(head.world);
  const angle = Math.atan2(-head.tangent.y, head.tangent.x);
  context.save();
  context.translate(screen.x, screen.y);
  context.rotate(angle);
  context.shadowColor = color;
  context.shadowBlur = 15;
  context.fillStyle = COLORS.paper;
  context.strokeStyle = color;
  context.lineWidth = 1.6;
  context.beginPath();
  if (head.layer === "wall") context.rect(-4.2, -4.2, 8.4, 8.4);
  else context.arc(0, 0, 4.4, 0, TAU);
  context.fill();
  context.stroke();
  context.beginPath();
  context.moveTo(-9, 0);
  context.lineTo(-5.5, 0);
  context.stroke();
  context.restore();
}

function drawScene(heads) {
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);
  drawCellWash();
  drawPotentialWalls();
  drawWalls();
  drawPassages();
  drawCarveProcess();
  drawSolution();
  if (state.mode !== "carve") {
    drawMarker(state.startNode, COLORS.passage);
    drawMarker(state.targetNode, COLORS.solution, true);
  }
  heads.forEach(drawHead);
  drawHoverCell();
}

function pitchValue(head) {
  if (state.mode === "carve" && Number.isFinite(head.carveValue)) {
    let processValue = head.carveValue;
    if (head.process === "frontier") {
      processValue = clamp(processValue * 0.68 + head.frontierRatio * 0.32, 0, 1);
    } else if (head.process === "merge") {
      processValue = clamp(processValue * 0.7 + head.mergeBalance * 0.3, 0, 1);
    }
    return head.layer === "passage"
      ? processValue
      : wrap01(head.orientation * 0.62 + processValue * 0.38);
  }
  if (head.layer === "passage") {
    if (state.passagePitch === "height") return clamp((head.world.y + 1) / 2, 0, 1);
    if (state.passagePitch === "turn") return head.turn;
    if (state.passagePitch === "route") return head.phase;
    return head.depth;
  }
  if (state.wallPitch === "height") return clamp((head.world.y + 1) / 2, 0, 1);
  if (state.wallPitch === "contour") return head.phase;
  if (state.wallPitch === "component") {
    return head.component / Math.max(1, state.maze.wallGraph.components.length - 1);
  }
  return head.orientation;
}

function voiceForHead(head, index) {
  const value = pitchValue(head);
  const wall = head.layer === "wall";
  const carveProfile = state.mode === "carve" ? CARVE_PROFILES[state.algorithm] : null;
  const layerProfile = carveProfile?.[wall ? "wall" : "passage"];
  const semitones = value * state.pitchRange + (wall ? state.wallOffset : 0);
  const frequency = clamp(state.rootFrequency * 2 ** (semitones / 12), 20, 16000);
  const layerLevel = wall ? state.wallLevel : state.passageLevel;
  return {
    key: `maze:${head.layer}:${index}`,
    frequency,
    gain: layerLevel * (wall ? 0.046 : 0.058),
    pan: clamp(head.world.x * 0.9, -0.95, 0.95),
    waveform: layerProfile?.waveform ?? (wall ? "triangle" : "sine"),
    mode: state.voiceEngine,
    synthDrive: layerProfile?.drive ?? (wall ? 0.72 : 0.36),
    modulationIndex: layerProfile?.index ?? (wall ? 5.8 : 2.8),
    modulationRatio: layerProfile?.ratio ?? (wall ? 2.67 : 1.51),
    shepardPosition: value,
    shepardTravel: value,
    shepardRate: state.speed * (wall ? -1 : 1),
    shepardWidth: wall ? 4.4 : 5.6,
  };
}

function triggerJunctions(heads, voices) {
  const nextSegments = new Map();
  const carveProfile = state.mode === "carve" ? CARVE_PROFILES[state.algorithm] : null;
  heads.forEach((head, index) => {
    const key = `${head.layer}:${head.headIndex ?? index}`;
    nextSegments.set(key, head.segmentKey);
    const previous = lastHeadSegments.get(key);
    if (!previous || previous === head.segmentKey || state.nodeAccent <= 0) return;
    const voice = voices[index];
    if (!voice) return;
    voicePool.strike({
      key: `maze-junction:${key}`,
      frequency: clamp(
        voice.frequency
          * (head.layer === "wall" ? 1.5 : 1)
          * (carveProfile?.strikeRatio ?? 1),
        20,
        16000,
      ),
      gain: state.nodeAccent
        * (head.layer === "wall" ? state.wallLevel : state.passageLevel)
        * 0.065
        * (head.process === "merge" ? 0.72 + head.mergeBalance * 0.56 : 1),
      pan: voice.pan,
      waveform: carveProfile?.[head.layer]?.waveform
        ?? (head.layer === "wall" ? "triangle" : "sine"),
    }, {
      attackSeconds: 0.004,
      decaySeconds: carveProfile?.strikeDecay ?? (head.layer === "wall" ? 0.11 : 0.16),
      attackNoise: carveProfile
        ? carveProfile.attackNoise * (head.layer === "wall" ? 1 : 0.45)
        : (head.layer === "wall" ? 0.12 : 0.025),
      retriggerMode: "crossfade",
    });
  });
  lastHeadSegments = nextSegments;
}

function updateAudio(heads) {
  if (!state.audio || !state.playing || document.hidden) {
    voicePool.setVoices([], { mode: state.voiceEngine });
    lastHeadSegments = new Map();
    return;
  }
  const voices = heads.map(voiceForHead);
  voicePool.setVoices(voices, {
    mode: state.voiceEngine,
    requestedVoiceCount: voices.length,
  });
  triggerJunctions(heads, voices);
}

async function setAudio(enabled) {
  if (!enabled) {
    state.audio = false;
    voicePool.setVoices([]);
    voicePool.disable();
    lastHeadSegments = new Map();
    updateReadouts(playheads());
    announce("Audio off.");
    return;
  }
  try {
    await voicePool.enable();
    voicePool.setLevel(state.level);
    state.audio = true;
    updateReadouts(playheads());
    scheduleFrame();
    announce("Audio on. Passage and wall voices are sounding.");
  } catch (error) {
    state.audio = false;
    voicePool.disable();
    showError(error);
    updateReadouts(playheads());
  }
}

function syncControls() {
  Object.entries(controls).forEach(([key, input]) => {
    if (!input || !(key in state)) return;
    if (input.type === "checkbox") input.checked = Boolean(state[key]);
    else input.value = String(state[key]);
  });
  document.querySelectorAll("[data-maze-mode]").forEach((button) => {
    setPressed(button, button.dataset.mazeMode === state.mode);
  });
  setPressed($("solveButton"), state.mode === "solve");
  document.querySelectorAll("[data-maze-topology]").forEach((button) => {
    setPressed(button, button.dataset.mazeTopology === state.topology);
  });
}

function updateReadouts(heads = playheads()) {
  const build = state.mode === "carve" ? carveState() : null;
  const visiblePassageHeads = heads.filter(({ layer }) => layer === "passage").length;
  const visibleWallHeads = heads.filter(({ layer }) => layer === "wall").length;
  const algorithm = mazeAlgorithmLabel(state.algorithm);
  const topology = mazeTopologyLabel(state.topology);
  setText("audioState", state.audio ? "on" : "off");
  setText("levelOut", percent(state.level));
  setText("positionOut", build
    ? `${build.completed} / ${state.maze.buildSteps.length} openings`
    : `${(state.position * 100).toFixed(1)}%`);
  setText("speedOut", build
    ? `${compact(state.speed * state.maze.buildSteps.length)} openings/s`
    : `${state.speed.toFixed(3)} cyc/s`);
  setText("sizeOut", state.size);
  setText("seedOut", state.seed);
  setText("braidOut", percent(state.braid));
  setText("bendOut", percent(state.bend));
  setText("twistOut", `${state.twist >= 0 ? "+" : ""}${Math.round(state.twist * 140)}°`);
  setText("fieldMotionOut", percent(state.fieldMotion));
  setText("rootFrequencyOut", `${compact(state.rootFrequency)} Hz`);
  setText("pitchRangeOut", `${state.pitchRange} st`);
  setText("wallOffsetOut", `${state.wallOffset >= 0 ? "+" : ""}${state.wallOffset} st`);
  setText("nodeAccentOut", percent(state.nodeAccent));
  setText("passageLayerOut", percent(state.passageLevel));
  setText("wallLayerOut", percent(state.wallLevel));
  setText("passageHeadsOut", state.passageHeads);
  setText("wallHeadsOut", state.wallHeads);
  setText("polyphonyOut", `${state.passageHeads} + ${state.wallHeads} voices`);
  setText("cellsReadout", state.maze.metrics.cellCount);
  setText("passagesReadout", state.maze.metrics.passageCount);
  setText("wallsReadout", state.maze.metrics.wallCount);
  setText("cyclesReadout", state.maze.metrics.cycleRank);
  setText("deadEndsReadout", state.maze.metrics.deadEndCount);
  setText("solutionReadout", `${Math.max(0, state.solution.length - 1)} edges`);
  setText(
    "stageReadout",
    `${state.maze.metrics.cellCount} CELLS / ${state.maze.metrics.wallCount} WALLS / ${visiblePassageHeads}+${visibleWallHeads} VOICES`,
  );
  $("phaseBar").style.width = `${clamp(state.position, 0, 1) * 100}%`;
  $("playButton").title = state.playing ? "Pause" : "Play";
  $("playButton").setAttribute("aria-label", state.playing ? "Pause maze time" : "Play maze time");
  setPressed($("playButton"), state.playing);
  $("directionButton").dataset.direction = state.direction > 0 ? "forward" : "reverse";
  $("directionButton").setAttribute("aria-label", `Direction: ${state.direction > 0 ? "forward" : "reverse"}`);
  setPressed($("audioButton"), state.audio);
  canvas.setAttribute(
    "aria-label",
    `${topology} maze generated by ${algorithm}; ${visiblePassageHeads} passage voices and ${visibleWallHeads} wall voices; audio ${state.audio ? "on" : "off"}.`,
  );
  controls.position.value = String(state.position);
}

function setMode(mode, { resetTime = false } = {}) {
  if (!Object.hasOwn(MODES, mode)) return;
  state.mode = mode;
  if (mode === "solve") state.showSolution = true;
  if (resetTime || mode === "carve") state.position = state.direction > 0 ? 0 : 1;
  rebuildRoutes();
  syncControls();
  scheduleFrame();
  announce(`${MODES[mode]} mode.`);
}

function togglePlayback() {
  if (!state.playing && state.cycleBehavior === "hold") {
    if ((state.direction > 0 && state.position >= 1) || (state.direction < 0 && state.position <= 0)) {
      state.position = state.direction > 0 ? 0 : 1;
    }
  }
  state.playing = !state.playing;
  lastFrameAt = performance.now();
  if (!state.playing) voicePool.setVoices([]);
  updateReadouts(playheads());
  if (state.playing) scheduleFrame();
}

function evolveSeed() {
  state.seed += state.direction > 0 ? 1 : -1;
  if (state.seed > 99999) state.seed = 1;
  if (state.seed < 1) state.seed = 99999;
  regenerate({ resetTime: false, announceChange: false });
}

function advanceTime(delta) {
  if (!state.playing) return;
  const next = state.position + delta * state.speed * state.direction;
  if (next >= 0 && next <= 1) {
    state.position = next;
    return;
  }
  if (state.cycleBehavior === "hold") {
    state.position = state.direction > 0 ? 1 : 0;
    state.playing = false;
    voicePool.setVoices([]);
    return;
  }
  state.position = wrap01(next);
  if (state.cycleBehavior === "evolve") evolveSeed();
  lastHeadSegments = new Map();
}

function nearestCell(clientX, clientY) {
  const bounds = canvas.getBoundingClientRect();
  const x = clientX - bounds.left;
  const y = clientY - bounds.top;
  let best = -1;
  let bestDistance = Infinity;
  state.maze.cells.forEach((cell) => {
    const center = screenPoint(warpPoint(cell.center));
    const distance = Math.hypot(center.x - x, center.y - y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell.id;
    }
  });
  return best;
}

function finishPointer(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  if (!pointer.moved) {
    const cell = nearestCell(event.clientX, event.clientY);
    if (cell >= 0) {
      if (event.shiftKey || pointer.shift) updateSolution(cell, state.targetNode, false);
      else updateSolution(state.startNode, cell, false);
      if (state.mode !== "solve") setMode("solve");
      announce(`${event.shiftKey || pointer.shift ? "Solver start" : "Solver target"} moved to cell ${cell + 1}.`);
    }
  }
  stageWrap.classList.remove("is-scrubbing");
  canvas.releasePointerCapture?.(event.pointerId);
  pointer = null;
  scheduleFrame();
}

function svgNumber(value) {
  return Number(value).toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function svgCurvePath(curve) {
  return `M ${svgNumber(curve.a.x)} ${svgNumber(-curve.a.y)} Q ${svgNumber(curve.c.x)} ${svgNumber(-curve.c.y)} ${svgNumber(curve.b.x)} ${svgNumber(-curve.b.y)}`;
}

function exportSvg() {
  const wallPaths = state.maze.walls
    .map((wall) => svgCurvePath(wallCurve(wall)))
    .join(" ");
  const passagePaths = state.maze.passages
    .map((passage) => svgCurvePath(passageCurve(passage)))
    .join(" ");
  const solutionRecord = routeRecord(state.solution, "passage");
  const solutionPaths = solutionRecord.segments
    .map((segment) => svgCurvePath(curveWorld("passage", segment.edge, segment.from, segment.to)))
    .join(" ");
  const svg = [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"-1.12 -1.12 2.24 2.24\">",
    `<title>Algorithmic Mazes - ${state.maze.topology.label}, ${state.maze.algorithm.label}, seed ${state.seed}</title>`,
    "<rect x=\"-1.12\" y=\"-1.12\" width=\"2.24\" height=\"2.24\" fill=\"#050708\"/>",
    `<path id="wall-outlines" data-layer="wall-outlines" d="${wallPaths}" fill="none" stroke="${COLORS.wall}" stroke-width="0.006" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path id="passage-centers" data-layer="passage-centers" d="${passagePaths}" fill="none" stroke="${COLORS.passage}" stroke-width="0.0045" stroke-linecap="round" stroke-linejoin="round"/>`,
    state.showSolution
      ? `<path id="solution-route" data-layer="solution-route" d="${solutionPaths}" fill="none" stroke="${COLORS.solution}" stroke-width="0.007" stroke-dasharray="0.014 0.018" stroke-linecap="round"/>`
      : "",
    "</svg>",
  ].join("\n");
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = `algorithmic-maze-${state.topology}-${state.seed}.svg`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  announce("SVG exported with separate wall, passage, and solution paths.");
}

function bindControls() {
  $("audioButton").addEventListener("click", () => setAudio(!state.audio));
  $("playButton").addEventListener("click", togglePlayback);
  $("directionButton").addEventListener("click", () => {
    state.direction *= -1;
    lastHeadSegments = new Map();
    updateReadouts(playheads());
    scheduleFrame();
  });
  document.querySelectorAll("[data-maze-mode]").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mazeMode));
  });
  document.querySelectorAll("[data-maze-topology]").forEach((button) => {
    button.addEventListener("click", () => {
      state.topology = button.dataset.mazeTopology;
      regenerate({ resetTime: state.mode === "carve" });
    });
  });

  controls.level.addEventListener("input", () => {
    state.level = Number(controls.level.value);
    voicePool.setLevel(state.level);
    updateReadouts(playheads());
  });
  controls.position.addEventListener("input", () => {
    state.position = Number(controls.position.value);
    lastHeadSegments = new Map();
    scheduleFrame();
  });
  controls.speed.addEventListener("input", () => {
    state.speed = Number(controls.speed.value);
    updateReadouts(playheads());
  });
  controls.cycleBehavior.addEventListener("change", () => {
    state.cycleBehavior = controls.cycleBehavior.value;
    updateReadouts(playheads());
  });
  controls.algorithm.addEventListener("change", () => {
    state.algorithm = controls.algorithm.value;
    regenerate({ resetTime: state.mode === "carve" });
  });
  for (const id of ["size", "seed", "braid"]) {
    controls[id].addEventListener("input", () => {
      state[id] = id === "braid" ? Number(controls[id].value) : Math.round(Number(controls[id].value));
      updateReadouts(playheads());
    });
    controls[id].addEventListener("change", () => regenerate({ resetTime: state.mode === "carve" }));
  }
  for (const id of ["bend", "twist", "fieldMotion"]) {
    controls[id].addEventListener("input", () => {
      state[id] = Number(controls[id].value);
      updateReadouts(playheads());
      scheduleFrame();
    });
  }
  for (const id of ["showPotential", "showSolution"]) {
    controls[id].addEventListener("change", () => {
      state[id] = controls[id].checked;
      scheduleFrame();
    });
  }
  for (const id of ["passageHeads", "wallHeads"]) {
    controls[id].addEventListener("input", () => {
      state[id] = Math.round(Number(controls[id].value));
      rebuildRoutes();
      updateReadouts(playheads());
      scheduleFrame();
    });
  }
  for (const id of ["passageLevel", "wallLevel", "rootFrequency", "pitchRange", "wallOffset", "nodeAccent"]) {
    controls[id].addEventListener("input", () => {
      state[id] = Number(controls[id].value);
      updateReadouts(playheads());
      scheduleFrame();
    });
  }
  for (const id of ["voiceEngine", "passagePitch", "wallPitch"]) {
    controls[id].addEventListener("change", () => {
      state[id] = controls[id].value;
      lastHeadSegments = new Map();
      updateReadouts(playheads());
      scheduleFrame();
    });
  }

  $("newMazeButton").addEventListener("click", () => {
    state.seed = randomSeed();
    regenerate({ resetTime: state.mode === "carve" });
  });
  $("replayCarveButton").addEventListener("click", () => {
    state.direction = 1;
    state.playing = true;
    setMode("carve", { resetTime: true });
  });
  $("solveButton").addEventListener("click", () => {
    state.playing = true;
    setMode("solve", { resetTime: true });
  });
  $("exportSvgButton").addEventListener("click", exportSvg);
  $("resetAllButton").addEventListener("click", () => {
    const keepAudio = state.audio;
    Object.assign(state, DEFAULTS, { audio: keepAudio });
    voicePool.setLevel(state.level);
    regenerate({ resetTime: false, announceChange: false });
    announce("Algorithmic Mazes reset.");
  });

  canvas.addEventListener("pointerdown", (event) => {
    pointer = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: state.position,
      shift: event.shiftKey,
      moved: false,
    };
    canvas.setPointerCapture?.(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!pointer || event.pointerId !== pointer.id) {
      hoverCell = nearestCell(event.clientX, event.clientY);
      scheduleFrame();
      return;
    }
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (Math.hypot(dx, dy) > 7) pointer.moved = true;
    if (!pointer.moved) return;
    stageWrap.classList.add("is-scrubbing");
    state.position = clamp(pointer.startPosition + dx / Math.max(1, cssWidth), 0, 1);
    lastHeadSegments = new Map();
    scheduleFrame();
  });
  canvas.addEventListener("pointerup", finishPointer);
  canvas.addEventListener("pointercancel", finishPointer);
  canvas.addEventListener("pointerleave", () => {
    if (!pointer) {
      hoverCell = -1;
      scheduleFrame();
    }
  });
  canvas.addEventListener("keydown", (event) => {
    if (event.code === "Space") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      state.position = clamp(state.position + (event.key === "ArrowRight" ? 0.01 : -0.01), 0, 1);
      lastHeadSegments = new Map();
      scheduleFrame();
    } else if (event.key.toLowerCase() === "r") {
      state.direction = 1;
      state.playing = true;
      setMode("carve", { resetTime: true });
    } else if (event.key.toLowerCase() === "n") {
      state.seed = randomSeed();
      regenerate({ resetTime: state.mode === "carve" });
    }
  });
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  pixelRatio = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  cssWidth = Math.max(1, bounds.width);
  cssHeight = Math.max(1, bounds.height);
  canvas.width = Math.round(cssWidth * pixelRatio);
  canvas.height = Math.round(cssHeight * pixelRatio);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  scheduleFrame();
}

function frame(now = performance.now()) {
  scheduledFrame = 0;
  const delta = Math.min(0.1, Math.max(0, (now - lastFrameAt) / 1000));
  lastFrameAt = now;
  advanceTime(delta);
  const heads = playheads();
  drawScene(heads);
  updateAudio(heads);
  updateReadouts(heads);
  if (state.playing || pointer) scheduleFrame();
}

function boot() {
  state.startNode = state.maze.start;
  state.targetNode = state.maze.goal;
  state.solution = shortestMazePath(state.maze, state.startNode, state.targetNode);
  rebuildRoutes();
  bindControls();
  syncControls();
  resizeCanvas();
  updateReadouts(playheads());
  const observer = new ResizeObserver(resizeCanvas);
  observer.observe(stageWrap);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) voicePool.setVoices([]);
    else if (state.playing) {
      lastFrameAt = performance.now();
      scheduleFrame();
    }
  });
  window.addEventListener("pagehide", () => voicePool.disable(), { once: true });
  scheduleFrame();
}

boot();
