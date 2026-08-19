import {
  ALPHABET,
  WHEEL_MORPH_LIMITS,
  WHEEL_SPIN_PHASES,
  assignWheelMouthLetter,
  canStartWheelSpin,
  compileWheelWord,
  createWheelState,
  createWheelSpinState,
  hitTestWheelMouth,
  mapWheelPullGesture,
  normalizeWheelWord,
  startWheelSpin,
  stepWheelSpin,
  wheelStateForWord,
  wheelMouthLayout,
  wheelVocalParameters,
} from "./src/wheel-of-organs.js";
import {
  WHEEL_AUDIO_VOICE_COUNT,
  WheelOfOrgansAudio,
} from "./src/wheel-of-organs-audio.js";

const TAU = Math.PI * 2;
const NOTE_NAMES = Object.freeze(["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]);
const DEFAULT_RATE = 250;
const DEFAULT_OVERLAP = 0.82;
const DEFAULT_LEVEL = 0.42;
const DEFAULT_ROOT_MIDI = 40;
const DEFAULT_VIBRATO = 0.12;
const DEFAULT_GROWL = 0.04;
const DEFAULT_SPREAD = 0.7;
const DEFAULT_SLIME = 0.03;
const DEFAULT_DIRT = 0.01;
const DEFAULT_DEPTH = 0.46;

function organPreset(id, buttonId, name, description, globals, mouth = null) {
  return Object.freeze({
    id,
    buttonId,
    name,
    description,
    globals: Object.freeze({ ...globals }),
    mouth: mouth ? Object.freeze({ ...mouth }) : null,
  });
}

/**
 * The original wet anatomy remains available, while the other patches keep
 * breath, screech, dirt, and cavity feedback deliberately low. Consonant
 * frication is still allowed through so the typed word remains intelligible.
 */
export const WHEEL_ORGAN_PRESETS = Object.freeze([
  organPreset(
    "original",
    "wheelPresetOriginal",
    "Wet organism",
    "The original wet, gritty anatomy. Choose another patch for a more voiced, lower-noise wheel.",
    { rootMidi: 36, rate: 320, overlap: 0.68, vibrato: 0.24, growl: 0.46, slime: 0.74, dirt: 0.62, depth: 0.78, spread: 0.84 },
  ),
  organPreset(
    "clear",
    "wheelPresetClear",
    "Clear choir",
    "Open, centered mouths with almost no added breath, screech, dirt, or slime.",
    { rootMidi: 40, rate: 250, overlap: 0.82, vibrato: 0.12, growl: 0.04, slime: 0.03, dirt: 0.01, depth: 0.46, spread: 0.7 },
    { pull: 0.2, aperture: 0.8, tongue: 0.5, glottalTension: 0.7, breath: 0.01, pinch: 0.02, push: 0.4, nasality: 0.06, screech: 0, size: 1, stretch: 1, tongueOut: 0 },
  ),
  organPreset(
    "velvet",
    "wheelPresetVelvet",
    "Velvet organ",
    "A slower, warmer sustained organ with soft folds and very little turbulence.",
    { rootMidi: 32, rate: 190, overlap: 0.92, vibrato: 0.18, growl: 0.08, slime: 0.08, dirt: 0.015, depth: 0.7, spread: 0.58 },
    { pull: 0.11, aperture: 0.72, tongue: 0.44, glottalTension: 0.56, breath: 0.015, pinch: 0.025, push: 0.32, nasality: 0.12, screech: 0, size: 1.1, stretch: 1.12, tongueOut: 0.015 },
  ),
  organPreset(
    "hum",
    "wheelPresetHum",
    "Humming ring",
    "Strong nasal resonance without the usual hiss, grit, or exaggerated tongue noise.",
    { rootMidi: 36, rate: 220, overlap: 0.9, vibrato: 0.16, growl: 0.035, slime: 0.045, dirt: 0.008, depth: 0.62, spread: 0.76 },
    { pull: 0.16, aperture: 0.66, tongue: 0.42, glottalTension: 0.64, breath: 0.008, pinch: 0.015, push: 0.36, nasality: 0.58, screech: 0, size: 1.04, stretch: 1.05, tongueOut: 0 },
  ),
  organPreset(
    "glass",
    "wheelPresetGlass",
    "Glass throats",
    "Bright, taut vocal folds with a clean upper register and restrained noise.",
    { rootMidi: 48, rate: 280, overlap: 0.76, vibrato: 0.08, growl: 0.02, slime: 0.015, dirt: 0.006, depth: 0.38, spread: 0.88 },
    { pull: 0.34, aperture: 0.62, tongue: 0.62, glottalTension: 0.86, breath: 0.006, pinch: 0.035, push: 0.38, nasality: 0.025, screech: 0.02, size: 0.94, stretch: 1.04, tongueOut: 0 },
  ),
  organPreset(
    "speech",
    "wheelPresetSpeech",
    "Soft speech",
    "A moderate, low-noise tract that leaves room for the word's consonant cues.",
    { rootMidi: 40, rate: 300, overlap: 0.6, vibrato: 0.06, growl: 0.025, slime: 0.02, dirt: 0.008, depth: 0.5, spread: 0.64 },
    { pull: 0.18, aperture: 0.74, tongue: 0.52, glottalTension: 0.68, breath: 0.012, pinch: 0.04, push: 0.42, nasality: 0.14, screech: 0, size: 1, stretch: 1, tongueOut: 0.025 },
  ),
  organPreset(
    "giant",
    "wheelPresetGiant",
    "Quiet giant",
    "A deep, slow, oversized choir whose weight comes from tract size rather than dirt.",
    { rootMidi: 27, rate: 150, overlap: 0.94, vibrato: 0.1, growl: 0.045, slime: 0.055, dirt: 0.008, depth: 0.82, spread: 0.5 },
    { pull: 0.06, aperture: 0.78, tongue: 0.4, glottalTension: 0.58, breath: 0.008, pinch: 0.015, push: 0.34, nasality: 0.1, screech: 0, size: 1.62, stretch: 1.28, tongueOut: 0 },
  ),
]);

function byId(doc, id) {
  return doc.getElementById(id);
}

function clamp(value, minimum = 0, maximum = 1, fallback = minimum) {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : fallback;
  return Math.min(maximum, Math.max(minimum, safe));
}

function noteName(midi) {
  const note = Math.round(Number(midi) || 0);
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

function spinStatusLabel(spin, character = "", activeMouthCount = 1) {
  if (activeMouthCount <= 0) return "unvoiced";
  switch (spin?.phase) {
    case WHEEL_SPIN_PHASES.accelerating: return "winding up";
    case WHEEL_SPIN_PHASES.coasting: return "spinning";
    case WHEEL_SPIN_PHASES.decelerating: return "slowing";
    case WHEEL_SPIN_PHASES.sustaining: return `holding ${character || "winner"}`;
    case WHEEL_SPIN_PHASES.decaying: return `fading ${character || "winner"}`;
    case WHEEL_SPIN_PHASES.cooldown: return "settling";
    default: return "ready";
  }
}

function spinMinimumTurns(rate) {
  const force = clamp((Number(rate) - 90) / (720 - 90));
  return 5 + Math.round(force * 4);
}

function spinForceLabel(rate) {
  return `${spinMinimumTurns(rate)}+ turns`;
}

function percent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function morphScale(value) {
  return `${Number(value).toFixed(2)}×`;
}

function mouthMorphSnapshot(mouth = {}) {
  return {
    pull: clamp(mouth.pull),
    aperture: clamp(mouth.aperture, 0.04, 1, 0.68),
    tongue: clamp(mouth.tongue, 0, 1, 0.5),
    glottalTension: clamp(mouth.glottalTension, 0, 1, 0.62),
    breath: clamp(mouth.breath, 0, 1, 0.22),
    pinch: clamp(mouth.pinch, 0, 1, 0.22),
    push: clamp(mouth.push, 0, 1, 0.3),
    nasality: clamp(mouth.nasality, 0, 1, 0.72),
    screech: clamp(mouth.screech, 0, 1, 0.38),
    size: clamp(
      mouth.size,
      WHEEL_MORPH_LIMITS.size.minimum,
      WHEEL_MORPH_LIMITS.size.maximum,
      WHEEL_MORPH_LIMITS.size.default,
    ),
    stretch: clamp(
      mouth.stretch,
      WHEEL_MORPH_LIMITS.stretch.minimum,
      WHEEL_MORPH_LIMITS.stretch.maximum,
      WHEEL_MORPH_LIMITS.stretch.default,
    ),
    tongueOut: clamp(
      mouth.tongueOut,
      WHEEL_MORPH_LIMITS.tongueOut.minimum,
      WHEEL_MORPH_LIMITS.tongueOut.maximum,
      WHEEL_MORPH_LIMITS.tongueOut.default,
    ),
  };
}

/**
 * Captured drags deliberately keep using their original origin while the
 * mouth is deforming. Unlike `pull`, these signed values continue past the
 * visible ring so a long gesture can reach the same extremes as mutation.
 */
function rawGestureTravel(drag, point) {
  const deltaX = point.x - drag.startX;
  const deltaY = point.y - drag.startY;
  return {
    radial: clamp(
      (deltaX * drag.radialX + deltaY * drag.radialY) / drag.radialSpan,
      -3,
      3,
      0,
    ),
    tangential: clamp(
      (-deltaX * drag.radialY + deltaY * drag.radialX) / drag.tangentialSpan,
      -3,
      3,
      0,
    ),
  };
}

/** Keep a draft typeable: full word normalization deliberately happens later. */
export function editableWheelWord(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]+/g, "")
    .replace(/\s/g, " ");
}

function replaceMouthLetter(word, mouthIndex, letter) {
  let index = -1;
  return [...String(word ?? "")].map((character) => {
    if (!/[A-Z]/i.test(character)) return character;
    index += 1;
    return index === mouthIndex ? letter : character;
  }).join("");
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.clientWidth / Math.max(1, rect.width)),
    y: (event.clientY - rect.top) * (canvas.clientHeight / Math.max(1, rect.height)),
  };
}

function localPoint(mouth, radial, tangential) {
  const cosine = Math.cos(mouth.angle);
  const sine = Math.sin(mouth.angle);
  return {
    x: mouth.centerX
      + cosine * radial * mouth.radialRadius
      - sine * tangential * mouth.tangentialRadius,
    y: mouth.centerY
      + sine * radial * mouth.radialRadius
      + cosine * tangential * mouth.tangentialRadius,
  };
}

function seededNoise(seed) {
  let value = seed >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0xffff_ffff;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, radius);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function drawNerve(ctx, layout, mouth, data, activity, current) {
  const cosine = Math.cos(mouth.angle);
  const sine = Math.sin(mouth.angle);
  const normalX = -sine;
  const normalY = cosine;
  const startRadius = layout.coreRadius * 0.78;
  const endRadius = Math.max(
    startRadius + 8,
    Math.hypot(mouth.centerX - layout.centerX, mouth.centerY - layout.centerY)
      - mouth.radialRadius * 0.78,
  );
  const startX = layout.centerX + cosine * startRadius;
  const startY = layout.centerY + sine * startRadius;
  const endX = layout.centerX + cosine * endRadius;
  const endY = layout.centerY + sine * endRadius;
  const bend = (data.tongue - 0.5) * mouth.tangentialRadius * 0.74;
  const middleX = (startX + endX) / 2 + normalX * bend;
  const middleY = (startY + endY) / 2 + normalY * bend;

  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(middleX, middleY, endX, endY);
  ctx.lineWidth = Math.max(8, mouth.tangentialRadius * 0.22);
  ctx.strokeStyle = "rgba(22, 7, 22, 0.98)";
  ctx.stroke();
  ctx.lineWidth = Math.max(2.1, mouth.tangentialRadius * 0.052);
  ctx.strokeStyle = data.active ? "rgba(166, 255, 77, 0.7)" : "rgba(71, 84, 63, 0.42)";
  ctx.shadowBlur = data.active ? 8 + activity * 14 : 0;
  ctx.shadowColor = "#b8ff58";
  ctx.stroke();

  const folds = 5;
  for (let index = 0; index < folds; index += 1) {
    const amount = (index + 1) / (folds + 1);
    const oneMinus = 1 - amount;
    const x = oneMinus * oneMinus * startX
      + 2 * oneMinus * amount * middleX
      + amount * amount * endX;
    const y = oneMinus * oneMinus * startY
      + 2 * oneMinus * amount * middleY
      + amount * amount * endY;
    const pulse = current && index === Math.floor(activity * folds) % folds;
    ctx.beginPath();
    ctx.arc(x, y, pulse ? 3.4 : 1.7, 0, TAU);
    ctx.fillStyle = pulse ? "#f7ffbf" : "rgba(184, 255, 88, 0.62)";
    ctx.fill();
  }
  ctx.restore();
}

function drawGlottis(ctx, mouth, data, activity, time) {
  const x = -mouth.radialRadius * 0.63;
  const foldLength = mouth.tangentialRadius * 0.3;
  const tension = clamp(data.glottalTension ?? 0.62);
  const push = clamp(data.push, 0, 1, 0.3);
  const screech = clamp(data.screech, 0, 1, 0.38);
  const voicedPulse = data.active
    ? Math.sin(time * (0.018 + tension * 0.014 + screech * 0.025) + mouth.index * 0.9) * 0.5 + 0.5
    : 0;
  const gap = Math.max(
    0.5,
    1.1 + (1 - tension) * 3.6 + voicedPulse * (1.2 + activity * 1.4) - push * 2.5,
  );

  ctx.save();
  ctx.translate(x, 0);
  ctx.fillStyle = "#26020f";
  ctx.strokeStyle = activity > 0.2 ? "#dbff75" : "#ff6b9e";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, mouth.radialRadius * 0.12, mouth.tangentialRadius * 0.34, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(2.2, mouth.tangentialRadius * 0.07);
  ctx.strokeStyle = data.active ? "#ff7fa8" : "#713548";
  ctx.shadowBlur = activity * 14;
  ctx.shadowColor = "#b8ff58";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-foldLength * 0.52, side * gap);
    ctx.quadraticCurveTo(0, side * (gap * 0.42), foldLength * 0.52, side * gap);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.ellipse(0, 0, Math.max(0.8, gap * 0.42), foldLength * 0.55, 0, 0, TAU);
  ctx.fillStyle = activity > 0.2 ? "#bdff5d" : "#120108";
  ctx.fill();
  ctx.restore();
}

function drawMouth(ctx, mouth, data, selected, current, activity, time) {
  const radialRadius = mouth.radialRadius;
  const tangentialRadius = mouth.tangentialRadius;
  const pinch = clamp(data.pinch, 0, 1, 0.22);
  const push = clamp(data.push, 0, 1, 0.3);
  const nasality = clamp(data.nasality, 0, 1, 0.72);
  const screech = clamp(data.screech, 0, 1, 0.38);
  ctx.save();
  ctx.translate(mouth.centerX, mouth.centerY);
  ctx.rotate(mouth.angle);
  ctx.scale(1 - push * 0.1 + screech * 0.035, 1 + push * 0.14 - pinch * 0.08);

  ctx.strokeStyle = `rgba(255, 93, 160, ${0.12 + activity * 0.3})`;
  ctx.lineWidth = 0.65;
  for (let index = 0; index < 30; index += 1) {
    const angle = index / 30 * TAU;
    const wobble = 0.72 + seededNoise((mouth.index + 1) * 613 + index * 97) * 0.36;
    const x = Math.cos(angle) * radialRadius;
    const y = Math.sin(angle) * tangentialRadius;
    const extension = 2 + wobble * 5 + activity * 3 + screech * (2 + (index % 4) * 1.2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x + Math.cos(angle) * extension,
      y + Math.sin(angle) * extension,
    );
    ctx.stroke();
  }

  const flesh = ctx.createRadialGradient(
    -radialRadius * 0.28,
    -tangentialRadius * 0.34,
    2,
    0,
    0,
    radialRadius * 1.25,
  );
  flesh.addColorStop(0, data.active ? "#ff9a8e" : "#71434c");
  flesh.addColorStop(0.46, data.active ? "#df347b" : "#502838");
  flesh.addColorStop(1, "#34123e");
  ctx.fillStyle = flesh;
  ctx.strokeStyle = selected ? "#fff4eb" : current ? "#caff74" : "rgba(255, 121, 173, 0.65)";
  ctx.lineWidth = selected ? 2.6 : current ? 2.2 : 1.1;
  ctx.shadowBlur = current ? 18 : activity * 12;
  ctx.shadowColor = current ? "#b8ff58" : "#ff579f";
  ctx.beginPath();
  ctx.ellipse(0, 0, radialRadius, tangentialRadius, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  ctx.fillStyle = `rgba(48, 8, 38, ${0.44 + nasality * 0.3})`;
  for (let hole = 0; hole < 10; hole += 1) {
    const angle = hole / 10 * TAU + mouth.index * 0.61;
    const x = Math.cos(angle) * radialRadius * (0.72 + 0.08 * Math.sin(hole * 2.7));
    const y = Math.sin(angle) * tangentialRadius * 0.7;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.8 + (hole % 3), 1.5 + (hole % 2), angle, 0, TAU);
    ctx.fill();
  }

  // Paired nasal cavities visibly open as the nasal morph rises.
  for (const side of [-1, 1]) {
    const noseX = -radialRadius * (0.05 + push * 0.08);
    const noseY = side * tangentialRadius * 0.46;
    ctx.beginPath();
    ctx.ellipse(
      noseX,
      noseY,
      radialRadius * (0.055 + nasality * 0.045),
      tangentialRadius * (0.05 + nasality * 0.07),
      0,
      0,
      TAU,
    );
    ctx.fillStyle = "#17020c";
    ctx.fill();
    ctx.strokeStyle = `rgba(190, 255, 99, ${0.14 + nasality * 0.72})`;
    ctx.lineWidth = 0.8 + nasality * 1.2;
    ctx.stroke();
  }

  const aperture = clamp(data.aperture, 0.04, 1, 0.68);
  const mouthWidth = radialRadius * (0.55 + aperture * 0.25) * (1 - pinch * 0.34);
  const mouthHeight = tangentialRadius * (0.12 + aperture * 0.62) * (1 - pinch * 0.5);
  const mouthX = radialRadius * 0.16;
  ctx.fillStyle = "#190108";
  ctx.strokeStyle = data.active ? "#ff6f9f" : "#74324c";
  ctx.lineWidth = Math.max(2.4, tangentialRadius * (0.075 + pinch * 0.075));
  ctx.beginPath();
  ctx.ellipse(mouthX, 0, mouthWidth, mouthHeight, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();

  if (pinch > 0.08) {
    ctx.beginPath();
    ctx.ellipse(
      mouthX + radialRadius * pinch * 0.035,
      0,
      mouthWidth * (1 + pinch * 0.16),
      mouthHeight * (1 + pinch * 0.38),
      0,
      0,
      TAU,
    );
    ctx.strokeStyle = `rgba(255, 174, 198, ${0.15 + pinch * 0.58})`;
    ctx.lineWidth = 1 + pinch * 2.5;
    ctx.stroke();
  }

  ctx.save();
  ctx.beginPath();
  ctx.ellipse(mouthX, 0, mouthWidth * 0.91, mouthHeight * 0.83, 0, 0, TAU);
  ctx.clip();
  const tongue = clamp(data.tongue, 0, 1, 0.5);
  const tongueY = (tongue - 0.5) * mouthHeight * 1.02;
  const tongueCurl = (tongue - 0.5) * 0.42;
  ctx.translate(mouthX + mouthWidth * 0.12, tongueY + mouthHeight * 0.38);
  ctx.rotate(tongueCurl);
  ctx.fillStyle = data.active ? "#f04b83" : "#71344d";
  ctx.strokeStyle = "rgba(255, 168, 184, 0.42)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.ellipse(0, 0, mouthWidth * (0.46 + aperture * 0.12), Math.max(2.3, mouthHeight * 0.28), 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  const tongueOut = clamp(data.tongueOut, 0, 1, 0.12);
  if (tongueOut > 0.01) {
    const startX = mouthX + mouthWidth * 0.18;
    const endX = mouthX + mouthWidth * 0.58 + radialRadius * tongueOut * 1.85;
    const endY = tongueY + (tongue - 0.5) * tangentialRadius * tongueOut * 0.7;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowBlur = activity * 8 + screech * 5;
    ctx.shadowColor = "rgba(255, 68, 130, 0.68)";
    ctx.beginPath();
    ctx.moveTo(startX, tongueY + mouthHeight * 0.26);
    ctx.bezierCurveTo(
      startX + radialRadius * tongueOut * 0.48,
      tongueY + mouthHeight * (0.36 + tongue * 0.12),
      endX - radialRadius * tongueOut * 0.34,
      endY + tangentialRadius * (tongue - 0.5) * 0.35,
      endX,
      endY,
    );
    ctx.strokeStyle = data.active ? "#e93f7d" : "#6b3048";
    ctx.lineWidth = Math.max(3, mouthHeight * (0.28 + aperture * 0.24) * (1 - pinch * 0.32));
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(startX, tongueY + mouthHeight * 0.24);
    ctx.quadraticCurveTo((startX + endX) / 2, endY, endX, endY);
    ctx.strokeStyle = "rgba(255, 184, 194, 0.34)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  drawGlottis(ctx, mouth, data, activity, time);

  const badgeX = radialRadius * 0.74;
  const badgeY = -tangentialRadius * 0.73;
  ctx.shadowBlur = current ? 14 : 0;
  ctx.shadowColor = "#b8ff58";
  ctx.fillStyle = current ? "#b8ff58" : selected ? "#fff1f7" : "#16080f";
  ctx.strokeStyle = current ? "#e9ffb8" : "rgba(255, 215, 232, 0.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, Math.max(9, tangentialRadius * 0.2), 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.save();
  ctx.translate(badgeX, badgeY);
  ctx.rotate(-mouth.angle);
  ctx.fillStyle = current ? "#102005" : "#ffd8e9";
  ctx.font = `650 ${Math.max(9, tangentialRadius * 0.21)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(data.letter ?? "?").slice(0, 1).toUpperCase(), 0, 0.5);
  ctx.restore();

  ctx.restore();
}

function drawCore(ctx, layout, state, currentMouth, currentCharacter, phase) {
  const { centerX, centerY, coreRadius } = layout;
  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.shadowBlur = state.running ? 25 : 13;
  ctx.shadowColor = state.running ? "rgba(184,255,88,.55)" : "rgba(255,70,145,.34)";
  const core = ctx.createRadialGradient(
    -coreRadius * 0.22,
    -coreRadius * 0.25,
    2,
    0,
    0,
    coreRadius,
  );
  core.addColorStop(0, "#ff806f");
  core.addColorStop(0.52, "#a70c58");
  core.addColorStop(1, "#250517");
  ctx.fillStyle = core;
  ctx.strokeStyle = state.running ? "#b8ff58" : "#f45c9d";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const lobes = Math.max(6, Math.min(12, state.mouths.length));
  ctx.fillStyle = "#4b032a";
  ctx.strokeStyle = "rgba(255,129,176,.62)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let index = 0; index < lobes * 2; index += 1) {
    const angle = index / (lobes * 2) * TAU - Math.PI / 2;
    const radius = coreRadius * (index % 2 ? 0.42 : 0.76);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (currentMouth >= 0 && layout.mouths[currentMouth]) {
    ctx.save();
    ctx.fillStyle = "#d8ff8f";
    ctx.shadowBlur = 13;
    ctx.shadowColor = "#b8ff58";
    ctx.beginPath();
    ctx.moveTo(coreRadius * 0.18, 0);
    ctx.lineTo(coreRadius * 0.66, -coreRadius * 0.07);
    ctx.lineTo(coreRadius * 0.66, coreRadius * 0.07);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  const pulse = state.running ? 0.88 + Math.sin(phase * TAU) * 0.1 : 0.82;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius * 0.29 * pulse, 0, TAU);
  ctx.fillStyle = "#120109";
  ctx.strokeStyle = "#ff86b4";
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = state.running ? "#ceff72" : "#ff91b9";
  ctx.font = `700 ${Math.max(13, coreRadius * 0.34)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(currentCharacter || "∿", 0, 1);
  ctx.restore();
}

function drawOrganReader(ctx, layout, flash = 0, winner = false) {
  const { centerX, centerY, coreRadius, innerRadius, outerRadius } = layout;
  const intensity = clamp(flash);
  const railStart = centerX + coreRadius * 0.88;
  const railEnd = centerX + outerRadius + coreRadius * 0.68;
  const pointerX = centerX + outerRadius + coreRadius * 0.22;

  ctx.save();
  ctx.lineCap = "round";
  ctx.shadowBlur = 8 + intensity * 22;
  ctx.shadowColor = winner ? "rgba(232,255,181,.95)" : "rgba(184,255,88,.82)";
  ctx.strokeStyle = `rgba(184,255,88,${0.28 + intensity * 0.72})`;
  ctx.lineWidth = 1.5 + intensity * 2.5;
  ctx.beginPath();
  ctx.moveTo(railStart, centerY);
  ctx.lineTo(railEnd, centerY);
  ctx.stroke();

  ctx.fillStyle = winner ? "#efffc9" : intensity > 0.25 ? "#d8ff8f" : "#8fc844";
  ctx.strokeStyle = "#101a09";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pointerX - coreRadius * 0.44, centerY);
  ctx.lineTo(pointerX + coreRadius * 0.2, centerY - coreRadius * 0.25);
  ctx.lineTo(pointerX + coreRadius * 0.2, centerY + coreRadius * 0.25);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const forkX = centerX + innerRadius * 0.93;
  ctx.strokeStyle = `rgba(255,220,234,${0.35 + intensity * 0.55})`;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(forkX, centerY - coreRadius * 0.28);
  ctx.lineTo(forkX + coreRadius * 0.18, centerY);
  ctx.lineTo(forkX, centerY + coreRadius * 0.28);
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = intensity > 0.25 ? "#e5ffaf" : "rgba(198,230,141,.68)";
  ctx.font = "600 8px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  if (centerX * 2 >= 520) {
    ctx.fillText("3 O'CLOCK · ORGAN READER", railEnd + 7, centerY - coreRadius * 0.36);
  }
  ctx.restore();
}

function audioGlobals(state, mouthIndex = -1) {
  const globals = {
    rootMidi: state.rootMidi,
    level: outputLevelFallback(state),
    vibrato: state.vibrato,
    growl: state.growl,
    slime: state.slime,
    dirt: state.dirt,
    noise: state.dirt,
    depth: state.depth,
    spread: state.spread,
    mouthCount: state.mouths.length,
  };
  if (mouthIndex >= 0 && state.mouths.length > 0) {
    globals.pan = Math.sin(mouthIndex / state.mouths.length * TAU) * state.spread;
  }
  return globals;
}

function voiceSlot(index) {
  const numeric = Math.trunc(Number(index));
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric % WHEEL_AUDIO_VOICE_COUNT;
}

function outputLevelFallback(state) {
  return Number.isFinite(state.outputLevel) ? state.outputLevel : DEFAULT_LEVEL;
}

function updatedWheelState(candidate, fallback) {
  if (candidate?.mouths && Array.isArray(candidate.mouths)) {
    return { ...fallback, ...candidate };
  }
  if (Array.isArray(candidate)) return { ...fallback, mouths: candidate };
  return fallback;
}

export function mountWheelOfOrgans(doc = globalThis.document) {
  if (!doc?.body) return null;
  const canvas = byId(doc, "stage");
  const ctx = canvas?.getContext?.("2d", { alpha: true, desynchronized: true });
  if (!canvas || !ctx) return null;

  const audio = new WheelOfOrgansAudio();
  let state = createWheelState({ rootMidi: DEFAULT_ROOT_MIDI });
  state.rootMidi = DEFAULT_ROOT_MIDI;
  state.vibrato = Number.isFinite(state.vibrato) ? state.vibrato : DEFAULT_VIBRATO;
  state.growl = Number.isFinite(state.growl) ? state.growl : DEFAULT_GROWL;
  state.spread = Number.isFinite(state.spread) ? state.spread : DEFAULT_SPREAD;
  state.slime = DEFAULT_SLIME;
  state.dirt = DEFAULT_DIRT;
  state.depth = DEFAULT_DEPTH;
  state.running = false;
  state.selectedMouth = Number.isInteger(state.selectedMouth) ? state.selectedMouth : 0;
  let wordRate = DEFAULT_RATE;
  let mouthOverlap = DEFAULT_OVERLAP;
  let outputLevel = DEFAULT_LEVEL;
  let audioOn = false;
  let audioStarting = false;
  let audioStopping = false;
  let audioStartPromise = null;
  let cssWidth = 1;
  let cssHeight = 1;
  let pixelRatio = 1;
  let layout = wheelMouthLayout(1, 1, state);
  let layoutDirty = true;
  let frame = 0;
  let lastTime = 0;
  let phraseIndex = -1;
  let currentMouth = -1;
  let currentCharacter = "";
  let currentEvent = null;
  let phrase = compileWheelWord(state.word, state);
  let spin = createWheelSpinState({ mouthCount: state.mouths.length });
  let readerFlash = 0;
  let winnerReleased = false;
  let flashLevels = Array(state.mouths.length).fill(0);
  let drag = null;
  const activePointers = new Map();
  let pinchGesture = null;
  let mutationCount = 0;
  let activePreset = "clear";

  const selectedMouth = () => state.mouths[state.selectedMouth] ?? state.mouths[0];

  function announce(message) {
    const live = byId(doc, "liveStatus");
    if (live) live.textContent = message;
  }

  function syncAudioButton() {
    const button = byId(doc, "audioButton");
    const label = byId(doc, "audioState");
    button?.setAttribute("aria-pressed", String(audioOn));
    if (button) button.disabled = audioStarting || audioStopping;
    if (label) {
      label.textContent = audioStopping
        ? "stopping"
        : audioStarting ? "starting" : audioOn ? "on" : "off";
    }
  }

  function syncTransport() {
    const button = byId(doc, "transportButton");
    const status = byId(doc, "transportState");
    const activeMouthCount = state.mouths.filter((mouth) => mouth.active).length;
    const ready = canStartWheelSpin(spin)
      && activeMouthCount > 0
      && !audio.isDecaying;
    button?.setAttribute("aria-pressed", String(state.running));
    button?.setAttribute("aria-label", ready
      ? "Spin the Wheel of Organs"
      : spin.phase === WHEEL_SPIN_PHASES.idle
        ? "Spin unavailable until an active mouth exists"
        : "Wheel spin in progress");
    if (button) {
      button.disabled = !ready;
      button.dataset.phase = spin.phase;
    }
    const wordInput = byId(doc, "wordInput");
    const mapWordButton = byId(doc, "mapWordButton");
    const mouthLetter = byId(doc, "mouthLetter");
    const mouthActive = byId(doc, "petalActive");
    const mutateButton = byId(doc, "mutateButton");
    if (wordInput) wordInput.disabled = spin.locked;
    if (mapWordButton) mapWordButton.disabled = spin.locked;
    if (mouthLetter) mouthLetter.disabled = spin.locked || !selectedMouth();
    if (mouthActive) mouthActive.disabled = spin.locked || !selectedMouth();
    if (mutateButton) mutateButton.disabled = spin.locked;
    if (status) status.textContent = spinStatusLabel(spin, currentCharacter, activeMouthCount);
  }

  function presetForId(id) {
    return WHEEL_ORGAN_PRESETS.find((preset) => preset.id === id) ?? null;
  }

  function syncPresetButtons() {
    for (const preset of WHEEL_ORGAN_PRESETS) {
      byId(doc, preset.buttonId)?.setAttribute(
        "aria-pressed",
        String(activePreset === preset.id),
      );
    }
    const description = byId(doc, "wheelPresetDescription");
    if (!description) return;
    const preset = presetForId(activePreset);
    description.textContent = preset?.description
      ?? "Custom anatomy — choose a preset to return to a repeatable voice.";
  }

  function markPresetCustom() {
    if (activePreset === null) return;
    activePreset = null;
    syncPresetButtons();
  }

  function applyPresetMouths(preset) {
    if (!preset || state.mouths.length === 0) return;
    const originalMouths = createWheelState({ word: state.word }).mouths;
    state.mouths.forEach((mouth, index) => {
      const original = originalMouths[index] ?? originalMouths[index % originalMouths.length];
      if (preset.id === "original" && original) {
        const { id, letter } = mouth;
        Object.assign(mouth, original, { id, letter });
        return;
      }
      if (!preset.mouth) return;
      const drift = ((index % 3) - 1) * 0.02;
      Object.assign(mouth, preset.mouth, {
        active: true,
        pull: clamp(preset.mouth.pull + drift),
        tongue: clamp(preset.mouth.tongue + Math.sin(index * 1.37) * 0.035),
        aperture: clamp(preset.mouth.aperture - drift, 0.04, 1, preset.mouth.aperture),
        interval: original?.interval ?? mouth.interval,
      });
    });
  }

  function applyPreset(id, shouldAnnounce = true) {
    const preset = presetForId(id);
    if (!preset) return false;
    const globals = preset.globals;
    state.rootMidi = globals.rootMidi;
    state.vibrato = globals.vibrato;
    state.growl = globals.growl;
    state.slime = globals.slime;
    state.dirt = globals.dirt;
    state.depth = globals.depth;
    state.spread = globals.spread;
    wordRate = globals.rate;
    mouthOverlap = globals.overlap;
    activePreset = preset.id;
    applyPresetMouths(preset);
    layoutDirty = true;
    syncGlobalControls();
    syncPresetButtons();
    syncAudio();
    if (shouldAnnounce) announce(`${preset.name} preset loaded.`);
    return true;
  }

  function buildLetterOptions() {
    const select = byId(doc, "mouthLetter");
    if (!select || select.options.length) return;
    for (const letter of ALPHABET) {
      const option = doc.createElement("option");
      option.value = letter;
      option.textContent = letter;
      select.append(option);
    }
  }

  function syncMouthButtons() {
    const root = byId(doc, "petalButtons");
    if (!root) return;
    for (const button of root.querySelectorAll("button[data-mouth-index]")) {
      const index = Number(button.dataset.mouthIndex);
      const mouth = state.mouths[index];
      if (!mouth) continue;
      button.setAttribute("aria-pressed", String(index === state.selectedMouth));
      button.classList.toggle("is-active", Boolean(mouth.active));
      button.classList.toggle("is-current", index === currentMouth);
      button.setAttribute(
        "aria-label",
        `Mouth ${index + 1}, letter ${mouth.letter}, ${mouth.active ? "voiced" : "muted"}`,
      );
      const letter = button.querySelector("b");
      if (letter) letter.textContent = mouth.letter;
    }
  }

  function buildMouthButtons() {
    const root = byId(doc, "petalButtons");
    if (!root) return;
    root.replaceChildren();
    state.mouths.forEach((mouth, index) => {
      const button = doc.createElement("button");
      const letter = doc.createElement("b");
      const number = doc.createElement("small");
      button.type = "button";
      button.dataset.mouthIndex = String(index);
      letter.textContent = mouth.letter;
      number.textContent = String(index + 1).padStart(2, "0");
      button.append(letter, number);
      button.addEventListener("click", () => {
        setSelected(index);
        audition(index, 0.7);
      });
      root.append(button);
    });
    syncMouthButtons();
  }

  function syncSelectedControls() {
    const mouth = selectedMouth();
    const selected = byId(doc, "selectedPetalOut");
    const controlIds = [
      "mouthLetter",
      "petalActive",
      "auditionMouth",
      "pull",
      "aperture",
      "tongue",
      "glottis",
      "emphasis",
      "pinch",
      "push",
      "nasality",
      "screech",
      "mouthSize",
      "stretch",
      "tongueOut",
    ];
    for (const id of controlIds) {
      const control = byId(doc, id);
      if (control) {
        control.disabled = !mouth
          || (spin.locked && ["mouthLetter", "petalActive"].includes(id));
      }
    }
    if (!mouth) {
      if (selected) selected.textContent = "no mouth";
      syncMouthButtons();
      return;
    }
    if (selected) {
      selected.textContent = `${String(state.selectedMouth + 1).padStart(2, "0")} · ${mouth.letter}`;
    }
    const values = {
      pull: mouth.pull,
      aperture: mouth.aperture,
      tongue: mouth.tongue,
      glottis: mouth.glottalTension,
      emphasis: mouth.breath,
      pinch: mouth.pinch ?? 0.22,
      push: mouth.push ?? 0.3,
      nasality: mouth.nasality ?? 0.72,
      screech: mouth.screech ?? 0.38,
      mouthSize: mouth.size ?? WHEEL_MORPH_LIMITS.size.default,
      stretch: mouth.stretch ?? WHEEL_MORPH_LIMITS.stretch.default,
      tongueOut: mouth.tongueOut ?? WHEEL_MORPH_LIMITS.tongueOut.default,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = byId(doc, id);
      const output = byId(doc, `${id}Out`);
      if (input) input.value = String(value);
      if (output) {
        output.textContent = ["mouthSize", "stretch"].includes(id)
          ? morphScale(value)
          : percent(value);
      }
    }
    const letter = byId(doc, "mouthLetter");
    if (letter) letter.value = mouth.letter;
    const active = byId(doc, "petalActive");
    active?.setAttribute("aria-pressed", String(mouth.active));
    if (active) active.textContent = mouth.active ? "mouth voiced" : "mouth muted";
    syncMouthButtons();
  }

  function syncGlobalControls() {
    const values = {
      rootNote: state.rootMidi,
      pulseRate: wordRate,
      legato: mouthOverlap,
      centerA: state.vibrato,
      centerB: state.growl,
      slime: state.slime,
      dirt: state.dirt,
      depth: state.depth,
      spread: state.spread,
      level: outputLevel,
    };
    for (const [id, value] of Object.entries(values)) {
      const input = byId(doc, id);
      if (input) input.value = String(value);
    }
    const root = byId(doc, "rootNoteOut");
    if (root) root.textContent = noteName(state.rootMidi);
    const rate = byId(doc, "pulseRateOut");
    if (rate) rate.textContent = spinForceLabel(wordRate);
    for (const [id, value] of Object.entries({
      centerA: state.vibrato,
      centerB: state.growl,
      slime: state.slime,
      dirt: state.dirt,
      depth: state.depth,
      spread: state.spread,
      level: outputLevel,
      legato: mouthOverlap,
    })) {
      const output = byId(doc, `${id}Out`);
      if (output) output.textContent = percent(value);
    }
    const word = byId(doc, "wordInput");
    if (word && word.value !== state.word) word.value = state.word;
    const count = byId(doc, "mouthCountOut");
    if (count) count.textContent = String(state.mouths.length);
    syncSelectedControls();
    syncTransport();
  }

  function setSelected(index, shouldAnnounce = true) {
    if (state.mouths.length === 0) {
      state.selectedMouth = -1;
      syncSelectedControls();
      if (shouldAnnounce) announce("The wheel has no mouths. Type a letter to grow one.");
      return;
    }
    state.selectedMouth = Math.max(0, Math.min(state.mouths.length - 1, Math.trunc(Number(index) || 0)));
    syncSelectedControls();
    if (shouldAnnounce) {
      const mouth = selectedMouth();
      announce(`Mouth ${state.selectedMouth + 1}, letter ${mouth.letter}, selected.`);
    }
  }

  function syncAudio() {
    if (!audioOn) return;
    state.outputLevel = outputLevel;
    audio.syncMouths(
      state.mouths.slice(0, WHEEL_AUDIO_VOICE_COUNT),
      audioGlobals(state),
    );
  }

  async function ensureAudio() {
    if (audioOn) return true;
    if (audioStopping) return false;
    if (audioStartPromise) return audioStartPromise;
    audioStarting = true;
    syncAudioButton();
    audioStartPromise = (async () => {
      try {
        audio.setLevel(outputLevel);
        await audio.enable();
        audioOn = true;
        syncAudio();
        announce("Audio on. The vocal organs are awake.");
        return true;
      } catch (error) {
        audioOn = false;
        announce(error instanceof Error ? error.message : "Audio could not start.");
        return false;
      } finally {
        audioStarting = false;
        syncAudioButton();
      }
    })();
    try {
      return await audioStartPromise;
    } finally {
      audioStartPromise = null;
    }
  }

  async function toggleAudio() {
    if (audioStarting || audioStopping) return;
    if (audioOn) {
      audioOn = false;
      audioStopping = true;
      syncAudioButton();
      try {
        await audio.disable();
        announce("Audio off.");
      } catch (error) {
        announce(error instanceof Error ? error.message : "Audio could not stop cleanly.");
      } finally {
        audioStopping = false;
        syncAudioButton();
      }
      return;
    }
    await ensureAudio();
  }

  function audition(index = state.selectedMouth, duration = 0.68, override = {}) {
    if (spin.locked) return;
    const mouth = { ...state.mouths[index], ...override };
    if (!mouth?.active) return;
    currentMouth = index;
    currentCharacter = mouth.letter;
    flashLevels[index] = 1;
    if (audioOn) {
      audio.articulate(voiceSlot(index), mouth, {
        duration,
        durationSeconds: duration,
        velocity: 0.92,
        globals: audioGlobals(state, index),
      });
    }
    syncTransport();
    syncMouthButtons();
  }

  function sustain(index = state.selectedMouth) {
    if (spin.locked) return;
    const mouth = state.mouths[index];
    if (!mouth?.active || !audioOn) return;
    const contextual = state.running && currentMouth === index && currentEvent
      ? {
        articulation: currentEvent.articulation,
        articulationSequence: currentEvent.articulationSequence,
        carrierLetter: currentEvent.carrierLetter,
        carrierSequence: currentEvent.carrierSequence,
        sequenceWeights: currentEvent.sequenceWeights,
        nextLetter: nextMouthEvent(phraseIndex)?.letter ?? "",
      }
      : {};
    audio.sustain(voiceSlot(index), mouth, {
      velocity: 0.88,
      globals: { ...audioGlobals(state, index), ...contextual },
    });
    flashLevels[index] = 0.85;
  }

  function release(index = state.selectedMouth) {
    if (audioOn && index >= 0) audio.release(voiceSlot(index));
  }

  function compilePhrase() {
    phrase = compileWheelWord(state.word, state);
    return phrase;
  }

  function nextMouthEvent(startIndex) {
    if (!phrase.events?.length) return null;
    for (let offset = 1; offset <= phrase.events.length; offset += 1) {
      const event = phrase.events[(startIndex + offset) % phrase.events.length];
      if ((event.type === "mouth" || event.type === "missing") && !event.silent) return event;
    }
    return null;
  }

  function phraseContextForMouth(mouthIndex) {
    const eventIndex = phrase.events?.findIndex((event) => (
      event.type !== "space" && event.mouthIndex === mouthIndex
    )) ?? -1;
    const event = eventIndex >= 0 ? phrase.events[eventIndex] : null;
    const next = eventIndex >= 0 ? nextMouthEvent(eventIndex) : null;
    return {
      eventIndex,
      event,
      globals: event ? {
        articulation: event.articulation,
        articulationSequence: event.articulationSequence,
        carrierLetter: event.carrierLetter,
        carrierSequence: event.carrierSequence,
        sequenceWeights: event.sequenceWeights,
        nextLetter: next?.letter ?? "",
      } : {},
    };
  }

  function rebuildWordAnatomy(word, { draft = null, shouldAnnounce = true } = {}) {
    if (spin.locked) {
      if (shouldAnnounce) announce("The letter wheel is locked until the winning organ fades.");
      return state;
    }
    state = updatedWheelState(wheelStateForWord(word, state), state);
    state.running = false;
    applyPresetMouths(presetForId(activePreset));
    state.selectedMouth = state.mouths.length > 0
      ? Math.max(0, Math.min(state.selectedMouth, state.mouths.length - 1))
      : -1;
    flashLevels = Array(state.mouths.length).fill(0);
    currentMouth = -1;
    currentCharacter = "";
    currentEvent = null;
    phraseIndex = -1;
    spin = createWheelSpinState({
      mouthCount: state.mouths.length,
      rotation: spin.rotation,
      seed: spin.rngState,
      spinNumber: spin.spinNumber,
    });
    layoutDirty = true;
    compilePhrase();
    buildMouthButtons();
    syncGlobalControls();
    const input = byId(doc, "wordInput");
    if (input && draft !== null) input.value = draft;
    syncAudio();
    if (shouldAnnounce) {
      announce(state.mouths.length > 0
        ? `${state.word} formed a wheel of ${state.mouths.length} letter-mouths. Ready to spin.`
        : "The wheel is empty. Type a letter to grow a mouth.");
    }
    return state;
  }

  function mapWord(shouldAnnounce = true) {
    if (spin.locked) {
      if (shouldAnnounce) announce("The letter wheel is locked until the winning organ fades.");
      return state;
    }
    const input = byId(doc, "wordInput");
    const word = normalizeWheelWord(input?.value ?? state.word);
    return rebuildWordAnatomy(word, { shouldAnnounce });
  }

  function crossingDuration(angularVelocity) {
    const speed = Math.max(0.18, Math.abs(Number(angularVelocity) || 0));
    const slotTime = TAU / Math.max(1, state.mouths.length) / speed;
    return clamp(slotTime * (0.38 + mouthOverlap * 0.7), 0.035, 0.38, 0.08);
  }

  function singCrossing(crossing) {
    const mouthIndex = crossing.mouthIndex;
    const mouth = state.mouths[mouthIndex];
    if (!mouth) return;
    const contextual = phraseContextForMouth(mouthIndex);
    phraseIndex = contextual.eventIndex;
    currentEvent = contextual.event;
    currentMouth = mouthIndex;
    currentCharacter = mouth.letter;
    flashLevels[mouthIndex] = 1;
    readerFlash = 1;

    if (crossing.isFinal) {
      if (audioOn && mouth.active) {
        audio.releaseAll();
        audio.sustain(voiceSlot(mouthIndex), mouth, {
          velocity: 0.98,
          globals: { ...audioGlobals(state, mouthIndex), ...contextual.globals },
        });
      }
      announce(audioOn
        ? `${mouth.letter} is the winning organ. Holding, then fading.`
        : `${mouth.letter} reached the reader silently. Holding, then fading.`);
    } else if (audioOn && mouth.active) {
      const duration = crossingDuration(crossing.angularVelocity);
      const speedRatio = Math.abs(crossing.angularVelocity)
        / Math.max(0.01, spin.peakAngularVelocity);
      audio.articulate(voiceSlot(mouthIndex), mouth, {
        duration,
        durationSeconds: duration,
        release: Math.min(0.12, duration * 0.42),
        velocity: clamp(0.58 + Math.sqrt(speedRatio) * 0.38, 0.58, 0.98, 0.8),
        globals: { ...audioGlobals(state, mouthIndex), ...contextual.globals },
      });
    }
    syncMouthButtons();
    syncTransport();
  }

  function setTransport(running = true, shouldAnnounce = true) {
    if (!Boolean(running)) {
      if (shouldAnnounce && spin.locked) {
        announce("The spin cannot be stopped; the winning organ must finish fading.");
      }
      return false;
    }
    if (spin.locked || audio.isDecaying) {
      if (shouldAnnounce) announce("Wait for the winning organ to finish fading before spinning again.");
      return false;
    }
    if (!state.mouths.some((mouth) => mouth.active)) {
      syncTransport();
      if (shouldAnnounce) announce("Give the wheel at least one voiced mouth before spinning.");
      return false;
    }

    const word = normalizeWheelWord(byId(doc, "wordInput")?.value ?? state.word);
    rebuildWordAnatomy(word, { shouldAnnounce: false });
    const activeMouths = state.mouths
      .map((mouth, index) => ({ mouth, index }))
      .filter(({ mouth }) => mouth.active);
    if (activeMouths.length === 0) {
      syncTransport();
      if (shouldAnnounce) announce("Give the wheel at least one voiced mouth before spinning.");
      return false;
    }

    const options = {
      mouthCount: state.mouths.length,
      minimumTurns: spinMinimumTurns(wordRate),
      extraTurns: 2,
    };
    let nextSpin = startWheelSpin(spin, options);
    if (!state.mouths[nextSpin.targetMouthIndex]?.active) {
      const activeTarget = activeMouths[nextSpin.targetMouthIndex % activeMouths.length].index;
      const turns = Math.max(options.minimumTurns, Math.floor(nextSpin.travelRadians / TAU));
      const seededState = { ...spin, rngState: nextSpin.rngState };
      nextSpin = startWheelSpin(seededState, {
        ...options,
        targetMouthIndex: activeTarget,
        turns,
      });
      nextSpin = { ...nextSpin, rngState: seededState.rngState };
    }
    spin = nextSpin;
    state.running = true;
    winnerReleased = false;
    readerFlash = 0;
    phraseIndex = -1;
    currentMouth = -1;
    currentCharacter = "";
    currentEvent = null;
    flashLevels = Array(state.mouths.length).fill(0);
    layoutDirty = true;
    audio.releaseAll();
    syncAudio();
    syncTransport();
    syncMouthButtons();
    if (shouldAnnounce) {
      announce(audioOn
        ? "Wheel spinning. Organs sing only as they cross the 3 o'clock reader."
        : "Wheel spinning silently. Turn Audio on to hear the next reader crossing.");
    }
    return true;
  }

  function setLetter(letter) {
    if (spin.locked) return;
    if (!selectedMouth()) return;
    markPresetCustom();
    state = updatedWheelState(
      assignWheelMouthLetter(state, state.selectedMouth, letter),
      state,
    );
    state.word = normalizeWheelWord(
      replaceMouthLetter(state.word, state.selectedMouth, selectedMouth().letter),
    );
    const input = byId(doc, "wordInput");
    if (input) input.value = state.word;
    compilePhrase();
    buildMouthButtons();
    syncSelectedControls();
    syncAudio();
    announce(`Mouth ${state.selectedMouth + 1} now sings ${selectedMouth().letter}.`);
  }

  function setMouthActive(active) {
    if (spin.locked) return;
    if (!selectedMouth()) return;
    markPresetCustom();
    const nextActive = active === undefined ? !selectedMouth().active : Boolean(active);
    selectedMouth().active = nextActive;
    if (!selectedMouth().active) release(state.selectedMouth);
    syncSelectedControls();
    syncTransport();
    syncAudio();
    announce(`Mouth ${state.selectedMouth + 1} ${selectedMouth().active ? "voiced" : "muted"}.`);
  }

  function mutate() {
    if (spin.locked) return;
    markPresetCustom();
    mutationCount += 1;
    let seed = 0x6d2b79f5 ^ mutationCount * 0x9e3779b9;
    const random = () => {
      seed = Math.floor(seededNoise(seed) * 0xffff_ffff) ^ 0x85ebca6b;
      return seededNoise(seed);
    };
    state.mouths.forEach((mouth, index) => {
      mouth.pull = clamp(0.08 + random() * 0.82);
      mouth.tongue = clamp(0.06 + random() * 0.88);
      mouth.aperture = clamp(0.22 + random() * 0.75);
      mouth.glottalTension = clamp(0.28 + random() * 0.68);
      mouth.breath = clamp(0.05 + random() * 0.62);
      mouth.pinch = clamp(0.04 + random() * 0.84);
      mouth.push = clamp(0.06 + random() * 0.82);
      mouth.nasality = clamp(0.36 + random() * 0.64);
      mouth.screech = clamp(0.12 + random() * 0.78);
      mouth.size = clamp(
        WHEEL_MORPH_LIMITS.size.minimum
          + random() * (WHEEL_MORPH_LIMITS.size.maximum - WHEEL_MORPH_LIMITS.size.minimum),
        WHEEL_MORPH_LIMITS.size.minimum,
        WHEEL_MORPH_LIMITS.size.maximum,
        WHEEL_MORPH_LIMITS.size.default,
      );
      mouth.stretch = clamp(
        WHEEL_MORPH_LIMITS.stretch.minimum
          + random() * (WHEEL_MORPH_LIMITS.stretch.maximum - WHEEL_MORPH_LIMITS.stretch.minimum),
        WHEEL_MORPH_LIMITS.stretch.minimum,
        WHEEL_MORPH_LIMITS.stretch.maximum,
        WHEEL_MORPH_LIMITS.stretch.default,
      );
      mouth.tongueOut = clamp(random() * 0.9);
      mouth.interval = Math.round((random() * 14 - 5) / 2) * 2;
      mouth.active = random() > 0.08 || index === 0;
    });
    state.growl = clamp(0.22 + random() * 0.68);
    state.slime = clamp(0.38 + random() * 0.62);
    state.dirt = clamp(0.28 + random() * 0.72);
    state.depth = clamp(0.46 + random() * 0.54);
    layoutDirty = true;
    syncGlobalControls();
    syncAudio();
    announce("The vocal anatomy mutated.");
  }

  function reset() {
    state.running = false;
    audio.releaseAll();
    state = createWheelState();
    state.rootMidi = DEFAULT_ROOT_MIDI;
    state.vibrato = DEFAULT_VIBRATO;
    state.growl = DEFAULT_GROWL;
    state.spread = DEFAULT_SPREAD;
    state.slime = DEFAULT_SLIME;
    state.dirt = DEFAULT_DIRT;
    state.depth = DEFAULT_DEPTH;
    state.running = false;
    state.selectedMouth = 0;
    wordRate = DEFAULT_RATE;
    mouthOverlap = DEFAULT_OVERLAP;
    outputLevel = DEFAULT_LEVEL;
    phraseIndex = -1;
    currentMouth = -1;
    currentCharacter = "";
    currentEvent = null;
    activePreset = "clear";
    phrase = compileWheelWord(state.word, state);
    spin = createWheelSpinState({ mouthCount: state.mouths.length });
    readerFlash = 0;
    winnerReleased = false;
    flashLevels = Array(state.mouths.length).fill(0);
    layoutDirty = true;
    audio.setLevel(outputLevel);
    buildMouthButtons();
    applyPreset("clear", false);
    announce("Wheel of Organs reset.");
  }

  function bindControls() {
    byId(doc, "audioButton")?.addEventListener("click", toggleAudio);
    byId(doc, "transportButton")?.addEventListener("click", () => setTransport());
    byId(doc, "mapWordButton")?.addEventListener("click", () => mapWord());
    byId(doc, "petalActive")?.addEventListener("click", () => setMouthActive());
    byId(doc, "auditionMouth")?.addEventListener("click", () => audition());
    byId(doc, "mutateButton")?.addEventListener("click", mutate);
    for (const preset of WHEEL_ORGAN_PRESETS) {
      byId(doc, preset.buttonId)?.addEventListener("click", () => applyPreset(preset.id));
    }
    for (const button of doc.querySelectorAll("[data-reset-all]")) {
      button.addEventListener("click", reset);
    }

    const word = byId(doc, "wordInput");
    word?.addEventListener("input", () => {
      if (spin.locked) return;
      const editable = editableWheelWord(word.value);
      if (word.value !== editable) word.value = editable;
      rebuildWordAnatomy(normalizeWheelWord(editable), {
        draft: editable,
        shouldAnnounce: false,
      });
    });
    word?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      mapWord();
    });

    const level = byId(doc, "level");
    level?.addEventListener("input", () => {
      outputLevel = Number(level.value);
      audio.setLevel(outputLevel);
      const output = byId(doc, "levelOut");
      if (output) output.textContent = percent(outputLevel);
    });

    const root = byId(doc, "rootNote");
    root?.addEventListener("input", () => {
      markPresetCustom();
      state.rootMidi = Number(root.value);
      const output = byId(doc, "rootNoteOut");
      if (output) output.textContent = noteName(state.rootMidi);
      syncAudio();
    });

    const rate = byId(doc, "pulseRate");
    rate?.addEventListener("input", () => {
      markPresetCustom();
      wordRate = Number(rate.value);
      const output = byId(doc, "pulseRateOut");
      if (output) output.textContent = spinForceLabel(wordRate);
    });

    const overlap = byId(doc, "legato");
    overlap?.addEventListener("input", () => {
      markPresetCustom();
      mouthOverlap = clamp(overlap.value, 0, 1, DEFAULT_OVERLAP);
      const output = byId(doc, "legatoOut");
      if (output) output.textContent = percent(mouthOverlap);
    });

    for (const [id, property] of [
      ["centerA", "vibrato"],
      ["centerB", "growl"],
      ["slime", "slime"],
      ["dirt", "dirt"],
      ["depth", "depth"],
      ["spread", "spread"],
    ]) {
      const input = byId(doc, id);
      input?.addEventListener("input", () => {
        markPresetCustom();
        state[property] = Number(input.value);
        const output = byId(doc, `${id}Out`);
        if (output) output.textContent = percent(state[property]);
        syncAudio();
      });
    }

    for (const [id, property] of [
      ["pull", "pull"],
      ["aperture", "aperture"],
      ["tongue", "tongue"],
      ["glottis", "glottalTension"],
      ["emphasis", "breath"],
      ["pinch", "pinch"],
      ["push", "push"],
      ["nasality", "nasality"],
      ["screech", "screech"],
      ["mouthSize", "size"],
      ["stretch", "stretch"],
      ["tongueOut", "tongueOut"],
    ]) {
      const input = byId(doc, id);
      input?.addEventListener("input", () => {
        const mouth = selectedMouth();
        if (!mouth) return;
        markPresetCustom();
        mouth[property] = Number(input.value);
        const output = byId(doc, `${id}Out`);
        if (output) {
          output.textContent = ["size", "stretch"].includes(property)
            ? morphScale(mouth[property])
            : percent(mouth[property]);
        }
        if (["pull", "size", "stretch"].includes(property)) layoutDirty = true;
        syncAudio();
      });
    }

    byId(doc, "mouthLetter")?.addEventListener("change", (event) => {
      setLetter(event.currentTarget.value);
    });
  }

  function rebuildLayout() {
    const size = Math.min(cssWidth, cssHeight);
    layout = wheelMouthLayout(cssWidth, cssHeight, state, {
      rotation: spin.rotation,
      centerX: cssWidth * 0.5,
      centerY: cssHeight * (cssWidth < 650 ? 0.55 : 0.52),
      coreRadius: size * 0.085,
      innerRadius: size * 0.255,
      outerRadius: size * 0.385,
      radialRadius: size * (state.mouths.length > 10 ? 0.09 : state.mouths.length > 8 ? 0.105 : 0.125),
      tangentialRadius: size * (state.mouths.length > 10 ? 0.057 : state.mouths.length > 8 ? 0.068 : 0.082),
    });
    layoutDirty = false;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    const nextRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (
      nextWidth !== cssWidth
      || nextHeight !== cssHeight
      || nextRatio !== pixelRatio
    ) {
      cssWidth = nextWidth;
      cssHeight = nextHeight;
      pixelRatio = nextRatio;
      canvas.width = Math.round(cssWidth * pixelRatio);
      canvas.height = Math.round(cssHeight * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      layoutDirty = true;
    }
    if (layoutDirty) rebuildLayout();
  }

  function updateTime(time, delta) {
    flashLevels = flashLevels.map((value) => Math.max(0, value - delta * 2.2));
    readerFlash = Math.max(0, readerFlash - delta * 3.8);
    if (!state.running) return;

    const previousPhase = spin.phase;
    const previousRotation = spin.rotation;
    const advanced = stepWheelSpin(spin, delta);
    spin = advanced.state;
    if (spin.rotation !== previousRotation) layoutDirty = true;
    for (const crossing of advanced.events) singCrossing(crossing);

    if (previousPhase !== spin.phase) {
      if (spin.phase === WHEEL_SPIN_PHASES.decaying && !winnerReleased) {
        winnerReleased = true;
        if (audioOn && currentMouth >= 0) {
          audio.release(voiceSlot(currentMouth), { release: spin.decaySeconds });
        }
        announce(`${currentCharacter || "The winning organ"} is fading away.`);
      }
      if (spin.phase === WHEEL_SPIN_PHASES.idle) {
        state.running = false;
        winnerReleased = false;
        currentMouth = -1;
        currentCharacter = "";
        currentEvent = null;
        phraseIndex = -1;
        readerFlash = 0;
        announce("The wheel is quiet, still, and ready for another spin.");
      }
      syncTransport();
      syncMouthButtons();
    }
    if (currentMouth >= 0) {
      if (spin.phase === WHEEL_SPIN_PHASES.sustaining) readerFlash = 1;
      if (spin.phase === WHEEL_SPIN_PHASES.decaying) {
        readerFlash = Math.max(readerFlash, spin.finalEnvelope);
      }
      flashLevels[currentMouth] = Math.max(
        flashLevels[currentMouth],
        spin.phase === WHEEL_SPIN_PHASES.decaying
          ? spin.finalEnvelope
          : 0.34 + Math.sin(time * 0.018) * 0.08,
      );
    }
  }

  function draw(time) {
    resize();
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const phase = spin.phase === WHEEL_SPIN_PHASES.sustaining
      ? clamp(spin.phaseElapsedSeconds / Math.max(0.001, spin.sustainSeconds))
      : spin.progress;
    for (const mouth of layout.mouths) {
      drawNerve(
        ctx,
        layout,
        mouth,
        state.mouths[mouth.index],
        flashLevels[mouth.index] ?? 0,
        mouth.index === currentMouth,
      );
    }
    for (const mouth of layout.mouths) {
      drawMouth(
        ctx,
        mouth,
        state.mouths[mouth.index],
        mouth.index === state.selectedMouth,
        mouth.index === currentMouth,
        flashLevels[mouth.index] ?? 0,
        time,
      );
    }
    drawCore(ctx, layout, state, currentMouth, currentCharacter, phase);
    drawOrganReader(
      ctx,
      layout,
      readerFlash,
      spin.phase === WHEEL_SPIN_PHASES.sustaining
        || spin.phase === WHEEL_SPIN_PHASES.decaying,
    );
    const readout = byId(doc, "stageReadout");
    if (readout) {
      const status = spinStatusLabel(
        spin,
        currentCharacter,
        state.mouths.filter((mouth) => mouth.active).length,
      );
      readout.textContent = `${state.mouths.length} mouths · ${state.word || "—"} · ${status}`;
    }
  }

  function loop(time) {
    const delta = lastTime ? Math.min(0.05, Math.max(0, (time - lastTime) / 1000)) : 0;
    lastTime = time;
    updateTime(time, delta);
    draw(time);
    frame = globalThis.requestAnimationFrame(loop);
  }

  function pointerDown(event) {
    const point = canvasPoint(canvas, event);
    if (
      !drag
      && Math.hypot(point.x - layout.centerX, point.y - layout.centerY) <= layout.coreRadius * 1.12
    ) {
      event.preventDefault();
      setTransport();
      return;
    }
    const index = hitTestWheelMouth(point, layout, 11);
    if (index === null) return;
    event.preventDefault();
    activePointers.set(event.pointerId, { ...point, index });
    canvas.setPointerCapture?.(event.pointerId);

    if (drag && drag.pointerId !== event.pointerId) {
      const first = activePointers.get(drag.pointerId);
      if (first && index === drag.index) {
        const mouth = state.mouths[index];
        const capturedMouth = layout.mouths[index];
        pinchGesture = {
          index,
          pointerIds: [drag.pointerId, event.pointerId],
          startDistance: Math.max(12, Math.hypot(point.x - first.x, point.y - first.y)),
          startCenterX: (point.x + first.x) / 2,
          startCenterY: (point.y + first.y) / 2,
          start: mouthMorphSnapshot(mouth),
          radialX: Math.cos(capturedMouth.angle),
          radialY: Math.sin(capturedMouth.angle),
          radialSpan: Math.max(1, layout.outerRadius - layout.innerRadius),
          tangentialSpan: Math.max(1, capturedMouth.tangentialRadius * 1.35),
        };
        drag.moved = true;
        canvas.classList.add("is-dragging", "is-pinching");
      }
      return;
    }

    setSelected(index, false);
    const layoutMouth = layout.mouths[index];
    const radialX = Math.cos(layoutMouth.angle);
    const radialY = Math.sin(layoutMouth.angle);
    const localRadial = (point.x - layoutMouth.centerX) * radialX
      + (point.y - layoutMouth.centerY) * radialY;
    const localTangential = -(point.x - layoutMouth.centerX) * radialY
      + (point.y - layoutMouth.centerY) * radialX;
    const tongueZone = localRadial > -layoutMouth.radialRadius * 0.08
      && Math.abs(localTangential) < layoutMouth.tangentialRadius * 0.62;
    drag = {
      pointerId: event.pointerId,
      index,
      startX: point.x,
      startY: point.y,
      startProjected: (point.x - layout.centerX) * radialX
        + (point.y - layout.centerY) * radialY,
      startLateral: -(point.x - layout.centerX) * radialY
        + (point.y - layout.centerY) * radialX,
      radialX,
      radialY,
      radialSpan: Math.max(1, layout.outerRadius - layout.innerRadius),
      tangentialSpan: Math.max(1, layoutMouth.tangentialRadius * 1.35),
      mouthId: state.mouths[index]?.id,
      start: mouthMorphSnapshot(state.mouths[index]),
      // Capture the modifier at pointer-down so crossing the opening or
      // releasing a key mid-gesture cannot silently change morph modes.
      mode: event.shiftKey ? "pinch" : event.altKey ? "stretch" : tongueZone ? "tongue" : "body",
      moved: false,
    };
    canvas.classList.add("is-dragging");
    if (audioOn && !spin.locked) sustain(index);
  }

  function pointerMove(event) {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    const point = canvasPoint(canvas, event);
    const stored = activePointers.get(event.pointerId);
    activePointers.set(event.pointerId, { ...stored, ...point });

    if (pinchGesture?.pointerIds.includes(event.pointerId)) {
      const [first, second] = pinchGesture.pointerIds.map((pointerId) => activePointers.get(pointerId));
      if (!first || !second) return;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const scaleDelta = Math.log2(Math.max(0.12, distance / pinchGesture.startDistance)) * 1.45;
      const mouth = state.mouths[pinchGesture.index];
      const radialX = pinchGesture.radialX;
      const radialY = pinchGesture.radialY;
      const centerX = (first.x + second.x) / 2;
      const centerY = (first.y + second.y) / 2;
      const centerDeltaX = centerX - pinchGesture.startCenterX;
      const centerDeltaY = centerY - pinchGesture.startCenterY;
      const radialTravel = clamp(
        (centerDeltaX * radialX + centerDeltaY * radialY)
          / pinchGesture.radialSpan,
        -3,
        3,
        0,
      );
      const tangentialTravel = clamp(
        (-centerDeltaX * radialY + centerDeltaY * radialX)
          / pinchGesture.tangentialSpan,
        -3,
        3,
        0,
      );
      const start = pinchGesture.start;
      markPresetCustom();
      const opening = Math.max(0, scaleDelta);
      const crushing = Math.max(0, -scaleDelta);
      mouth.size = clamp(
        start.size + scaleDelta * 1.05,
        WHEEL_MORPH_LIMITS.size.minimum,
        WHEEL_MORPH_LIMITS.size.maximum,
        start.size,
      );
      mouth.stretch = clamp(
        start.stretch + opening * 0.48 + radialTravel * 0.72,
        WHEEL_MORPH_LIMITS.stretch.minimum,
        WHEEL_MORPH_LIMITS.stretch.maximum,
        start.stretch,
      );
      mouth.pull = clamp(start.pull + radialTravel * 0.72);
      mouth.aperture = clamp(start.aperture + opening * 0.34 - crushing * 0.62, 0.04, 1, start.aperture);
      mouth.pinch = clamp(start.pinch + crushing * 0.7 - opening * 0.48);
      mouth.push = clamp(start.push + crushing * 0.55 - opening * 0.24);
      mouth.tongue = clamp(start.tongue + tangentialTravel * 0.36);
      mouth.tongueOut = clamp(start.tongueOut + opening * 0.2 + radialTravel * 0.32);
      mouth.nasality = clamp(start.nasality + crushing * 0.32 + Math.abs(tangentialTravel) * 0.12);
      mouth.screech = clamp(start.screech + Math.abs(scaleDelta) * 0.38 + Math.abs(radialTravel) * 0.22);
      mouth.glottalTension = clamp(start.glottalTension + crushing * 0.35 + tangentialTravel * 0.12);
      mouth.breath = clamp(start.breath + Math.abs(scaleDelta) * 0.24 + Math.abs(radialTravel) * 0.12);
      flashLevels[pinchGesture.index] = 0.95;
      layoutDirty = true;
      syncSelectedControls();
      syncAudio();
      sustain(pinchGesture.index);
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4) drag.moved = true;
    const mouth = state.mouths[drag.index];
    const mappedGesture = mapWheelPullGesture(point, layout, drag.index);
    if (!mappedGesture) return;
    markPresetCustom();
    const travel = rawGestureTravel(drag, point);
    const outward = Math.max(0, travel.radial);
    const inward = Math.max(0, -travel.radial);
    const sideways = Math.abs(travel.tangential);
    const start = drag.start;
    const gesture = {
      ...mappedGesture,
      pull: clamp(start.pull + travel.radial * 0.72),
      tongue: clamp(start.tongue + travel.tangential * 0.36),
    };
    if (drag.mode === "tongue") {
      mouth.tongue = gesture.tongue;
      mouth.tongueOut = clamp(start.tongueOut + outward * 0.78 - inward * 0.62);
      mouth.pull = clamp(start.pull + travel.radial * 0.28);
      mouth.aperture = clamp(start.aperture + outward * 0.46 - inward * 0.36, 0.04, 1, start.aperture);
      mouth.pinch = clamp(start.pinch - outward * 0.34 + inward * 0.42 + sideways * 0.1);
      mouth.size = clamp(
        start.size + outward * 0.2 - inward * 0.13,
        WHEEL_MORPH_LIMITS.size.minimum,
        WHEEL_MORPH_LIMITS.size.maximum,
        start.size,
      );
      mouth.stretch = clamp(
        start.stretch + outward * 0.52 - inward * 0.28 + sideways * 0.13,
        WHEEL_MORPH_LIMITS.stretch.minimum,
        WHEEL_MORPH_LIMITS.stretch.maximum,
        start.stretch,
      );
      mouth.nasality = clamp(start.nasality + sideways * 0.2 + inward * 0.12);
      mouth.screech = clamp(start.screech + outward * 0.5 + sideways * 0.24);
      mouth.glottalTension = clamp(start.glottalTension + outward * 0.28 + travel.tangential * 0.16);
      mouth.breath = clamp(start.breath + outward * 0.32 + sideways * 0.16);
    } else if (drag.mode === "stretch") {
      mouth.pull = gesture.pull;
      mouth.stretch = clamp(
        start.stretch + travel.radial * 1.25,
        WHEEL_MORPH_LIMITS.stretch.minimum,
        WHEEL_MORPH_LIMITS.stretch.maximum,
        start.stretch,
      );
      mouth.size = clamp(
        start.size + travel.tangential * 0.82,
        WHEEL_MORPH_LIMITS.size.minimum,
        WHEEL_MORPH_LIMITS.size.maximum,
        start.size,
      );
      mouth.aperture = clamp(start.aperture + travel.radial * 0.24 - travel.tangential * 0.1, 0.04, 1, start.aperture);
      mouth.tongue = gesture.tongue;
      mouth.tongueOut = clamp(start.tongueOut + outward * 0.3 - inward * 0.2);
      mouth.pinch = clamp(start.pinch + inward * 0.22 + Math.max(0, -travel.tangential) * 0.12);
      mouth.push = clamp(start.push + inward * 0.3);
      mouth.nasality = clamp(start.nasality + Math.max(0, -travel.tangential) * 0.18);
      mouth.screech = clamp(start.screech + Math.abs(travel.radial) * 0.3 + sideways * 0.34);
      mouth.glottalTension = clamp(start.glottalTension + travel.tangential * 0.22);
      mouth.breath = clamp(start.breath + Math.abs(travel.radial) * 0.18 + sideways * 0.16);
    } else if (drag.mode === "pinch") {
      const pinchDrive = inward * 0.86 + sideways * 0.74 - outward * 0.62;
      mouth.pull = gesture.pull;
      mouth.tongue = gesture.tongue;
      mouth.pinch = clamp(start.pinch + pinchDrive);
      mouth.aperture = clamp(start.aperture - pinchDrive * 0.82, 0.04, 1, start.aperture);
      mouth.push = clamp(start.push + Math.max(0, pinchDrive) * 0.66 - outward * 0.2);
      mouth.size = clamp(
        start.size - Math.max(0, pinchDrive) * 0.48 + outward * 0.3,
        WHEEL_MORPH_LIMITS.size.minimum,
        WHEEL_MORPH_LIMITS.size.maximum,
        start.size,
      );
      mouth.stretch = clamp(
        start.stretch + sideways * 0.68 + outward * 0.3 - inward * 0.25,
        WHEEL_MORPH_LIMITS.stretch.minimum,
        WHEEL_MORPH_LIMITS.stretch.maximum,
        start.stretch,
      );
      mouth.tongueOut = clamp(start.tongueOut + outward * 0.28 - inward * 0.38);
      mouth.nasality = clamp(start.nasality + Math.max(0, pinchDrive) * 0.4 + sideways * 0.12);
      mouth.screech = clamp(start.screech + Math.abs(pinchDrive) * 0.56 + sideways * 0.14);
      mouth.glottalTension = clamp(start.glottalTension + Math.max(0, pinchDrive) * 0.48);
      mouth.breath = clamp(start.breath + Math.abs(pinchDrive) * 0.28);
    } else {
      // A bare drag is the main performance gesture: pulling beyond the ring
      // blooms a huge, long, tongue-forward screeching organ; driving inward
      // crushes it into a small, pinched, pressurised nasal cavity.
      mouth.pull = gesture.pull;
      mouth.tongue = gesture.tongue;
      mouth.push = clamp(start.push + inward * 0.8 - outward * 0.24);
      mouth.pinch = clamp(start.pinch + inward * 0.66 + sideways * 0.13 - outward * 0.3);
      mouth.aperture = clamp(
        start.aperture + outward * 0.4 + sideways * 0.08 - inward * 0.54,
        0.04,
        1,
        start.aperture,
      );
      mouth.size = clamp(
        start.size + outward * 0.7 + sideways * 0.18 - inward * 0.46,
        WHEEL_MORPH_LIMITS.size.minimum,
        WHEEL_MORPH_LIMITS.size.maximum,
        start.size,
      );
      mouth.stretch = clamp(
        start.stretch + outward * 0.94 + sideways * 0.16 - inward * 0.4,
        WHEEL_MORPH_LIMITS.stretch.minimum,
        WHEEL_MORPH_LIMITS.stretch.maximum,
        start.stretch,
      );
      mouth.tongueOut = clamp(start.tongueOut + outward * 0.5 + sideways * 0.12 - inward * 0.44);
      mouth.nasality = clamp(start.nasality + inward * 0.4 + sideways * 0.15 - outward * 0.12);
      mouth.screech = clamp(start.screech + outward * 0.48 + sideways * 0.32 + inward * 0.12);
      mouth.glottalTension = clamp(
        start.glottalTension + outward * 0.3 + inward * 0.18 + travel.tangential * 0.16,
      );
      mouth.breath = clamp(start.breath + Math.max(outward, inward) * 0.28 + sideways * 0.18);
      if (event.pointerType === "pen" && event.pressure > 0.05) {
        mouth.push = Math.max(mouth.push, clamp(event.pressure));
      }
    }
    flashLevels[drag.index] = 0.9;
    layoutDirty = true;
    syncSelectedControls();
    syncAudio();
    sustain(drag.index);
  }

  function pointerUp(event) {
    if (!activePointers.has(event.pointerId)) return;
    activePointers.delete(event.pointerId);

    if (pinchGesture?.pointerIds.includes(event.pointerId)) {
      const index = pinchGesture.index;
      for (const pointerId of pinchGesture.pointerIds) {
        try { canvas.releasePointerCapture?.(pointerId); } catch { /* capture may already be gone */ }
      }
      activePointers.clear();
      pinchGesture = null;
      drag = null;
      canvas.classList.remove("is-dragging", "is-pinching");
      if (audioOn) release(index);
      return;
    }

    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.classList.remove("is-dragging");
    if (event.type === "pointercancel") {
      if (audioOn) release(finished.index);
      return;
    }
    if (finished.moved) {
      if (audioOn) release(finished.index);
      return;
    }
    audition(finished.index, 0.72);
  }

  function keydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName?.toLowerCase?.();
    if (["input", "select", "textarea", "button"].includes(tag)) return;
    if (event.code === "Space") {
      event.preventDefault();
      setTransport();
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index >= state.mouths.length) return;
      event.preventDefault();
      setSelected(index);
      audition(index);
      return;
    }
    if (/^[a-z]$/i.test(event.key)) {
      const letter = event.key.toUpperCase();
      const index = state.mouths.findIndex((mouth) => mouth.letter === letter);
      if (index < 0) return;
      event.preventDefault();
      setSelected(index);
      audition(index);
    }
  }

  buildLetterOptions();
  buildMouthButtons();
  bindControls();
  applyPreset("clear", false);
  syncAudioButton();
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  doc.addEventListener("keydown", keydown);
  frame = globalThis.requestAnimationFrame(loop);

  const dispose = () => {
    globalThis.cancelAnimationFrame?.(frame);
    doc.removeEventListener("keydown", keydown);
    audio.close();
  };
  globalThis.addEventListener?.("pagehide", dispose, { once: true });

  return Object.freeze({
    canvas,
    audio,
    get state() { return state; },
    get spin() { return spin; },
    get activePreset() { return activePreset; },
    get phrase() { return phrase; },
    get layout() { return layout; },
    mapWord,
    applyPreset,
    reset,
    setSelected,
    setTransport,
    audition,
    dispose,
    vocalParameters(index = state.selectedMouth) {
      return wheelVocalParameters(state.mouths[index], audioGlobals(state));
    },
  });
}
