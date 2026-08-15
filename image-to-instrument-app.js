import { VoicePool } from "./src/audio.js";
import { mountWheelOfOrgans } from "./wheel-of-organs-app.js";
import {
  PETAL_COUNT,
  advanceSequencerStep,
  clamp,
  createChoirVoiceSpecs,
  createDefaultImageInstrumentState,
  createRouterStrikeSpecs,
  createSequencerStepStrikeSpecs,
  hitTestRadialPetal,
  mapPetalGesture,
  midiToFrequency,
  radialPetalLayout,
  sequencerStepDurationSeconds,
} from "./src/image-to-instrument.js";

const TAU = Math.PI * 2;
const NOTE_NAMES = Object.freeze(["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"]);
const VARIANTS = Object.freeze({
  1: Object.freeze({
    slug: "radial-choir",
    activeLabel: "voice active",
    inactiveLabel: "voice muted",
    runningLabel: "orbiting",
    stoppedLabel: "held",
    transportOn: "hold the pressure",
    transportOff: "orbit the pressure",
  }),
  2: Object.freeze({
    slug: "signal-router",
    activeLabel: "gate open",
    inactiveLabel: "gate closed",
    runningLabel: "routing",
    stoppedLabel: "waiting",
    transportOn: "hold signal",
    transportOff: "send continuous pulse",
  }),
  3: Object.freeze({
    slug: "mouthwheel-sequencer",
    activeLabel: "step active",
    inactiveLabel: "step silent",
    runningLabel: "playing",
    stoppedLabel: "stopped",
    transportOn: "stop mouthwheel",
    transportOff: "start mouthwheel",
  }),
});
const PAGE_DEFAULTS = Object.freeze({
  1: Object.freeze({ rootMidi: 48, centerA: 0.44, centerB: 0.31, spread: 0.86 }),
  2: Object.freeze({ rootMidi: 43, centerA: 0.28, centerB: 0.56, spread: 0.92 }),
  3: Object.freeze({ rootMidi: 36, centerA: 0.18, centerB: 0.38, spread: 0.78 }),
});

function elementById(doc, id) {
  return doc.getElementById(id);
}

function noteName(midi) {
  const note = Math.round(Number(midi) || 0);
  return `${NOTE_NAMES[((note % 12) + 12) % 12]}${Math.floor(note / 12) - 1}`;
}

function percent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function rateToNormalized(variant, value) {
  if (variant === 1) return clamp((value - 0.04) / 1.16);
  if (variant === 2) return clamp((value - 0.2) / 3.8);
  return clamp((value - 48) / 172);
}

function formatRate(variant, value) {
  if (variant === 3) return `${Math.round(value)} bpm`;
  return `${Number(value).toFixed(variant === 1 ? 2 : 2)} Hz`;
}

function xorshift(seed) {
  let value = (seed || 1) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(Math.abs(width) / 2, Math.abs(height) / 2, Math.max(0, radius));
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

function ellipsePoint(petal, radial, tangential) {
  const cosine = Math.cos(petal.angle);
  const sine = Math.sin(petal.angle);
  return {
    x: petal.centerX
      + cosine * radial * petal.radialRadius
      - sine * tangential * petal.tangentialRadius,
    y: petal.centerY
      + sine * radial * petal.radialRadius
      + cosine * tangential * petal.tangentialRadius,
  };
}

function canvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (canvas.clientWidth / Math.max(1, rect.width)),
    y: (event.clientY - rect.top) * (canvas.clientHeight / Math.max(1, rect.height)),
  };
}

function centerDistance(point, layout) {
  return Math.hypot(point.x - layout.centerX, point.y - layout.centerY);
}

function routeGatePoint(layout, petal) {
  const amount = 0.43;
  return {
    x: layout.centerX + (petal.centerX - layout.centerX) * amount,
    y: layout.centerY + (petal.centerY - layout.centerY) * amount,
  };
}

function hitRouteGate(point, layout) {
  const radius = Math.max(11, layout.coreRadius * 0.18);
  for (const petal of layout.petals) {
    const gate = routeGatePoint(layout, petal);
    if (Math.hypot(point.x - gate.x, point.y - gate.y) <= radius) return petal.index;
  }
  return null;
}

function drawFuzzyOutline(ctx, petal, index, activity) {
  const spines = 34;
  const glow = 0.12 + activity * 0.25;
  ctx.save();
  ctx.translate(petal.centerX, petal.centerY);
  ctx.rotate(petal.angle);
  ctx.lineWidth = 0.65;
  ctx.strokeStyle = `rgba(255, 89, 164, ${glow})`;
  for (let step = 0; step < spines; step += 1) {
    const angle = step / spines * TAU;
    const randomish = 0.75 + 0.25 * Math.sin(step * 4.7 + index * 2.1);
    const x = Math.cos(angle) * petal.radialRadius;
    const y = Math.sin(angle) * petal.tangentialRadius;
    const outer = 2.5 + 5 * randomish + activity * 3;
    const normalX = Math.cos(angle);
    const normalY = Math.sin(angle);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + normalX * outer, y + normalY * outer);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTube(ctx, layout, petal, data, variant, phase, activeStep) {
  const cosine = Math.cos(petal.angle);
  const sine = Math.sin(petal.angle);
  const startRadius = layout.coreRadius * (variant === 3 ? 1.08 : 0.78);
  const endRadius = layout.ringRadius - petal.radialRadius * 0.72;
  const startX = layout.centerX + cosine * startRadius;
  const startY = layout.centerY + sine * startRadius;
  const endX = layout.centerX + cosine * endRadius;
  const endY = layout.centerY + sine * endRadius;
  const bend = (data.tongue - 0.5) * petal.tangentialRadius * 0.44;
  const normalX = -sine;
  const normalY = cosine;
  const midX = (startX + endX) / 2 + normalX * bend;
  const midY = (startY + endY) / 2 + normalY * bend;
  const isCurrent = activeStep === petal.index;
  const active = data.active;

  ctx.save();
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.quadraticCurveTo(midX, midY, endX, endY);
  ctx.lineWidth = variant === 2 ? 13 : 10;
  ctx.strokeStyle = variant === 2 ? "rgba(10, 13, 13, 0.98)" : "rgba(25, 10, 24, 0.96)";
  ctx.stroke();
  ctx.lineWidth = variant === 2 ? 3.2 : 2.5;
  ctx.strokeStyle = active ? "rgba(135, 255, 68, 0.72)" : "rgba(66, 77, 67, 0.48)";
  ctx.shadowBlur = active ? 9 + (isCurrent ? 8 : 0) : 0;
  ctx.shadowColor = "#8dff46";
  ctx.stroke();

  if (active && (variant === 2 || variant === 3 || isCurrent)) {
    const pulsePhase = variant === 2
      ? clamp(phase)
      : variant === 3 ? 0.88 : 0.45 + 0.2 * Math.sin(phase * TAU + petal.index);
    const oneMinus = 1 - pulsePhase;
    const pulseX = oneMinus * oneMinus * startX + 2 * oneMinus * pulsePhase * midX + pulsePhase * pulsePhase * endX;
    const pulseY = oneMinus * oneMinus * startY + 2 * oneMinus * pulsePhase * midY + pulsePhase * pulsePhase * endY;
    ctx.beginPath();
    ctx.arc(pulseX, pulseY, isCurrent ? 5.2 : 3.8, 0, TAU);
    ctx.fillStyle = "#c9ff7a";
    ctx.shadowBlur = 18;
    ctx.fill();
  }
  ctx.restore();
}

function drawGate(ctx, layout, petal, data, selected, pulse) {
  const point = routeGatePoint(layout, petal);
  const radius = Math.max(8, layout.coreRadius * 0.13);
  ctx.save();
  ctx.shadowBlur = data.active ? 12 + pulse * 10 : 0;
  ctx.shadowColor = data.active ? "#ff315b" : "transparent";
  ctx.fillStyle = "#111516";
  ctx.strokeStyle = selected ? "#ecf4ef" : "#89918f";
  ctx.lineWidth = selected ? 2 : 1;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius + 3, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = data.active ? "#ff315b" : "#35131b";
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * 0.57, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawPetal(ctx, petal, data, variant, selected, activity, current) {
  drawFuzzyOutline(ctx, petal, petal.index, activity);
  ctx.save();
  ctx.translate(petal.centerX, petal.centerY);
  ctx.rotate(petal.angle);

  const width = petal.radialRadius * 2;
  const height = petal.tangentialRadius * 2;
  const body = ctx.createRadialGradient(
    -petal.radialRadius * 0.3,
    -petal.tangentialRadius * 0.34,
    2,
    0,
    0,
    petal.radialRadius * 1.25,
  );
  body.addColorStop(0, data.active ? "#ff8b8a" : "#74434d");
  body.addColorStop(0.5, data.active ? "#d52972" : "#4a2738");
  body.addColorStop(1, variant === 2 ? "#541a64" : "#2e123d");
  ctx.fillStyle = body;
  ctx.strokeStyle = selected ? "#fff2e8" : current ? "#c7ff78" : "rgba(255, 127, 171, 0.54)";
  ctx.lineWidth = selected ? 2.6 : current ? 2.2 : 1.1;
  ctx.shadowBlur = activity * 15 + (current ? 13 : 0);
  ctx.shadowColor = current ? "#a9ff57" : "#ff4e9e";
  ctx.beginPath();
  ctx.ellipse(0, 0, petal.radialRadius, petal.tangentialRadius, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  const holes = 11;
  ctx.fillStyle = "rgba(42, 9, 35, 0.55)";
  for (let hole = 0; hole < holes; hole += 1) {
    const a = (hole / holes) * TAU + petal.index * 0.53;
    const radiusX = petal.radialRadius * (0.67 + 0.12 * Math.sin(hole * 2.4));
    const radiusY = petal.tangentialRadius * (0.68 + 0.08 * Math.cos(hole * 1.8));
    const x = Math.cos(a) * radiusX;
    const y = Math.sin(a) * radiusY;
    ctx.beginPath();
    ctx.ellipse(x, y, 2.3 + (hole % 3), 1.8 + (hole % 2), a, 0, TAU);
    ctx.fill();
  }

  const mouthWidth = petal.radialRadius * (0.68 + data.aperture * 0.27);
  const mouthHeight = petal.tangentialRadius * (0.17 + data.aperture * 0.58);
  const mouthX = petal.radialRadius * 0.08;
  ctx.fillStyle = "#21040f";
  ctx.strokeStyle = data.active ? "#ff6c9e" : "#77324f";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.ellipse(mouthX, 0, mouthWidth, mouthHeight, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();

  const tongueOffset = (data.tongue - 0.5) * mouthHeight * 0.9;
  const tongueWidth = mouthWidth * (0.38 + data.emphasis * 0.18);
  ctx.fillStyle = data.active ? "#f04783" : "#71334d";
  ctx.beginPath();
  ctx.ellipse(
    mouthX + mouthWidth * 0.04,
    tongueOffset,
    tongueWidth,
    Math.max(2.5, mouthHeight * 0.26),
    (data.tongue - 0.5) * 0.45,
    0,
    TAU,
  );
  ctx.fill();

  if (variant === 3) {
    ctx.fillStyle = data.active ? "#aaff52" : "#26351f";
    ctx.shadowBlur = data.active ? 10 : 0;
    ctx.shadowColor = "#aaff52";
    ctx.beginPath();
    ctx.arc(-petal.radialRadius * 0.58, 0, 4.2, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function drawRosette(ctx, layout, state, variant, currentStep, phase) {
  const { centerX, centerY, coreRadius } = layout;
  ctx.save();
  ctx.translate(centerX, centerY);
  if (variant === 3) ctx.rotate(-Math.PI / 2 + (currentStep + phase) * TAU / PETAL_COUNT);

  ctx.shadowBlur = 22;
  ctx.shadowColor = variant === 2 ? "rgba(92,255,83,.28)" : "rgba(255,60,140,.3)";
  ctx.fillStyle = variant === 2 ? "#090d0d" : "#250619";
  ctx.strokeStyle = variant === 2 ? "#64716d" : "#f24a99";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, coreRadius, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;

  if (variant === 1) {
    const inner = coreRadius * (0.32 + state.centerA * 0.16);
    const outer = coreRadius * (0.68 + state.centerB * 0.14);
    ctx.fillStyle = "#8e0749";
    ctx.strokeStyle = "#ff6fb1";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let index = 0; index < PETAL_COUNT * 2; index += 1) {
      const angle = index / (PETAL_COUNT * 2) * TAU - Math.PI / 2;
      const radius = index % 2 ? inner : outer;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius * 0.18, 0, TAU);
    ctx.fillStyle = "#16020d";
    ctx.fill();
  } else if (variant === 2) {
    const rings = 9;
    for (let ring = rings; ring >= 1; ring -= 1) {
      const amount = ring / rings;
      ctx.beginPath();
      ctx.arc(0, 0, coreRadius * amount * 0.78, 0, TAU);
      ctx.fillStyle = ring % 2 ? "#7b1b6e" : "#c53c87";
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius * 0.16, 0, TAU);
    ctx.fillStyle = "#ff354c";
    ctx.shadowBlur = 15 + 10 * Math.sin(phase * Math.PI);
    ctx.shadowColor = "#ff354c";
    ctx.fill();
  } else {
    ctx.strokeStyle = "#a4aba8";
    ctx.lineWidth = 1.1;
    for (let tooth = 0; tooth < 16; tooth += 1) {
      const angle = tooth / 16 * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * coreRadius * 0.7, Math.sin(angle) * coreRadius * 0.7);
      ctx.lineTo(Math.cos(angle) * coreRadius * 0.9, Math.sin(angle) * coreRadius * 0.9);
      ctx.stroke();
    }
    const arm = coreRadius * 1.28;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(5, coreRadius * 0.09);
    ctx.strokeStyle = "#e7a555";
    ctx.shadowBlur = 12;
    ctx.shadowColor = "#c5ff4e";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(arm, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(arm, 0, Math.max(5, coreRadius * 0.1), 0, TAU);
    ctx.fillStyle = "#c5ff4e";
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, coreRadius * 0.18, 0, TAU);
    ctx.fillStyle = "#c4cbc8";
    ctx.fill();
  }
  ctx.restore();
}

function strikeAll(audio, entries) {
  for (const entry of entries) audio.strike(entry.voice, entry.envelope);
}

export function mountImageToInstrument(doc = globalThis.document) {
  if (!doc?.body) return null;
  const variant = Number(doc.body.dataset.imageInstrument);
  const config = VARIANTS[variant];
  if (!config) return null;
  if (variant === 3) return mountWheelOfOrgans(doc);

  const canvas = elementById(doc, "stage");
  const ctx = canvas?.getContext?.("2d", { alpha: true, desynchronized: true });
  if (!canvas || !ctx) return null;

  const audio = new VoicePool(24);
  let state = createDefaultImageInstrumentState(config.slug);
  Object.assign(state, PAGE_DEFAULTS[variant]);
  state.selectedPetal = 0;
  let audioOn = false;
  let audioStarting = false;
  let cssWidth = 1;
  let cssHeight = 1;
  let pixelRatio = 1;
  let layout = radialPetalLayout(1, 1);
  let frame = 0;
  let lastTime = 0;
  let sequenceAccumulator = 0;
  let sequenceStep = 0;
  let absoluteStep = 0;
  let lastRouterCycle = -1;
  let pulseRateValue = Number(elementById(doc, "pulseRate")?.value) || 1;
  let outputLevel = Number(elementById(doc, "level")?.value) || 0.42;
  let mutateCount = 0;
  let drag = null;
  let flashLevels = Array(PETAL_COUNT).fill(0);
  let ratchetQueue = [];

  const selectedPetal = () => state.petals[state.selectedPetal ?? 0];

  function announce(message) {
    const live = elementById(doc, "liveStatus");
    if (live) live.textContent = message;
  }

  function syncAudioButton() {
    const button = elementById(doc, "audioButton");
    const label = elementById(doc, "audioState");
    button?.setAttribute("aria-pressed", String(audioOn));
    if (button) button.disabled = audioStarting;
    if (label) label.textContent = audioStarting ? "starting" : audioOn ? "on" : "off";
  }

  function syncTransport() {
    const button = elementById(doc, "transportButton");
    const label = button?.querySelector("b");
    const stateLabel = elementById(doc, "transportState");
    button?.setAttribute("aria-pressed", String(state.running));
    if (label) label.textContent = state.running ? config.transportOn : config.transportOff;
    if (stateLabel) stateLabel.textContent = state.running ? config.runningLabel : config.stoppedLabel;
  }

  function syncPetalButtons() {
    const root = elementById(doc, "petalButtons");
    if (!root) return;
    for (const button of root.querySelectorAll("button[data-petal-index]")) {
      const index = Number(button.dataset.petalIndex);
      button.setAttribute("aria-pressed", String(index === state.selectedPetal));
      button.classList.toggle("is-active", Boolean(state.petals[index]?.active));
      button.setAttribute(
        "aria-label",
        `${variant === 2 ? "Route" : variant === 3 ? "Step" : "Mouth"} ${index + 1}, ${state.petals[index]?.active ? "active" : "inactive"}`,
      );
    }
  }

  function syncSelectedControls() {
    const petal = selectedPetal();
    if (!petal) return;
    const selectedOutput = elementById(doc, "selectedPetalOut");
    if (selectedOutput) selectedOutput.textContent = String((state.selectedPetal ?? 0) + 1).padStart(2, "0");
    for (const key of ["aperture", "tongue", "emphasis"]) {
      const input = elementById(doc, key);
      const output = elementById(doc, `${key}Out`);
      const value = variant === 3 && key === "emphasis" ? petal.probability : petal[key];
      if (input) input.value = String(value);
      if (output) output.textContent = percent(value);
    }
    const active = elementById(doc, "petalActive");
    active?.setAttribute("aria-pressed", String(petal.active));
    if (active) active.textContent = petal.active ? config.activeLabel : config.inactiveLabel;
    syncPetalButtons();
  }

  function syncGlobalControls() {
    const assignments = {
      rootNote: state.rootMidi,
      centerA: state.centerA,
      centerB: state.centerB,
      spread: state.spread,
    };
    for (const [id, value] of Object.entries(assignments)) {
      const input = elementById(doc, id);
      if (input) input.value = String(value);
    }
    const rootOutput = elementById(doc, "rootNoteOut");
    if (rootOutput) rootOutput.textContent = noteName(state.rootMidi);
    for (const id of ["centerA", "centerB", "spread"]) {
      const output = elementById(doc, `${id}Out`);
      if (output) output.textContent = percent(state[id]);
    }
    const rate = elementById(doc, "pulseRate");
    if (rate) rate.value = String(pulseRateValue);
    const rateOutput = elementById(doc, "pulseRateOut");
    if (rateOutput) rateOutput.textContent = formatRate(variant, pulseRateValue);
    const level = elementById(doc, "level");
    if (level) level.value = String(outputLevel);
    const levelOutput = elementById(doc, "levelOut");
    if (levelOutput) levelOutput.textContent = percent(outputLevel);
    syncSelectedControls();
    syncTransport();
  }

  function setSelected(index, shouldAnnounce = true) {
    state.selectedPetal = Math.max(0, Math.min(PETAL_COUNT - 1, Number(index) || 0));
    syncSelectedControls();
    if (shouldAnnounce) announce(`${variant === 2 ? "Route" : variant === 3 ? "Step" : "Mouth"} ${state.selectedPetal + 1} selected.`);
  }

  function setPetalActive(index, active = !state.petals[index].active, shouldAnnounce = true) {
    state.petals[index].active = Boolean(active);
    syncSelectedControls();
    if (variant === 1) updateContinuousAudio();
    if (variant === 2 && state.petals[index].active) triggerRouterPulse(index, 0.82);
    if (shouldAnnounce) announce(`${variant === 2 ? "Route" : variant === 3 ? "Step" : "Mouth"} ${index + 1} ${state.petals[index].active ? "active" : "inactive"}.`);
  }

  function updateContinuousAudio() {
    if (!audioOn) return;
    if (variant === 1) {
      audio.setVoices(createChoirVoiceSpecs(state), { mode: "fm" });
    } else if (variant === 2 && state.running) {
      audio.setVoices([{
        key: "image-router-source",
        frequency: midiToFrequency(state.rootMidi - 12),
        gain: 0.055 + state.centerB * 0.035,
        pan: 0,
        waveform: "sine",
        mode: "fm",
        synthDrive: state.centerB * 0.42,
        modulationIndex: state.centerA * 2.1,
        modulationRatio: 0.5 + state.centerB,
      }], { mode: "fm" });
    } else {
      audio.setVoices([], { mode: "fm" });
    }
  }

  function triggerRouterPulse(sourcePetal = state.selectedPetal ?? 0, energy = 1) {
    if (!audioOn) return;
    const entries = createRouterStrikeSpecs(state, {
      sourcePetal,
      energy,
      chance: 0,
    });
    strikeAll(audio, entries);
    for (const entry of entries) flashLevels[entry.routeIndex] = Math.max(flashLevels[entry.routeIndex], energy);
  }

  function queueSequencerStep(step, stepDuration) {
    const petal = state.petals[step];
    const chance = xorshift((absoluteStep + 1) * 0x9e3779b1 + step * 101) / 0xffff_ffff;
    if (!petal.active || chance >= petal.probability) return;
    const ratchets = Math.max(1, petal.ratchets);
    const now = performance.now();
    for (let ratchet = 0; ratchet < ratchets; ratchet += 1) {
      ratchetQueue.push({
        at: now + ratchet * stepDuration * 1000 * 0.56 / ratchets,
        step,
        ratchet,
        duration: stepDuration / ratchets,
      });
    }
  }

  function flushRatchets(now) {
    if (!ratchetQueue.length) return;
    const remaining = [];
    for (const hit of ratchetQueue) {
      if (hit.at > now) {
        remaining.push(hit);
        continue;
      }
      if (audioOn) {
        strikeAll(audio, createSequencerStepStrikeSpecs(state, {
          stepIndex: hit.step,
          ratchetIndex: hit.ratchet,
          durationSeconds: hit.duration,
          velocity: state.petals[hit.step].emphasis,
        }, { chance: 0 }));
      }
      flashLevels[hit.step] = 1;
    }
    ratchetQueue = remaining;
  }

  function triggerSelected() {
    const index = state.selectedPetal ?? 0;
    if (variant === 1) {
      flashLevels[index] = 1;
      const voice = createChoirVoiceSpecs(state)
        .find((candidate) => candidate.key === `image-choir-petal-${index}`);
      if (voice && audioOn) {
        audio.strike({ ...voice, gain: Math.max(0.18, voice.gain) }, {
          attackSeconds: 0.008,
          decaySeconds: 0.18 + state.petals[index].aperture * 0.16,
          attackNoise: state.petals[index].tongue * 0.035,
          retriggerMode: "crossfade",
        });
      }
    } else if (variant === 2) {
      triggerRouterPulse(index, 1);
    } else {
      const tempo = pulseRateValue;
      const duration = sequencerStepDurationSeconds(tempo, state.centerA, absoluteStep);
      queueSequencerStep(index, duration);
    }
  }

  async function toggleAudio() {
    if (audioStarting) return;
    if (audioOn) {
      audioOn = false;
      audio.disable();
      syncAudioButton();
      announce("Audio off.");
      return;
    }
    audioStarting = true;
    syncAudioButton();
    try {
      audio.setLevel(outputLevel);
      await audio.enable();
      audioOn = true;
      updateContinuousAudio();
      announce("Audio on. The organism is ready.");
    } catch (error) {
      audioOn = false;
      announce(error instanceof Error ? error.message : "Audio could not start.");
    } finally {
      audioStarting = false;
      syncAudioButton();
    }
  }

  function setTransport(running = !state.running) {
    state.running = Boolean(running);
    if (variant === 3 && state.running) {
      sequenceAccumulator = 0;
      sequenceStep = state.selectedPetal ?? sequenceStep;
      const duration = sequencerStepDurationSeconds(pulseRateValue, state.centerA, absoluteStep);
      queueSequencerStep(sequenceStep, duration);
    }
    if (variant === 2 && state.running) {
      state.phase = 0;
      lastRouterCycle = 0;
      triggerRouterPulse(state.selectedPetal ?? 0, 1);
    }
    if (!state.running) ratchetQueue = [];
    syncTransport();
    updateContinuousAudio();
    announce(`${variant === 3 ? "Mouthwheel" : variant === 2 ? "Signal" : "Pressure orbit"} ${state.running ? "started" : "stopped"}.`);
  }

  function mutate() {
    mutateCount += 1;
    let seed = xorshift(0x6d2b79f5 ^ (mutateCount * 0x9e3779b9) ^ variant);
    const random = () => {
      seed = xorshift(seed);
      return seed / 0xffff_ffff;
    };
    state.petals.forEach((petal, index) => {
      petal.aperture = clamp(0.18 + random() * 0.78);
      petal.tongue = clamp(0.08 + random() * 0.84);
      petal.emphasis = clamp(0.38 + random() * 0.62);
      petal.interval = Math.round((random() * 24 - 7) / 2) * 2;
      if (variant === 2) petal.active = random() > 0.3;
      if (variant === 3) {
        petal.active = random() > 0.28 || index === 0;
        petal.probability = clamp(0.55 + random() * 0.45);
        petal.ratchets = random() > 0.8 ? 2 + Math.floor(random() * 2) : 1;
      }
    });
    syncSelectedControls();
    updateContinuousAudio();
    announce(`${variant === 3 ? "Pattern" : variant === 2 ? "Routes" : "Colony"} mutated.`);
  }

  function reset() {
    const wasAudioOn = audioOn;
    const defaults = createDefaultImageInstrumentState(config.slug);
    Object.assign(defaults, PAGE_DEFAULTS[variant]);
    defaults.selectedPetal = 0;
    state = defaults;
    pulseRateValue = variant === 1 ? 0.22 : variant === 2 ? 1.2 : 112;
    outputLevel = variant === 1 ? 0.42 : variant === 2 ? 0.44 : 0.46;
    state.rate = rateToNormalized(variant, pulseRateValue);
    sequenceAccumulator = 0;
    sequenceStep = 0;
    absoluteStep = 0;
    ratchetQueue = [];
    flashLevels.fill(0);
    audio.setLevel(outputLevel);
    syncGlobalControls();
    if (wasAudioOn) updateContinuousAudio();
    announce("All image-to-instrument parameters reset.");
  }

  function buildPetalButtons() {
    const root = elementById(doc, "petalButtons");
    if (!root) return;
    root.replaceChildren();
    for (let index = 0; index < PETAL_COUNT; index += 1) {
      const button = doc.createElement("button");
      button.type = "button";
      button.dataset.petalIndex = String(index);
      button.textContent = String(index + 1).padStart(2, "0");
      button.addEventListener("click", () => {
        setSelected(index);
        if (variant !== 3) triggerSelected();
      });
      root.append(button);
    }
    syncPetalButtons();
  }

  function bindControls() {
    elementById(doc, "audioButton")?.addEventListener("click", toggleAudio);
    elementById(doc, "transportButton")?.addEventListener("click", () => setTransport());
    elementById(doc, "mutateButton")?.addEventListener("click", mutate);
    elementById(doc, "petalActive")?.addEventListener("click", () => setPetalActive(state.selectedPetal ?? 0));
    for (const button of doc.querySelectorAll("[data-reset-all]")) button.addEventListener("click", reset);

    const level = elementById(doc, "level");
    level?.addEventListener("input", () => {
      outputLevel = Number(level.value);
      audio.setLevel(outputLevel);
      const output = elementById(doc, "levelOut");
      if (output) output.textContent = percent(outputLevel);
    });

    const root = elementById(doc, "rootNote");
    root?.addEventListener("input", () => {
      state.rootMidi = Number(root.value);
      const output = elementById(doc, "rootNoteOut");
      if (output) output.textContent = noteName(state.rootMidi);
      updateContinuousAudio();
    });

    const rate = elementById(doc, "pulseRate");
    rate?.addEventListener("input", () => {
      pulseRateValue = Number(rate.value);
      state.rate = rateToNormalized(variant, pulseRateValue);
      const output = elementById(doc, "pulseRateOut");
      if (output) output.textContent = formatRate(variant, pulseRateValue);
      updateContinuousAudio();
    });

    for (const key of ["centerA", "centerB", "spread"]) {
      const input = elementById(doc, key);
      input?.addEventListener("input", () => {
        state[key] = Number(input.value);
        const output = elementById(doc, `${key}Out`);
        if (output) output.textContent = percent(state[key]);
        updateContinuousAudio();
      });
    }

    for (const key of ["aperture", "tongue", "emphasis"]) {
      const input = elementById(doc, key);
      input?.addEventListener("input", () => {
        const property = variant === 3 && key === "emphasis" ? "probability" : key;
        selectedPetal()[property] = Number(input.value);
        const output = elementById(doc, `${key}Out`);
        if (output) output.textContent = percent(selectedPetal()[property]);
        updateContinuousAudio();
      });
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.round(rect.width));
    const nextHeight = Math.max(1, Math.round(rect.height));
    const nextRatio = Math.min(2, globalThis.devicePixelRatio || 1);
    if (nextWidth === cssWidth && nextHeight === cssHeight && nextRatio === pixelRatio) return;
    cssWidth = nextWidth;
    cssHeight = nextHeight;
    pixelRatio = nextRatio;
    canvas.width = Math.round(cssWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    const size = Math.min(cssWidth, cssHeight);
    layout = radialPetalLayout(cssWidth, cssHeight, {
      centerX: cssWidth * 0.5,
      centerY: cssHeight * (cssWidth < 650 ? 0.54 : 0.52),
      coreRadius: size * (variant === 3 ? 0.095 : 0.088),
      ringRadius: size * 0.29,
      radialRadius: size * 0.142,
      tangentialRadius: size * 0.092,
    });
  }

  function updateTime(time, dt) {
    flashLevels = flashLevels.map((value) => Math.max(0, value - dt * 2.8));
    if (!state.running) {
      flushRatchets(time);
      return;
    }
    if (variant === 1) {
      state.phase = (state.phase + dt * pulseRateValue) % 1;
      const focused = Math.floor(state.phase * PETAL_COUNT) % PETAL_COUNT;
      flashLevels[focused] = Math.max(flashLevels[focused], 0.38);
      updateContinuousAudio();
    } else if (variant === 2) {
      const previous = state.phase;
      state.phase = (state.phase + dt * pulseRateValue) % 1;
      if (state.phase < previous || lastRouterCycle < 0) {
        lastRouterCycle += 1;
        triggerRouterPulse(advanceSequencerStep(state.selectedPetal ?? 0, lastRouterCycle), 0.88);
      }
    } else {
      const stepDuration = sequencerStepDurationSeconds(pulseRateValue, state.centerA, absoluteStep);
      sequenceAccumulator += dt;
      while (sequenceAccumulator >= stepDuration) {
        sequenceAccumulator -= stepDuration;
        sequenceStep = advanceSequencerStep(sequenceStep, 1);
        absoluteStep += 1;
        queueSequencerStep(sequenceStep, sequencerStepDurationSeconds(pulseRateValue, state.centerA, absoluteStep));
      }
      state.phase = clamp(sequenceAccumulator / Math.max(0.001, stepDuration));
    }
    flushRatchets(time);
  }

  function draw(time) {
    resize();
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const shimmer = 0.5 + 0.5 * Math.sin(time * 0.0021);
    const currentStep = variant === 3
      ? sequenceStep
      : variant === 1 ? Math.floor(state.phase * PETAL_COUNT) % PETAL_COUNT : -1;

    for (const petal of layout.petals) {
      drawTube(ctx, layout, petal, state.petals[petal.index], variant, state.phase, currentStep);
    }
    if (variant === 2) {
      for (const petal of layout.petals) {
        drawGate(
          ctx,
          layout,
          petal,
          state.petals[petal.index],
          petal.index === state.selectedPetal,
          state.phase,
        );
      }
    }
    for (const petal of layout.petals) {
      const activity = clamp(flashLevels[petal.index] + (state.petals[petal.index].active ? 0.08 * shimmer : 0));
      drawPetal(
        ctx,
        petal,
        state.petals[petal.index],
        variant,
        petal.index === state.selectedPetal,
        activity,
        petal.index === currentStep,
      );
    }
    drawRosette(ctx, layout, state, variant, currentStep, state.phase);

    const activeCount = state.petals.filter((petal) => petal.active).length;
    const readout = elementById(doc, "stageReadout");
    if (readout) {
      if (variant === 1) readout.textContent = `${activeCount} mouths · audio ${audioOn ? "on" : "off"}`;
      else if (variant === 2) readout.textContent = `${activeCount} / 8 routes · ${state.running ? "pulsing" : "idle"}`;
      else readout.textContent = `step ${sequenceStep + 1} / 8 · ${state.running ? `${Math.round(pulseRateValue)} bpm` : "stopped"}`;
    }
  }

  function loop(time) {
    const dt = lastTime ? Math.min(0.05, Math.max(0, (time - lastTime) / 1000)) : 0;
    lastTime = time;
    updateTime(time, dt);
    draw(time);
    frame = globalThis.requestAnimationFrame(loop);
  }

  function pointerDown(event) {
    const point = canvasPoint(canvas, event);
    if (centerDistance(point, layout) <= layout.coreRadius * 1.1) {
      setTransport();
      return;
    }
    const gateIndex = variant === 2 ? hitRouteGate(point, layout) : null;
    if (gateIndex !== null) {
      setSelected(gateIndex, false);
      setPetalActive(gateIndex);
      return;
    }
    const index = hitTestRadialPetal(point, layout, 8);
    if (index === null) return;
    event.preventDefault();
    setSelected(index, false);
    drag = { pointerId: event.pointerId, index, started: point, moved: false };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add("is-dragging");
    const gesture = mapPetalGesture({ ...point, pressure: event.pressure > 0 ? event.pressure : undefined }, layout, { hitPadding: 16 });
    if (gesture) {
      Object.assign(state.petals[index], {
        aperture: gesture.aperture,
        tongue: gesture.tongue,
        emphasis: event.pressure > 0 ? gesture.emphasis : state.petals[index].emphasis,
      });
      syncSelectedControls();
      updateContinuousAudio();
    }
    if (variant === 2) triggerRouterPulse(index, 0.9);
  }

  function pointerMove(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = canvasPoint(canvas, event);
    if (Math.hypot(point.x - drag.started.x, point.y - drag.started.y) > 5) drag.moved = true;
    const gesture = mapPetalGesture(
      { ...point, petalIndex: drag.index, pressure: event.pressure > 0 ? event.pressure : undefined },
      layout,
      { defaultEmphasis: state.petals[drag.index].emphasis },
    );
    if (!gesture) return;
    state.petals[drag.index].aperture = gesture.aperture;
    state.petals[drag.index].tongue = gesture.tongue;
    if (event.pressure > 0) state.petals[drag.index].emphasis = gesture.emphasis;
    flashLevels[drag.index] = 0.7;
    syncSelectedControls();
    updateContinuousAudio();
  }

  function pointerUp(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const finished = drag;
    drag = null;
    canvas.releasePointerCapture?.(event.pointerId);
    canvas.classList.remove("is-dragging");
    if (!finished.moved) {
      if (variant === 3) setPetalActive(finished.index);
      triggerSelected();
    }
  }

  function keydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName?.toLowerCase?.();
    if (["input", "select", "textarea", "button"].includes(tag)) return;
    if (/^[1-8]$/.test(event.key)) {
      event.preventDefault();
      setSelected(Number(event.key) - 1);
      triggerSelected();
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      setTransport();
      return;
    }
    const petal = selectedPetal();
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      petal.aperture = clamp(petal.aperture + (event.key === "ArrowUp" ? 0.04 : -0.04));
      syncSelectedControls();
      updateContinuousAudio();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      petal.tongue = clamp(petal.tongue + (event.key === "ArrowRight" ? 0.04 : -0.04));
      syncSelectedControls();
      updateContinuousAudio();
    }
  }

  state.rate = rateToNormalized(variant, pulseRateValue);
  buildPetalButtons();
  bindControls();
  syncGlobalControls();
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
    reset,
    setSelected,
    setTransport,
    triggerSelected,
    dispose,
  });
}

if (typeof document !== "undefined") mountImageToInstrument(document);
