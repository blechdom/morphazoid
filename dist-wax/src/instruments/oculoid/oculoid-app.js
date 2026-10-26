import { registerHeaderPresets } from "../../site/header-presets.js";
import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";
import { OculoidAudio } from "./oculoid-audio.js";
import {
  boundedEyeTurn, boundedOculoidStretch, clampEye, eyePose, eyePoseWithRetractor, hexEyeColor, lidEdge,
  OCULOID_EYE_COUNTS, OCULOID_ENSEMBLES, normalizeOculoidEnsemble,
  normalizeOculoid, normalizeOculoidLighting, normalizeOculoidSurface,
  oculoidPokeContact, OCULOID_POKE_HOME, stepOculoidPoke,
  stepOculoidElastic, OCULOID_STRETCH_LIMIT, OCULOID_SURFACE_DEFAULTS,
  OCULOID_SURFACE_RANGES, TEAR_CYCLE_BEATS,
  OCULOID_APPEARANCE_DEFAULTS, OCULOID_DEFAULTS, OCULOID_EYE_LOOKS, OCULOID_IRIS_COLORS,
  OCULOID_IRIS_PATTERNS, OCULOID_EYEBALL_STYLES, OCULOID_EYELID_STYLES,
  OCULOID_CRY_TEMPO_RANGE,
  OCULOID_LIGHT_DEFAULTS, OCULOID_LIGHT_RANGES,
  OCULOID_RANGES, OCULOID_SCLERA_COLORS, OCULOID_SCLERA_PATTERNS,
} from "./oculoid-model.js";
import { OculoidMidiState } from "./oculoid-midi.js";
import { OCULOID_PRESETS, randomizeOculoid, randomOculoidStyle } from "./oculoid-presets.js";
import { createOculoidViewer } from "./oculoid-viewer.js";
import { OCULOID_HAIRCUTS, OCULOID_HATS, OCULOID_WARDROBE_DEFAULTS } from "./oculoid-wardrobe.js";

const $ = id => document.getElementById(id);
const canvas = $("eyeCanvas"), listeners = new AbortController(), options = { signal: listeners.signal };
const audio = new OculoidAudio(globalThis), state = normalizeOculoid(OCULOID_DEFAULTS);
const turn = boundedEyeTurn();
const lighting = normalizeOculoidLighting();
const midi = new OculoidMidiState();
let playing = false, disposed = false, cached = false, parkedBeat = null, wasArmed = false;
let frame = 0, lastFrame = 0, dragging = null, heldBlink = null;
let lightDragging = null, gazeDragging = null;
let pokeMode = false, pokeKeyboard = false, pokeContact = OCULOID_POKE_HOME;
let pokePressure = 0, pokeTarget = 0;
let pokeSpring = { depth: 0, velocity: 0 }, lastPokeFrame = 0, lastPokeMessage = 0;
const surfaceControls = normalizeOculoidSurface();
const wardrobe = { ...OCULOID_WARDROBE_DEFAULTS };
let eyeCount = 1, touchedEye = 0, ensembleStyle = "banter";
const surfaceTools = ["stretch"];
let surfaceMode = "none", retracted = false, lidsHidden = false, surfaceSpot = OCULOID_POKE_HOME;
let stretchAnchor = null, stretchTarget = { x: 0, y: 0 };
let stretchSpring = { x: 0, y: 0, vx: 0, vy: 0 };
let keyboardStretch = false;
let lastElasticMessage = 0;
let crying = false, tearSingle = false, tearAnchorMs = performance.now(), tearAnchorBeat = 0;
let cryTempo = OCULOID_DEFAULTS.tempo;
const FLASHLIGHT_DEFAULT_POWER = 0.8;
let flashlightMode = false, flashlightPower = FLASHLIGHT_DEFAULT_POWER;
let flashlightAim = { x: 0, y: 0 }, lightSettling = false;
let irisColorId = OCULOID_APPEARANCE_DEFAULTS.irisColor;
let irisPatternId = OCULOID_APPEARANCE_DEFAULTS.irisPattern;
let scleraColorId = OCULOID_APPEARANCE_DEFAULTS.scleraColor;
let scleraPatternId = OCULOID_APPEARANCE_DEFAULTS.scleraPattern;
let scleraPatternHex = OCULOID_APPEARANCE_DEFAULTS.scleraPatternColor;
let eyeLook = OCULOID_APPEARANCE_DEFAULTS.eyeLook;
let presets = null;
const gazePad = $("gazePad"), gazeHandle = $("gazeHandle");
// The shared header Output is enhanced by nav.js; only the panel's native
// ranges get their own compact rotary presentation and teardown here.
const rangeKnobs = new Map([...document.querySelectorAll(".oc-panel .oc-dial > input[type=range]")]
  .map(input => [input.id, enhanceRangeKnob(input, input.id === "cryTempo" ? { scale: "log" } : {})]));
function cancelKnobs() { for (const knob of rangeKnobs.values()) knob.cancelGesture(); }
const labels = {
  gazeX: value => `${Math.round(value * 100)}%`,
  gazeY: value => `${Math.round(value * 100)}%`,
  blink: value => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`,
  lowerLid: value => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`,
  pupil: value => `${Math.round(value * 100)}%`,
  tempo: value => `${Math.round(value)} BPM`,
  lidRate: value => `${Number(value).toFixed(2).replace(/\.?0+$/, "")}×`,
  motion: value => `${Math.round(value * 100)}%`,
  rootHz: value => `${Math.round(value)} Hz`,
  tone: value => `${Math.round(value * 100)}%`,
  air: value => `${Math.round(value * 100)}%`,
  wetness: value => `${Math.round(value * 100)}%`,
  veins: value => `${Math.round(value * 100)}%`,
  irisTint: value => `${Math.round(value * 100)}%`,
};
const viewer = createOculoidViewer(canvas, { onStatus: ({ state, message }) => {
  const stage = canvas.closest(".oc-stage"), status = $("modelStatus");
  stage.dataset.modelState = state;
  stage.setAttribute("aria-busy", "false");
  $("pokeMode").disabled = state !== "ready";
  $("flashlightMode").disabled = state !== "ready";
  for (const name of surfaceTools) $(name + "Mode").disabled = state !== "ready";
  for (const id of ["hideLids", "tearOnce", "cryMode"])
    $(id).disabled = state !== "ready" || (lidsHidden && id !== "hideLids");
  status.textContent = message;
  status.hidden = !message;
  render();
} });
viewer.setWardrobe(wardrobe);
audio.setWardrobe(wardrobe);
audio.onState = syncAudio;
audio.onError = error => { if (!disposed) announce(error.message); };
audio.setConfig(state);

function announce(message) { $("liveStatus").textContent = message; }

function syncAudio() {
  if (disposed) return;
  const button = $("audioButton");
  const status = audio.starting ? "starting" : audio.armed
    ? audio.running ? "on" : "interrupted" : "off";
  const previous = button.dataset.audioState;
  button.dataset.audioState = status;
  button.setAttribute("aria-pressed", String(audio.armed));
  const action = status === "interrupted" ? "Resume Audio"
    : status === "on" ? "Turn Audio off" : "Turn Audio on";
  button.setAttribute("aria-label", action);
  button.title = action;
  $("audioState").textContent = status;
  if (status === "interrupted" && previous !== status) announce("Audio interrupted. Tap Audio to resume.");
}

function sync() {
  for (const [key, format] of Object.entries(labels)) {
    $(key).value = state[key];
    $(key + "Out").textContent = format(state[key]);
    rangeKnobs.get(key)?.update();
  }
  gazeHandle.style.left = `${50 + 34 * state.gazeX}%`;
  gazeHandle.style.top = `${50 - 34 * state.gazeY}%`;
  gazeHandle.setAttribute("aria-label",
    `Steer gaze, ${labels.gazeX(state.gazeX)} across, ${labels.gazeY(state.gazeY)} up/down`);
  $("eyeballStyle").value = state.eyeballStyle;
  $("eyelidStyle").value = state.eyelidStyle;
  $("motionButton").setAttribute("aria-pressed", String(playing));
  $("motionButton").setAttribute("aria-label", playing ? "Pause eye movement" : "Play eye movement");
  $("outputLevelOut").textContent = `${Math.round(audio.level * 100)}%`;
  syncAudio();
  presets?.refresh();
}

function tearBeatAt(now = performance.now()) {
  return Math.max(0, tearAnchorBeat + (now - tearAnchorMs) * cryTempo / 60000);
}

function render() {
  if (disposed || cached) return;
  const performed = midi.performance(state);
  const beat = audio.getBeat(), lidBeat = audio.getLidBeat();
  const tearBeat = tearBeatAt();
  if (tearSingle && tearBeat >= TEAR_CYCLE_BEATS) tearSingle = false;
  const tearing = crying || tearSingle;
  const light = viewer.draw(eyePoseWithRetractor(eyePose(performed, beat, playing, lidBeat),
    retracted || lidsHidden),
    performed, playing ? beat : 0, playing || tearing,
    { contact: pokeContact, depth: pokeSpring.depth, diameter: surfaceControls.pokeDiameter,
      eyeIndex: touchedEye },
    { active: flashlightMode, power: flashlightPower, diameter: surfaceControls.flashDiameter,
      ...flashlightAim },
    { stretch: stretchAnchor ? { contact: stretchAnchor, ...stretchSpring } : null,
      eyeIndex: touchedEye, motionPlaying: playing },
    { active: tearing, beat: tearBeat });
  lightSettling = light?.settling === true;
  audio.flashlight(light?.exposure ?? 0);
  if (surfaceMode !== "none") showSurfaceSpot();
}

function pokeNeedsFrame() {
  // The zero-pressure spring snaps to *exactly* zero. Keep one final frame so
  // a released eye restores its full-resolution still image and bind mesh.
  return (pokeTarget === 0 ? pokeSpring.depth !== 0
    : Math.abs(pokeSpring.depth - pokeTarget) > 0.001)
    || Math.abs(pokeSpring.velocity) > 0.008;
}

function schedule() {
  if (disposed || cached || document.hidden || frame) return;
  frame = requestAnimationFrame(now => {
    frame = 0;
    const elapsed = lastPokeFrame ? (now - lastPokeFrame) / 1000 : 1 / 60;
    lastPokeFrame = now;
    const settling = pokeNeedsFrame();
    if (settling) pokeSpring = stepOculoidPoke(pokeSpring, pokeTarget, elapsed);
    if (stretchAnchor) {
      stretchSpring = stepOculoidElastic(stretchSpring, stretchTarget, elapsed,
        OCULOID_STRETCH_LIMIT);
      if (!stretchTarget.x && !stretchTarget.y && !stretchSpring.x && !stretchSpring.y
        && !stretchSpring.vx && !stretchSpring.vy)
        stretchAnchor = null;
    }
    const stillSettling = pokeNeedsFrame();
    const stretchReturning = !stretchTarget.x && !stretchTarget.y;
    const stretching = Boolean(stretchAnchor && (
      (stretchReturning && (stretchSpring.x !== 0 || stretchSpring.y !== 0))
      || Math.hypot(stretchSpring.x - stretchTarget.x, stretchSpring.y - stretchTarget.y) > 0.001
      || Math.hypot(stretchSpring.vx, stretchSpring.vy) > 0.008));
    const tearing = crying || tearSingle;
    // The audio clock keeps running independently of the viewer. Software
    // WebGL needs a lower draw rate to leave room for gestures and Web Audio.
    const visualRate = viewer.softwareRendering ? (playing || tearing ? 12 : 9)
      : state.eyeballStyle === "drift" && state.eyelidStyle === "blink" ? 30 : 24;
    if ((!playing && !tearing && !stillSettling && !lightSettling && !stretching)
      || now - lastFrame >= 1000 / visualRate) {
      render();
      lastFrame = now;
    }
    if (playing || crying || tearSingle || stillSettling || lightSettling || stretching) schedule();
  });
}

function setPoke(pressure, contact = pokeContact, travel = 0, force = false) {
  if (Number.isInteger(contact?.eyeIndex)) touchedEye = contact.eyeIndex;
  pokeContact = oculoidPokeContact(contact);
  pokePressure = clampEye(pressure, 0, 1, 0);
  pokeTarget = clampEye(pokePressure * surfaceControls.pokeDepth, 0, 1, 0);
  const now = performance.now();
  if (force || !pokeTarget || now - lastPokeMessage >= 35) {
    audio.poke({ pressure: pokeTarget, travel, pan: pokeContact.x * 0.84,
      diameter: surfaceControls.pokeDiameter });
    lastPokeMessage = now;
  }
  schedule();
}

function cancelPoke(immediate = false) {
  pokeKeyboard = false;
  pokePressure = pokeTarget = 0;
  audio.poke({ pressure: 0, cancel: true });
  if (immediate) {
    pokeSpring = { depth: 0, velocity: 0 };
    pokeContact = OCULOID_POKE_HOME;
  }
  schedule();
}

function setPokeMode(value, silent = false) {
  if (value && flashlightMode) setFlashlightMode(false, true);
  if (value && surfaceMode !== "none") setSurfaceMode("none", true);
  pokeMode = value === true;
  if (!pokeMode) {
    // A second pointer or keyboard activation can turn Poke off while the
    // canvas still owns a press. Do not let its next move dimple the eye again.
    if (dragging?.kind === "poke") {
      const { id } = dragging;
      dragging = null;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    cancelPoke(true);
  }
  $("pokeMode").setAttribute("aria-pressed", String(pokeMode));
  canvas.setAttribute("aria-label", pokeMode
    ? "Playable 3D eye, poke mode" : "Playable 3D eye");
  canvas.classList.toggle("oc-poking", pokeMode);
  if (!silent) announce(pokeMode
    ? "Poke mode: press and drag exposed eyeball; on the focused canvas, arrows move the spot and hold P to press."
    : "Poke mode off. Drag the eye to steer gaze.");
  schedule();
}
$("pokeMode").addEventListener("click", () => setPokeMode(!pokeMode), options);

function setFlashAim(x, y) {
  flashlightAim = { x: clampEye(x, -1, 1, 0), y: clampEye(y, -1, 1, 0) };
  const marker = $("flashlightMarker");
  marker.style.left = `${50 + flashlightAim.x * 50}%`;
  marker.style.top = `${50 - flashlightAim.y * 50}%`;
  schedule();
}

function aimFlashAtPointer(event) {
  const rect = canvas.getBoundingClientRect();
  setFlashAim(
    (event.clientX - rect.left) * 2 / Math.max(1, rect.width) - 1,
    1 - (event.clientY - rect.top) * 2 / Math.max(1, rect.height),
  );
}

function setFlashlightPower(value) {
  flashlightPower = Math.round(clampEye(value, 0, 1, FLASHLIGHT_DEFAULT_POWER) * 100) / 100;
  $("flashlightPower").value = flashlightPower;
  $("flashlightPowerOut").textContent = `${Math.round(flashlightPower * 100)}%`;
  rangeKnobs.get("flashlightPower")?.update();
  schedule();
}

function setFlashlightMode(value, silent = false) {
  if (value && pokeMode) setPokeMode(false, true);
  if (value && surfaceMode !== "none") setSurfaceMode("none", true);
  flashlightMode = value === true;
  if (!flashlightMode && dragging?.kind === "flashlight") {
    const { id } = dragging;
    dragging = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  $("flashlightMode").setAttribute("aria-pressed", String(flashlightMode));
  $("flashlightMarker").hidden = !flashlightMode;
  canvas.classList.toggle("oc-flashlighting", flashlightMode);
  canvas.setAttribute("aria-label", flashlightMode
    ? "Playable 3D eye, flashlight mode"
    : pokeMode ? "Playable 3D eye, poke mode" : "Playable 3D eye");
  // A hidden or parked page cannot draw the returning pupil, so drop any
  // pending light exposure before an Audio graph can be resumed.
  if (!flashlightMode && (document.hidden || cached)) {
    viewer.resetFlashlight();
    audio.flashlight(0);
  }
  if (!silent) announce(flashlightMode
    ? "Flashlight: aim on the canvas or use its arrow keys. The exposed iris constricts; eyelids block the beam."
    : "Flashlight off. Drag the eye to steer gaze.");
  schedule();
}
$("flashlightMode").addEventListener("click", () => setFlashlightMode(!flashlightMode), options);
$("flashlightPower").addEventListener("input", event =>
  setFlashlightPower(event.currentTarget.value), options);

function setSurfaceControl(key, value) {
  const [min, max] = OCULOID_SURFACE_RANGES[key];
  surfaceControls[key] = Math.round(clampEye(value, min, max, OCULOID_SURFACE_DEFAULTS[key]) * 100) / 100;
  $(key).value = surfaceControls[key];
  $(key + "Out").textContent = `${Math.round(surfaceControls[key] * 100)}% ${key === "pokeDepth" ? "depth" : "eye"}`;
  rangeKnobs.get(key)?.update();
  if (key === "flashDiameter") {
    // Same projected globe scale as the spotlight cone; unlike the former
    // 19px dot, the marker now shows how broad the actual beam has become.
    const width = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.72 * surfaceControls[key];
    $("flashlightMarker").style.width = $("flashlightMarker").style.height = `${Math.max(18, width)}px`;
  } else if (pokePressure) setPoke(pokePressure, pokeContact, 0, true);
  schedule();
}
for (const key of Object.keys(OCULOID_SURFACE_RANGES)) {
  $(key).addEventListener("input", event => setSurfaceControl(key, event.currentTarget.value), options);
}

function showSurfaceSpot() {
  const marker = $("surfaceMarker");
  const point = viewer.projectContact(surfaceSpot, touchedEye);
  marker.hidden = surfaceMode === "none" || !point.visible
    || point.x < 0 || point.x > 100 || point.y < 0 || point.y > 100;
  marker.style.left = `${point.x}%`;
  marker.style.top = `${point.y}%`;
}
function setSurfaceSpot(contact) {
  if (Number.isInteger(contact?.eyeIndex)) touchedEye = contact.eyeIndex;
  surfaceSpot = oculoidPokeContact(contact);
  showSurfaceSpot();
}

function tugCornea(x, y, contact = stretchAnchor) {
  stretchTarget = boundedOculoidStretch(x, y);
  const strength = Math.hypot(stretchTarget.x, stretchTarget.y);
  const now = performance.now();
  if (strength > 0.025 && now - lastElasticMessage > 60) {
    audio.surface({ kind: "stretch",
      strength: Math.min(1, strength / OCULOID_STRETCH_LIMIT),
      pan: (contact?.x ?? 0) * 0.84 });
    lastElasticMessage = now;
  }
  schedule();
}
function releaseStretch(canceled = false) {
  const strength = Math.hypot(stretchTarget.x, stretchTarget.y);
  stretchTarget = { x: 0, y: 0 };
  keyboardStretch = false;
  if (!canceled && strength > 0.025) audio.surface({ kind: "stretch",
    strength: strength / OCULOID_STRETCH_LIMIT,
    pan: stretchAnchor?.x * 0.84, release: true });
  if (canceled) clearSurface();
  schedule();
}

function clearSurface() {
  stretchAnchor = null;
  stretchTarget = { x: 0, y: 0 };
  stretchSpring = { x: 0, y: 0, vx: 0, vy: 0 };
  keyboardStretch = false;
  lastElasticMessage = 0;
  audio.surface({ cancel: true });
  schedule();
}

function setSurfaceMode(mode, silent = false) {
  const next = surfaceTools.includes(mode) ? mode : "none";
  if (next === surfaceMode) return;
  if (next !== "none") {
    if (pokeMode) setPokeMode(false, true);
    if (flashlightMode) setFlashlightMode(false, true);
  }
  if (dragging && surfaceTools.includes(dragging.kind)) {
    const { id } = dragging;
    dragging = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  clearSurface();
  surfaceMode = next;
  for (const name of surfaceTools)
    $(name + "Mode").setAttribute("aria-pressed", String(name === next));
  $("surfaceMarker").hidden = next === "none";
  canvas.classList.toggle("oc-surface-tool", next !== "none");
  canvas.setAttribute("aria-label", next === "none"
    ? pokeMode ? "Playable 3D eye, poke mode"
      : flashlightMode ? "Playable 3D eye, flashlight mode" : "Playable 3D eye"
    : `Playable 3D eye, ${next} tool`);
  if (!silent) announce(next === "none"
    ? "Surface tools off. Drag the eye to steer gaze."
    : `${next[0].toUpperCase() + next.slice(1)} tool: touch and drag the exposed globe. Focus the canvas for arrow keys and Enter.`);
  if (next !== "none") showSurfaceSpot();
  schedule();
}
for (const name of surfaceTools)
  $(name + "Mode").addEventListener("click", () =>
    setSurfaceMode(surfaceMode === name ? "none" : name), options);

function setRetractor(value, silent = false) {
  if (value && (dragging?.kind === "upper" || dragging?.kind === "lower")) {
    const { id, blink, lowerLid } = dragging;
    dragging = null;
    Object.assign(state, { blink, lowerLid });
    audio.setConfig(midi.performance(state));
    sync();
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  retracted = value === true;
  audio.retractLids(retracted || lidsHidden);
  const button = $("lidRetractor");
  button.setAttribute("aria-pressed", String(retracted));
  button.textContent = retracted ? "Release lids" : "Retract lids";
  button.setAttribute("aria-label", retracted ? "Release the held-open eyelids"
    : "Hold both eyelids fully open");
  canvas.closest(".oc-stage").classList.toggle("oc-retracted", retracted);
  if (!silent) announce(retracted
    ? "Lids held fully open. Surface tools reach the exposed eyeball; saved lid positions are unchanged."
    : "Lid retractor released; saved lid positions restored.");
  schedule();
}
$("lidRetractor").addEventListener("click", () => setRetractor(!retracted), options);

function setCry(value, silent = false) {
  crying = value === true && !lidsHidden;
  tearSingle = false;
  if (crying) {
    tearAnchorBeat = 0;
    tearAnchorMs = performance.now();
  }
  audio.cry(crying, crying ? 0 : tearBeatAt());
  $("cryMode").setAttribute("aria-pressed", String(crying));
  $("cryMode").textContent = crying ? "Stop crying" : "Cry · 4 beats";
  if (!silent) announce(crying
    ? "Crying: one drop every four beats at Cry tempo, even with Motion paused."
    : "Crying stopped.");
  schedule();
}

function setCryTempo(value) {
  tearAnchorBeat = tearBeatAt();
  tearAnchorMs = performance.now();
  cryTempo = Math.round(clampEye(value, ...OCULOID_CRY_TEMPO_RANGE, OCULOID_DEFAULTS.tempo));
  $("cryTempo").value = cryTempo;
  $("cryTempoOut").textContent = `${cryTempo} BPM`;
  rangeKnobs.get("cryTempo")?.update();
  audio.setCryTempo(cryTempo);
  schedule();
}
$("cryTempo").addEventListener("input", event => setCryTempo(event.currentTarget.value), options);

const wardrobeToggles = ["sunglasses", "groucho", "cigar", "mustache", "coat", "scarf",
  "lipstick", "teeth", "tongue", "catEars", "humanEars", "bowTie", "tail", "headband"];
for (const key of wardrobeToggles) {
  $(key).addEventListener("change", event => {
    wardrobe[key] = event.currentTarget.checked;
    viewer.setWardrobe(wardrobe);
    audio.setWardrobe(wardrobe);
    schedule();
  }, options);
}
$("lipstickColor").addEventListener("input", event => {
  wardrobe.lipstickColor = event.currentTarget.value;
  viewer.setWardrobe(wardrobe);
  schedule();
}, options);
$("bowTieColor").addEventListener("input", event => {
  wardrobe.bowTieColor = event.currentTarget.value;
  viewer.setWardrobe(wardrobe);
  schedule();
}, options);
$("hatStyle").addEventListener("change", event => {
  wardrobe.hat = OCULOID_HATS.includes(event.currentTarget.value)
    ? event.currentTarget.value : "none";
  viewer.setWardrobe(wardrobe);
  audio.setWardrobe(wardrobe);
  schedule();
}, options);
$("hatSize").addEventListener("input", event => {
  wardrobe.hatSize = clampEye(Number(event.currentTarget.value), 0.75, 1.5, 1);
  $("hatSizeOut").textContent = `${Math.round(wardrobe.hatSize * 100)}%`;
  viewer.setWardrobe(wardrobe);
  schedule();
}, options);
$("hairStyle").addEventListener("change", event => {
  wardrobe.hair = OCULOID_HAIRCUTS.includes(event.currentTarget.value)
    ? event.currentTarget.value : "none";
  viewer.setWardrobe(wardrobe);
  audio.setWardrobe(wardrobe);
  schedule();
}, options);
function setEyeCount(count) {
  const next = OCULOID_EYE_COUNTS.includes(Number(count)) ? Number(count) : 1;
  $("eyeCountOut").textContent = `${next} ${next === 1 ? "eye" : "eyes"}`;
  if (eyeCount === next) return;
  if (dragging) {
    const { id } = dragging;
    dragging = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  cancelPoke(true);
  clearSurface();
  touchedEye = 0;
  eyeCount = next;
  $("eyeCount").value = String(next);
  rangeKnobs.get("eyeCount")?.update();
  viewer.setEyeCount(next);
  audio.setEnsemble(next, ensembleStyle);
  schedule();
  announce(`${next} ${next === 1 ? "eyeball" : "eyeballs"} inside the sheath${
    next > 1 ? `, playing ${ensembleStyle}` : ""}.`);
}
$("eyeCount").addEventListener("input", event => setEyeCount(event.currentTarget.value), options);
function setEnsembleStyle(value, silent = false) {
  ensembleStyle = normalizeOculoidEnsemble(value);
  $("ensembleStyle").value = ensembleStyle;
  viewer.setEyeEnsemble(ensembleStyle);
  audio.setEnsemble(eyeCount, ensembleStyle);
  if (!silent) announce(`${OCULOID_ENSEMBLES.find(style => style.id === ensembleStyle).label
  } eyeball ensemble. With multiple eyes, Motion gives them individual parts.`);
  schedule();
}
$("ensembleStyle").addEventListener("change", event =>
  setEnsembleStyle(event.currentTarget.value), options);
function resetWardrobe() {
  Object.assign(wardrobe, OCULOID_WARDROBE_DEFAULTS);
  for (const key of wardrobeToggles) $(key).checked = wardrobe[key];
  $("hatStyle").value = wardrobe.hat;
  $("hatSize").value = String(wardrobe.hatSize);
  $("hatSizeOut").textContent = `${Math.round(wardrobe.hatSize * 100)}%`;
  rangeKnobs.get("hatSize")?.update();
  $("hairStyle").value = wardrobe.hair;
  $("lipstickColor").value = wardrobe.lipstickColor;
  $("bowTieColor").value = wardrobe.bowTieColor;
  viewer.setWardrobe(wardrobe);
  audio.setWardrobe(wardrobe);
}

function dropOneTear() {
  if (lidsHidden) return;
  setCry(false, true);
  tearSingle = true;
  tearAnchorBeat = 0;
  tearAnchorMs = performance.now();
  audio.tear(state.wetness);
  announce("One tear growing from the lid corner.");
  schedule();
}
$("tearOnce").addEventListener("click", dropOneTear, options);
$("cryMode").addEventListener("click", () => setCry(!crying), options);

function setLidsHidden(value, silent = false) {
  if (value && (crying || tearSingle)) setCry(false, true);
  if (value && (dragging?.kind === "upper" || dragging?.kind === "lower")) {
    const { id, blink, lowerLid } = dragging;
    dragging = null;
    Object.assign(state, { blink, lowerLid });
    audio.setConfig(midi.performance(state));
    sync();
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  lidsHidden = value === true;
  viewer.setLidsHidden(lidsHidden);
  audio.setLidsVisible(!lidsHidden);
  // A hidden shell no longer occludes light or touch. Hold its sound gate
  // fully open too, without changing the saved lid positions or retractor.
  setRetractor(retracted, true);
  const button = $("hideLids");
  button.setAttribute("aria-pressed", String(lidsHidden));
  button.textContent = lidsHidden ? "Show lids" : "Hide lids";
  button.setAttribute("aria-label", lidsHidden ? "Show the saved eyelid shell"
    : "Hide the eyelid shell");
  $("lidRetractor").disabled = lidsHidden;
  for (const id of ["tearOnce", "cryMode"]) $(id).disabled = lidsHidden || !viewer.loaded;
  if (!silent) announce(lidsHidden
    ? "Lids hidden. Rotate, shine, or touch the bare eyeball; lid settings are saved."
    : "Lids restored to their saved positions.");
  schedule();
}
$("hideLids").addEventListener("click", () => setLidsHidden(!lidsHidden), options);

function change(key, value) {
  if (!(key in OCULOID_RANGES)) return;
  const [min, max] = OCULOID_RANGES[key];
  state[key] = clampEye(value, min, max, state[key]);
  audio.setConfig(midi.performance(state));
  sync();
  schedule();
}

function setGaze(x, y) {
  state.gazeX = Math.round(clampEye(x, -1, 1) * 100) / 100;
  state.gazeY = Math.round(clampEye(y, -1, 1) * 100) / 100;
  audio.setConfig(midi.performance(state));
  sync();
  schedule();
}

function moveGazeToPointer(event) {
  const rect = gazePad.getBoundingClientRect();
  const x = clampEye((event.clientX - rect.left) / Math.max(1, rect.width), 0.16, 0.84);
  const y = clampEye((event.clientY - rect.top) / Math.max(1, rect.height), 0.16, 0.84);
  setGaze((x - 0.5) / 0.34, (0.5 - y) / 0.34);
}

gazePad.addEventListener("pointerdown", event => {
  if (gazeDragging || event.button !== 0 || event.isPrimary === false) return;
  gazeDragging = { id: event.pointerId, x: state.gazeX, y: state.gazeY };
  gazePad.setPointerCapture(event.pointerId);
  gazeHandle.focus({ preventScroll: true });
  moveGazeToPointer(event);
  event.preventDefault();
}, options);
gazePad.addEventListener("pointermove", event => {
  if (!gazeDragging || gazeDragging.id !== event.pointerId) return;
  moveGazeToPointer(event);
  event.preventDefault();
}, options);
function releaseGaze(event) {
  if (!gazeDragging || gazeDragging.id !== event.pointerId) return;
  const previous = gazeDragging;
  gazeDragging = null;
  if (event.type !== "pointerup") setGaze(previous.x, previous.y);
  if (gazePad.hasPointerCapture(event.pointerId)) gazePad.releasePointerCapture(event.pointerId);
}
for (const type of ["pointerup", "pointercancel", "lostpointercapture"])
  gazePad.addEventListener(type, releaseGaze, options);
gazeHandle.addEventListener("keydown", event => {
  const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (!steps[event.key]) return;
  const [x, y] = steps[event.key], distance = event.shiftKey ? 0.01 : 0.05;
  setGaze(state.gazeX + x * distance, state.gazeY + y * distance);
  event.preventDefault();
}, options);

// Viewpoint is deliberately separate from the musical gaze and presets.
function setTurn(yaw, pitch) {
  Object.assign(turn, boundedEyeTurn(Math.round(yaw), Math.round(pitch)));
  viewer.setTurn(turn.yaw, turn.pitch);
  for (const [id, value] of [["turnX", turn.yaw], ["turnY", turn.pitch]]) {
    $(id).value = value;
    $(id + "Out").textContent = `${value}°`;
    rangeKnobs.get(id)?.update();
  }
  schedule();
}

// The light rig and finish are visual only: presets, MIDI and the sound engine
// never rewrite them. The separate pad leaves canvas eye/eyelid drags intact.
const lightPad = $("lightPad");
const lightHandles = { key: $("keyLightHandle"), fill: $("fillLightHandle") };
function setEyeLook(value) {
  eyeLook = OCULOID_EYE_LOOKS.includes(value)
    ? value : OCULOID_APPEARANCE_DEFAULTS.eyeLook;
  $("eyeLook").value = eyeLook;
  viewer.setEyeLook(eyeLook);
  // Keep the chosen palettes ready for switching back; they have no effect
  // while the licensed textures are replaced by the loading-eye drawing.
  for (const id of ["irisColor", "irisPicker", "irisPattern",
    "scleraColor", "scleraPicker", "scleraPattern", "scleraPatternPicker"])
    $(id).disabled = eyeLook === "ink";
  schedule();
}
function setIrisColor(value, customHex) {
  const choice = OCULOID_IRIS_COLORS.find(item => item.id === value)
    ?? OCULOID_IRIS_COLORS.find(item => item.id === OCULOID_APPEARANCE_DEFAULTS.irisColor);
  irisColorId = value === "custom" ? "custom" : choice.id;
  const hex = irisColorId === "custom"
    ? hexEyeColor(customHex, $("irisPicker").value)
    : `#${choice.swatch.toString(16).padStart(6, "0")}`;
  $("irisColor").value = irisColorId;
  $("irisPicker").value = hex;
  $("irisSwatch").style.backgroundColor = hex;
  viewer.setIrisColor(irisColorId, hex);
  schedule();
}

function setIrisPattern(value) {
  irisPatternId = OCULOID_IRIS_PATTERNS.includes(value)
    ? value : OCULOID_APPEARANCE_DEFAULTS.irisPattern;
  $("irisPattern").value = irisPatternId;
  viewer.setIrisPattern(irisPatternId);
  schedule();
}

function setScleraColor(value, customHex) {
  const choice = OCULOID_SCLERA_COLORS.find(item => item.id === value)
    ?? OCULOID_SCLERA_COLORS.find(item => item.id === OCULOID_APPEARANCE_DEFAULTS.scleraColor);
  scleraColorId = value === "custom" ? "custom" : choice.id;
  const hex = scleraColorId === "custom"
    ? hexEyeColor(customHex, $("scleraPicker").value)
    : `#${choice.tint.toString(16).padStart(6, "0")}`;
  $("scleraColor").value = scleraColorId;
  $("scleraPicker").value = hex;
  viewer.setScleraColor(scleraColorId, hex);
  schedule();
}

function setScleraPattern(value) {
  scleraPatternId = OCULOID_SCLERA_PATTERNS.includes(value)
    ? value : OCULOID_APPEARANCE_DEFAULTS.scleraPattern;
  $("scleraPattern").value = scleraPatternId;
  viewer.setScleraPattern(scleraPatternId);
  schedule();
}

function setScleraPatternColor(value) {
  scleraPatternHex = hexEyeColor(value, OCULOID_APPEARANCE_DEFAULTS.scleraPatternColor);
  $("scleraPatternPicker").value = scleraPatternHex;
  viewer.setScleraPatternColor(scleraPatternHex);
  schedule();
}

function setLighting(change = {}) {
  Object.assign(lighting, normalizeOculoidLighting({ ...lighting, ...change }));
  viewer.setLighting(lighting);
  $("skinFinish").value = lighting.finish;
  $("skinPicker").value = lighting.color;
  $("skinPattern").value = lighting.pattern;
  $("lightPattern").value = lighting.lightPattern;
  for (const [key, [min, max]] of Object.entries(OCULOID_LIGHT_RANGES)) {
    $(key).value = lighting[key];
    $(key + "Out").textContent = key === "keyBrightness" || key === "reflection"
      ? `${Math.round(lighting[key] * 100)}%` : `${lighting[key]}°`;
    rangeKnobs.get(key)?.update();
    if (key === "keyBrightness" || key === "reflection") continue;
    const handle = lightHandles[key.startsWith("key") ? "key" : "fill"];
    if (key.endsWith("Azimuth")) handle.style.left = `${16 + 68 * (lighting[key] - min) / (max - min)}%`;
    else handle.style.top = `${84 - 68 * (lighting[key] - min) / (max - min)}%`;
  }
  schedule();
}

function moveLightToPointer(event, name) {
  const rect = lightPad.getBoundingClientRect();
  const horizontal = clampEye((event.clientX - rect.left) / Math.max(1, rect.width), 0.16, 0.84);
  const vertical = clampEye((event.clientY - rect.top) / Math.max(1, rect.height), 0.16, 0.84);
  const az = OCULOID_LIGHT_RANGES[`${name}Azimuth`];
  const el = OCULOID_LIGHT_RANGES[`${name}Elevation`];
  setLighting({
    [`${name}Azimuth`]: Math.round(az[0] + (horizontal - 0.16) / 0.68 * (az[1] - az[0])),
    [`${name}Elevation`]: Math.round(el[1] - (vertical - 0.16) / 0.68 * (el[1] - el[0])),
  });
}

for (const [name, handle] of Object.entries(lightHandles)) {
  handle.addEventListener("pointerdown", event => {
    if (lightDragging || event.button !== 0) return;
    lightDragging = { name, id: event.pointerId, handle, before: { ...lighting } };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, options);
  handle.addEventListener("pointermove", event => {
    if (!lightDragging || lightDragging.handle !== handle || lightDragging.id !== event.pointerId) return;
    moveLightToPointer(event, name);
    event.preventDefault();
  }, options);
  function releaseLight(event) {
    if (!lightDragging || lightDragging.handle !== handle || lightDragging.id !== event.pointerId) return;
    if (event.type !== "pointerup") setLighting(lightDragging.before);
    lightDragging = null;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener("pointerup", releaseLight, options);
  handle.addEventListener("pointercancel", releaseLight, options);
  handle.addEventListener("lostpointercapture", releaseLight, options);
  handle.addEventListener("keydown", event => {
    const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (!steps[event.key]) return;
    const [x, y] = steps[event.key], distance = event.shiftKey ? 1 : 5;
    setLighting({
      [`${name}Azimuth`]: lighting[`${name}Azimuth`] + x * distance,
      [`${name}Elevation`]: lighting[`${name}Elevation`] + y * distance,
    });
    event.preventDefault();
  }, options);
}
$("skinFinish").addEventListener("change", event =>
  setLighting({ finish: event.currentTarget.value }), options);
$("skinPicker").addEventListener("input", event =>
  setLighting({ color: event.currentTarget.value }), options);
$("skinPattern").addEventListener("change", event =>
  setLighting({ pattern: event.currentTarget.value }), options);
$("lightPattern").addEventListener("change", event =>
  setLighting({ lightPattern: event.currentTarget.value }), options);
$("eyeLook").addEventListener("change", event =>
  setEyeLook(event.currentTarget.value), options);
$("irisColor").addEventListener("change", event => setIrisColor(event.currentTarget.value), options);
$("irisPicker").addEventListener("input", event =>
  setIrisColor("custom", event.currentTarget.value), options);
$("irisPattern").addEventListener("change", event => setIrisPattern(event.currentTarget.value), options);
$("scleraColor").addEventListener("change", event => setScleraColor(event.currentTarget.value), options);
$("scleraPicker").addEventListener("input", event =>
  setScleraColor("custom", event.currentTarget.value), options);
$("scleraPattern").addEventListener("change", event =>
  setScleraPattern(event.currentTarget.value), options);
$("scleraPatternPicker").addEventListener("input", event =>
  setScleraPatternColor(event.currentTarget.value), options);
for (const key of Object.keys(OCULOID_LIGHT_RANGES)) {
  $(key).addEventListener("input", event =>
    setLighting({ [key]: event.currentTarget.value }), options);
}

for (const key of Object.keys(labels)) {
  $(key).addEventListener("input", event => change(key, event.currentTarget.value), options);
}
for (const [id, axis] of [["turnX", "yaw"], ["turnY", "pitch"]]) {
  $(id).addEventListener("input", event => setTurn(
    axis === "yaw" ? event.currentTarget.value : turn.yaw,
    axis === "pitch" ? event.currentTarget.value : turn.pitch,
  ), options);
}
function setAnimationStyle(key, value, styles) {
  const chosen = normalizeOculoid({ [key]: value })[key];
  if (state[key] === chosen) return;
  state[key] = chosen;
  audio.setConfig(midi.performance(state));
  sync();
  schedule();
  announce(`${key === "eyeballStyle" ? "Eyeball" : "Eyelid"} animation: ${
    styles.find(style => style.id === chosen).label}.`);
}
for (const [key, styles, dice] of [
  ["eyeballStyle", OCULOID_EYEBALL_STYLES, "eyeballDice"],
  ["eyelidStyle", OCULOID_EYELID_STYLES, "eyelidDice"],
]) {
  $(key).addEventListener("change", event =>
    setAnimationStyle(key, event.currentTarget.value, styles), options);
  $(dice).addEventListener("click", () =>
    setAnimationStyle(key, randomOculoidStyle(styles, state[key]), styles), options);
}

$("outputLevel").addEventListener("input", event => {
  audio.setOutput(event.currentTarget.value);
  $("outputLevelOut").textContent = `${Math.round(audio.level * 100)}%`;
}, options);

$("audioButton").addEventListener("click", () => {
  if (audio.running) {
    audio.mute();
    syncAudio();
    return;
  }
  // arm() creates/resumes the context *inside* this explicit pointer/key
  // gesture. Awaiting any other work first breaks mobile autoplay policies.
  audio.cry(crying, tearBeatAt());
  const task = audio.arm();
  syncAudio();
  task.then(() => {
    if (!disposed) { syncAudio(); schedule(); }
  }).catch(error => {
    if (!disposed) { announce(`Audio could not start: ${error.message}`); syncAudio(); }
  });
}, options);

function setPlaying(value) {
  if (playing === value) return;
  playing = value;
  audio.setPlaying(playing);
  sync();
  if (!playing && frame) { cancelAnimationFrame(frame); frame = 0; }
  schedule();
}

$("motionButton").addEventListener("click", () => setPlaying(!playing), options);

function resetEye() {
  cancelKnobs();
  // A pending captured drag or held L key must not apply an old pose after
  // either Reset button has restored the centered eye.
  if (dragging) {
    const { id } = dragging;
    dragging = null;
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  if (gazeDragging) {
    const { id } = gazeDragging;
    gazeDragging = null;
    if (gazePad.hasPointerCapture(id)) gazePad.releasePointerCapture(id);
  }
  if (lightDragging) {
    const { handle, id } = lightDragging;
    lightDragging = null;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  heldBlink = null;
  setPokeMode(false, true);
  setFlashlightMode(false, true);
  setSurfaceMode("none", true);
  clearSurface();
  setCry(false, true);
  setRetractor(false, true);
  setLidsHidden(false, true);
  surfaceSpot = OCULOID_POKE_HOME;
  viewer.resetFlashlight();
  audio.flashlight(0);
  setFlashAim(0, 0);
  setFlashlightPower(FLASHLIGHT_DEFAULT_POWER);
  for (const key of Object.keys(OCULOID_SURFACE_DEFAULTS))
    setSurfaceControl(key, OCULOID_SURFACE_DEFAULTS[key]);
  setCryTempo(OCULOID_DEFAULTS.tempo);
  midi.clear();
  Object.assign(state, normalizeOculoid(OCULOID_DEFAULTS));
  setTurn(0, 0);
  setLighting(OCULOID_LIGHT_DEFAULTS);
  setEyeLook(OCULOID_APPEARANCE_DEFAULTS.eyeLook);
  setIrisColor(OCULOID_APPEARANCE_DEFAULTS.irisColor);
  setIrisPattern(OCULOID_APPEARANCE_DEFAULTS.irisPattern);
  setScleraColor(OCULOID_APPEARANCE_DEFAULTS.scleraColor);
  setScleraPattern(OCULOID_APPEARANCE_DEFAULTS.scleraPattern);
  setScleraPatternColor(OCULOID_APPEARANCE_DEFAULTS.scleraPatternColor);
  setEyeCount(1);
  setEnsembleStyle("banter", true);
  resetWardrobe();
  audio.setConfig(state);
  audio.seekBeat(0);
  sync();
  schedule();
  announce("Eye returned to the starting pose.");
}
for (const id of ["resetAll", "stageReset"])
  $(id).addEventListener("click", resetEye, options);

function applyPreset(snapshot) {
  cancelKnobs();
  Object.assign(state, normalizeOculoid(snapshot));
  audio.setConfig(midi.performance(state));
  sync();
  schedule();
}

presets = registerHeaderPresets({
  id: "oculoid", presets: OCULOID_PRESETS,
  capture: () => normalizeOculoid(state),
  apply: applyPreset,
  randomize: randomizeOculoid,
  onApplied: () => schedule(),
});

function normalizedControl(key, value) {
  const input = $(key);
  if (!input) return;
  const min = Number(input.min), max = Number(input.max), step = Number(input.step) || 0.01;
  const raw = min + (max - min) * clampEye(value, 0, 1, 0);
  input.value = String(clampEye(Math.round((raw - min) / step) * step + min, min, max));
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

const midiMacros = ["gazeX", "gazeY", "blink", "pupil", "wetness", "veins", "tone", "air"];
function handleMidi(event) {
  const { message, routeId } = event.detail ?? {};
  if (disposed || !message || (routeId && routeId !== "oculoid")) return;
  if (midi.handle(message)) {
    event.preventDefault();
    audio.setConfig(midi.performance(state));
    if (message.type === "noteOn" && Number(message.velocity) > 0) {
      audio.excite(Number(message.velocity) / 127);
    }
    schedule();
    return;
  }
  if (message.type === "controlChange") {
    const value = clampEye(message.value, 0, 127, 0) / 127;
    const index = message.logical?.type === "macro" ? message.logical.index : null;
    const target = Number.isInteger(index) ? midiMacros[index] : ({
      1: "pupil", 7: "outputLevel", 11: "air", 71: "veins", 74: "tone",
    })[message.controller];
    if (target) {
      event.preventDefault();
      normalizedControl(target, value);
    }
  } else if (message.type === "programChange" && Number.isInteger(message.program)) {
    event.preventDefault();
    presets?.view?.select(OCULOID_PRESETS[message.program % OCULOID_PRESETS.length].id);
  } else if (message.type === "start" || message.type === "continue") {
    event.preventDefault();
    setPlaying(true);
  } else if (message.type === "stop") {
    // Let the shared adapter reset its 24-PPQN clock tracker too. Its
    // transport fallback observes our already-paused button and does nothing.
    midi.clear();
    audio.setConfig(state);
    setPlaying(false);
  }
}
window.addEventListener("morphazoid:midi-input", handleMidi, options);

// The stage is a direct eye surface; controls remain its keyboard alternative.
canvas.addEventListener("pointerdown", event => {
  if (dragging || event.button !== 0 || event.isPrimary === false) return;
  const surface = flashlightMode ? null : viewer.surfacePoint(event);
  const pokeHit = pokeMode ? viewer.pokePoint(event) : null;
  const toolHit = surfaceMode !== "none" ? viewer.pokePoint(event) : null;
  const point = viewer.stagePoint(event);
  const top = surface ? surface.y - lidEdge(surface.x, true, state.blink, state.lowerLid) : Infinity;
  const bottom = surface ? lidEdge(surface.x, false, state.blink, state.lowerLid) - surface.y : Infinity;
  // The spherical pick surface can put a hit just beyond the rounded lip near the
  // globe edge. Widen only that lid's grab zone so a fully open lid can be pulled
  // back without stealing central-iris gaze gestures at the resting pose.
  const nearTop = !retracted && !lidsHidden && surface?.z > 0 && Math.abs(surface.x) < 0.94
    && top > -0.05 - 0.45 * Math.max(0, -state.blink) && top < 0.43;
  const nearBottom = !retracted && !lidsHidden && surface?.z > 0 && Math.abs(surface.x) < 0.94
    && bottom > -0.05 - 0.45 * Math.max(0, state.lowerLid) && bottom < 0.4;
  const kind = flashlightMode ? "flashlight" : pokeHit ? "poke"
    : surfaceMode !== "none" ? toolHit ? surfaceMode : "tool-miss"
    : !surface ? "turn"
      : nearTop && (!nearBottom || Math.abs(top) < Math.abs(bottom))
    ? "upper" : nearBottom ? "lower"
      : "gaze";
  dragging = {
    id: event.pointerId, kind, point, clientX: event.clientX, clientY: event.clientY,
    x: state.gazeX, y: state.gazeY, blink: state.blink, lowerLid: state.lowerLid,
    yaw: turn.yaw, pitch: turn.pitch, flashlightAim: { ...flashlightAim },
    eyeIndex: pokeHit?.eyeIndex ?? toolHit?.eyeIndex ?? 0,
  };
  canvas.setPointerCapture(event.pointerId);
  canvas.focus({ preventScroll: true });
  if (kind === "flashlight") aimFlashAtPointer(event);
  if (kind === "poke") {
    pokeKeyboard = false;
    setPoke(event.pointerType === "pen" ? clampEye(event.pressure, 0.15, 1, 0.68) : 0.68,
      pokeHit, 0, true);
  }
  if (toolHit) {
    setSurfaceSpot(toolHit);
    if (kind === "stretch") {
      stretchAnchor = toolHit;
      stretchTarget = { x: 0, y: 0 };
      audio.surface({ kind, strength: 0.25, pan: toolHit.x * 0.84 });
    }
  } else if (kind === "tool-miss") {
    announce("Touch the exposed globe to use the selected tool; it will not steer gaze.");
  }
  event.preventDefault();
}, options);

canvas.addEventListener("pointermove", event => {
  if (!dragging) {
    if (flashlightMode && event.pointerType !== "touch") aimFlashAtPointer(event);
    return;
  }
  if (event.pointerId !== dragging.id) return;
  if (dragging.kind === "flashlight") {
    aimFlashAtPointer(event);
  } else if (dragging.kind === "turn") {
    const rect = canvas.getBoundingClientRect();
    setTurn(dragging.yaw + (event.clientX - dragging.clientX) * 180 / Math.max(1, rect.width),
      dragging.pitch + (dragging.clientY - event.clientY) * 180 / Math.max(1, rect.height));
  } else if (dragging.kind === "poke") {
    const hit = viewer.pokePoint(event);
    const contact = hit?.eyeIndex === dragging.eyeIndex ? hit : null;
    if (!contact) {
      if (pokeTarget) setPoke(0, pokeContact, 0, true);
    } else {
      const travel = Math.hypot(contact.x - pokeContact.x, contact.y - pokeContact.y,
        contact.z - pokeContact.z) / 0.17;
      const pressure = event.pointerType === "pen"
        ? clampEye(event.pressure, 0.15, 1, 0.68)
        : clampEye(0.68 + (event.clientY - dragging.clientY) / 210, 0.14, 1);
      setPoke(pressure, contact, travel, !pokeTarget);
    }
  } else if (dragging.kind === "stretch") {
    const hit = viewer.pokePoint(event);
    const contact = hit?.eyeIndex === dragging.eyeIndex ? hit : null;
    if (contact) {
      setSurfaceSpot(contact);
      tugCornea(contact.x - stretchAnchor.x, contact.y - stretchAnchor.y, contact);
    }
  } else if (dragging.kind === "tool-miss") {
    // An occluded or outside-iris tool press must not silently become Gaze.
  } else if (dragging.kind === "upper") {
    const now = viewer.stagePoint(event);
    change("blink", dragging.blink + (dragging.point.y - now.y) * 1.8);
  } else if (dragging.kind === "lower") {
    const now = viewer.stagePoint(event);
    change("lowerLid", dragging.lowerLid + (dragging.point.y - now.y) * 2);
  } else {
    const now = viewer.stagePoint(event);
    setGaze(dragging.x + (now.x - dragging.point.x) * 1.5,
      dragging.y + (now.y - dragging.point.y) * 1.5);
  }
  event.preventDefault();
}, options);

function releasePointer(event) {
  if (!dragging || event.pointerId !== dragging.id) return;
  if (dragging.kind === "poke") {
    if (event.type === "pointerup") setPoke(0, pokeContact, 0, true);
    else cancelPoke();
  }
  if (surfaceTools.includes(dragging.kind)) {
    releaseStretch(event.type !== "pointerup");
  }
  if (event.type === "pointercancel" || event.type === "lostpointercapture") {
    if (dragging.kind === "flashlight") setFlashAim(dragging.flashlightAim.x, dragging.flashlightAim.y);
    else if (dragging.kind === "turn") setTurn(dragging.yaw, dragging.pitch);
    else if (dragging.kind !== "poke" && !surfaceTools.includes(dragging.kind)) {
      state.gazeX = dragging.x;
      state.gazeY = dragging.y;
      state.blink = dragging.blink;
      state.lowerLid = dragging.lowerLid;
      audio.setConfig(midi.performance(state));
      sync(); schedule();
    }
  }
  dragging = null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
}
canvas.addEventListener("pointerup", releasePointer, options);
canvas.addEventListener("pointercancel", releasePointer, options);
canvas.addEventListener("lostpointercapture", releasePointer, options);

canvas.addEventListener("keydown", event => {
  const steps = { ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    ArrowUp: [0, 1], ArrowDown: [0, -1] };
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (steps[event.key]) {
    const [x, y] = steps[event.key], amount = event.shiftKey ? 0.02 : 0.07;
    if (flashlightMode) {
      setFlashAim(flashlightAim.x + x * amount, flashlightAim.y + y * amount);
    } else if (pokeMode) {
      let px = pokeContact.x + x * amount, py = pokeContact.y + y * amount;
      const radius = Math.hypot(px, py);
      if (radius > 0.75) { px *= 0.75 / radius; py *= 0.75 / radius; }
      pokeContact = oculoidPokeContact({ x: px, y: py,
        z: Math.sqrt(1 - px * px - py * py) });
      if (pokeKeyboard) setPoke(0.82, pokeContact, 0.3, true);
      else schedule();
    } else if (surfaceMode === "stretch") {
      if (keyboardStretch) {
        tugCornea(stretchTarget.x + x * amount, stretchTarget.y + y * amount);
      } else {
        let px = surfaceSpot.x + x * amount, py = surfaceSpot.y + y * amount;
        const radius = Math.hypot(px, py);
        if (radius > 0.76) { px *= 0.76 / radius; py *= 0.76 / radius; }
        const contact = oculoidPokeContact({ x: px, y: py,
          z: Math.sqrt(1 - px * px - py * py) });
        setSurfaceSpot(contact);
      }
    } else setGaze(state.gazeX + x * amount, state.gazeY + y * amount);
    event.preventDefault();
  } else if (surfaceMode === "stretch" && event.key === "Enter" && !event.repeat) {
    if (keyboardStretch) releaseStretch();
    else {
      keyboardStretch = true;
      stretchAnchor = surfaceSpot;
      audio.surface({ kind: "stretch", strength: 0.25, pan: surfaceSpot.x * 0.84 });
    }
    event.preventDefault();
  } else if (surfaceMode !== "none" && event.key === "Escape") {
    if (keyboardStretch) releaseStretch();
    event.preventDefault();
  } else if (pokeMode && event.key.toLowerCase() === "p" && !event.repeat
  ) {
    pokeKeyboard = true;
    setPoke(0.82, pokeContact, 0, true);
    event.preventDefault();
  } else if (event.key.toLowerCase() === "l" && !event.repeat && !retracted && !lidsHidden) {
    heldBlink = state.blink;
    change("blink", 1);
    event.preventDefault();
  }
}, options);

function releaseCanvasKeys(event) {
  if (pokeKeyboard && (event.type === "blur" || event.key?.toLowerCase() === "p")) {
    pokeKeyboard = false;
    setPoke(0, pokeContact, 0, true);
  }
  if (event.type === "blur" && keyboardStretch) clearSurface();
  if (event.type !== "blur" && event.key?.toLowerCase() !== "l") return;
  if (heldBlink === null) return;
  change("blink", heldBlink);
  heldBlink = null;
}
canvas.addEventListener("keyup", releaseCanvasKeys, options);
canvas.addEventListener("blur", releaseCanvasKeys, options);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (dragging?.kind === "poke" || surfaceTools.includes(dragging?.kind)) {
      const { id } = dragging;
      dragging = null;
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    cancelPoke(true);
    setSurfaceMode("none", true);
    clearSurface();
    setCry(false, true);
    setRetractor(false, true);
    setFlashlightMode(false, true);
    if (frame) { cancelAnimationFrame(frame); frame = 0; }
  } else schedule();
}, options);

const observer = new ResizeObserver(() => {
  setSurfaceControl("flashDiameter", surfaceControls.flashDiameter);
  schedule();
});
observer.observe(canvas);
window.addEventListener("pagehide", event => {
  if (!event.persisted) { dispose(); return; }
  if (disposed || cached) return;
  cached = true;
  cancelPoke(true);
  setSurfaceMode("none", true);
  clearSurface();
  setCry(false, true);
  setRetractor(false, true);
  setFlashlightMode(false, true);
  parkedBeat = audio.getBeat();
  wasArmed = audio.armed;
  if (frame) cancelAnimationFrame(frame);
  frame = 0;
  cancelKnobs();
  if (gazeDragging) {
    const { id, x, y } = gazeDragging;
    gazeDragging = null;
    setGaze(x, y);
    if (gazePad.hasPointerCapture(id)) gazePad.releasePointerCapture(id);
  }
  if (dragging) {
    const { id, kind, x, y, blink, lowerLid, yaw, pitch } = dragging;
    dragging = null;
    if (kind === "turn") setTurn(yaw, pitch);
    else Object.assign(state, { gazeX: x, gazeY: y, blink, lowerLid });
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }
  if (lightDragging) {
    const { handle, id, before } = lightDragging;
    lightDragging = null;
    setLighting(before);
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  if (heldBlink !== null) { state.blink = heldBlink; heldBlink = null; }
  midi.clear();
  audio.setConfig(state);
  void audio.close().catch(() => {});
  sync();
}, options);

window.addEventListener("pageshow", event => {
  if (!event.persisted || disposed || !cached) return;
  cached = false;
  audio.seekBeat(parkedBeat ?? 0);
  parkedBeat = null;
  sync();
  if (wasArmed) announce("Audio is off after returning. Tap Audio to resume.");
  wasArmed = false;
  schedule();
}, options);

function dispose() {
  if (disposed) return;
  disposed = true;
  audio.cry(false, 0);
  cancelPoke(true);
  clearSurface();
  audio.retractLids(false);
  audio.flashlight(0);
  cancelKnobs();
  listeners.abort();
  if (frame) cancelAnimationFrame(frame);
  observer.disconnect();
  presets?.destroy();
  for (const knob of rangeKnobs.values()) knob.destroy();
  viewer.dispose();
  void audio.dispose().catch(() => {});
}

setTurn(0, 0);
setLighting(OCULOID_LIGHT_DEFAULTS);
setEyeLook(eyeLook);
setFlashAim(0, 0);
setFlashlightPower(FLASHLIGHT_DEFAULT_POWER);
for (const key of Object.keys(OCULOID_SURFACE_DEFAULTS))
  setSurfaceControl(key, OCULOID_SURFACE_DEFAULTS[key]);
setCryTempo(OCULOID_DEFAULTS.tempo);
setIrisColor(irisColorId);
setIrisPattern(irisPatternId);
setScleraColor(scleraColorId);
setScleraPattern(scleraPatternId);
setScleraPatternColor(scleraPatternHex);
sync();
render();
