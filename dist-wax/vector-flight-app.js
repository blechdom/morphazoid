import {
  VoicePool,
  normalizeStrikeGains,
  synthParametersForMode,
} from "./src/audio.js";
import { createFixedStepper } from "./src/physics-common.js";
import {
  FLIGHT_ARTICULATIONS,
  FLIGHT_TIERS,
  circularPlayheadRadius,
  clamp,
  createFlightStar,
  flightTierForThrottle,
  lerp,
  mapFlightContact,
  normalizedThrottle,
  plaidAmountForThrottle,
  projectFlightStar,
  projectedKinematics,
  radialPlayheadCrossing,
  recycleFlightStar,
  seededRandom,
  stepFlightStar,
  trailLengthForThrottle,
  travelSpeedForThrottle,
  wrapAngle,
} from "./src/vector-flight.js";

const $ = (id) => document.getElementById(id);
const canvas = $("stage");
const stageWrap = $("stageWrap");
const context = canvas.getContext("2d", { alpha: false, desynchronized: true });
const query = new URLSearchParams(window.location.search);
const reducedMotionQuery = window.matchMedia?.("(prefers-reduced-motion: reduce)");
const compactViewport = window.matchMedia?.("(max-width: 650px)")?.matches === true;
const stepper = createFixedStepper({ step: 1 / 120, maxSubsteps: 8 });
const pool = new VoicePool(18, { continuousPeakCeiling: 0.72 });

const TAU = Math.PI * 2;
const STAR_COLORS = Object.freeze(["#fff4ce", "#8dffcf", "#ffe17a", "#d6fff2"]);
const PLAID_COLORS = Object.freeze(["#8dffcf", "#75d9ff", "#ff7bd5", "#ffe17a", "#c79bff", "#ff826f", "#f7ffff"]);
const DEFAULT_FIELD = Math.max(1, Math.trunc(Number(query.get("seed")) || 1979));
const MODE_LABELS = Object.freeze({
  continuous: "Continuous",
  notes: "Notes",
  triggers: "Triggers",
});

const DEFAULTS = Object.freeze({
  running: true,
  audioOn: false,
  level: 0.42,
  throttle: clamp(Number(query.get("throttle") ?? 22), 0, 100),
  density: clamp(Number(query.get("density") ?? (compactViewport ? 54 : 78)), 24, 144),
  articulation: FLIGHT_ARTICULATIONS.includes(query.get("mode")) ? query.get("mode") : "continuous",
  sensorRadius: 0.26,
  sensorWidth: 0.1,
  orbitLobes: 3,
  orbitPhase: 0,
  fieldSpin: 0.12,
  minimumFrequency: 48,
  maximumFrequency: 2_400,
  stereoWidth: 0.92,
  doppler: 0.7,
  tail: 0.56,
  character: 0.48,
  engineMix: 0.22,
});

const state = {
  ...DEFAULTS,
  field: DEFAULT_FIELD,
  random: seededRandom(DEFAULT_FIELD),
  stars: [],
  flashes: [],
  fieldContacts: [],
  noteHolds: [],
  pendingTriggers: [],
  steer: { x: 0, y: 0 },
  helm: { x: 0, y: 0 },
  heading: -Math.PI / 2,
  headingTarget: -Math.PI / 2,
  simulationTime: 0,
  contactCount: 0,
  modeContacts: { continuous: 0, notes: 0, triggers: 0 },
  lastContact: null,
  audioStarting: false,
};

let reducedMotion = reducedMotionQuery?.matches === true;
let cssWidth = 1;
let cssHeight = 1;
let pixelRatio = 1;
let scheduledFrame = 0;
let lastFrameAt = performance.now();
let lastUiAt = 0;
let lastAudioAt = -Infinity;
let pointerId = null;
let manualMode = false;
let lastCanvasLabel = "";
let simulationFrameOffset = 0;

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function formatSignedPercent(value) {
  const percent = Math.round(value * 100);
  return `${percent > 0 ? "+" : ""}${percent}%`;
}

function formatFrequency(value) {
  return `${Math.round(value)} Hz`;
}

function announce(message) {
  const live = $("liveStatus");
  live.textContent = "";
  requestAnimationFrame(() => { live.textContent = message; });
}

function showError(error) {
  $("audioError").textContent = error instanceof Error ? error.message : String(error);
  $("audioError").hidden = false;
}

function clearError() {
  $("audioError").textContent = "";
  $("audioError").hidden = true;
}

function helmMagnitude(steer = state.steer) {
  return clamp(Math.hypot(steer.x, steer.y), 0, 1);
}

function unitDiscVector(x, y) {
  const safeX = Number.isFinite(Number(x)) ? Number(x) : 0;
  const safeY = Number.isFinite(Number(y)) ? Number(y) : 0;
  const magnitude = Math.hypot(safeX, safeY);
  if (magnitude <= 1) return { x: safeX, y: safeY };
  return { x: safeX / magnitude, y: safeY / magnitude };
}

function flightGeometry(steer = state.steer, heading = state.heading) {
  const centerX = cssWidth * 0.5;
  const centerY = cssHeight * 0.5;
  const minimumDimension = Math.min(cssWidth, cssHeight);
  return {
    centerX,
    centerY,
    shipX: centerX,
    shipY: centerY,
    heading,
    helmX: steer.x,
    helmY: steer.y,
    sensorRadius: minimumDimension * state.sensorRadius,
    sensorWidth: minimumDimension * state.sensorWidth,
    minimumDimension,
  };
}

function projected(star, geometry = flightGeometry(), previous = false) {
  return projectFlightStar(star, {
    width: cssWidth,
    height: cssHeight,
    centerX: geometry.centerX,
    centerY: geometry.centerY,
    depth: previous ? star.previousZ : star.z,
    sourceX: previous ? star.previousX : star.x,
    sourceY: previous ? star.previousY : star.y,
    helmX: geometry.helmX,
    helmY: geometry.helmY,
  });
}

function articulationWidth(geometry) {
  if (state.articulation === "notes") return geometry.sensorWidth * lerp(0.34, 0.74, state.tail);
  if (state.articulation === "triggers") return geometry.sensorWidth * 0.24;
  return geometry.sensorWidth * lerp(0.9, 1.48, state.tail);
}

function contactForPoint(star, point, geometry, width = articulationWidth(geometry)) {
  return mapFlightContact(point, {
    id: star.id,
    centerX: geometry.centerX,
    centerY: geometry.centerY,
    heading: geometry.heading,
    sensorRadius: geometry.sensorRadius,
    sensorWidth: width,
    orbitLobes: state.orbitLobes,
    orbitPhase: state.orbitPhase,
    orbitDepth: 0.12,
    minimumFrequency: state.minimumFrequency,
    maximumFrequency: state.maximumFrequency,
    radialVelocity: star.projectedRadialVelocity ?? 0,
    tangentialVelocity: star.projectedTangentialVelocity ?? 0,
    brightness: star.brightness,
    doppler: state.doppler,
    stereoWidth: state.stereoWidth,
  });
}

function rememberProjectedKinematics(star, before, after, geometry, deltaSeconds) {
  const motion = projectedKinematics(
    before,
    after,
    { x: geometry.centerX, y: geometry.centerY },
    deltaSeconds,
  );
  const radialScale = Math.max(1, geometry.sensorRadius * 2.2);
  const tangentialScale = Math.max(1, geometry.sensorRadius * 1.45);
  star.projectedRadialVelocity = Math.tanh(motion.radialVelocity / radialScale);
  star.projectedTangentialVelocity = Math.tanh(motion.tangentialVelocity / tangentialScale);
  return motion;
}

function placeStarInAngularLane(star, count = state.stars.length || state.density) {
  star.theta = (star.id + state.random()) / Math.max(1, count) * TAU;
  star.x = Math.cos(star.theta) * star.radius;
  star.y = Math.sin(star.theta) * star.radius;
  star.previousTheta = star.theta;
  star.previousX = star.x;
  star.previousY = star.y;
  star.projectedRadialVelocity = 0;
  star.projectedTangentialVelocity = 0;
  return star;
}

function resetStars({ advanceField = false, announceReset = false } = {}) {
  if (advanceField) state.field = (state.field + 0x9e3779b9) >>> 0;
  state.random = seededRandom(state.field);
  const count = Math.max(1, Math.round(state.density));
  state.stars = Array.from({ length: count }, (_, index) => {
    const depth = 0.045 + ((index + state.random()) / count) * 1.01;
    return placeStarInAngularLane(createFlightStar(index, state.random, depth), count);
  });
  state.flashes = [];
  state.fieldContacts = [];
  state.noteHolds = [];
  state.pendingTriggers = [];
  if (manualMode) refreshFieldContacts();
  if (announceReset) announce(`New deterministic star field ${state.field} loaded.`);
}

function resizeCanvas() {
  const bounds = stageWrap.getBoundingClientRect();
  const nextWidth = Math.max(1, Math.round(bounds.width));
  const nextHeight = Math.max(1, Math.round(bounds.height));
  let nextRatio = Math.min(window.devicePixelRatio || 1, compactViewport ? 1.5 : 2);
  const pixelCount = nextWidth * nextHeight * nextRatio * nextRatio;
  if (pixelCount > 2_800_000) nextRatio *= Math.sqrt(2_800_000 / pixelCount);
  if (nextWidth === cssWidth && nextHeight === cssHeight && nextRatio === pixelRatio) return;
  cssWidth = nextWidth;
  cssHeight = nextHeight;
  pixelRatio = nextRatio;
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  refreshFieldContacts();
  if (manualMode) draw();
}

function starColor(star, plaid) {
  return plaid > 0.04
    ? PLAID_COLORS[star.colorIndex % PLAID_COLORS.length]
    : STAR_COLORS[star.colorIndex % STAR_COLORS.length];
}

function contourPoint(geometry, localAngle, scale = 1, phaseOffset = 0) {
  const angle = localAngle + geometry.heading;
  const radius = circularPlayheadRadius(geometry.sensorRadius * scale, localAngle, {
    lobes: state.orbitLobes,
    phase: state.orbitPhase + phaseOffset,
    depth: 0.12,
  });
  return {
    x: geometry.centerX + Math.cos(angle) * radius,
    y: geometry.centerY + Math.sin(angle) * radius,
  };
}

function traceContour(geometry, scale = 1, phaseOffset = 0) {
  context.beginPath();
  for (let index = 0; index <= 128; index += 1) {
    const localAngle = -Math.PI + index / 128 * TAU;
    const point = contourPoint(geometry, localAngle, scale, phaseOffset);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
}

function drawPolarFrame(geometry, speed) {
  const pulse = reducedMotion ? 0.34 : (state.simulationTime * (0.1 + speed * 0.68)) % 1;
  const maximumRadius = Math.hypot(cssWidth, cssHeight) * 0.68;
  const plaid = plaidAmountForThrottle(state.throttle);
  const frameFade = lerp(1, 0.16, speed ** 1.25) * (1 - plaid * 0.7);
  context.save();
  context.translate(geometry.centerX, geometry.centerY);
  context.rotate(state.steer.x * 0.07);
  context.lineWidth = 1;
  for (let index = 0; index < 24; index += 1) {
    const angle = index / 24 * TAU;
    const cardinal = index % 6 === 0;
    context.strokeStyle = cardinal ? "#75d9ff" : "#8dffcf";
    context.globalAlpha = cardinal ? 0.018 + frameFade * 0.082 : frameFade * 0.048;
    context.beginPath();
    context.moveTo(Math.cos(angle) * geometry.sensorRadius * 0.28, Math.sin(angle) * geometry.sensorRadius * 0.28);
    context.lineTo(Math.cos(angle) * maximumRadius, Math.sin(angle) * maximumRadius);
    context.stroke();
  }
  context.restore();

  context.save();
  context.strokeStyle = "#8dffcf";
  for (let index = 0; index < 9; index += 1) {
    const phase = (index / 9 + pulse) % 1;
    const radius = phase ** 1.62 * maximumRadius;
    context.globalAlpha = frameFade * (0.025 + phase * 0.055);
    context.beginPath();
    context.arc(geometry.centerX, geometry.centerY, radius, 0, TAU);
    context.stroke();
  }
  context.restore();
}

function drawPlaidWeave(geometry, amount) {
  if (amount <= 0) return;
  const intensity = reducedMotion ? amount * 0.38 : amount;
  const motion = reducedMotion ? 0.18 : state.simulationTime * 0.78;
  const maximumRadius = Math.hypot(cssWidth, cssHeight) * 0.72;
  const twist = state.steer.x * 0.48 - state.steer.y * 0.22;
  const stripeOffsets = [-0.034, -0.021, -0.006, 0.008, 0.026, 0.036];
  const stripeWidths = [5.5, 0.8, 2.4, 0.8, 1.3, 4.2];
  context.save();
  context.globalCompositeOperation = "source-over";

  for (let group = 0; group < 9; group += 1) {
    const groupAngle = group / 9 * TAU + twist * 0.22;
    for (let stripe = 0; stripe < stripeOffsets.length; stripe += 1) {
      const angle = groupAngle + stripeOffsets[stripe];
      context.strokeStyle = PLAID_COLORS[(group * 2 + stripe) % PLAID_COLORS.length];
      context.globalAlpha = intensity * (stripeWidths[stripe] > 3 ? 0.055 : 0.11);
      context.lineWidth = stripeWidths[stripe];
      context.beginPath();
      context.moveTo(geometry.centerX, geometry.centerY);
      context.lineTo(
        geometry.centerX + Math.cos(angle) * maximumRadius,
        geometry.centerY + Math.sin(angle) * maximumRadius,
      );
      context.stroke();
    }
  }

  for (let group = 0; group < 8; group += 1) {
    const groupPhase = (group / 8 + motion * 0.12) % 1;
    for (let stripe = 0; stripe < stripeOffsets.length; stripe += 1) {
      const phase = clamp(groupPhase + stripeOffsets[stripe] * 0.72, 0, 1);
      const baseRadius = phase ** 1.42 * maximumRadius;
      context.strokeStyle = PLAID_COLORS[(group + stripe + 2) % PLAID_COLORS.length];
      context.globalAlpha = intensity * (stripeWidths[stripe] > 3 ? 0.05 : 0.1);
      context.lineWidth = stripeWidths[stripe] * 0.82;
      context.beginPath();
      for (let pointIndex = 0; pointIndex <= 96; pointIndex += 1) {
        const angle = pointIndex / 96 * TAU;
        const warp = 1 + Math.sin(angle * state.orbitLobes + state.orbitPhase + motion) * 0.06 * intensity;
        const x = geometry.centerX + Math.cos(angle + twist * phase) * baseRadius * warp;
        const y = geometry.centerY + Math.sin(angle + twist * phase) * baseRadius * warp;
        if (pointIndex === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();
    }
  }

  context.globalCompositeOperation = "lighter";
  for (let family = 0; family < 24; family += 1) {
    const direction = family % 2 === 0 ? 1 : -1;
    const startAngle = family / 24 * TAU - motion * 0.06 * direction;
    context.strokeStyle = PLAID_COLORS[(family + 4) % PLAID_COLORS.length];
    context.globalAlpha = intensity * (family % 6 === 0 ? 0.16 : 0.075);
    context.lineWidth = family % 6 === 0 ? 1.7 : 0.7;
    context.beginPath();
    for (let pointIndex = 0; pointIndex <= 40; pointIndex += 1) {
      const radius = pointIndex / 40 * maximumRadius;
      const angle = startAngle + direction * radius / maximumRadius * (0.5 + twist * direction);
      const x = geometry.centerX + Math.cos(angle) * radius;
      const y = geometry.centerY + Math.sin(angle) * radius;
      if (pointIndex === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore();
}

function drawStars(geometry, plaid) {
  const speed = normalizedThrottle(state.throttle);
  const trail = reducedMotion
    ? Math.min(0.16, trailLengthForThrottle(state.throttle))
    : trailLengthForThrottle(state.throttle);
  context.save();
  context.globalCompositeOperation = "lighter";
  for (const star of state.stars) {
    const point = projected(star, geometry);
    const previousPoint = projected(star, geometry, true);
    if (point.x < -180 || point.x > cssWidth + 180 || point.y < -180 || point.y > cssHeight + 180) continue;
    const flicker = reducedMotion ? 1 : 0.79 + Math.sin(state.simulationTime * 7 + star.twinkle) * 0.21;
    const color = starColor(star, plaid);
    const radius = clamp(star.size * point.perspective * 1.22, 0.55, 5.4);
    const lineWidth = clamp(radius * 0.62, 0.55, 2.8);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.globalAlpha = clamp(star.brightness * flicker, 0.2, 1);
    if (trail > 0.015) {
      const extension = 1 + trail * lerp(0.7, 5.8, speed ** 1.4);
      const tailX = point.x - (point.x - previousPoint.x) * extension;
      const tailY = point.y - (point.y - previousPoint.y) * extension;
      context.lineWidth = lineWidth + (reducedMotion ? 0 : trail * 2.2);
      if (!reducedMotion) {
        context.shadowColor = color;
        context.shadowBlur = 4 + trail * 12;
      }
      context.beginPath();
      context.moveTo(tailX, tailY);
      context.lineTo(point.x, point.y);
      context.stroke();
      context.shadowBlur = 0;
    }
    context.globalAlpha = clamp(star.brightness * flicker * (1 + plaid * 0.22), 0.26, 1);
    context.beginPath();
    context.arc(point.x, point.y, trail > 0.015 ? Math.max(0.75, radius * 0.62) : radius, 0, TAU);
    context.fill();
  }
  context.restore();
}

function drawListeningField(geometry) {
  const tier = flightTierForThrottle(state.throttle);
  context.save();
  context.globalCompositeOperation = "lighter";
  for (const [scale, alpha, dash] of [
    [0.72, 0.08, [2, 10]],
    [1, 0.48, []],
    [1.28, 0.08, [2, 10]],
  ]) {
    context.strokeStyle = scale === 1 ? tier.accent : "#75d9ff";
    context.globalAlpha = alpha;
    context.lineWidth = scale === 1 ? 1.4 : 1;
    context.setLineDash(dash);
    traceContour(geometry, scale, scale === 1 ? 0 : (scale - 1) * 1.4);
    context.stroke();
  }
  context.setLineDash([]);

  for (const contact of state.fieldContacts.slice(0, 18)) {
    if (contact.proximity < 0.04) continue;
    const arcHalf = lerp(0.018, 0.075, contact.proximity);
    context.strokeStyle = PLAID_COLORS[contact.id % PLAID_COLORS.length];
    context.globalAlpha = 0.18 + contact.proximity * 0.7;
    context.lineWidth = 1 + contact.proximity * 3;
    const localAngle = contact.localAngle;
    context.beginPath();
    for (let index = 0; index <= 12; index += 1) {
      const angle = localAngle - arcHalf + index / 12 * arcHalf * 2;
      const point = contourPoint(geometry, angle);
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    }
    context.stroke();
  }

  context.strokeStyle = "#ffe17a";
  context.globalAlpha = 0.5;
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(geometry.centerX, geometry.centerY);
  context.lineTo(
    geometry.centerX + Math.cos(geometry.heading) * geometry.sensorRadius * 0.66,
    geometry.centerY + Math.sin(geometry.heading) * geometry.sensorRadius * 0.66,
  );
  context.stroke();
  context.restore();
}

function shipPath(size) {
  context.beginPath();
  context.moveTo(0, -size * 1.14);
  context.lineTo(size * 0.22, -size * 0.38);
  context.lineTo(size * 1.05, size * 0.42);
  context.lineTo(size * 0.4, size * 0.3);
  context.lineTo(size * 0.28, size * 0.96);
  context.lineTo(0, size * 0.57);
  context.lineTo(-size * 0.28, size * 0.96);
  context.lineTo(-size * 0.4, size * 0.3);
  context.lineTo(-size * 1.05, size * 0.42);
  context.lineTo(-size * 0.22, -size * 0.38);
  context.closePath();
}

function drawShip(geometry) {
  const speed = normalizedThrottle(state.throttle);
  const size = clamp(geometry.minimumDimension * 0.035, 16, 31);
  const bank = state.steer.x * 0.12;
  context.save();
  context.translate(geometry.shipX, geometry.shipY);
  context.rotate(geometry.heading + Math.PI / 2 + bank);
  context.globalCompositeOperation = "lighter";
  context.strokeStyle = "rgba(141, 255, 207, 0.24)";
  context.lineWidth = 6;
  if (!reducedMotion) {
    context.shadowColor = "#8dffcf";
    context.shadowBlur = 14;
  }
  shipPath(size);
  context.stroke();
  context.shadowBlur = 0;
  context.strokeStyle = "#eafff6";
  context.lineWidth = 1.4;
  shipPath(size);
  context.stroke();
  context.strokeStyle = "#75d9ff";
  context.lineWidth = 1.15;
  context.beginPath();
  context.moveTo(-size * 0.4, size * 0.3);
  context.lineTo(0, -size * 0.78);
  context.lineTo(size * 0.4, size * 0.3);
  context.moveTo(-size * 0.27, size * 0.58);
  context.lineTo(size * 0.27, size * 0.58);
  context.stroke();
  context.strokeStyle = speed > 0.9 ? "#ff7bd5" : "#ffe17a";
  context.globalAlpha = 0.4 + speed * 0.55;
  const exhaust = size * lerp(0.18, 1.5, speed ** 1.25);
  context.beginPath();
  context.moveTo(-size * 0.16, size * 0.72);
  context.lineTo(-size * 0.08, size * 0.86 + exhaust);
  context.moveTo(size * 0.16, size * 0.72);
  context.lineTo(size * 0.08, size * 0.86 + exhaust);
  context.stroke();
  context.restore();
}

function drawContactFlashes(geometry) {
  context.save();
  context.globalCompositeOperation = "lighter";
  for (const flash of state.flashes) {
    const life = clamp(1 - flash.age / flash.duration, 0, 1);
    const expansion = 1 - life;
    const localAngle = wrapAngle(flash.angle - geometry.heading);
    const contour = contourPoint(geometry, localAngle);
    context.strokeStyle = flash.color;
    context.globalAlpha = life * 0.8;
    context.lineWidth = flash.mode === "triggers" ? 2.4 : 1.4;
    context.beginPath();
    context.arc(contour.x, contour.y, 4 + expansion * 24, 0, TAU);
    context.stroke();
    context.beginPath();
    context.arc(geometry.centerX, geometry.centerY, flash.radius + expansion * 12, flash.angle - 0.035, flash.angle + 0.035);
    context.stroke();
    if (life > 0.55 && flash.mode !== "continuous") {
      context.fillStyle = flash.color;
      context.globalAlpha = (life - 0.55) * 1.8;
      context.font = "7px ui-monospace, monospace";
      context.textAlign = Math.cos(flash.angle) < 0 ? "right" : "left";
      const label = flash.mode === "triggers" ? "TRG" : `${Math.round(flash.frequency)} HZ`;
      context.fillText(label, contour.x + (Math.cos(flash.angle) < 0 ? -9 : 9), contour.y - 7);
    }
  }
  context.restore();
}

function drawHudFrame(tier) {
  const inset = clamp(Math.min(cssWidth, cssHeight) * 0.036, 12, 28);
  const length = clamp(Math.min(cssWidth, cssHeight) * 0.052, 16, 38);
  context.save();
  context.strokeStyle = tier.accent;
  context.globalAlpha = 0.2;
  context.lineWidth = 1;
  for (const [x, y, sx, sy] of [
    [inset, inset, 1, 1],
    [cssWidth - inset, inset, -1, 1],
    [inset, cssHeight - inset, 1, -1],
    [cssWidth - inset, cssHeight - inset, -1, -1],
  ]) {
    context.beginPath();
    context.moveTo(x + sx * length, y);
    context.lineTo(x, y);
    context.lineTo(x, y + sy * length);
    context.stroke();
  }
  context.restore();
}

function refreshFieldContacts(geometry = flightGeometry()) {
  const width = articulationWidth(geometry);
  state.fieldContacts = state.stars
    .map((star) => contactForPoint(star, projected(star, geometry), geometry, width))
    .filter((contact) => contact.proximity > 0.002)
    .sort((left, right) => right.strength - left.strength || left.id - right.id);
  return state.fieldContacts;
}

function draw() {
  const geometry = flightGeometry();
  const speed = normalizedThrottle(state.throttle);
  const plaid = plaidAmountForThrottle(state.throttle);
  const tier = flightTierForThrottle(state.throttle);
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.fillStyle = "#020405";
  context.fillRect(0, 0, cssWidth, cssHeight);
  drawPolarFrame(geometry, speed);
  drawPlaidWeave(geometry, plaid);
  drawStars(geometry, plaid);
  drawListeningField(geometry);
  drawContactFlashes(geometry);
  drawShip(geometry);
  drawHudFrame(tier);
}

function recordContact(star, crossing, geometry, offsetSeconds = 0) {
  const contact = contactForPoint(star, crossing, geometry, Math.max(1, geometry.sensorWidth));
  const mode = state.articulation;
  const color = starColor(star, plaidAmountForThrottle(state.throttle));
  state.contactCount += 1;
  state.modeContacts[mode] += 1;
  state.lastContact = {
    id: star.id,
    angle: contact.angle,
    frequency: contact.frequency,
    pan: contact.pan,
    radialVelocity: contact.radialVelocity,
    tangentialVelocity: contact.tangentialVelocity,
    mode,
  };
  state.flashes.push({
    angle: contact.angle,
    radius: contact.contourRadius,
    frequency: contact.frequency,
    color,
    mode,
    age: 0,
    duration: mode === "triggers" ? 0.42 : mode === "notes" ? 0.72 : 0.34,
  });
  if (state.flashes.length > 36) state.flashes.splice(0, state.flashes.length - 36);
  if (mode === "notes" && state.audioOn && !document.hidden) {
    state.noteHolds.push({
      key: `vector-flight:note:${star.id}:${state.contactCount}`,
      age: 0,
      duration: lerp(0.16, 1.22, state.tail ** 1.3),
      baseFrequency: contact.baseFrequency,
      radialVelocity: contact.radialVelocity,
      tangentialVelocity: contact.tangentialVelocity,
      incidence: contact.incidence,
      character: contact.character,
      strength: contact.strength,
      pan: contact.pan,
    });
    if (state.noteHolds.length > 48) state.noteHolds.splice(0, state.noteHolds.length - 48);
  }
  if (mode === "triggers" && state.audioOn) {
    const sector = Math.floor(((contact.localAngle + Math.PI) / TAU) * state.orbitLobes * 2);
    const waveforms = ["triangle", "sine", "square"];
    const dopplerOctaves = state.doppler * contact.radialVelocity * 0.34;
    state.pendingTriggers.push({
      offsetSeconds,
      spec: {
        key: `vector-flight:trigger:${star.id}`,
        frequency: clamp(contact.baseFrequency * 2 ** dopplerOctaves, 24, 8_000),
        gain: lerp(0.045, 0.19, contact.strength),
        pan: contact.pan,
        waveform: waveforms[Math.abs(sector) % waveforms.length],
      },
      attackNoise: clamp(state.character * 0.55 + contact.character * 0.3, 0, 0.8),
    });
  }
}

function simulate(deltaSeconds) {
  const dt = clamp(deltaSeconds, 0, 0.05);
  const stepOffset = simulationFrameOffset;
  const previousGeometry = flightGeometry(state.steer, state.heading);
  const helmEase = 1 - Math.exp(-dt * 7.4);
  state.steer.x = lerp(state.steer.x, state.helm.x, helmEase);
  state.steer.y = lerp(state.steer.y, state.helm.y, helmEase);
  if (helmMagnitude(state.helm) > 0.035) state.headingTarget = Math.atan2(state.helm.y, state.helm.x);
  const headingEase = 1 - Math.exp(-dt * 8.2);
  state.heading = wrapAngle(state.heading + wrapAngle(state.headingTarget - state.heading) * headingEase);
  for (const flash of state.flashes) flash.age += dt;
  state.flashes = state.flashes.filter((flash) => flash.age < flash.duration);
  if (!state.running) {
    simulationFrameOffset += dt;
    return;
  }

  state.simulationTime += dt;
  for (const note of state.noteHolds) note.age += dt;
  state.noteHolds = state.noteHolds.filter((note) => note.age < note.duration);
  const geometry = flightGeometry();
  const motionScale = reducedMotion ? 0.28 : 1;
  const travelSpeed = travelSpeedForThrottle(state.throttle) * motionScale;
  const spin = state.fieldSpin * lerp(0.035, 0.3, normalizedThrottle(state.throttle));
  const steeringCurl = state.steer.x * 0.78 - state.steer.y * 0.24;
  for (const star of state.stars) {
    const before = projected(star, previousGeometry);
    stepFlightStar(star, dt, travelSpeed, { fieldSpin: spin, steeringCurl });
    const after = projected(star, geometry);
    rememberProjectedKinematics(star, before, after, geometry, dt);
    const crossing = star.contacted ? null : radialPlayheadCrossing(before, after, {
      centerX: geometry.centerX,
      centerY: geometry.centerY,
      heading: geometry.heading,
      previousHeading: previousGeometry.heading,
      currentHeading: geometry.heading,
      sensorRadius: geometry.sensorRadius,
      orbitLobes: state.orbitLobes,
      orbitPhase: state.orbitPhase,
      orbitDepth: 0.12,
    });
    if (crossing) {
      recordContact(star, crossing, geometry, stepOffset + crossing.amount * dt);
      star.contacted = true;
    }
    const radialDistance = Math.hypot(after.x - geometry.centerX, after.y - geometry.centerY);
    if (star.z <= 0.025 || radialDistance > Math.hypot(cssWidth, cssHeight) * 0.82) {
      placeStarInAngularLane(recycleFlightStar(star, state.random, 1.05), state.stars.length);
    }
  }
  simulationFrameOffset += dt;
}

function engineVoice() {
  if (!state.running || document.hidden || state.engineMix <= 0) return null;
  const speed = normalizedThrottle(state.throttle);
  return {
    key: "vector-flight:engine",
    frequency: 31 + 104 * speed ** 1.5,
    gain: state.engineMix * lerp(0.035, 0.115, speed ** 0.72),
    pan: clamp(-state.steer.x * 0.24, -1, 1),
    waveform: "triangle",
    ...synthParametersForMode("fm", 0.28 + speed * 0.72, {
      fmIndex: 1.2 + state.character * 4.8,
      fmRatio: 1.5 + speed * 1.5,
    }),
  };
}

function starVoice(contact) {
  if (state.articulation !== "continuous") return null;
  const speed = normalizedThrottle(state.throttle);
  const gain = contact.strength * lerp(0.055, 0.115, speed);
  if (gain < 0.0005) return null;
  const timbre = clamp(contact.character * state.character + speed * 0.18, 0, 1);
  return {
    key: `vector-flight:star:${contact.id}`,
    frequency: contact.frequency,
    gain,
    pan: contact.pan,
    waveform: "sine",
    ...synthParametersForMode("fm", timbre, {
      fmIndex: 0.6 + state.character * 3.2,
      fmRatio: 1.25 + contact.incidence * 1.75,
    }),
    gainSmoothingSeconds: 0.028,
  };
}

function noteVoice(note) {
  if (state.articulation !== "notes" || note.age < 0 || note.age >= note.duration) return null;
  const progress = clamp(note.age / Math.max(0.001, note.duration), 0, 1);
  const attack = clamp(progress / 0.075, 0, 1);
  const release = clamp((1 - progress) / 0.86, 0, 1);
  const envelope = Math.sin(Math.PI * progress) ** 0.6 * Math.min(attack, release);
  const bendPosition = lerp(0.92, -0.88, progress * progress * (3 - 2 * progress));
  const frequency = clamp(
    note.baseFrequency * 2 ** (state.doppler * note.radialVelocity * bendPosition * 0.34),
    20,
    20_000,
  );
  const speed = normalizedThrottle(state.throttle);
  const gain = note.strength * envelope * lerp(0.1, 0.19, speed);
  if (gain < 0.0005) return null;
  return {
    key: note.key,
    frequency,
    gain,
    pan: note.pan,
    waveform: speed > 0.72 ? "triangle" : "sine",
    ...synthParametersForMode("fm", clamp(note.character * state.character, 0, 1), {
      fmIndex: 0.25 + Math.abs(note.tangentialVelocity) * state.character * 2.6,
      fmRatio: 1.25 + note.incidence * 1.25,
    }),
    gainSmoothingSeconds: 0.018,
  };
}

function updateAudio(now = performance.now(), force = false) {
  if (!state.audioOn) return;
  if (!force && now - lastAudioAt < 32) return;
  lastAudioAt = now;
  if (document.hidden || !state.running) {
    pool.setVoices([]);
    return;
  }
  const voices = [];
  const engine = engineVoice();
  if (engine) voices.push(engine);
  const starVoiceLimit = Math.max(0, 18 - (engine ? 1 : 0));
  if (state.articulation === "continuous") {
    for (const contact of state.fieldContacts.slice(0, starVoiceLimit)) {
      const voice = starVoice(contact);
      if (voice) voices.push(voice);
    }
  } else if (state.articulation === "notes") {
    const noteVoices = state.noteHolds
      .map(noteVoice)
      .filter(Boolean)
      .sort((left, right) => right.gain - left.gain)
      .slice(0, starVoiceLimit);
    voices.push(...noteVoices);
  }
  pool.setVoices(voices, { requestedVoiceCount: voices.length });
}

function flushTriggers() {
  if (!state.pendingTriggers.length) return;
  const intents = state.pendingTriggers
    .splice(0)
    .sort((left, right) => right.spec.gain - left.spec.gain)
    .slice(0, 16);
  if (!state.audioOn || state.articulation !== "triggers" || document.hidden) return;
  const headroom = pool.availableStrikeHeadroom(0.72);
  const specs = normalizeStrikeGains(intents.map((intent) => intent.spec), headroom);
  intents.forEach((intent, index) => {
    pool.strike(specs[index], {
      attackSeconds: 0.002 + (1 - state.character) * 0.004,
      decaySeconds: lerp(0.045, 0.62, state.tail ** 1.35),
      attackNoise: intent.attackNoise,
      startDelaySeconds: clamp(intent.offsetSeconds, 0, 0.03),
      retriggerMode: "overlap",
    });
  });
}

function updateUi(now = performance.now(), force = false) {
  if (!force && now - lastUiAt < 90) return;
  lastUiAt = now;
  const tier = flightTierForThrottle(state.throttle);
  const tierIndex = FLIGHT_TIERS.findIndex(({ id }) => id === tier.id);
  const modeLabel = MODE_LABELS[state.articulation];
  const headingDegrees = Math.round(((state.heading + Math.PI / 2 + TAU) % TAU) / TAU * 360) % 360;
  document.body.style.setProperty("--flight-tier", tier.accent);
  document.body.classList.toggle("is-plaid", tier.id === "plaid");
  $("flightModeBadge").querySelector("span").textContent = tier.label;
  $("telemetryMode").textContent = tier.label;
  $("metricThrust").textContent = String(Math.round(state.throttle)).padStart(3, "0");
  $("metricContacts").textContent = String(state.contactCount).padStart(4, "0").slice(-4);
  $("metricHelm").textContent = `${String(headingDegrees).padStart(3, "0")}°`;
  $("driveSummary").textContent = `${state.running ? "flying" : "paused"} · ${tier.label}`;
  $("fieldSummary").textContent = `${state.stars.length} stars · ${state.orbitLobes} lobe${state.orbitLobes === 1 ? "" : "s"}`;
  $("soundSummary").textContent = `${modeLabel.toLowerCase()} · ${Math.round(state.minimumFrequency)}–${Math.round(state.maximumFrequency)} Hz`;
  $("stageReadout").textContent = `${String(Math.round(state.throttle)).padStart(3, "0")}% THRUST · ${modeLabel.toUpperCase()} · ${state.orbitLobes}-LOBE FIELD · ${state.audioOn ? "AUDIO ON" : "AUDIO OFF"}`;
  $("stageInvitation").querySelector("b").textContent = state.audioOn ? `${modeLabel} field open` : "drag around the ship";
  $("stageInvitation").querySelector("span").textContent = state.audioOn
    ? "azimuth, distance, and velocity are audible"
    : "turn on audio · enter the listening contour";
  $("stageInvitation").classList.toggle("is-awake", state.audioOn);
  for (const [index, marker] of [...$("regimeTrack").children].entries()) {
    marker.style.setProperty("--tier-color", FLIGHT_TIERS[index].accent);
    marker.classList.toggle("is-active", index === tierIndex);
    marker.classList.toggle("is-passed", index < tierIndex);
  }
  for (const button of document.querySelectorAll("[data-throttle-preset]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.throttlePreset) === state.throttle));
  }
  for (const button of document.querySelectorAll("[data-articulation]")) {
    button.setAttribute("aria-pressed", String(button.dataset.articulation === state.articulation));
  }
  const canvasLabel = `Vector Flight is ${state.running ? "flying" : "paused"} at ${Math.round(state.throttle)} percent throttle in ${modeLabel} mode. The ship remains centered inside a ${state.orbitLobes}-lobe circular listening field. Audio is ${state.audioOn ? "on" : "off"}.`;
  if (canvasLabel !== lastCanvasLabel) {
    canvas.setAttribute("aria-label", canvasLabel);
    lastCanvasLabel = canvasLabel;
  }
}

function animate(now) {
  scheduledFrame = 0;
  const deltaSeconds = clamp((now - lastFrameAt) / 1_000, 0, 0.05);
  lastFrameAt = now;
  simulationFrameOffset = 0;
  if (!document.hidden) stepper.advance(deltaSeconds, simulate);
  refreshFieldContacts();
  updateAudio(now);
  flushTriggers();
  updateUi(now);
  draw();
  scheduledFrame = requestAnimationFrame(animate);
}

async function toggleAudio() {
  if (state.audioStarting) return;
  clearError();
  if (state.audioOn) {
    state.audioOn = false;
    state.noteHolds = [];
    state.pendingTriggers = [];
    pool.disable();
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    updateUi(performance.now(), true);
    announce("Vector Flight audio off. The circular star field continues silently.");
    return;
  }
  state.audioStarting = true;
  $("audioButton").disabled = true;
  $("audioState").textContent = "starting";
  try {
    await pool.enable();
    state.audioOn = true;
    pool.setLevel(state.level);
    refreshFieldContacts();
    updateAudio(performance.now(), true);
    $("audioButton").setAttribute("aria-pressed", "true");
    $("audioState").textContent = "on";
    announce(`Vector Flight audio on in ${MODE_LABELS[state.articulation]} mode.`);
  } catch (error) {
    state.audioOn = false;
    pool.disable();
    $("audioButton").setAttribute("aria-pressed", "false");
    $("audioState").textContent = "off";
    showError(error);
  } finally {
    state.audioStarting = false;
    $("audioButton").disabled = false;
    updateUi(performance.now(), true);
  }
}

function setRunning(running) {
  state.running = Boolean(running);
  $("flightButton").setAttribute("aria-pressed", String(state.running));
  $("flightButton").setAttribute("aria-label", state.running ? "Pause Vector Flight" : "Resume Vector Flight");
  lastFrameAt = performance.now();
  stepper.reset();
  if (!state.running) {
    state.noteHolds = [];
    state.pendingTriggers = [];
    pool.setVoices([]);
  }
  else updateAudio(performance.now(), true);
  updateUi(performance.now(), true);
  announce(state.running ? "Vector Flight resumed." : "Vector Flight paused; the star geometry is held.");
}

function setThrottle(value, { announceChange = false } = {}) {
  state.throttle = Math.round(clamp(Number(value), 0, 100));
  $("throttle").value = String(state.throttle);
  const tier = flightTierForThrottle(state.throttle);
  $("throttleOut").textContent = `${String(state.throttle).padStart(3, "0")} · ${tier.id.toUpperCase()}`;
  updateUi(performance.now(), true);
  if (manualMode) {
    refreshFieldContacts();
    draw();
  }
  if (announceChange) announce(`${tier.label}, ${state.throttle} percent throttle.`);
}

function setArticulation(value, { announceChange = false } = {}) {
  state.articulation = FLIGHT_ARTICULATIONS.includes(value) ? value : "continuous";
  $("articulation").value = state.articulation;
  state.noteHolds = [];
  state.pendingTriggers = [];
  for (const star of state.stars) star.contacted = false;
  pool.silence();
  refreshFieldContacts();
  updateAudio(performance.now(), true);
  updateUi(performance.now(), true);
  if (announceChange) announce(`${MODE_LABELS[state.articulation]} articulation selected.`);
}

function updateRangeOutput(id, value) {
  const formatters = {
    level: formatPercent,
    density: (number) => String(Math.round(number)),
    sensorRadius: formatPercent,
    sensorWidth: formatPercent,
    orbitLobes: (number) => String(Math.round(number)),
    orbitPhase: (number) => `${Math.round(number)}°`,
    fieldSpin: formatSignedPercent,
    minimumFrequency: formatFrequency,
    maximumFrequency: formatFrequency,
    stereoWidth: formatPercent,
    doppler: formatPercent,
    tail: formatPercent,
    character: formatPercent,
    engineMix: formatPercent,
  };
  $(`${id}Out`).textContent = formatters[id](Number(value));
}

function paintControls() {
  const fields = {
    level: state.level,
    density: state.density,
    sensorRadius: state.sensorRadius,
    sensorWidth: state.sensorWidth,
    orbitLobes: state.orbitLobes,
    orbitPhase: state.orbitPhase * 180 / Math.PI,
    fieldSpin: state.fieldSpin,
    minimumFrequency: state.minimumFrequency,
    maximumFrequency: state.maximumFrequency,
    stereoWidth: state.stereoWidth,
    doppler: state.doppler,
    tail: state.tail,
    character: state.character,
    engineMix: state.engineMix,
  };
  for (const [id, value] of Object.entries(fields)) {
    $(id).value = String(value);
    updateRangeOutput(id, value);
  }
  $("articulation").value = state.articulation;
  setThrottle(state.throttle);
  updateUi(performance.now(), true);
}

function normalizedPointer(event) {
  const bounds = canvas.getBoundingClientRect();
  const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.5);
  return unitDiscVector(
    (event.clientX - (bounds.left + bounds.width * 0.5)) / radius,
    (event.clientY - (bounds.top + bounds.height * 0.5)) / radius,
  );
}

function beginPointer(event) {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  pointerId = event.pointerId;
  Object.assign(state.helm, normalizedPointer(event));
  canvas.setPointerCapture?.(event.pointerId);
  canvas.focus({ preventScroll: true });
  stageWrap.classList.add("is-steering");
}

function movePointer(event) {
  if (pointerId !== event.pointerId) return;
  event.preventDefault();
  Object.assign(state.helm, normalizedPointer(event));
}

function endPointer(event) {
  if (pointerId !== event.pointerId) return;
  pointerId = null;
  stageWrap.classList.remove("is-steering");
  canvas.releasePointerCapture?.(event.pointerId);
}

function bindControls() {
  $("audioButton").addEventListener("click", () => { void toggleAudio(); });
  $("flightButton").addEventListener("click", () => setRunning(!state.running));
  $("centerHelm").addEventListener("click", () => {
    state.helm.x = 0;
    state.helm.y = 0;
    state.headingTarget = -Math.PI / 2;
    announce("Helm centered. The ship remains at the middle of its listening field.");
  });
  $("newSector").addEventListener("click", () => resetStars({ advanceField: true, announceReset: true }));
  $("articulation").addEventListener("change", (event) => setArticulation(event.target.value, { announceChange: true }));
  for (const button of document.querySelectorAll("[data-articulation]")) {
    button.addEventListener("click", () => setArticulation(button.dataset.articulation, { announceChange: true }));
  }
  $("throttle").addEventListener("input", (event) => setThrottle(event.target.value));
  for (const button of document.querySelectorAll("[data-throttle-preset]")) {
    button.addEventListener("click", () => setThrottle(button.dataset.throttlePreset, { announceChange: true }));
  }

  $("level").addEventListener("input", (event) => {
    state.level = Number(event.target.value);
    updateRangeOutput("level", state.level);
    pool.setLevel(state.level);
  });
  $("density").addEventListener("input", (event) => {
    state.density = Math.round(Number(event.target.value));
    updateRangeOutput("density", state.density);
    resetStars();
    refreshFieldContacts();
    updateUi(performance.now(), true);
  });
  for (const [id, key, transform] of [
    ["sensorRadius", "sensorRadius", Number],
    ["sensorWidth", "sensorWidth", Number],
    ["orbitLobes", "orbitLobes", (value) => Math.round(Number(value))],
    ["orbitPhase", "orbitPhase", (value) => Number(value) * Math.PI / 180],
    ["fieldSpin", "fieldSpin", Number],
    ["minimumFrequency", "minimumFrequency", Number],
    ["maximumFrequency", "maximumFrequency", Number],
    ["stereoWidth", "stereoWidth", Number],
    ["doppler", "doppler", Number],
    ["tail", "tail", Number],
    ["character", "character", Number],
    ["engineMix", "engineMix", Number],
  ]) {
    $(id).addEventListener("input", (event) => {
      state[key] = transform(event.target.value);
      updateRangeOutput(id, event.target.value);
      refreshFieldContacts();
      updateAudio(performance.now(), true);
      updateUi(performance.now(), true);
      if (manualMode) draw();
    });
  }

  $("resetAll").addEventListener("click", () => {
    const preserveAudio = state.audioOn;
    Object.assign(state, DEFAULTS, { audioOn: preserveAudio });
    state.field = DEFAULT_FIELD;
    state.simulationTime = 0;
    state.contactCount = 0;
    state.modeContacts = { continuous: 0, notes: 0, triggers: 0 };
    state.lastContact = null;
    state.noteHolds = [];
    state.pendingTriggers = [];
    state.helm.x = 0;
    state.helm.y = 0;
    state.steer.x = 0;
    state.steer.y = 0;
    state.heading = -Math.PI / 2;
    state.headingTarget = -Math.PI / 2;
    lastFrameAt = performance.now();
    stepper.reset();
    pool.silence();
    paintControls();
    resetStars();
    refreshFieldContacts();
    setRunning(true);
    pool.setLevel(state.level);
    announce("Vector Flight reset to its centered circular field.");
  });

  canvas.addEventListener("pointerdown", beginPointer);
  canvas.addEventListener("pointermove", movePointer);
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("keydown", (event) => {
    const amount = event.shiftKey ? 0.16 : 0.075;
    const directions = {
      ArrowLeft: [-amount, 0], a: [-amount, 0], A: [-amount, 0],
      ArrowRight: [amount, 0], d: [amount, 0], D: [amount, 0],
      ArrowUp: [0, -amount], w: [0, -amount], W: [0, -amount],
      ArrowDown: [0, amount], s: [0, amount], S: [0, amount],
    };
    if (directions[event.key]) {
      event.preventDefault();
      Object.assign(state.helm, unitDiscVector(
        state.helm.x + directions[event.key][0],
        state.helm.y + directions[event.key][1],
      ));
    } else if (["+", "="].includes(event.key)) {
      event.preventDefault();
      setThrottle(state.throttle + 4);
    } else if (["-", "_"].includes(event.key)) {
      event.preventDefault();
      setThrottle(state.throttle - 4);
    } else if (event.key === " ") {
      event.preventDefault();
      setRunning(!state.running);
    } else if (event.key === "Escape" && state.audioOn) {
      event.preventDefault();
      void toggleAudio();
    } else if (event.key.toLowerCase() === "p") {
      event.preventDefault();
      setThrottle(100, { announceChange: true });
    }
  });
}

function quadrantCounts() {
  return state.stars.reduce((counts, star) => {
    const horizontal = star.x < 0 ? "left" : "right";
    const vertical = star.y < 0 ? "top" : "bottom";
    counts[`${vertical}${horizontal[0].toUpperCase()}${horizontal.slice(1)}`] += 1;
    return counts;
  }, { topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0 });
}

function installManualHook() {
  if (query.get("manual") !== "1") return false;
  globalThis.__VECTOR_FLIGHT__ = Object.freeze({
    step(frames = 1) {
      const frameCount = clamp(Math.round(frames), 1, 4_000);
      simulationFrameOffset = 0;
      for (let index = 0; index < frameCount; index += 1) simulate(1 / 120);
      refreshFieldContacts();
      updateAudio(performance.now(), true);
      flushTriggers();
      updateUi(performance.now(), true);
      draw();
      return this.snapshot();
    },
    setThrottle(value) {
      setThrottle(value);
      refreshFieldContacts();
      draw();
      return this.snapshot();
    },
    setMode(value) {
      setArticulation(value);
      draw();
      return this.snapshot();
    },
    steer(x, y) {
      Object.assign(state.helm, unitDiscVector(Number(x), Number(y)));
      simulationFrameOffset = 0;
      for (let index = 0; index < 90; index += 1) simulate(1 / 120);
      refreshFieldContacts();
      draw();
      return this.snapshot();
    },
    snapshot() {
      return {
        throttle: state.throttle,
        tier: flightTierForThrottle(state.throttle).id,
        articulation: state.articulation,
        contactCount: state.contactCount,
        modeContacts: { ...state.modeContacts },
        starCount: state.stars.length,
        ship: { x: 0.5, y: 0.5, heading: state.heading },
        steer: { ...state.steer },
        helm: { ...state.helm },
        quadrants: quadrantCounts(),
        activeContacts: state.fieldContacts.length,
        activeNotes: state.noteHolds.length,
        lastContact: state.lastContact ? { ...state.lastContact } : null,
      };
    },
  });
  return true;
}

resizeCanvas();
resetStars();
paintControls();
bindControls();
manualMode = installManualHook();
refreshFieldContacts();
if (typeof ResizeObserver === "function") new ResizeObserver(resizeCanvas).observe(stageWrap);
else window.addEventListener("resize", resizeCanvas);
document.addEventListener("visibilitychange", () => {
  lastFrameAt = performance.now();
  stepper.reset();
  if (document.hidden) pool.silence();
  else updateAudio(performance.now(), true);
});
reducedMotionQuery?.addEventListener?.("change", (event) => {
  reducedMotion = event.matches;
  if (manualMode) draw();
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    pool.silence();
    return;
  }
  if (scheduledFrame) cancelAnimationFrame(scheduledFrame);
  void pool.close();
});
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  lastFrameAt = performance.now();
  stepper.reset();
  updateAudio(performance.now(), true);
});
if (manualMode) draw();
else scheduledFrame = requestAnimationFrame(animate);
