import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
} from "../internal.js";

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Create the bounded minus/readout/plus control used for counts and heads. */
export function createNumberStepper(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const minimum = finiteNumber(options.min, 0);
  const maximum = Math.max(minimum, finiteNumber(options.max, 16));
  const step = Math.max(Number.EPSILON, Math.abs(finiteNumber(options.step, 1)));
  const formatValue = options.formatValue ?? ((value) => String(value));
  let disabled = Boolean(options.disabled);
  let value = minimum;

  const root = doc.createElement("div");
  root.className = classNames("mz-number-stepper", "playhead-stepper", options.className);
  root.setAttribute("role", "group");
  applyCommonOptions(root, {
    ...options,
    ariaLabel: options.ariaLabel ?? options.label ?? "Number stepper",
  });

  const decrementButton = doc.createElement("button");
  decrementButton.type = "button";
  decrementButton.className = "mz-number-stepper__decrement";
  decrementButton.textContent = "−";
  decrementButton.setAttribute("aria-label", String(options.decrementLabel ?? `Decrease ${options.label ?? "value"}`));

  const readout = doc.createElement("span");
  readout.className = "mz-number-stepper__readout";
  const label = doc.createElement("small");
  label.textContent = String(options.label ?? "Value");
  const output = doc.createElement("output");
  output.className = "mz-number-stepper__value";
  readout.append(label, output);

  const incrementButton = doc.createElement("button");
  incrementButton.type = "button";
  incrementButton.className = "mz-number-stepper__increment";
  incrementButton.textContent = "+";
  incrementButton.setAttribute("aria-label", String(options.incrementLabel ?? `Increase ${options.label ?? "value"}`));
  root.append(decrementButton, readout, incrementButton);

  const normalize = (next) => {
    const clamped = Math.min(maximum, Math.max(minimum, finiteNumber(next, minimum)));
    if (clamped === minimum || clamped === maximum) return clamped;
    const steps = Math.round((clamped - minimum) / step);
    return Math.min(maximum, Math.max(minimum, minimum + steps * step));
  };
  const update = () => {
    const formatted = typeof formatValue === "function"
      ? formatValue(value, root)
      : String(formatValue).replace("{}", String(value));
    output.value = String(formatted ?? value);
    output.textContent = output.value;
    decrementButton.disabled = disabled || value <= minimum;
    incrementButton.disabled = disabled || value >= maximum;
    root.setAttribute("data-value", String(value));
    return value;
  };
  const setValue = (next, { emit = false } = {}) => {
    const previous = value;
    value = normalize(next);
    update();
    if (emit && value !== previous) options.onChange?.(value, root);
    return value;
  };
  const setDisabled = (next) => {
    disabled = Boolean(next);
    root.setAttribute("aria-disabled", String(disabled));
    update();
    return disabled;
  };
  const adjacentValue = (direction) => {
    const progress = (value - minimum) / step;
    const tolerance = Number.EPSILON * Math.max(1, Math.abs(progress)) * 4;
    const index = direction > 0
      ? Math.floor(progress + tolerance) + 1
      : Math.ceil(progress - tolerance) - 1;
    return Math.min(maximum, Math.max(minimum, minimum + index * step));
  };
  const decrement = () => {
    if (!decrementButton.disabled) setValue(adjacentValue(-1), { emit: true });
  };
  const increment = () => {
    if (!incrementButton.disabled) setValue(adjacentValue(1), { emit: true });
  };
  decrementButton.addEventListener("click", decrement);
  incrementButton.addEventListener("click", increment);

  setValue(options.value ?? minimum);
  setDisabled(disabled);
  defineApi(root, {
    decrementButton,
    incrementButton,
    labelElement: label,
    output,
    setValue,
    setDisabled,
    destroy() {
      decrementButton.removeEventListener("click", decrement);
      incrementButton.removeEventListener("click", increment);
    },
  });
  defineGetter(root, "value", () => value);
  defineGetter(root, "disabled", () => disabled);
  return root;
}
