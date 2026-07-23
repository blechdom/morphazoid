import {
  amplitudeEnvelopePreset,
  mirroredAmplitudeEnvelopePhase,
  sampleAmplitudeEnvelope,
  updateAmplitudeEnvelopeNode,
} from "./audio.js";

const LABELS = ["T", "A", "D", "S", "R"];
const PRESETS = ["pluck", "note", "sustain", "pad"];

function clamp(value, low = 0, high = 1) {
  return Math.min(high, Math.max(low, Number(value) || 0));
}

export function createAmplitudeControl(host, { onChange = () => {}, label = "Contact Amplitude ADSR" } = {}) {
  const state = {
    enabled: true,
    swell: false,
    preset: "sustain",
    level: 1,
    points: amplitudeEnvelopePreset("sustain"),
  };
  let dragging = null;

  const controller = {
    state,
    sample(phase, peak = 1) {
      const rawAmount = clamp(phase);
      // Give a newly triggered continuous voice a non-zero first target. The
      // following animation frames still trace the complete attack ramp.
      const amount = state.enabled && rawAmount === 0 ? 0.0001 : rawAmount;
      const peakLevel = clamp(peak, 0, 4);
      if (!state.enabled) return peakLevel * state.level;
      const envelopePhase = state.swell
        ? mirroredAmplitudeEnvelopePhase(amount, state.points[1]?.x ?? 0)
        : amount;
      return peakLevel * state.level * sampleAmplitudeEnvelope(envelopePhase, state.points);
    },
    setVisible(visible) {
      if (host) host.hidden = !visible;
    },
    reset() {
      state.enabled = true;
      state.swell = false;
      state.preset = "sustain";
      state.level = 1;
      state.points = amplitudeEnvelopePreset("sustain");
      render();
      onChange(controller);
    },
  };

  function pathData() {
    return state.points.map((point, index) => (
      `${index ? "L" : "M"}${(point.x * 240).toFixed(2)} ${(96 - point.y * 96).toFixed(2)}`
    )).join(" ");
  }

  function render() {
    if (!host) return;
    host.className = "shared-amplitude-control";
    host.innerHTML = `<div class="shared-amplitude-heading"><span class="field-label">${label}</span><div><button type="button" data-action="toggle" aria-pressed="${state.enabled}">${state.enabled ? "On" : "Off"}</button><button type="button" data-action="swell" aria-pressed="${state.swell}" ${state.enabled ? "" : "disabled"}>${state.swell ? "Swell on" : "Swell off"}</button></div></div>
      <div class="shared-amplitude-presets">${PRESETS.map((preset) => `<button type="button" data-preset="${preset}" aria-pressed="${state.preset === preset}" ${state.enabled ? "" : "disabled"}>${preset}</button>`).join("")}</div>
      <div class="shared-amplitude-editor ${state.enabled ? "" : "is-disabled"}" data-editor>
        <svg viewBox="0 0 240 96" preserveAspectRatio="none" aria-hidden="true"><path d="${pathData()}" /></svg>
        ${state.points.map((point, index) => `<button type="button" data-node="${index}" role="slider" aria-label="${LABELS[index]} envelope node" style="left:${point.x * 100}%;top:${(1 - point.y) * 100}%" ${state.enabled ? "" : "disabled"}>${LABELS[index]}</button>`).join("")}
      </div>
      <label class="control shared-amplitude-level"><span><b>Envelope level</b><output>${Math.round(state.level * 100)}%</output></span><input data-level type="range" min="0" max="1" step="0.01" value="${state.level}" /></label>
      <small>${state.swell ? "Edge midpoint → corner peak → midpoint" : "Contact/corner trigger → release"}</small>`;
  }

  function pointFromEvent(event) {
    const editor = host.querySelector?.("[data-editor]");
    const bounds = editor?.getBoundingClientRect?.() ?? { left: 0, top: 0, width: 1, height: 1 };
    return {
      x: clamp((event.clientX - bounds.left) / Math.max(1, bounds.width)),
      y: 1 - clamp((event.clientY - bounds.top) / Math.max(1, bounds.height)),
    };
  }

  host?.addEventListener?.("click", (event) => {
    const action = event.target.closest?.("[data-action]")?.dataset.action;
    const preset = event.target.closest?.("[data-preset]")?.dataset.preset;
    if (action === "toggle") {
      state.enabled = !state.enabled;
      if (!state.enabled) state.swell = false;
    } else if (action === "swell" && state.enabled) state.swell = !state.swell;
    else if (preset && state.enabled) {
      state.preset = PRESETS.includes(preset) ? preset : "note";
      state.points = amplitudeEnvelopePreset(state.preset);
    } else return;
    render();
    onChange(controller);
  });
  host?.addEventListener?.("input", (event) => {
    if (!event.target.matches?.("[data-level]")) return;
    state.level = clamp(event.target.value);
    render();
    onChange(controller);
  });
  host?.addEventListener?.("pointerdown", (event) => {
    const node = event.target.closest?.("[data-node]");
    if (!node || !state.enabled) return;
    dragging = { index: Number(node.dataset.node), pointerId: event.pointerId };
    host.setPointerCapture?.(event.pointerId);
    state.points = updateAmplitudeEnvelopeNode(state.points, dragging.index, pointFromEvent(event));
    state.preset = "custom";
    render();
    onChange(controller);
    event.preventDefault();
  });
  host?.addEventListener?.("pointermove", (event) => {
    if (!dragging || dragging.pointerId !== event.pointerId) return;
    state.points = updateAmplitudeEnvelopeNode(state.points, dragging.index, pointFromEvent(event));
    state.preset = "custom";
    render();
    onChange(controller);
  });
  for (const type of ["pointerup", "pointercancel"]) host?.addEventListener?.(type, () => { dragging = null; });
  render();
  return controller;
}
