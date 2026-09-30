import { parameterValue, normalizedParameter, formatParameter } from "./catalog.js";
import { enhanceChooseSelect } from "./choose.js";
import { createKnobControl } from "./knob.js";

export { createKnobControl } from "./knob.js";

/** Method controls retain the full engine range through rotary and exact gestures. */
export function createParameterControl(control, index, value, onInput) {
  const id = `synth-param-${index}`;
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
