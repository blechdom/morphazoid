import { createRoachViewer } from "./src/roach-synth-viewer.js";
import { ROACH_MOTION_PRESETS, ROACH_MOTION_DEFAULTS, normalizeRoachMotion, activeRoachPreset, writeRoachPose, createRoachJointTrack, roachSequencePosition, createRoachSceneState, writeRoachSceneState } from "./src/roach-synth-motion.js";
import { RoachSynthAudio, ROACH_SOUND_DEFAULTS, ROACH_SOUND_PRESETS, ROACH_MOD_TARGETS, createDefaultRoachMappings } from "./src/roach-synth-audio.js";

const el = (id) => document.getElementById(id);
const listeners = new AbortController();
const options = { signal: listeners.signal };
const modelUrl = new URL("./assets/roach-synth/cockroach.glb", import.meta.url);
const sources = ["x", "y", "z", "xy", "xz", "yz", "xyz"];
const quality = { economy: { fps: 20, pixelRatio: 1 }, balanced: { fps: 25, pixelRatio: 1.25 }, detail: { fps: 30, pixelRatio: 1.5 } };
const motionQuery = matchMedia("(prefers-reduced-motion: reduce)");
const state = {
  playing: false, audioOn: false, audioStarting: false, disposed: false,
  view: "side", side: "left", motion: normalizeRoachMotion(ROACH_MOTION_DEFAULTS),
  sound: { ...ROACH_SOUND_DEFAULTS }, mappings: [], joints: [],
  time: 0, anchor: performance.now(), clipPreview: false, sequenceAxis: "y", selectedStep: 0,
  renderQuality: "economy", activePreset: "", phraseRequest: 0,
};
let viewer;
let rigSignature = "";
let loadVersion = 0;
let frame = 0;
let lastFrame = -Infinity;
let pose = new Float32Array(0);
let routeSerial = 0;
const sceneState = createRoachSceneState();
const patchStorageKey = "morphazoid.roach-synth.joint-patches.v1";
const editedPatches = new Map();
try {
  const stored = localStorage.getItem(patchStorageKey);
  if (stored && stored.length < 800000) {
    const data = JSON.parse(stored);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      for (const preset of [{ id: "none" }, ...ROACH_MOTION_PRESETS]) {
        if (data[preset.id]) {
          const motion = normalizeRoachMotion({ ...data[preset.id], presetId: preset.id });
          editedPatches.set(preset.id, { tracks: motion.tracks, sequenceEnabled: motion.sequenceEnabled });
        }
      }
    }
  }
} catch { /* Storage is optional; live performance never depends on it. */ }
const initialEdits = editedPatches.get(state.motion.presetId);
if (initialEdits) state.motion = normalizeRoachMotion({ ...state.motion, ...initialEdits });
const setStatus = (message) => { el("modelStatus").textContent = String(message); };
const announce = (message) => { el("liveStatus").textContent = String(message); };
const audio = new RoachSynthAudio({
  onStatus: (message) => {
    if (state.disposed) return;
    el("voiceStatus").textContent = String(message);
    if (state.audioOn && !audio.getState().enabled) {
      anchorTime(audio.getTime()); state.audioOn = false;
      el("audioButton").setAttribute("aria-pressed", "false"); el("audioState").textContent = "off";
      syncTransport();
    }
  },
  onTelemetry: () => {},
});
function fallbackTime() { return state.time + (state.playing ? (performance.now() - state.anchor) / 1000 : 0); }
function currentTime() { return state.audioOn ? audio.getTime() : fallbackTime(); }
function anchorTime(time) { state.time = Math.max(0, Number(time) || 0); state.anchor = performance.now(); }
function publish(extra = {}) {
  audio.update({ playing: state.playing, motion: state.motion, joints: state.joints, mappings: state.mappings, sound: state.sound, ...extra });
}
function selectedPart() { return state.joints.find((part) => part.id === el("bodyPart").value); }
function refreshJoints() {
  if (!viewer) return;
  state.joints = viewer.getState().bones;
  if (pose.length !== state.joints.length * 3) pose = new Float32Array(state.joints.length * 3);
}
function selectView(view) {
  state.view = ["side", "top", "bottom", "face"].includes(view) ? view : "side";
  viewer?.setViewPreset(state.view, { side: state.side });
  for (const button of el("viewPresets").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.view === state.view));
  el("sideToggle").hidden = state.view !== "side";
  refreshGaze();
}
function refreshGaze() {
  const preset = activeRoachPreset(currentTime(), state.motion);
  state.motion.gaze = viewer && (state.view === "face" || preset.lookAtViewer) ? viewer.getGazeOffset() : { x: 0, y: 0, z: 0 };
  publish(); updateVisual();
}
function populateMotionPresets() {
  el("motionPreset").replaceChildren(new Option("Manual / joint score only", "none"));
  ROACH_MOTION_PRESETS.forEach((preset, index) => el("motionPreset").add(new Option(`${String(index + 1).padStart(2, "0")} · ${preset.label}`, preset.id)));
  el("motionPreset").value = state.motion.presetId;
  const index = ROACH_MOTION_PRESETS.findIndex((preset) => preset.id === state.motion.presetId);
  el("patchNumber").value = index < 0 ? "Manual" : `${String(index + 1).padStart(2, "0")} / ${ROACH_MOTION_PRESETS.length}`;
}
function selectedTrack(create = false) {
  const part = selectedPart(); if (!part) return null;
  let track = state.motion.tracks.find((track) => track.jointId === part.id && track.axis === state.sequenceAxis);
  if (!track && create && state.motion.tracks.length < 81) {
    track = createRoachJointTrack(part.id, state.sequenceAxis);
    state.motion.tracks.push(track);
  }
  return track;
}
function rememberPatch() {
  editedPatches.set(state.motion.presetId, { tracks: structuredClone(state.motion.tracks), sequenceEnabled: state.motion.sequenceEnabled });
}
function markScoreEdited() {
  state.motion.sequenceEnabled = true; el("sequenceEnabled").checked = true;
  rememberPatch(); el("patchStatus").textContent = "Joint score edited. Save edits to keep it in this browser.";
  publish(); renderSequence(); updateVisual();
}
function renderSequence() {
  const part = selectedPart();
  const track = selectedTrack();
  el("sequenceJoint").value = part?.id ?? "";
  el("sequenceSteps").replaceChildren();
  for (let index = 0; index < 16; index += 1) {
    const button = document.createElement("button"); button.type = "button"; button.className = "roach-step"; button.dataset.step = String(index);
    const value = track?.steps[index] ?? 0;
    button.setAttribute("aria-label", `Step ${index + 1}, ${state.sequenceAxis.toUpperCase()} rotation ${Math.round(value)} degrees`);
    button.setAttribute("aria-pressed", String(index === state.selectedStep));
    button.disabled = !part;
    const label = document.createElement("span"); label.textContent = String(index + 1).padStart(2, "0");
    const amount = document.createElement("strong"); amount.textContent = `${Math.round(value)}°`;
    button.classList.toggle("has-value", Math.abs(value) > .1);
    button.append(label, amount);
    button.addEventListener("click", () => { state.selectedStep = index; syncStepEditor(); }, options);
    el("sequenceSteps").append(button);
  }
  for (const button of el("sequenceAxes").querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.axis === state.sequenceAxis));
  const tracks = state.motion.tracks.filter((item) => item.enabled !== false && item.steps.some((value) => Math.abs(value) > .01)).length;
  el("sequenceSummary").textContent = `${tracks} tracks · 16 steps`;
  syncStepEditor();
}
function syncStepEditor() {
  const track = selectedTrack(); const value = track?.steps[state.selectedStep] ?? 0;
  el("stepRotation").value = String(value); el("stepRotationOut").value = `${Math.round(value)}°`;
  el("stepLabel").textContent = `Step ${state.selectedStep + 1} · ${state.sequenceAxis.toUpperCase()} rotation`;
  for (const id of ["stepRotation", "captureStep", "waveTrack", "clearTrack"]) el(id).disabled = !selectedPart();
  for (const button of el("sequenceSteps").children) button.setAttribute("aria-pressed", String(Number(button.dataset.step) === state.selectedStep));
}
function syncTransport() {
  const button = el("motionButton");
  button.setAttribute("aria-pressed", String(state.playing));
  button.setAttribute("aria-label", state.playing ? "Pause cockroach motion" : "Play cockroach motion");
  el("motionSummary").textContent = state.playing ? "Playing" : "Paused";
  if (state.playing && !state.audioOn) announce("Audio is off — turn it on to hear playback");
  else announce(state.playing ? "Body motion is driving the sound." : "Animation paused. Drag a part to play it, or say a phrase.");
}
function setPlaying(playing) {
  const time = currentTime();
  state.playing = Boolean(playing);
  anchorTime(time);
  if (state.clipPreview) viewer?.setPlaying(state.playing);
  publish({ time });
  syncTransport();
  updateVisual();
  scheduleFrame();
}
function seek(time) { anchorTime(time); publish({ time: state.time }); updateVisual(); }
function syncSelectedPart() {
  if (!viewer) return;
  refreshJoints();
  const rig = viewer.getState();
  el("bodyPart").value = rig.selectedBone ?? "";
  const part = selectedPart();
  el("poseControls").disabled = !part;
  el("motionControls").disabled = !part;
  el("addMapping").disabled = !part || state.mappings.length >= 81;
  for (const axis of ["x", "y", "z"]) {
    const id = `pose${axis.toUpperCase()}`;
    el(id).value = String(part?.offset[axis] ?? 0);
    el(`${id}Out`).value = `${Math.round(part?.offset[axis] ?? 0)}°`;
  }
  el("motionAxis").value = part?.motion.axis ?? "y";
  el("motionAmount").value = String(part?.motion.amplitude ?? 12);
  el("motionRate").value = String(part?.motion.speed ?? 0.5);
  el("motionAmountOut").value = `${el("motionAmount").value}°`;
  el("motionRateOut").value = `${Number(el("motionRate").value).toFixed(1)} Hz`;
  el("jointMotion").setAttribute("aria-pressed", String(Boolean(part?.motion.enabled)));
  el("jointMotion").textContent = part?.motion.enabled ? "Stop this part" : "Animate this part";
  const count = state.joints.filter((joint) => joint.motion.enabled).length;
  el("activeMotions").textContent = `${count} extra part movement${count === 1 ? "" : "s"}. Each part keeps its settings.`;
  el("stageJoint").textContent = part?.name.toUpperCase() ?? "";
  renderMappings();
  renderSequence();
  updateVisual();
}
function syncRig() {
  if (!viewer) return;
  const rig = viewer.getState();
  const signature = JSON.stringify([rig.modelName, rig.bones.map(({ id, name }) => [id, name]), rig.clips]);
  el("specimenImage").hidden = rig.loaded;
  el("roachCanvas").style.visibility = rig.loaded ? "visible" : "hidden";
  if (signature !== rigSignature) {
    rigSignature = signature;
    refreshJoints();
    state.mappings = createDefaultRoachMappings(state.joints).slice(0, 81).map((route) => ({ ...route, id: `route-${++routeSerial}` }));
    el("bodyPart").replaceChildren(); el("sequenceJoint").replaceChildren();
    for (const part of state.joints) { el("bodyPart").add(new Option(part.name, part.id)); el("sequenceJoint").add(new Option(part.name, part.id)); }
    if (!state.joints.length) el("bodyPart").add(new Option("No movable joints", ""));
    el("animationClip").replaceChildren(new Option("Procedural body motion", "-1"));
    rig.clips.forEach((clip, index) => el("animationClip").add(new Option(clip.name || `Clip ${index + 1}`, String(index))));
    el("clipControls").hidden = !rig.clips.length;
    state.clipPreview = false;
    publish();
  }
  el("jointCount").textContent = `${rig.bones.length} joints`;
  for (const id of ["bodyPart", "sequenceJoint", "showJoints"]) el(id).disabled = !rig.bones.length;
  for (const id of ["motionButton", "resetCamera", "resetPose"]) el(id).disabled = !rig.loaded;
  syncSelectedPart();
}
function renderMappings() {
  const part = selectedPart();
  const container = el("jointMappings"); container.replaceChildren();
  const routes = state.mappings.filter((route) => route.jointId === part?.id);
  for (const route of routes) {
    const row = document.createElement("div"); row.className = "roach-mapping";
    const source = document.createElement("select"); source.setAttribute("aria-label", `${part.name} movement source`);
    for (const id of sources) source.add(new Option(id.toUpperCase().split("").join(" + "), id));
    source.value = route.source;
    const target = document.createElement("select"); target.setAttribute("aria-label", `${part.name} sound destination`);
    for (const item of ROACH_MOD_TARGETS) target.add(new Option(item.label, item.id));
    target.value = route.target;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "mapping-remove"; remove.textContent = "×"; remove.setAttribute("aria-label", `Remove ${part.name} ${route.source} to ${route.target} route`);
    const label = document.createElement("label"); label.className = "control mapping-depth";
    const text = document.createElement("span"); text.textContent = "Depth ";
    const output = document.createElement("output"); output.value = `${Math.round(route.amount * 100)}%`; text.append(output);
    const depth = document.createElement("input"); depth.type = "range"; depth.min = "-1"; depth.max = "1"; depth.step = "0.01"; depth.value = String(route.amount); depth.setAttribute("aria-label", `${part.name} route depth`);
    label.append(text, depth);
    source.addEventListener("change", () => { route.source = source.value; publish(); }, options);
    target.addEventListener("change", () => { route.target = target.value; publish(); }, options);
    depth.addEventListener("input", () => { route.amount = Number(depth.value); output.value = `${Math.round(route.amount * 100)}%`; publish(); }, options);
    remove.addEventListener("click", () => { state.mappings = state.mappings.filter((item) => item !== route); publish(); renderMappings(); }, options);
    row.append(source, target, remove, label); container.append(row);
  }
  if (!routes.length) { const note = document.createElement("p"); note.className = "roach-note"; note.textContent = "Add a route from this part’s rotation to a sound parameter."; container.append(note); }
  el("mappingCount").textContent = `${state.mappings.length} routes across ${new Set(state.mappings.map((route) => route.jointId)).size} parts. Combine axes or add more routes.`;
  el("addMapping").disabled = !part || state.mappings.length >= 81;
}
function formatSound(id, value) {
  if (id === "pitch" || id === "wingRate") return `${Math.round(value)} Hz`;
  if (id === "rhythm") return `${Number(value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`;
  if (id === "pan") return Math.abs(value) < .01 ? "Center" : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "L" : "R"}`;
  return `${Math.round(value * 100)}%`;
}
function syncSound() {
  for (const input of document.querySelectorAll("[data-sound]")) {
    input.value = String(state.sound[input.dataset.sound]);
    el(`${input.id}Out`).value = formatSound(input.id, state.sound[input.dataset.sound]);
  }
  el("level").value = String(state.sound.level); el("levelOut").value = `${Math.round(state.sound.level * 100)}%`;
}
function setMotionPreset(id) {
  rememberPatch();
  const edited = editedPatches.get(id) ?? { tracks: [], sequenceEnabled: false };
  state.motion = normalizeRoachMotion({ ...state.motion, ...edited, presetId: id });
  el("sequenceEnabled").checked = state.motion.sequenceEnabled;
  if (id !== "none") { state.motion.antennae = true; el("antennae").checked = true; }
  state.clipPreview = false; el("animationClip").value = "-1";
  viewer?.setClip(-1); viewer?.setPlaying(false);
  populateMotionPresets(); renderSequence(); refreshGaze();
  el("patchStatus").textContent = edited.tracks.length ? "Your joint score is loaded for this routine." : "Factory routine. Add a joint score to customize it.";
  publish(); updateVisual();
}
async function loadModel(file) {
  if (!viewer) return;
  const version = ++loadVersion; el("retryModel").hidden = true;
  try {
    if (file) {
      if (!/\.glb$/i.test(file.name)) throw new Error("Choose a self-contained .glb model file.");
      if (file.size > 64 * 1024 * 1024) throw new Error("Choose a GLB smaller than 64 MB.");
      const buffer = await file.arrayBuffer();
      if (version !== loadVersion) return;
      await viewer.loadArrayBuffer(buffer, { name: file.name });
    } else await viewer.loadUrl(modelUrl.href, { name: "Cockroach · photogrammetry scan" });
    if (version !== loadVersion) return;
    const rig = viewer.getState(); const head = rig.bones.find((part) => /^head$/i.test(part.name));
    if (head) viewer.selectBone(head.id);
    syncRig(); selectView(state.view, { manual: false }); publish();
    setStatus(`${rig.modelName} · ${rig.bones.length} movable joints`);
    updateVisual();
  } catch (error) {
    if (version !== loadVersion) return;
    setStatus(`${error.message || "The model could not load."}${viewer.getState().loaded ? " The current model is still available." : ""}`);
    el("retryModel").hidden = false;
  } finally { el("modelFile").value = ""; }
}
function updateVisual() {
  if (state.disposed) return;
  const time = currentTime();
  const preset = activeRoachPreset(time, state.motion);
  if (state.activePreset !== preset.id) {
    state.activePreset = preset.id;
    el("motionDescription").textContent = preset.description || (preset.id === "none" ? "Manual pose and your joint score." : `${preset.label} · looping motion patch.`);
  }
  if (viewer && state.joints.length && !state.clipPreview) {
    writeRoachPose(time, state.motion, state.joints, pose);
    writeRoachSceneState(time, state.motion, sceneState, state.joints);
    viewer.setExternalPose(pose);
    viewer.setSceneState(sceneState);
  }
  const position = roachSequencePosition(time, state.motion);
  el("timelinePositionOut").value = `${position.step + 1} / 16`;
  if (document.activeElement !== el("timelinePosition")) el("timelinePosition").value = String(position.step + position.fraction);
  for (const cell of el("sequenceSteps").children) cell.classList.toggle("is-current", state.motion.sequenceEnabled && Number(cell.dataset.step) === position.step);
  const motionLabel = state.clipPreview ? (el("animationClip").selectedOptions[0]?.textContent ?? "Clip preview") : preset.label;
  el("stageMotion").textContent = `${motionLabel.toUpperCase()} / ${state.playing ? "PLAYING" : "PAUSED"}`;
  el("timelinePosition").disabled = state.clipPreview;
  el("sequenceEnabled").disabled = state.clipPreview;
  const index = state.joints.findIndex((part) => part.id === el("bodyPart").value);
  if (state.clipPreview) el("jointReadout").textContent = "Visual clip preview · sound follows the motion patch";
  else if (index >= 0) el("jointReadout").textContent = ["X", "Y", "Z"].map((axis, offset) => `${axis} ${Math.round(pose[index * 3 + offset])}°`).join(" · ");
}
function syncManualPose() {
  refreshJoints(); const part = selectedPart();
  for (const axis of ["x", "y", "z"]) {
    const value = part?.offset[axis] ?? 0;
    el(`pose${axis.toUpperCase()}`).value = String(value);
    el(`pose${axis.toUpperCase()}Out`).value = `${Math.round(value)}°`;
  }
  publish(); updateVisual();
}
function tick(now) {
  frame = 0;
  if (state.disposed || document.hidden) return;
  if (now - lastFrame >= 1000 / quality[state.renderQuality].fps) { lastFrame = now; updateVisual(); }
  if (state.playing) scheduleFrame();
}
function scheduleFrame() { if (!frame && !state.disposed && !document.hidden) frame = requestAnimationFrame(tick); }

el("soundPreset").replaceChildren(...ROACH_SOUND_PRESETS.map((preset) => new Option(preset.label, preset.id)));
const defaultSound = ROACH_SOUND_PRESETS.find((preset) => JSON.stringify(preset.sound) === JSON.stringify(state.sound)) ?? ROACH_SOUND_PRESETS[0];
if (defaultSound) { el("soundPreset").value = defaultSound.id; el("soundSummary").textContent = defaultSound.label; }
populateMotionPresets(); renderSequence(); syncSound(); el("sequenceEnabled").checked = state.motion.sequenceEnabled; updateVisual();
try {
  viewer = createRoachViewer({ canvas: el("roachCanvas"), onStatus: setStatus, onRig: syncRig, onSelect: syncSelectedPart,
    onPoseChange: syncManualPose,
    onInteraction: (gesture) => {
      if (gesture.kind === "orbit") { if (gesture.phase === "change" || gesture.phase === "end") refreshGaze(); return; }
      if (gesture.kind !== "joint") return;
      audio.interact({ jointId: gesture.id, active: gesture.phase === "start" || gesture.phase === "change", velocity: gesture.velocity });
      if (!state.audioOn && gesture.phase === "start") announce("Audio is off — turn it on to hear playback");
    },
  });
  viewer.setRenderBudget(quality[state.renderQuality]);
  Object.defineProperty(window, "roachSynth", { configurable: true, value: Object.freeze({ getState: () => ({
    ...viewer.getState(), playing: state.playing, time: currentTime(), view: state.view, side: state.side,
    motionSettings: structuredClone(state.motion), sound: { ...state.sound }, mappings: structuredClone(state.mappings),
    audio: audio.getState(), audioOn: state.audioOn, clipPreview: state.clipPreview,
    activePreset: state.activePreset, renderQuality: state.renderQuality,
  }), getPartScreenPosition: (id) => viewer.getPartScreenPosition(id) }) });
  loadModel();
} catch (error) {
  setStatus(`3D could not start: ${error.message || "WebGL unavailable"}.`);
  el("roachCanvas").hidden = true; el("modelFile").disabled = true;
}

el("audioButton").addEventListener("click", async () => {
  if (state.audioStarting || state.disposed) return;
  if (state.audioOn) {
    const time = currentTime(); state.audioOn = false; anchorTime(time); audio.disable();
    el("audioButton").setAttribute("aria-pressed", "false"); el("audioState").textContent = "off"; syncTransport(); return;
  }
  state.audioStarting = true; el("audioButton").disabled = true; el("audioState").textContent = "starting";
  try {
    await audio.enable({ time: currentTime(), playing: state.playing, motion: state.motion, joints: state.joints, mappings: state.mappings, sound: state.sound });
    if (state.disposed) return;
    const time = fallbackTime(); state.audioOn = true; publish({ time });
    el("audioButton").setAttribute("aria-pressed", "true"); el("audioState").textContent = "on";
    syncTransport();
  } catch (error) {
    state.audioOn = false; el("audioButton").setAttribute("aria-pressed", "false"); el("audioState").textContent = "error";
    announce(`Audio could not start: ${error.message || error}`);
  } finally { state.audioStarting = false; el("audioButton").disabled = false; }
}, options);
el("motionButton").addEventListener("click", () => setPlaying(!state.playing), options);
for (const button of el("viewPresets").querySelectorAll("button")) button.addEventListener("click", () => selectView(button.dataset.view), options);
el("sideToggle").addEventListener("click", () => {
  state.side = state.side === "left" ? "right" : "left";
  el("sideToggle").textContent = state.side === "left" ? "L → R" : "R → L";
  el("sideToggle").setAttribute("aria-label", `Side view: ${state.side}; switch to ${state.side === "left" ? "right" : "left"}`);
  selectView("side");
}, options);
el("motionPreset").addEventListener("change", () => setMotionPreset(el("motionPreset").value), options);
el("tempo").addEventListener("input", () => {
  const oldTempo = state.motion.tempo; const time = currentTime(); state.motion.tempo = Number(el("tempo").value);
  el("tempoOut").value = `${state.motion.tempo} BPM`; seek(time * oldTempo / state.motion.tempo); publish();
}, options);
el("intensity").addEventListener("input", () => { state.motion.intensity = Number(el("intensity").value); el("intensityOut").value = `${Math.round(state.motion.intensity * 100)}%`; publish(); updateVisual(); }, options);
el("antennae").addEventListener("change", () => { state.motion.antennae = el("antennae").checked; publish(); updateVisual(); }, options);
el("sequenceEnabled").addEventListener("change", () => { state.motion.sequenceEnabled = el("sequenceEnabled").checked; rememberPatch(); publish(); updateVisual(); }, options);
el("timelinePosition").addEventListener("input", () => seek(Number(el("timelinePosition").value) * state.motion.stepBeats * 60 / state.motion.tempo), options);
el("soundPreset").addEventListener("change", () => {
  const preset = ROACH_SOUND_PRESETS.find((item) => item.id === el("soundPreset").value); if (!preset) return;
  state.sound = { ...ROACH_SOUND_DEFAULTS, ...preset.sound, level: state.sound.level };
  el("soundSummary").textContent = preset.label; syncSound(); publish();
}, options);
for (const input of document.querySelectorAll("[data-sound]")) input.addEventListener("input", () => {
  state.sound[input.dataset.sound] = Number(input.value); el(`${input.id}Out`).value = formatSound(input.id, Number(input.value)); publish();
}, options);
el("level").addEventListener("input", () => { state.sound.level = Number(el("level").value); el("levelOut").value = `${Math.round(state.sound.level * 100)}%`; audio.setLevel(state.sound.level); }, options);
el("speakButton").addEventListener("click", async () => {
  if (!state.audioOn) { announce("Audio is off — turn it on to hear playback"); el("voiceStatus").textContent = "Turn Audio on, then say the phrase."; return; }
  const text = el("phrase").value.trim(); if (!text) { el("voiceStatus").textContent = "Give the bug a few words first."; return; }
  const version = ++state.phraseRequest; el("voiceStatus").textContent = "Preparing the bug’s words…";
  try { const spoken = await audio.speak(text); if (spoken && version === state.phraseRequest && !state.disposed && state.audioOn) el("voiceStatus").textContent = `Saying “${text}”`; }
  catch (error) { if (version === state.phraseRequest) el("voiceStatus").textContent = `Voice: ${error.message || error}`; }
}, options);
el("bodyPart").addEventListener("change", () => viewer?.selectBone(el("bodyPart").value), options);
for (const axis of ["x", "y", "z"]) el(`pose${axis.toUpperCase()}`).addEventListener("input", (event) => {
  const part = selectedPart(); if (!part) return;
  viewer.setBoneOffset(part.id, { [axis]: Number(event.target.value) }); syncManualPose();
  audio.interact({ jointId: part.id, active: true, velocity: .35 });
}, options);
function changePartMotion(enabled) {
  const part = selectedPart(); if (!part) return;
  viewer.setBoneMotion(part.id, { enabled: enabled ?? part.motion.enabled, axis: el("motionAxis").value, amplitude: Number(el("motionAmount").value), speed: Number(el("motionRate").value) });
  syncSelectedPart(); publish(); updateVisual();
}
el("jointMotion").addEventListener("click", () => { const part = selectedPart(); if (!part) return; const enabled = !part.motion.enabled; changePartMotion(enabled); if (enabled) setPlaying(true); }, options);
for (const id of ["motionAmount", "motionRate"]) el(id).addEventListener("input", () => changePartMotion(), options);
el("motionAxis").addEventListener("change", () => changePartMotion(), options);
el("addMapping").addEventListener("click", () => {
  const part = selectedPart(); if (!part || state.mappings.length >= 81) return;
  const used = state.mappings.filter((route) => route.jointId === part.id).map((route) => route.source);
  state.mappings.push({ id: `route-${++routeSerial}`, jointId: part.id, source: sources.find((source) => !used.includes(source)) ?? "xyz", target: "pitch", amount: 0.5 });
  publish(); renderMappings();
}, options);
el("resetCamera").addEventListener("click", () => { viewer?.resetCamera(); refreshGaze(); }, options);
el("showJoints").addEventListener("click", () => { const visible = el("showJoints").getAttribute("aria-pressed") !== "true"; viewer?.setSkeletonVisible(visible); el("showJoints").setAttribute("aria-pressed", String(visible)); }, options);
el("resetPose").addEventListener("click", () => {
  setPlaying(false); state.clipPreview = false; viewer?.setExternalPose(null); viewer?.resetPose();
  state.motion = normalizeRoachMotion({ ...state.motion, presetId: "none", antennae: false, sequenceEnabled: false, tracks: [] });
  el("antennae").checked = false; el("sequenceEnabled").checked = false; el("animationClip").value = "-1";
  refreshJoints(); populateMotionPresets(); seek(0); syncSelectedPart(); publish(); updateVisual();
}, options);
el("animationClip").addEventListener("change", () => {
  const clip = Number(el("animationClip").value); state.clipPreview = clip >= 0;
  viewer?.setExternalPose(null); viewer?.setClip(clip); viewer?.setPlaying(state.clipPreview && state.playing);
  updateVisual();
}, options);
el("clipSpeed").addEventListener("input", () => { viewer?.setSpeed(Number(el("clipSpeed").value)); el("clipSpeedOut").value = `${el("clipSpeed").value}×`; }, options);
el("renderQuality").addEventListener("change", () => { state.renderQuality = el("renderQuality").value; viewer?.setRenderBudget(quality[state.renderQuality]); updateVisual(); }, options);
el("modelFile").addEventListener("change", () => { if (el("modelFile").files[0]) loadModel(el("modelFile").files[0]); }, options);
el("retryModel").addEventListener("click", () => loadModel(), options);
document.addEventListener("visibilitychange", () => { if (document.hidden) { if (frame) cancelAnimationFrame(frame); frame = 0; } else { lastFrame = -Infinity; updateVisual(); scheduleFrame(); } }, options);
motionQuery.addEventListener("change", () => { if (motionQuery.matches) setPlaying(false); }, options);
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  state.disposed = true; loadVersion += 1; state.phraseRequest += 1;
  if (frame) cancelAnimationFrame(frame); frame = 0;
  listeners.abort(); viewer?.dispose(); audio.dispose(); delete window.roachSynth;
}, options);

function changePatchBy(amount) {
  const index = ROACH_MOTION_PRESETS.findIndex((preset) => preset.id === state.motion.presetId);
  setMotionPreset(ROACH_MOTION_PRESETS[(index + amount + ROACH_MOTION_PRESETS.length) % ROACH_MOTION_PRESETS.length].id);
}
el("previousPatch").addEventListener("click", () => changePatchBy(-1), options);
el("nextPatch").addEventListener("click", () => changePatchBy(1), options);
el("savePatch").addEventListener("click", () => {
  rememberPatch();
  try {
    localStorage.setItem(patchStorageKey, JSON.stringify(Object.fromEntries(editedPatches)));
    el("patchStatus").textContent = "Joint scores saved in this browser.";
  } catch { el("patchStatus").textContent = "Browser storage is unavailable. Your edits remain playable in this tab."; }
}, options);
el("restorePatch").addEventListener("click", () => {
  editedPatches.delete(state.motion.presetId);
  state.motion.tracks = []; state.motion.sequenceEnabled = false;
  el("sequenceEnabled").checked = false;
  el("patchStatus").textContent = "Factory motion restored. Sound routes remain yours.";
  renderSequence(); publish(); updateVisual();
}, options);
el("sequenceJoint").addEventListener("change", () => viewer?.selectBone(el("sequenceJoint").value), options);
for (const button of el("sequenceAxes").querySelectorAll("button")) button.addEventListener("click", () => { state.sequenceAxis = button.dataset.axis; renderSequence(); }, options);
el("stepRotation").addEventListener("input", () => {
  const track = selectedTrack(true); if (!track) return;
  track.steps[state.selectedStep] = Number(el("stepRotation").value); markScoreEdited();
}, options);
el("captureStep").addEventListener("click", () => {
  const track = selectedTrack(true); const part = selectedPart(); if (!track || !part) return;
  track.steps[state.selectedStep] = Math.max(-60, Math.min(60, track.steps[state.selectedStep] + part.offset[state.sequenceAxis]));
  viewer.setBoneOffset(part.id, { [state.sequenceAxis]: 0 }); refreshJoints();
  markScoreEdited(); syncManualPose();
}, options);
el("waveTrack").addEventListener("click", () => {
  const track = selectedTrack(true); if (!track) return;
  track.steps = Array.from({ length: 16 }, (_, index) => Math.round(Math.sin(index * Math.PI / 8) * 18)); markScoreEdited();
}, options);
el("clearTrack").addEventListener("click", () => {
  const part = selectedPart(); if (!part) return;
  state.motion.tracks = state.motion.tracks.filter((track) => track.jointId !== part.id || track.axis !== state.sequenceAxis);
  rememberPatch(); renderSequence(); publish(); updateVisual();
}, options);
el("dragAxis").addEventListener("change", () => viewer?.setDragAxis(el("dragAxis").value), options);
el("touch3D").addEventListener("click", () => {
  const active = el("touch3D").getAttribute("aria-pressed") !== "true";
  el("touch3D").setAttribute("aria-pressed", String(active)); viewer?.setTouchInteraction(active);
  el("touch3D").textContent = active ? "3D touch on" : "3D touch";
}, options);
for (const axis of ["X", "Y", "Z"]) {
  const release = () => { const part = selectedPart(); if (part) audio.interact({ jointId: part.id, active: false }); };
  for (const name of ["change", "pointerup", "pointercancel", "blur"]) el(`pose${axis}`).addEventListener(name, release, options);
}
el("phrase").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); el("speakButton").click(); }
}, options);
