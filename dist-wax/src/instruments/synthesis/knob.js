import { enhanceRangeKnob } from "../../ui/primitives/range-knob.js";

/** A native rotary range with physical-unit readout and optional precise entry. */
export function createKnobControl(options, doc = globalThis.document) {
  const {
    id, label, min: initialMin = 0, max: initialMax = 1, step = "any", value = initialMin, unit = "",
    scale = "linear", help = "", formatValue = number => `${Number(number.toPrecision(5))}${unit ? ` ${unit}` : ""}`,
    onInput = () => {}, editorId = `${id}-value`,
  } = options;
  let min = initialMin, max = initialMax;
  const logarithmic = scale === "log" && min > 0 && max > min;
  const toSlider = options.toSlider || (logarithmic ? number => Math.log(number / min) / Math.log(max / min) : number => number);
  const fromSlider = options.fromSlider || (logarithmic ? number => min * (max / min) ** number : number => number);
  const sliderMin = options.sliderMin ?? (logarithmic ? 0 : min);
  const sliderMax = options.sliderMax ?? (logarithmic ? 1 : max);
  const sliderStep = options.sliderStep ?? (logarithmic ? .00001 : step);
  const root = doc.createElement("div"); root.className = `synthesis-knob${options.className ? ` ${options.className}` : ""}`;
  const caption = doc.createElement("label");
  caption.className = "synthesis-knob-label"; caption.htmlFor = id; caption.textContent = label;
  const dial = doc.createElement("div"); dial.className = "synthesis-knob-dial";
  const input = doc.createElement("input");
  input.type = "range"; input.id = id;
  input.min = String(sliderMin); input.max = String(sliderMax); input.step = String(sliderStep);
  input.setAttribute("aria-label", label);
  input.title = `${min}–${max}${unit ? ` ${unit}` : ""}. Drag up or down; Shift for fine adjustment.`;
  dial.append(input);
  const readout = doc.createElement("button");
  readout.type = "button"; readout.className = "synthesis-knob-value";
  readout.title = `Type an exact ${label.toLowerCase()} value`;
  const output = doc.createElement("output"); output.htmlFor = id; readout.append(output);
  const editor = doc.createElement("input");
  editor.type = "number"; editor.id = editorId; editor.className = "synthesis-knob-editor";
  editor.inputMode = step === 1 ? "numeric" : "decimal";
  editor.min = String(min); editor.max = String(max); editor.step = String(step);
  editor.setAttribute("aria-label", `${label}${unit ? ` (${unit})` : ""}`);
  editor.title = `${min}–${max}${unit ? ` ${unit}` : ""}`;
  editor.hidden = true;
  root.append(caption, dial, readout, editor);
  if (help) {
    const description = doc.createElement("span");
    description.id = `${id}-help`; description.className = "sr-only"; description.textContent = help;
    input.setAttribute("aria-describedby", description.id);
    editor.setAttribute("aria-describedby", description.id);
    readout.setAttribute("aria-describedby", description.id);
    caption.title = root.title = help;
    root.append(description);
  }
  const knob = enhanceRangeKnob(input);
  const removers = [];
  let current = min;
  let editing = false;
  let destroyed = false;
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
    const formatted = String(formatValue(current));
    output.value = formatted; output.textContent = formatted;
    readout.setAttribute("aria-label", `Set ${label.toLowerCase()} precisely; ${formatted}`);
    input.setAttribute("aria-valuetext", formatted);
    if (!editing) editor.value = String(current);
    knob.update();
  }
  function finishEdit(commit, returnFocus = false) {
    if (!editing) return;
    const next = commit && editor.value !== "" && Number.isFinite(editor.valueAsNumber) ? normalize(editor.valueAsNumber) : current;
    editing = false; editor.hidden = true; readout.hidden = false;
    const changed = next !== current;
    current = next; paint();
    if (returnFocus && root.isConnected) readout.focus({ preventScroll: true });
    if (commit && changed) onInput(current);
  }
  listen(input, "input", () => {
    current = normalize(fromSlider(Number(input.value)));
    paint(); onInput(current);
  });
  listen(readout, "click", () => {
    if (input.disabled) return;
    editing = true; editor.value = String(current);
    readout.hidden = true; editor.hidden = false;
    editor.focus({ preventScroll: true }); editor.select();
  });
  listen(editor, "keydown", event => {
    event.stopPropagation();
    if (event.key === "Enter" || event.key === "Escape") {
      event.preventDefault(); finishEdit(event.key === "Enter", true);
    }
  });
  listen(editor, "change", () => finishEdit(true));
  listen(editor, "blur", () => finishEdit(true));
  root.input = input; root.editor = editor; root.output = output; root.readout = readout; root.labelElement = caption;
  root.setValue = next => {
    // Preset recall owns the displayed state, including an unfinished exact edit.
    if (editing) finishEdit(false);
    current = normalize(next); paint(); return current;
  };
  root.setDisabled = disabled => {
    if (disabled && editing) finishEdit(false);
    input.disabled = editor.disabled = readout.disabled = !!disabled;
    root.classList.toggle("is-disabled", !!disabled); knob.update();
  };
  root.setMinimum = next => {
    if (!Number.isFinite(Number(next))) return min;
    min = Math.min(Number(next), max); editor.min = String(min);
    if (!Object.hasOwn(options, "sliderMin") && !logarithmic) input.min = String(min);
    current = normalize(current); paint(); return min;
  };
  root.setMaximum = next => {
    if (!Number.isFinite(Number(next))) return max;
    max = Math.max(min, Number(next)); editor.max = String(max);
    if (!Object.hasOwn(options, "sliderMax") && !logarithmic) input.max = String(max);
    current = normalize(current); paint(); return max;
  };
  root.destroy = () => {
    if (destroyed) return;
    destroyed = true; editing = false; knob.destroy();
    for (const remove of removers) remove();
    root.remove();
  };
  root.setValue(value);
  root.setDisabled(options.disabled);
  return root;
}
