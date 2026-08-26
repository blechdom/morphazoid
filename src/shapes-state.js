import { normalizeSharedProfile } from "./shapes-profile.js";

const clamp = (value, minimum, maximum, fallback = minimum) => {
  const numeric = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(numeric) ? numeric : fallback));
};

const choice = (value, options, fallback) => options.includes(value) ? value : fallback;

export const SHAPES_DIMENSIONS = Object.freeze({
  "2d": Object.freeze({ id: "2d", geometry: "shape", label: "2D", name: "Polygon", color: "#69f2bd" }),
  "3d": Object.freeze({ id: "3d", geometry: "solid", label: "3D", name: "Polyhedra", color: "#78a7ff" }),
  "4d": Object.freeze({ id: "4d", geometry: "hyper", label: "4D", name: "Hyperpolyhedra", color: "#cb8fff" }),
});

export const SHAPES_PLAYING_MODES = Object.freeze([
  Object.freeze({ id: "continuous", label: "Continuous" }),
  Object.freeze({ id: "notes", label: "Notes" }),
  Object.freeze({ id: "triggers", label: "Triggers" }),
]);

export const SHAPES_VOICE_ENGINES = Object.freeze([
  Object.freeze({ id: "sine", label: "Sine" }),
  Object.freeze({ id: "fm", label: "FM" }),
  Object.freeze({ id: "pm", label: "PM" }),
  Object.freeze({ id: "shepard", label: "Shepard" }),
]);

export const SHAPES_BANKS = Object.freeze(["main", "form", "rotation", "mapping"]);

export const SHAPES_STORAGE_KEY = "morphazoid:shapes:standalone:v1";

const DEFAULT_STATE = Object.freeze({
  selection: Object.freeze({ dimension: "2d", playingMode: "continuous", bank: "main" }),
  audio: Object.freeze({ enabled: false, level: 0.65 }),
  play: Object.freeze({
    running: false,
    continuousPhase: 0.18,
    rateCyclesPerSecond: 0.12,
    direction: 1,
    motion: "loop",
  }),
  profile: Object.freeze({ sides: 6, kind: "polygon", starDepth: 0.48 }),
  voice: Object.freeze({
    engine: "sine",
    baseHz: 110,
    rangeOctaves: 3,
    character: 0.35,
    spread: 0.85,
    noteDivisions: 8,
  }),
  trigger: Object.freeze({
    mapping: "feature",
    divisions: 2,
    tuningDepth: 12,
    characterDepth: 0.7,
    hitCap: 6,
  }),
  dimension: Object.freeze({
    "2d": Object.freeze({
      reader: "points",
      rotation: 0,
      rotationRunning: false,
      rotationSpeed: 0.12,
      curvature: 0,
      aspect: 0,
      skew: 0,
    }),
    "3d": Object.freeze({
      representation: "profile",
      readerYaw: 45,
      readerPitch: -22,
      rotation: Object.freeze({ x: -24, y: 36, z: 8 }),
      rotationRunning: false,
      rotationSpeed: 0.08,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
      skew: Object.freeze({ x: 0, z: 0 }),
    }),
    "4d": Object.freeze({
      representation: "profile",
      rotation: Object.freeze({ xw: 24, yw: -18, zw: 12 }),
      rotationRunning: false,
      rotationSpeed: 0.06,
      scale: Object.freeze({ x: 1, y: 1, z: 1, w: 1 }),
    }),
  }),
});

function sanitizeDimension(value) {
  const aliases = { shape: "2d", polygon: "2d", solid: "3d", polyhedra: "3d", hyper: "4d", hyperpolyhedra: "4d" };
  const candidate = String(value ?? "").toLowerCase();
  return SHAPES_DIMENSIONS[candidate] ? candidate : aliases[candidate] ?? "2d";
}

function sanitizePlayingMode(value, legacySound) {
  if (value === "continuous" || value === "notes" || value === "triggers") return value;
  if (legacySound === "drums") return "triggers";
  return "continuous";
}

function sanitizeAngle(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return ((numeric + 180) % 360 + 360) % 360 - 180;
}

function sanitizeScale(source, axes, maximum = 1.6) {
  return Object.fromEntries(axes.map((axis) => [
    axis,
    clamp(source?.[axis], 0.5, maximum, 1),
  ]));
}

export function createShapesState(source = {}) {
  const selection = source.selection ?? {};
  const dimension = sanitizeDimension(selection.dimension ?? source.geometry);
  const profile = normalizeSharedProfile(source.profile ?? DEFAULT_STATE.profile);
  const two = source.dimension?.["2d"] ?? {};
  const three = source.dimension?.["3d"] ?? {};
  const four = source.dimension?.["4d"] ?? {};
  const voice = source.voice ?? {};
  const trigger = source.trigger ?? {};
  const play = source.play ?? {};
  const audio = source.audio ?? {};

  return {
    selection: {
      dimension,
      playingMode: sanitizePlayingMode(selection.playingMode, source.sound),
      bank: choice(selection.bank, SHAPES_BANKS, "main"),
    },
    audio: {
      enabled: Boolean(audio.enabled),
      level: clamp(audio.level, 0, 1, DEFAULT_STATE.audio.level),
    },
    play: {
      running: Boolean(play.running),
      continuousPhase: Number.isFinite(Number(play.continuousPhase))
        ? Number(play.continuousPhase)
        : DEFAULT_STATE.play.continuousPhase,
      rateCyclesPerSecond: clamp(
        play.rateCyclesPerSecond,
        0,
        4,
        DEFAULT_STATE.play.rateCyclesPerSecond,
      ),
      direction: Number(play.direction) < 0 ? -1 : 1,
      motion: choice(play.motion, ["loop", "pingpong"], "loop"),
    },
    profile: { sides: profile.sides, kind: profile.kind, starDepth: profile.starDepth },
    voice: {
      engine: choice(voice.engine, SHAPES_VOICE_ENGINES.map(({ id }) => id), "sine"),
      baseHz: clamp(voice.baseHz, 20, 440, DEFAULT_STATE.voice.baseHz),
      rangeOctaves: clamp(voice.rangeOctaves, 0, 7, DEFAULT_STATE.voice.rangeOctaves),
      character: clamp(voice.character, 0, 1, DEFAULT_STATE.voice.character),
      spread: clamp(voice.spread, 0, 1, DEFAULT_STATE.voice.spread),
      noteDivisions: Math.round(clamp(voice.noteDivisions, 1, 24, DEFAULT_STATE.voice.noteDivisions)),
    },
    trigger: {
      mapping: choice(trigger.mapping, ["feature", "position", "incidence"], "feature"),
      divisions: Math.round(clamp(trigger.divisions, 1, 16, DEFAULT_STATE.trigger.divisions)),
      tuningDepth: clamp(trigger.tuningDepth, 0, 24, DEFAULT_STATE.trigger.tuningDepth),
      characterDepth: clamp(trigger.characterDepth, 0, 1, DEFAULT_STATE.trigger.characterDepth),
      hitCap: Math.round(clamp(trigger.hitCap, 1, 16, DEFAULT_STATE.trigger.hitCap)),
    },
    dimension: {
      "2d": {
        reader: choice(two.reader, ["points", "line", "radar"], "points"),
        rotation: sanitizeAngle(two.rotation, DEFAULT_STATE.dimension["2d"].rotation),
        rotationRunning: Boolean(two.rotationRunning),
        rotationSpeed: clamp(two.rotationSpeed, -0.5, 0.5, DEFAULT_STATE.dimension["2d"].rotationSpeed),
        curvature: clamp(two.curvature, -1, 1, 0),
        aspect: clamp(two.aspect, -2, 2, 0),
        skew: clamp(two.skew, -2, 2, 0),
      },
      "3d": {
        representation: choice(
          three.representation,
          ["profile", "cube", "pyramid", "octahedron", "prism", "cone", "cylinder", "sphere", "torus"],
          "profile",
        ),
        readerYaw: sanitizeAngle(three.readerYaw, DEFAULT_STATE.dimension["3d"].readerYaw),
        readerPitch: sanitizeAngle(three.readerPitch, DEFAULT_STATE.dimension["3d"].readerPitch),
        rotation: {
          x: sanitizeAngle(three.rotation?.x, DEFAULT_STATE.dimension["3d"].rotation.x),
          y: sanitizeAngle(three.rotation?.y, DEFAULT_STATE.dimension["3d"].rotation.y),
          z: sanitizeAngle(three.rotation?.z, DEFAULT_STATE.dimension["3d"].rotation.z),
        },
        rotationRunning: Boolean(three.rotationRunning),
        rotationSpeed: clamp(three.rotationSpeed, -0.5, 0.5, DEFAULT_STATE.dimension["3d"].rotationSpeed),
        scale: sanitizeScale(three.scale, ["x", "y", "z"]),
        skew: {
          x: clamp(three.skew?.x, -0.7, 0.7, 0),
          z: clamp(three.skew?.z, -0.7, 0.7, 0),
        },
      },
      "4d": {
        representation: choice(
          four.representation,
          ["profile", "tesseract", "hypersphere", "hyperpyramid", "klein"],
          "profile",
        ),
        rotation: {
          xw: sanitizeAngle(four.rotation?.xw, DEFAULT_STATE.dimension["4d"].rotation.xw),
          yw: sanitizeAngle(four.rotation?.yw, DEFAULT_STATE.dimension["4d"].rotation.yw),
          zw: sanitizeAngle(four.rotation?.zw, DEFAULT_STATE.dimension["4d"].rotation.zw),
        },
        rotationRunning: Boolean(four.rotationRunning),
        rotationSpeed: clamp(four.rotationSpeed, -0.5, 0.5, DEFAULT_STATE.dimension["4d"].rotationSpeed),
        scale: sanitizeScale(four.scale, ["x", "y", "z", "w"], 1.5),
      },
    },
  };
}

export function displayShapesPhase(state) {
  const phase = Number(state?.play?.continuousPhase) || 0;
  if (state?.play?.motion === "pingpong") {
    const folded = ((phase % 2) + 2) % 2;
    return folded <= 1 ? folded : 2 - folded;
  }
  return ((phase % 1) + 1) % 1;
}

export function selectShapesDimension(state, dimension) {
  state.selection.dimension = sanitizeDimension(dimension);
  return state;
}

export function selectShapesPlayingMode(state, playingMode) {
  state.selection.playingMode = sanitizePlayingMode(playingMode);
  return state;
}

export function shapesDivisionCount(state) {
  if (state?.selection?.playingMode === "notes") {
    return Math.round(clamp(state?.voice?.noteDivisions, 1, 24, DEFAULT_STATE.voice.noteDivisions));
  }
  if (state?.selection?.playingMode === "triggers") {
    return Math.round(clamp(state?.trigger?.divisions, 1, 16, DEFAULT_STATE.trigger.divisions));
  }
  return 1;
}

export function setShapesDivisionCount(state, value) {
  if (state?.selection?.playingMode === "notes") {
    state.voice.noteDivisions = Math.round(clamp(value, 1, 24, DEFAULT_STATE.voice.noteDivisions));
  } else if (state?.selection?.playingMode === "triggers") {
    state.trigger.divisions = Math.round(clamp(value, 1, 16, DEFAULT_STATE.trigger.divisions));
  }
  return state;
}

export function selectShapesBank(state, bank) {
  state.selection.bank = choice(bank, SHAPES_BANKS, "main");
  return state;
}

export function advanceShapesMotion(state, deltaSeconds) {
  const delta = clamp(deltaSeconds, 0, 0.25, 0);
  if (state.play.running) {
    state.play.continuousPhase += state.play.direction * state.play.rateCyclesPerSecond * delta;
  }
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  if (!local.rotationRunning) return state;
  const degrees = local.rotationSpeed * 360 * delta;
  if (dimension === "2d") local.rotation = sanitizeAngle(local.rotation + degrees, 0);
  if (dimension === "3d") {
    local.rotation.x = sanitizeAngle(local.rotation.x + degrees * 0.37, local.rotation.x);
    local.rotation.y = sanitizeAngle(local.rotation.y + degrees, local.rotation.y);
    local.rotation.z = sanitizeAngle(local.rotation.z + degrees * 0.21, local.rotation.z);
  }
  if (dimension === "4d") {
    local.rotation.xw = sanitizeAngle(local.rotation.xw + degrees, local.rotation.xw);
    local.rotation.yw = sanitizeAngle(local.rotation.yw + degrees * 0.67, local.rotation.yw);
    local.rotation.zw = sanitizeAngle(local.rotation.zw - degrees * 0.41, local.rotation.zw);
  }
  return state;
}

export function shapesRepresentationLabel(state) {
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  if (dimension === "2d") {
    if (state.profile.sides === 1) return "Circle";
    if (state.profile.sides === 2) return "Open line";
    return state.profile.kind === "star"
      ? `${state.profile.sides}-point star`
      : `${state.profile.sides}-sided polygon`;
  }
  if (local.representation === "profile") {
    const suffix = dimension === "3d" ? "prism" : "hyperprism";
    const profileLabel = state.profile.kind === "circle"
      ? "Circular"
      : state.profile.kind === "line"
        ? "Line"
        : state.profile.kind === "star"
          ? `${state.profile.sides}-point star`
          : `${state.profile.sides}-sided polygon`;
    return `${profileLabel} ${suffix}`;
  }
  const labels = {
    cube: "Cube",
    pyramid: "Pyramid",
    octahedron: "Octahedron",
    prism: "Triangular prism",
    cone: "Cone",
    cylinder: "Cylinder",
    sphere: "Sphere",
    torus: "Torus",
    tesseract: "Tesseract",
    hypersphere: "Hypersphere",
    hyperpyramid: "Hyperpyramid",
    klein: "Klein bottle",
  };
  return labels[local.representation] ?? SHAPES_DIMENSIONS[dimension].name;
}

function eventRotationValues(state) {
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  if (dimension === "2d") return [local.rotation];
  if (dimension === "3d") {
    return [local.readerYaw, local.readerPitch, local.rotation.x, local.rotation.y, local.rotation.z];
  }
  return [local.rotation.xw, local.rotation.yw, local.rotation.zw];
}

function quantizedRotationToken(state) {
  return eventRotationValues(state).map((value) => {
    const wrapped = ((Number(value) % 360) + 360) % 360;
    return Math.floor(wrapped / 5);
  }).join(".");
}

function quantizedContactToken(scene, divisions) {
  if (!Array.isArray(scene?.contacts)) return String(Math.max(0, Number(scene) || 0));
  const buckets = Math.max(8, Math.min(64, Math.round(divisions) * 4));
  return scene.contacts.slice(0, 12).map((contact, index) => {
    const pitch = Math.floor(clamp(contact.pitch01, 0, 1, 0.5) * buckets);
    const pan = Math.floor(clamp((Number(contact.pan) + 1) * 0.5, 0, 1, 0.5) * buckets);
    const drive = Math.floor(clamp(contact.drive01, 0, 1, 0.5) * buckets);
    return `${contact.voiceKey ?? contact.edgeIndex ?? contact.segmentIndex ?? index}.${pitch}.${pan}.${drive}`;
  }).join(",");
}

export function shapesEventToken(state, scene = 1, { clock = "auto" } = {}) {
  const phase = displayShapesPhase(state);
  const divisions = shapesDivisionCount(state);
  const topology = Number.isFinite(Number(scene?.topologyEdgeCount))
    ? Math.max(1, Math.min(64, Math.round(scene.topologyEdgeCount)))
    : Array.isArray(scene?.edges)
      ? Math.max(1, Math.min(64, scene.edges.length))
      : Math.max(1, state.profile.sides === 1 ? 8 : state.profile.sides);
  const regionCount = Math.max(1, topology * divisions);
  const local = state.dimension[state.selection.dimension];
  const representation = scene?.geometry?.type ?? local.representation ?? local.reader ?? "profile";
  const usesDivisionClock = clock === "phase"
    || (clock === "auto"
      && state.play.running
      && Math.abs(state.play.rateCyclesPerSecond) > 1e-6);
  const eventPosition = usesDivisionClock
    ? Math.floor(state.play.continuousPhase * regionCount)
    : Math.floor(phase * regionCount) % regionCount;
  const divisionToken = [
    state.selection.dimension,
    representation,
    eventPosition,
  ];
  if (usesDivisionClock) return divisionToken.join(":");
  return [...divisionToken, quantizedRotationToken(state), quantizedContactToken(scene, divisions)].join(":");
}

export function shapesEventIntervalMs(state, contactCount = 1) {
  const maximum = state.selection.playingMode === "triggers" ? state.trigger.hitCap : 8;
  const simultaneous = Math.max(1, Math.min(maximum, Math.round(Number(contactCount) || 1)));
  const floor = state.selection.playingMode === "triggers" ? 54 : 72;
  return Math.max(floor, simultaneous * 14);
}
