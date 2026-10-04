import { parameterValue, normalizedParameter, formatParameter } from "./catalog.js";
import { enhanceChooseSelect } from "./choose.js";
import { createKnobControl } from "./knob.js";

export { createKnobControl } from "./knob.js";

/** A bounded horizontal control with an always-visible exact value field. */
export function createLinearControl(options, doc = globalThis.document) {
  const {
    id, label, min: initialMin = 0, max: initialMax = 1, step = "any", unit = "",
    scale = "linear", help = "", formatValue = number => `${Number(number.toPrecision(5))}${unit ? ` ${unit}` : ""}`,
    onInput = () => {}, editorId = `${id}-value`,
  } = options;
  let min = initialMin, max = initialMax;
  const value = options.value ?? min;
  const logarithmic = scale === "log" && min > 0 && max > min;
  const toSlider = options.toSlider || (logarithmic ? number => Math.log(number / min) / Math.log(max / min) : number => number);
  const fromSlider = options.fromSlider || (logarithmic ? number => min * (max / min) ** number : number => number);
  const sliderMin = options.sliderMin ?? (logarithmic ? 0 : min);
  const sliderMax = options.sliderMax ?? (logarithmic ? 1 : max);
  const sliderStep = options.sliderStep ?? (logarithmic ? .00001 : step);
  const root = doc.createElement("div");
  root.className = `synthesis-linear-control${options.className ? ` ${options.className}` : ""}`;
  const heading = doc.createElement("div"); heading.className = "synthesis-linear-heading";
  const caption = doc.createElement("label"); caption.htmlFor = id; caption.textContent = label;
  const exact = doc.createElement("span"); exact.className = "synthesis-linear-exact";
  const editor = doc.createElement("input");
  editor.type = "number"; editor.id = editorId; editor.className = "synthesis-linear-editor";
  editor.min = String(min); editor.max = String(max); editor.step = String(step);
  editor.inputMode = Number(step) === 1 ? "numeric" : "decimal";
  editor.setAttribute("aria-label", `${label}${unit ? ` (${unit})` : ""}`);
  const suffix = doc.createElement("span"); suffix.textContent = unit;
  suffix.hidden = !unit;
  exact.append(editor, suffix); heading.append(caption, exact);
  const input = doc.createElement("input");
  input.type = "range"; input.id = id; input.className = "synthesis-linear-range";
  input.min = String(sliderMin); input.max = String(sliderMax); input.step = String(sliderStep);
  input.setAttribute("aria-label", label);
  root.append(heading, input);
  if (help) {
    const description = doc.createElement("span");
    description.id = `${id}-help`; description.className = "sr-only"; description.textContent = help;
    input.setAttribute("aria-describedby", description.id);
    editor.setAttribute("aria-describedby", description.id);
    caption.title = root.title = help;
    root.append(description);
  }
  const removers = [];
  let current = min, destroyed = false;
  const listen = (node, type, callback) => {
    node.addEventListener(type, callback);
    removers.push(() => node.removeEventListener(type, callback));
  };
  const normalize = number => {
    let next = Math.max(min, Math.min(max, Number.isFinite(number) ? number : current));
    const increment = Number(step);
    if (step !== "any" && increment > 0) next = min + Math.round((next - min) / increment) * increment;
    return Number(Math.max(min, Math.min(max, next)).toPrecision(12));
  };
  function paint() {
    input.value = String(toSlider(current));
    editor.value = String(current);
    const formatted = String(formatValue(current));
    input.setAttribute("aria-valuetext", formatted);
    input.title = editor.title = `${label}: ${formatted}`;
    if (!help) root.title = `${label}: ${formatted}`;
  }
  function commit(next) {
    const bounded = normalize(next);
    if (bounded === current) { paint(); return; }
    current = bounded; paint(); onInput(current);
  }
  listen(input, "input", () => commit(fromSlider(Number(input.value))));
  listen(editor, "change", () => commit(editor.valueAsNumber));
  listen(editor, "keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); commit(editor.valueAsNumber); editor.select(); }
    if (event.key === "Escape") { event.preventDefault(); paint(); input.focus({ preventScroll: true }); }
  });
  root.input = input; root.editor = editor; root.labelElement = caption;
  root.setValue = next => { current = normalize(next); paint(); return current; };
  root.setMinimum = next => {
    const candidate = Number(next);
    if (!Number.isFinite(candidate)) return min;
    min = Math.min(candidate, max);
    editor.min = String(min);
    if (!Object.hasOwn(options, "sliderMin") && !logarithmic) input.min = String(min);
    current = normalize(current); paint();
    return min;
  };
  root.setMaximum = next => {
    const candidate = Number(next);
    if (!Number.isFinite(candidate)) return max;
    max = Math.max(min, candidate);
    editor.max = String(max);
    if (!Object.hasOwn(options, "sliderMax") && !logarithmic) input.max = String(max);
    current = normalize(current); paint();
    return max;
  };
  root.setDisabled = disabled => {
    input.disabled = editor.disabled = !!disabled;
    root.classList.toggle("is-disabled", !!disabled);
  };
  root.destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const remove of removers) remove();
    root.remove();
  };
  root.setValue(value);
  root.setDisabled(options.disabled);
  return root;
}

/** Method controls retain the full engine range through rotary and exact gestures. */
export function createParameterControl(control, index, value, onInput, { prefix = "synth-param" } = {}) {
  const id = `${prefix}-${index}`;
  if (control.options) {
    const root = document.createElement("div");
    root.className = "synthesis-parameter synthesis-parameter-choice";
    const label = document.createElement("label"); label.htmlFor = id; label.textContent = control.label;
    const select = document.createElement("select"); select.id = id;
    select.setAttribute("aria-label", control.label);
    select.replaceChildren(...control.options.map((name, option) => new Option(name, String(option))));
    root.append(label, select);
    const picker = enhanceChooseSelect(select, { label: `Choose ${control.label.toLowerCase()}` });
    const change = () => onInput(Number(select.value) / Math.max(1, control.options.length - 1));
    select.addEventListener("change", change);
    root.input = select; root.picker = picker;
    root.setValue = normalized => {
      select.value = String(control.optionValues ? Math.round(normalized * (control.options.length - 1)) : Math.round(parameterValue(control, normalized)));
      picker.refresh();
    };
    root.setDisabled = disabled => { select.disabled = !!disabled; picker.refresh(); };
    root.destroy = () => { select.removeEventListener("change", change); picker.destroy(); root.remove(); };
    root.setValue(value);
    return root;
  }
  const physicalSlider = control.integer && control.scale !== "log";
  const toSlider = physical => physicalSlider ? physical : normalizedParameter(control, physical);
  const fromSlider = raw => physicalSlider ? raw : parameterValue(control, raw);
  const root = createKnobControl({
    id, label: control.label, min: control.min, max: control.max,
    unit: control.unit, step: control.integer ? 1 : "any",
    value: parameterValue(control, value),
    toSlider, fromSlider,
    sliderMin: physicalSlider ? control.min : 0,
    sliderMax: physicalSlider ? control.max : 1,
    sliderStep: physicalSlider ? 1 : .00001,
    formatValue: physical => formatParameter(control, normalizedParameter(control, physical)),
    onInput: physical => onInput(normalizedParameter(control, physical)),
  });
  root.classList.add("synthesis-parameter");
  const setPhysical = root.setValue;
  root.setValue = normalized => setPhysical(parameterValue(control, normalized));
  return root;
}
