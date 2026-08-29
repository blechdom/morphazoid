import { normalizeSharedProfile } from "./shapes-profile.js";
import {
  canonicalHeadOffsets,
  sanitizeHeadOffsets,
  updateHeadOffset,
  wrapOffset,
} from "./playheads.js";

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

export const SHAPES_TRIGGER_SOUND_BANKS = Object.freeze([
  Object.freeze({ id: "rattlesnake", label: "Rattlesnake" }),
  Object.freeze({ id: "fm-kit", label: "FM drum kit" }),
]);

export const SHAPES_BANKS = Object.freeze(["main", "form", "rotation", "mapping"]);

export const SHAPES_STORAGE_KEY = "morphazoid:shapes:standalone:v3";
export const MAX_SHAPES_2D_HEADS = 12;

const DEFAULT_HEAD_DIRECTIONS = Object.freeze(Array(MAX_SHAPES_2D_HEADS).fill(1));
const DEFAULT_HEAD_ADJUSTMENTS = Object.freeze(Array(MAX_SHAPES_2D_HEADS).fill(0));
const DEFAULT_SCAN_LINE_AXES = Object.freeze(Array(MAX_SHAPES_2D_HEADS).fill("vertical"));

const DEFAULT_STATE = Object.freeze({
  selection: Object.freeze({ dimension: "2d", playingMode: "continuous", bank: "main" }),
  audio: Object.freeze({ enabled: false, level: 0.65 }),
  play: Object.freeze({
    running: false,
    continuousPhase: 0.18,
    rateCyclesPerSecond: 0.12,
    direction: 1,
    motion: "loop",
    divisions: 2,
  }),
  profile: Object.freeze({ sides: 4, kind: "polygon", starDepth: 0.48 }),
  voice: Object.freeze({
    engine: "sine",
    baseHz: 110,
    rangeOctaves: 3,
    character: 0.35,
    spread: 0.85,
  }),
  trigger: Object.freeze({
    soundBank: "rattlesnake",
    mapping: "feature",
    tuningDepth: 12,
    characterDepth: 0.7,
    hitCap: 6,
  }),
  dimension: Object.freeze({
    "2d": Object.freeze({
      reader: "points",
      heads: 1,
      headOffsets: Object.freeze([0]),
      scanLineAxes: DEFAULT_SCAN_LINE_AXES,
      traceHeadDirections: DEFAULT_HEAD_DIRECTIONS,
      radialHeadDirections: DEFAULT_HEAD_DIRECTIONS,
      traceHeadDirectionAdjustments: DEFAULT_HEAD_ADJUSTMENTS,
      radialHeadDirectionAdjustments: DEFAULT_HEAD_ADJUSTMENTS,
      rotation: 0,
      rotationRunning: false,
      rotationSpeed: 0.12,
      curvature: 0,
      aspect: 0,
      skew: 0,
    }),
    "3d": Object.freeze({
      representation: "cube",
      readerYaw: 45,
      readerPitch: -22,
      rotation: Object.freeze({ x: -24, y: 36, z: 8 }),
      rotationMotion: Object.freeze({
        readerYaw: Object.freeze({ running: false, speed: 0.04 }),
        readerPitch: Object.freeze({ running: false, speed: 0.03 }),
        x: Object.freeze({ running: false, speed: 0.03 }),
        y: Object.freeze({ running: false, speed: 0.08 }),
        z: Object.freeze({ running: false, speed: 0.02 }),
      }),
      rotationRunning: false,
      rotationSpeed: 0.08,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
      skew: Object.freeze({ x: 0, z: 0 }),
    }),
    "4d": Object.freeze({
      representation: "tesseract",
      rotation: Object.freeze({ xw: 24, yw: -18, zw: 12 }),
      rotationMotion: Object.freeze({
        xw: Object.freeze({ running: false, speed: 0.06 }),
        yw: Object.freeze({ running: false, speed: 0.04 }),
        zw: Object.freeze({ running: false, speed: -0.02 }),
      }),
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

function sanitizeHeadDirections(source) {
  return Array.from({ length: MAX_SHAPES_2D_HEADS }, (_, index) => (
    Number(source?.[index]) < 0 ? -1 : 1
  ));
}

function sanitizeHeadAdjustments(source) {
  return Array.from({ length: MAX_SHAPES_2D_HEADS }, (_, index) => {
    const numeric = Number(source?.[index]);
    return Number.isFinite(numeric) ? numeric : 0;
  });
}

function sanitizeScanLineAxes(source) {
  return Array.from({ length: MAX_SHAPES_2D_HEADS }, (_, index) => (
    source?.[index] === "horizontal" ? "horizontal" : "vertical"
  ));
}

function sanitizeRotationMotion(source, defaults, legacy = null) {
  return Object.fromEntries(Object.entries(defaults).map(([axis, fallback]) => {
    const candidate = source?.[axis] ?? {};
    const legacyAxis = legacy?.[axis] ?? {};
    return [axis, {
      running: Boolean(candidate.running ?? legacyAxis.running ?? fallback.running),
      speed: clamp(candidate.speed ?? legacyAxis.speed, -0.5, 0.5, fallback.speed),
    }];
  }));
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
  const legacyThreeSpeed = clamp(
    three.rotationSpeed,
    -0.5,
    0.5,
    DEFAULT_STATE.dimension["3d"].rotationSpeed,
  );
  const legacyFourSpeed = clamp(
    four.rotationSpeed,
    -0.5,
    0.5,
    DEFAULT_STATE.dimension["4d"].rotationSpeed,
  );
  const hasLegacyThreeMotion = Object.prototype.hasOwnProperty.call(three, "rotationRunning")
    || Object.prototype.hasOwnProperty.call(three, "rotationSpeed");
  const hasLegacyFourMotion = Object.prototype.hasOwnProperty.call(four, "rotationRunning")
    || Object.prototype.hasOwnProperty.call(four, "rotationSpeed");
  const twoDimensionalHeadCount = Math.round(clamp(
    two.heads ?? two.headCount,
    1,
    MAX_SHAPES_2D_HEADS,
    DEFAULT_STATE.dimension["2d"].heads,
  ));

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
      divisions: Math.round(clamp(
        play.divisions
          ?? (selection.playingMode === "notes" ? voice.noteDivisions : trigger.divisions)
          ?? trigger.divisions
          ?? voice.noteDivisions,
        1,
        16,
        DEFAULT_STATE.play.divisions,
      )),
    },
    profile: { sides: profile.sides, kind: profile.kind, starDepth: profile.starDepth },
    voice: {
      engine: choice(voice.engine, SHAPES_VOICE_ENGINES.map(({ id }) => id), "sine"),
      baseHz: clamp(voice.baseHz, 20, 440, DEFAULT_STATE.voice.baseHz),
      rangeOctaves: clamp(voice.rangeOctaves, 0, 7, DEFAULT_STATE.voice.rangeOctaves),
      character: clamp(voice.character, 0, 1, DEFAULT_STATE.voice.character),
      spread: clamp(voice.spread, 0, 1, DEFAULT_STATE.voice.spread),
    },
    trigger: {
      soundBank: choice(
        trigger.soundBank ?? trigger.bank,
        SHAPES_TRIGGER_SOUND_BANKS.map(({ id }) => id),
        DEFAULT_STATE.trigger.soundBank,
      ),
      mapping: choice(trigger.mapping, ["feature", "position", "incidence"], "feature"),
      tuningDepth: clamp(trigger.tuningDepth, 0, 24, DEFAULT_STATE.trigger.tuningDepth),
      characterDepth: clamp(trigger.characterDepth, 0, 1, DEFAULT_STATE.trigger.characterDepth),
      hitCap: Math.round(clamp(trigger.hitCap, 1, 16, DEFAULT_STATE.trigger.hitCap)),
    },
    dimension: {
      "2d": {
        reader: choice(two.reader, ["points", "line", "radar"], "points"),
        heads: twoDimensionalHeadCount,
        headOffsets: sanitizeHeadOffsets(
          two.headOffsets ?? two.readerOffsets,
          twoDimensionalHeadCount,
        ),
        scanLineAxes: sanitizeScanLineAxes(two.scanLineAxes ?? two.lineAxes),
        traceHeadDirections: sanitizeHeadDirections(
          two.traceHeadDirections ?? two.pointHeadDirections,
        ),
        radialHeadDirections: sanitizeHeadDirections(
          two.radialHeadDirections ?? two.radarHeadDirections,
        ),
        traceHeadDirectionAdjustments: sanitizeHeadAdjustments(
          two.traceHeadDirectionAdjustments ?? two.pointHeadDirectionAdjustments,
        ),
        radialHeadDirectionAdjustments: sanitizeHeadAdjustments(
          two.radialHeadDirectionAdjustments ?? two.radarHeadDirectionAdjustments,
        ),
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
          DEFAULT_STATE.dimension["3d"].representation,
        ),
        readerYaw: sanitizeAngle(three.readerYaw, DEFAULT_STATE.dimension["3d"].readerYaw),
        readerPitch: sanitizeAngle(three.readerPitch, DEFAULT_STATE.dimension["3d"].readerPitch),
        rotation: {
          x: sanitizeAngle(three.rotation?.x, DEFAULT_STATE.dimension["3d"].rotation.x),
          y: sanitizeAngle(three.rotation?.y, DEFAULT_STATE.dimension["3d"].rotation.y),
          z: sanitizeAngle(three.rotation?.z, DEFAULT_STATE.dimension["3d"].rotation.z),
        },
        rotationMotion: sanitizeRotationMotion(
          three.rotationMotion,
          DEFAULT_STATE.dimension["3d"].rotationMotion,
          hasLegacyThreeMotion ? {
            x: { running: three.rotationRunning, speed: legacyThreeSpeed * 0.37 },
            y: { running: three.rotationRunning, speed: legacyThreeSpeed },
            z: { running: three.rotationRunning, speed: legacyThreeSpeed * 0.21 },
          } : null,
        ),
        // Legacy all-axis motion is migrated into the independent axis states
        // above; keeping the old latch set would restart every axis after the
        // final individual button is paused.
        rotationRunning: false,
        rotationSpeed: legacyThreeSpeed,
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
          DEFAULT_STATE.dimension["4d"].representation,
        ),
        rotation: {
          xw: sanitizeAngle(four.rotation?.xw, DEFAULT_STATE.dimension["4d"].rotation.xw),
          yw: sanitizeAngle(four.rotation?.yw, DEFAULT_STATE.dimension["4d"].rotation.yw),
          zw: sanitizeAngle(four.rotation?.zw, DEFAULT_STATE.dimension["4d"].rotation.zw),
        },
        rotationMotion: sanitizeRotationMotion(
          four.rotationMotion,
          DEFAULT_STATE.dimension["4d"].rotationMotion,
          hasLegacyFourMotion ? {
            xw: { running: four.rotationRunning, speed: legacyFourSpeed },
            yw: { running: four.rotationRunning, speed: legacyFourSpeed * 0.67 },
            zw: { running: four.rotationRunning, speed: legacyFourSpeed * -0.41 },
          } : null,
        ),
        rotationRunning: false,
        rotationSpeed: legacyFourSpeed,
        scale: sanitizeScale(four.scale, ["x", "y", "z", "w"], 1.5),
      },
    },
  };
}

export function foldShapesPhase(phase, motion = "loop") {
  const travel = Number(phase) || 0;
  if (motion === "pingpong") {
    const folded = ((travel % 2) + 2) % 2;
    return folded <= 1 ? folded : 2 - folded;
  }
  return ((travel % 1) + 1) % 1;
}

export function displayShapesPhase(state) {
  return foldShapesPhase(
    state?.play?.continuousPhase,
    state?.play?.motion,
  );
}

export function shapes2dHeadCount(state) {
  return Math.round(clamp(
    state?.dimension?.["2d"]?.heads,
    1,
    MAX_SHAPES_2D_HEADS,
    1,
  ));
}

export function shapes2dHeadOffset(state, index) {
  const count = shapes2dHeadCount(state);
  if (!Number.isInteger(index) || index < 0 || index >= count) return 0;
  const value = state?.dimension?.["2d"]?.headOffsets?.[index];
  return Number.isFinite(value) ? wrapOffset(value) : canonicalHeadOffsets(count)[index];
}

function shapes2dDirectionFields(reader) {
  if (reader === "radar") {
    return {
      directions: "radialHeadDirections",
      adjustments: "radialHeadDirectionAdjustments",
    };
  }
  return {
    directions: "traceHeadDirections",
    adjustments: "traceHeadDirectionAdjustments",
  };
}

export function shapes2dHeadDirection(state, index, reader = state?.dimension?.["2d"]?.reader) {
  if (reader === "line") return 1;
  const { directions } = shapes2dDirectionFields(reader);
  return Number(state?.dimension?.["2d"]?.[directions]?.[index]) < 0 ? -1 : 1;
}

export function shapes2dHeadTravel(state, index, reader = state?.dimension?.["2d"]?.reader) {
  const position = Number(state?.play?.continuousPhase) || 0;
  const offset = shapes2dHeadOffset(state, index);
  if (reader === "line") return position + offset;
  const { adjustments } = shapes2dDirectionFields(reader);
  const adjustment = Number(state?.dimension?.["2d"]?.[adjustments]?.[index]);
  return shapes2dHeadDirection(state, index, reader) * position
    + offset
    + (Number.isFinite(adjustment) ? adjustment : 0);
}

export function shapes2dHeadPhase(state, index, reader = state?.dimension?.["2d"]?.reader) {
  return foldShapesPhase(
    shapes2dHeadTravel(state, index, reader),
    state?.play?.motion,
  );
}

export function setShapes2dHeadCount(state, value) {
  const local = state?.dimension?.["2d"];
  if (!local) return state;
  const count = Math.round(clamp(value, 1, MAX_SHAPES_2D_HEADS, 1));
  local.heads = count;
  local.headOffsets = canonicalHeadOffsets(count);

  // Match the original Shape behavior: changing the count restores an even
  // layout and rebases reversed heads so they meet their forward counterparts
  // at the current transport position.
  const position = Number(state?.play?.continuousPhase) || 0;
  for (const reader of ["points", "radar"]) {
    const { directions, adjustments } = shapes2dDirectionFields(reader);
    local[directions] = sanitizeHeadDirections(local[directions]);
    local[adjustments] = sanitizeHeadAdjustments(local[adjustments]);
    for (let index = 0; index < MAX_SHAPES_2D_HEADS; index += 1) {
      local[adjustments][index] = (1 - local[directions][index]) * position;
    }
  }
  return state;
}

export function setShapes2dHeadOffset(state, index, value) {
  const local = state?.dimension?.["2d"];
  const count = shapes2dHeadCount(state);
  if (!local || !Number.isInteger(index) || index < 0 || index >= count) return state;
  local.headOffsets = updateHeadOffset(
    sanitizeHeadOffsets(local.headOffsets, count),
    index,
    Number(value),
  );
  return state;
}

export function setShapes2dLineAxis(state, index, axis) {
  const local = state?.dimension?.["2d"];
  if (!local || !Number.isInteger(index) || index < 0 || index >= shapes2dHeadCount(state)) {
    return state;
  }
  local.scanLineAxes = sanitizeScanLineAxes(local.scanLineAxes);
  local.scanLineAxes[index] = axis === "horizontal" ? "horizontal" : "vertical";
  return state;
}

export function toggleShapes2dHeadOption(
  state,
  index,
  reader = state?.dimension?.["2d"]?.reader,
) {
  const local = state?.dimension?.["2d"];
  if (!local || !Number.isInteger(index) || index < 0 || index >= shapes2dHeadCount(state)) {
    return state;
  }
  if (reader === "line") {
    local.scanLineAxes = sanitizeScanLineAxes(local.scanLineAxes);
    local.scanLineAxes[index] = local.scanLineAxes[index] === "horizontal"
      ? "vertical"
      : "horizontal";
    return state;
  }

  const { directions, adjustments } = shapes2dDirectionFields(reader);
  local[directions] = sanitizeHeadDirections(local[directions]);
  local[adjustments] = sanitizeHeadAdjustments(local[adjustments]);
  const beforeTravel = shapes2dHeadTravel(state, index, reader);
  local[directions][index] *= -1;
  const position = Number(state?.play?.continuousPhase) || 0;
  local[adjustments][index] = beforeTravel
    - local[directions][index] * position
    - shapes2dHeadOffset(state, index);
  return state;
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
  if (state?.selection?.playingMode === "continuous") return 1;
  return Math.round(clamp(state?.play?.divisions, 1, 16, DEFAULT_STATE.play.divisions));
}

export function setShapesDivisionCount(state, value) {
  if (state?.selection?.playingMode === "continuous") return state;
  state.play.divisions = Math.round(clamp(value, 1, 16, DEFAULT_STATE.play.divisions));
  return state;
}

export function selectShapesBank(state, bank) {
  state.selection.bank = choice(bank, SHAPES_BANKS, "main");
  return state;
}

export function shapesRotationIsMoving(state, dimension = state?.selection?.dimension) {
  const normalizedDimension = sanitizeDimension(dimension);
  const local = state?.dimension?.[normalizedDimension];
  if (!local) return false;
  if (normalizedDimension === "2d") {
    return Boolean(local.rotationRunning) && Math.abs(Number(local.rotationSpeed) || 0) > 1e-6;
  }
  const independent = Object.values(local.rotationMotion ?? {}).some((motion) => (
    Boolean(motion?.running) && Math.abs(Number(motion?.speed) || 0) > 1e-6
  ));
  return independent
    || (Boolean(local.rotationRunning) && Math.abs(Number(local.rotationSpeed) || 0) > 1e-6);
}

export function advanceShapesMotion(state, deltaSeconds) {
  const delta = clamp(deltaSeconds, 0, 0.25, 0);
  if (state.play.running) {
    state.play.continuousPhase += state.play.direction * state.play.rateCyclesPerSecond * delta;
  }
  const dimension = state.selection.dimension;
  const local = state.dimension[dimension];
  if (dimension === "2d") {
    if (local.rotationRunning) {
      local.rotation = sanitizeAngle(local.rotation + local.rotationSpeed * 360 * delta, 0);
    }
    return state;
  }
  if (dimension === "3d") {
    const motion = local.rotationMotion ?? {};
    const independentShapeMotion = ["x", "y", "z"].some((axis) => motion[axis]?.running);
    if (local.rotationRunning && !independentShapeMotion) {
      const degrees = local.rotationSpeed * 360 * delta;
      local.rotation.x = sanitizeAngle(local.rotation.x + degrees * 0.37, local.rotation.x);
      local.rotation.y = sanitizeAngle(local.rotation.y + degrees, local.rotation.y);
      local.rotation.z = sanitizeAngle(local.rotation.z + degrees * 0.21, local.rotation.z);
    } else {
      for (const axis of ["x", "y", "z"]) {
        if (!motion[axis]?.running) continue;
        local.rotation[axis] = sanitizeAngle(
          local.rotation[axis] + motion[axis].speed * 360 * delta,
          local.rotation[axis],
        );
      }
    }
    if (motion.readerYaw?.running) {
      local.readerYaw = sanitizeAngle(
        local.readerYaw + motion.readerYaw.speed * 360 * delta,
        local.readerYaw,
      );
    }
    if (motion.readerPitch?.running) {
      local.readerPitch = sanitizeAngle(
        local.readerPitch + motion.readerPitch.speed * 360 * delta,
        local.readerPitch,
      );
    }
  }
  if (dimension === "4d") {
    const motion = local.rotationMotion ?? {};
    const independentMotion = ["xw", "yw", "zw"].some((axis) => motion[axis]?.running);
    if (local.rotationRunning && !independentMotion) {
      const degrees = local.rotationSpeed * 360 * delta;
      local.rotation.xw = sanitizeAngle(local.rotation.xw + degrees, local.rotation.xw);
      local.rotation.yw = sanitizeAngle(local.rotation.yw + degrees * 0.67, local.rotation.yw);
      local.rotation.zw = sanitizeAngle(local.rotation.zw - degrees * 0.41, local.rotation.zw);
    } else {
      for (const axis of ["xw", "yw", "zw"]) {
        if (!motion[axis]?.running) continue;
        local.rotation[axis] = sanitizeAngle(
          local.rotation[axis] + motion[axis].speed * 360 * delta,
          local.rotation[axis],
        );
      }
    }
  }
  return state;
}

/**
 * Produce a cheap, mutation-safe transport forecast for audio look-ahead.
 * Geometry/profile data is shared because the scene builders only read it;
 * the active transport and rotation objects are copied because they advance.
 */
export function projectShapesMotion(state, deltaSeconds) {
  const dimension = sanitizeDimension(state?.selection?.dimension);
  const local = state.dimension[dimension];
  const projectedLocal = {
    ...local,
    rotation: local.rotation && typeof local.rotation === "object"
      ? { ...local.rotation }
      : local.rotation,
    rotationMotion: local.rotationMotion
      ? Object.fromEntries(Object.entries(local.rotationMotion).map(([axis, motion]) => [
        axis,
        { ...motion },
      ]))
      : local.rotationMotion,
  };
  const projected = {
    ...state,
    selection: { ...state.selection },
    play: { ...state.play },
    dimension: {
      ...state.dimension,
      [dimension]: projectedLocal,
    },
  };
  return advanceShapesMotion(projected, deltaSeconds);
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

export function shapesEventRegionKeys(scene) {
  if (!Array.isArray(scene?.contacts)) return [];
  return [...new Set(scene.contacts.map((contact, index) => (
    contact.eventKey ?? contact.voiceKey ?? `contact:${index}`
  )))].sort();
}

export function shapesEventToken(state, scene = 1, { clock = "auto" } = {}) {
  const local = state.dimension[state.selection.dimension];
  const representation = scene?.geometry?.type ?? local.representation ?? local.reader ?? "profile";
  const regions = shapesEventRegionKeys(scene);
  if (regions.length) return [
    state.selection.dimension,
    state.selection.playingMode,
    representation,
    ...regions,
  ].join(":");
  // Preserve a useful deterministic fallback for callers that provide only a
  // contact count instead of a scene. Runtime scenes use exact visible regions.
  const phase = displayShapesPhase(state);
  const regionCount = Math.max(1, Math.round(Number(scene) || 1) * shapesDivisionCount(state));
  const eventPosition = Math.floor(phase * regionCount) % regionCount;
  return [state.selection.dimension, state.selection.playingMode, representation, clock, eventPosition].join(":");
}

export function shapesEventIntervalMs(state, contactCount = 1) {
  const maximum = state.selection.playingMode === "triggers" ? state.trigger.hitCap : 8;
  const simultaneous = Math.max(1, Math.min(maximum, Math.round(Number(contactCount) || 1)));
  const floor = state.selection.playingMode === "triggers" ? 54 : 72;
  return Math.max(floor, simultaneous * 14);
}
