import { shapesControlAvailability } from "./control-availability.js";
import { createAmplitudeControl } from "../../amplitude-control.js";
import { mappingCurvePreset, updateMappingCurveNode } from "../../mapping.js";
import { sanitizePercussionEnvelope } from "../../audio.js";

const sources = ["fixed", "horizontal", "height", "center", "corner", "incidence", "phase"];
const curves = ["linear", "exponential", "logarithmic", "smooth", "inverted"];
const choices = (key, label, options) => `<label class="select-control"><span class="field-label">${label}</span><span class="select-shell"><select data-tone="${key}" aria-label="${label}">${options.map(option => `<option value="${option}">${option}</option>`).join("")}</select></span></label>`;
const range = (key, label, min, max, step = 0.01, owner = "tone") => `<label class="control"><span><b>${label}</b><output data-value="${key}"></output></span><input data-${owner}="${key}" aria-label="${label}" type="range" min="${min}" max="${max}" step="${step}"></label>`;
const flag = (key, label) => `<label class="control"><span><b>${label}</b><input type="checkbox" data-tone="${key}" aria-label="${label}"></span></label>`;

/** Domain controls use existing native fields and the shared envelope editor. */
export function createShapesSoundControls(host, { getState, onChange }) {
  host.innerHTML = `
    <label class="select-control"><span class="field-label">Sound controls</span><span class="select-shell"><select id="shapesSoundModel"><option value="shapes">Shapes · Character</option><option value="geometry">Shape / Solid / Hyper · Full controls</option></select></span></label>
    <div class="shapes-parameter-grid">
      ${range("voiceLimit", "Voice ceiling", 1, 32, 1, "voice")}
      ${range("presetLevel", "Scene level", 0, 1, 0.01, "voice")}
    </div>
    <div data-detailed-sound>
      <section data-note-section><h3>Corners &amp; Notes</h3>
        <label class="control"><span><b>Swell · peak at marker</b><input type="checkbox" data-note="swell" aria-label="Swell peaks at corners and subdivisions"></span></label>
        <small class="mz-control-note">Swell starts the attack before each marker. Releases may overlap later markers.</small>
        <div data-pitched-note-controls>
          ${range("hitCap", "Notes per crossing", 1, 8, 1, "note")}
          <div data-note-envelope></div>
        </div>
      </section>
      <section data-modulation><h3>Modulation</h3><div class="shapes-parameter-grid">
        ${range("fmIndex", "FM / PM index", 0, 12)}${range("fmRatio", "FM / PM ratio", 0.25, 8)}
        <div data-two-only>${range("pmIndex", "PM depth", 0, 8)}${range("pmRatio", "PM ratio", 0.25, 8)}</div>
        <div data-two-only>${choices("fmIndexSource", "FM source", sources)}${choices("pmDepthSource", "PM source", sources)}</div>
      </div></section>
      <section data-two-only><h3>Pitch and stereo</h3><div class="shapes-parameter-grid">
        ${choices("pitchSource", "Pitch source", ["vertical", "horizontal", "center"])}
        ${choices("stereoSource", "Stereo source", ["horizontal", "vertical", "center"])}
        ${flag("stereoInverted", "Invert stereo")}
        ${choices("pitchCurvePreset", "Pitch curve", [...curves, "custom"])}
      </div>
      <div class="shared-amplitude-editor" data-pitch-editor aria-label="Pitch mapping curve">
        <svg viewBox="0 0 240 96" preserveAspectRatio="none" aria-hidden="true"><path></path></svg>
        ${Array.from({ length: 5 }, (_, i) => `<button type="button" data-pitch-node="${i}" role="slider" aria-label="Pitch curve node ${i + 1}">${i + 1}</button>`).join("")}
      </div></section>
      <section data-amplitude><div data-two-only>
        ${choices("cornerAmplitudeSource", "Amplitude source", sources)}
        <div data-shape-envelope></div>
      </div><div data-higher-only data-geometry-envelope></div></section>
      <section data-corners><h3>Corner percussion</h3><div data-two-only>
        <div class="shapes-parameter-grid">${range("percussionStrikeLevel", "Strike level", 0, 1)}
        ${range("percussionAttackNoise", "Attack noise", 0, 1)}
        ${choices("percussionLevelSource", "Strike level source", [...sources, "signed"])}
        ${choices("percussionLevelCurve", "Strike level curve", curves)}</div>
        <div data-strike-envelope></div>
      </div><div data-higher-only class="shapes-parameter-grid">
        ${range("percussionAttack", "Attack · ms", 0.5, 30, 0.5, "synthesis")}
        ${range("percussionDecay", "Decay · ms", 15, 2000, 1, "synthesis")}
      </div></section>
      <section data-shepard data-two-only><h3>Shepard</h3><div class="shapes-parameter-grid">
        ${range("shepardCycles", "Cycles", 0.25, 4)}
        ${choices("shepardDirection", "Shepard direction", [1, -1])}
        ${choices("shepardMapping", "Shepard mapping", ["travel", "turn"])}
        ${range("shepardTurnGlide", "Turn glide", 0.05, 1)}
        ${range("shepardWidth", "Shepard width", 2, 8)}
      </div></section>
    </div>`;
  let syncing = false, drag = null;
  const state = () => getState(), tone = () => state().synthesis.tone;
  const changed = () => { if (!syncing) onChange(); };
  const shapeEnvelope = createAmplitudeControl(host.querySelector("[data-shape-envelope]"), {
    presets: ["segment", "pluck", "note", "sustain", "pad"], showLevel: false,
    onChange: controller => {
      if (syncing) return;
      const value = controller.captureState();
      Object.assign(tone(), { amplitudeEnvelopeEnabled: value.enabled, cornerSwell: value.swell, amplitudePreset: value.preset, amplitudeEnvelopePoints: value.points });
      changed();
    },
  });
  const geometryEnvelope = createAmplitudeControl(host.querySelector("[data-geometry-envelope]"), {
    onChange: controller => { if (!syncing) { state().synthesis.envelope = controller.captureState(); changed(); } },
  });
  const strikeEnvelope = createAmplitudeControl(host.querySelector("[data-strike-envelope]"), {
    timing: "milliseconds", label: "Strike envelope", showLevel: false, allowDisable: false,
    onChange: controller => {
      if (syncing) return;
      const value = controller.captureState();
      Object.assign(tone(), { percussionPreset: value.preset, percussionEnvelopePoints: value.points });
      changed();
    },
  });
  const noteEnvelope = createAmplitudeControl(host.querySelector("[data-note-envelope]"), {
    timing: "milliseconds", label: "Note ADSR · overlapping tails", showLevel: false, allowDisable: false,
    onChange: controller => {
      if (syncing) return;
      const value = controller.captureState();
      state().notes.preset = value.preset;
      state().notes.envelopePoints = sanitizePercussionEnvelope(value.points);
      changed();
    },
  });
  host.querySelector("#shapesSoundModel").addEventListener("change", event => {
    state().synthesis.model = event.target.value; changed();
  });
  function fieldChange(event) {
    const field = event.target;
    const key = field.dataset.tone ?? field.dataset.voice ?? field.dataset.synthesis ?? field.dataset.note;
    if (!key) return;
    const owner = field.dataset.tone ? tone() : field.dataset.voice ? state().voice : field.dataset.note ? state().notes : state().synthesis;
    owner[key] = field.type === "checkbox" ? field.checked : field.type === "range" || key === "shepardDirection" ? Number(field.value) : field.value;
    if (key === "pitchCurvePreset" && field.value !== "custom") tone().pitchCurveNodes = mappingCurvePreset(field.value);
    changed();
  }
  host.addEventListener("input", event => { if (event.target.type === "range") fieldChange(event); });
  host.addEventListener("change", event => { if (event.target.type !== "range") fieldChange(event); });
  const editor = host.querySelector("[data-pitch-editor]");
  function setNode(index, point) {
    tone().pitchCurveNodes = updateMappingCurveNode(tone().pitchCurveNodes, index, point);
    tone().pitchCurvePreset = "custom"; changed();
  }
  function dragNode(event) {
    const box = editor.getBoundingClientRect();
    setNode(drag.index, { x: (event.clientX - box.left) / box.width, y: 1 - (event.clientY - box.top) / box.height });
  }
  editor.addEventListener("pointerdown", event => {
    const node = event.target.closest("[data-pitch-node]");
    if (!node) return;
    event.preventDefault();
    drag = { index: Number(node.dataset.pitchNode), pointerId: event.pointerId };
    editor.setPointerCapture(event.pointerId); dragNode(event);
  });
  editor.addEventListener("pointermove", event => { if (drag?.pointerId === event.pointerId) dragNode(event); });
  for (const type of ["pointerup", "pointercancel"]) editor.addEventListener(type, () => { drag = null; });
  editor.addEventListener("keydown", event => {
    const node = event.target.closest("[data-pitch-node]");
    if (!node || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = Number(node.dataset.pitchNode), point = tone().pitchCurveNodes[index], step = event.shiftKey ? 0.05 : 0.01;
    setNode(index, { x: point.x + (event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0), y: point.y + (event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0) });
  });
  function sync() {
    syncing = true;
    const s = state(), t = tone(), two = s.selection.dimension === "2d", notes = s.selection.playingMode === "notes";
    const corners = notes && s.voice.engine === "percussion";
    const available = shapesControlAvailability(s);
    host.querySelector("#shapesSoundModel").value = s.synthesis.model;
    host.querySelector("#shapesSoundModel").disabled = notes;
    host.querySelector('[data-voice="voiceLimit"]').closest("label").hidden = corners;
    host.querySelector("[data-detailed-sound]").hidden = s.synthesis.model !== "geometry" && !corners;
    host.querySelector("[data-note-section]").hidden = !notes;
    host.querySelector("[data-pitched-note-controls]").hidden = corners;
    for (const element of host.querySelectorAll("[data-two-only]")) element.hidden = !two;
    for (const element of host.querySelectorAll("[data-higher-only]")) element.hidden = two;
    host.querySelector("[data-modulation]").hidden = corners || !["fm", "pm"].includes(s.voice.engine);
    host.querySelector("[data-amplitude]").hidden = notes;
    host.querySelector("[data-corners]").hidden = !corners;
    host.querySelector("[data-shepard]").hidden = !two || corners || s.voice.engine !== "shepard";
    for (const field of host.querySelectorAll("[data-tone], [data-voice], [data-synthesis], [data-note]")) {
      const key = field.dataset.tone ?? field.dataset.voice ?? field.dataset.synthesis ?? field.dataset.note;
      const owner = field.dataset.tone ? t : field.dataset.voice ? s.voice : field.dataset.note ? s.notes : s.synthesis;
      if (field.type === "checkbox") field.checked = owner[key]; else field.value = String(owner[key]);
      const output = host.querySelector(`[data-value="${key}"]`);
      if (output) output.textContent = Number(owner[key]).toFixed(Number.isInteger(owner[key]) ? 0 : 2);
    }
    const applyIfChanged = (controller, value) => {
      if (JSON.stringify(controller.captureState()) !== JSON.stringify(value)) controller.applyState(value);
    };
    applyIfChanged(shapeEnvelope, { enabled: t.amplitudeEnvelopeEnabled, swell: t.cornerSwell, preset: t.amplitudePreset, level: 1, points: t.amplitudeEnvelopePoints });
    applyIfChanged(geometryEnvelope, s.synthesis.envelope);
    applyIfChanged(strikeEnvelope, { enabled: true, swell: false, preset: t.percussionPreset, level: 1, points: t.percussionEnvelopePoints });
    applyIfChanged(noteEnvelope, { enabled: true, swell: false, preset: s.notes.preset, level: 1, points: s.notes.envelopePoints });
    editor.querySelector("path").setAttribute("d", t.pitchCurveNodes.map((point, i) => `${i ? "L" : "M"}${point.x * 240} ${(1 - point.y) * 96}`).join(" "));
    editor.querySelectorAll("[data-pitch-node]").forEach((node, i) => {
      const point = t.pitchCurveNodes[i];
      node.style.left = `${point.x * 100}%`; node.style.top = `${(1 - point.y) * 100}%`;
      node.setAttribute("aria-valuetext", `Input ${Math.round(point.x * 100)}%, output ${Math.round(point.y * 100)}%`);
    });
    for (const key of ["fmIndex", "fmRatio", "fmIndexSource", "pmIndex", "pmRatio", "pmDepthSource", "shepardTurnGlide", "shepardMapping"]) {
      const visible = key === "fmIndexSource" ? available.fmSource
        : key.startsWith("fm") ? available.fm : key.startsWith("pm") ? available.pm
        : key === "shepardMapping" ? available.shepardTurn : available.shepardTurnGlide;
      host.querySelector(`[data-tone="${key}"]`).closest("label").hidden = !visible;
    }
    for (const [key, label] of [["fmIndex", two ? "FM index" : "FM / PM index"], ["fmRatio", two ? "FM ratio" : "FM / PM ratio"]]) {
      const field = host.querySelector(`[data-tone="${key}"]`);
      field.setAttribute("aria-label", label);
      field.closest("label").querySelector("b").textContent = label;
    }
    const turn = host.querySelector('[data-tone="shepardMapping"] option[value="turn"]');
    turn.disabled = s.dimension["2d"].reader !== "points" || s.profile.sides === 2;
    syncing = false;
  }
  return { sync };
}
