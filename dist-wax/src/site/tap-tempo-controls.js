import { createTapTempoButton } from "../ui/primitives/tap-tempo-button.js";
import { nextId } from "../ui/internal.js";
import { tapTempoBpm, tapTempoValue } from "../tap-tempo.js";
import { TAP_TEMPO_TARGETS } from "./tap-tempo-targets.js";

const installations = new WeakMap();

function readValue(control) {
  return Number(control.value ?? control.getAttribute("aria-valuenow"));
}

function boundedValue(control, value) {
  const native = control.matches("input");
  const min = Number(native ? control.min || 0 : control.getAttribute("aria-valuemin"));
  const max = Number(native ? control.max || 100 : control.getAttribute("aria-valuemax"));
  const step = native && control.step !== "any" ? Number(control.step) || 1 : 0;
  let next = Math.max(min, Math.min(max, value));
  if (step) next = Math.max(min, Math.min(max, min + Math.round((next - min) / step) * step));
  return Number(next.toPrecision(12));
}

/** Add one Tap beside an intact owner control, retaining its native event path. */
export function mountTapTempoControl(control, target, runtime = control.ownerDocument.defaultView) {
  if (!control.parentElement || (!control.matches('input[type="range"], input[type="number"]')
    && typeof control.setTapTempoValue !== "function")) return null;
  const doc = control.ownerDocument;
  const field = control.closest("label, .webgpu-knob, .synthesis-knob") ?? control;
  // Precise knob editors and labels are separate children of a domain field.
  const ownerField = control.closest(".synthesis-knob") ?? field;
  const wrapper = doc.createElement("div");
  const knob = ownerField.classList.contains("mz-range-knob") || ownerField.classList.contains("webgpu-knob") || ownerField.classList.contains("synthesis-knob");
  wrapper.className = `mz-tap-tempo-field${knob ? " mz-tap-tempo-field--knob" : ""}`;
  ownerField.before(wrapper);
  wrapper.append(ownerField);
  const originalId = control.id;
  if (!originalId) control.id = nextId("mz-tap-target", doc);
  let writing = false;
  let lastValue = readValue(control);
  const mapping = () => {
    const settings = { ...target.mapping };
    const root = control.getRootNode();
    if (settings.referenceSelector) {
      settings.referenceBpm = Number(root.querySelector(settings.referenceSelector)?.value) *
        (Number(root.querySelector(settings.referenceFactorSelector ?? ":not(*)")?.value) || 1);
    }
    if (settings.densitySelector) {
      const density = Number(root.querySelector(settings.densitySelector)?.value ?? settings.densityDefault);
      settings.frequencyScale = settings.defaultTileScale / (settings.openTileScale + settings.tileScaleSlope * density);
    }
    return settings;
  };
  const button = createTapTempoButton({
    runtime,
    title: target.title,
    ariaLabel: `Tap ${target.label ?? control.getAttribute("aria-label") ?? "tempo"}`,
    onBeforeTap: () => sync(),
    getResetAfter: () => {
      const bpm = tapTempoBpm(readValue(control), mapping());
      return target.resetAfter ?? (bpm > 0 && Number.isFinite(bpm) ? Math.max(4000, 150000 / bpm) : 4000);
    },
    onTempo(bpm) {
      const value = boundedValue(control, tapTempoValue(bpm, mapping(), readValue(control)));
      if (!Number.isFinite(value)) return;
      writing = true;
      try {
        if (typeof control.setTapTempoValue === "function") control.setTapTempoValue(value);
        else {
          control.value = String(value);
          for (const type of ["input", "change"]) control.dispatchEvent(new runtime.Event(type, { bubbles: true, composed: true }));
        }
        lastValue = readValue(control);
      } finally { writing = false; }
    },
  }, doc);
  button.setAttribute("aria-controls", control.id);
  button.setAttribute("data-tap-control", target.selector);
  wrapper.append(button);
  const disabled = () => control.matches(":disabled") || control.getAttribute("aria-disabled") === "true";
  const sync = () => {
    button.disabled = disabled();
    if (!writing && lastValue !== readValue(control)) { button.reset(); lastValue = readValue(control); }
  };
  const edit = () => { if (!writing) button.reset(); sync(); };
  for (const type of ["input", "change"]) control.addEventListener(type, edit);
  const observer = runtime.MutationObserver ? new runtime.MutationObserver(sync) : null;
  observer?.observe(control, { attributes: true, attributeFilter: ["disabled", "aria-disabled", "aria-valuenow", "min", "max", "step", "value"] });
  sync();
  return { control, button, wrapper, sync,
    destroy() {
      observer?.disconnect(); button.destroy(); button.remove();
      for (const type of ["input", "change"]) control.removeEventListener(type, edit);
      if (ownerField.parentElement === wrapper) { wrapper.before(ownerField); wrapper.remove(); }
      if (!originalId) control.removeAttribute("id");
    },
  };
}

/** Explicit route registrations include controls rendered or replaced after bootstrap. */
export function initializeTapTempoControls(doc, runtime = doc?.defaultView ?? globalThis, {
  targets = TAP_TEMPO_TARGETS, route = runtime.location?.pathname?.split("/").pop(),
} = {}) {
  if (!doc?.body || !doc.querySelectorAll || installations.has(doc)) return installations.get(doc) ?? null;
  const controllers = new Map();
  const roots = new Map();
  const addRoot = (root, rootRoute) => {
    if (roots.has(root)) return;
    const registrations = targets.filter(target => target.route === rootRoute);
    if (!registrations.length && !root.querySelector("[data-tap-tempo]")) return;
    const scan = subtree => {
      const candidates = registrations.flatMap(target => [...subtree.querySelectorAll(target.selector),
        ...(subtree.matches?.(target.selector) ? [subtree] : [])].map(control => [control, target]));
      for (const control of subtree.querySelectorAll("[data-tap-tempo]")) candidates.push([control, {
        selector: `[data-tap-tempo="${control.dataset.tapTempo}"]`, mapping: { unit: control.dataset.tapTempo },
      }]);
      for (const [control, target] of candidates) {
        if (controllers.has(control)) continue;
        const controller = mountTapTempoControl(control, target, runtime);
        if (controller) controllers.set(control, controller);
      }
    };
    scan(root);
    const observer = runtime.MutationObserver ? new runtime.MutationObserver(records => {
      for (const [control, controller] of controllers) if (!control.isConnected) {
        controller.destroy(); controllers.delete(control);
      }
      for (const record of records) {
        if (record.type === "attributes") {
          for (const controller of controllers.values()) if (record.target.contains(controller.control)) controller.sync();
        } else for (const node of record.addedNodes) if (node.nodeType === 1) scan(node);
      }
    }) : null;
    observer?.observe(root === doc ? doc.body : root, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
    roots.set(root, observer);
  };
  addRoot(doc, route);
  const embedded = event => {
    const instrumentId = event.detail?.instrumentId;
    if (!instrumentId) return;
    const root = doc.querySelector("[data-active-instrument-root]")?.shadowRoot;
    if (root) addRoot(root, `${instrumentId}.html`);
  };
  runtime.addEventListener?.("morphazoid:instrument-root-change", embedded);
  const api = {
    controllers,
    destroy() {
      for (const observer of roots.values()) observer?.disconnect();
      for (const controller of controllers.values()) controller.destroy();
      controllers.clear(); roots.clear(); installations.delete(doc);
      runtime.removeEventListener?.("morphazoid:instrument-root-change", embedded);
      runtime.removeEventListener?.("pagehide", hide);
      runtime.removeEventListener?.("pageshow", show);
    },
  };
  const hide = event => { if (!event.persisted) api.destroy(); else for (const controller of controllers.values()) controller.button.reset(); };
  const show = () => { for (const controller of controllers.values()) { controller.button.reset(); controller.sync(); } };
  runtime.addEventListener?.("pagehide", hide);
  runtime.addEventListener?.("pageshow", show);
  installations.set(doc, api);
  return api;
}
