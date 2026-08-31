import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  dispatchNativeEvent,
  nextId,
  requireDocument,
  setClassState,
} from "../internal.js";

function defaultRangeFormat(value) {
  return Number.isFinite(value) ? String(value) : "—";
}

/** Create a labelled native range input with a synchronized output. */
export function createRangeField(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const root = doc.createElement("label");
  root.className = classNames("mz-field", "mz-range-field", "control", options.className);
  applyCommonOptions(root, { ...options, id: options.rootId });

  const inputId = String(options.id ?? nextId("mz-range", doc));
  const heading = doc.createElement("span");
  heading.className = "mz-field__heading";
  const label = doc.createElement("span");
  label.className = classNames("mz-field__label", "field-label", options.labelClassName);
  label.textContent = String(options.label ?? "Value");
  const output = doc.createElement("output");
  output.className = classNames("mz-field__output", options.outputClassName);
  output.setAttribute("for", inputId);
  output.htmlFor = inputId;
  heading.append(label, output);

  const input = doc.createElement("input");
  input.type = "range";
  input.id = inputId;
  input.className = classNames("mz-range-field__input", options.inputClassName);
  if (options.name !== undefined) input.name = String(options.name);
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  if (options.value !== undefined) input.value = String(options.value);
  if (options.ariaLabel) input.setAttribute("aria-label", String(options.ariaLabel));
  if (options.inputAttributes) {
    for (const [name, value] of Object.entries(options.inputAttributes)) {
      if (value !== undefined && value !== null && value !== false) {
        input.setAttribute(name, value === true ? "" : String(value));
      }
    }
  }
  root.htmlFor = inputId;

  let description = null;
  if (options.description !== undefined && options.description !== null) {
    description = doc.createElement("small");
    description.id = String(options.descriptionId ?? `${inputId}-description`);
    description.className = classNames("mz-field__description", "control-note", options.descriptionClassName);
    description.textContent = String(options.description);
    input.setAttribute("aria-describedby", description.id);
  }

  const readValue = () => {
    if (typeof options.parseValue === "function") return options.parseValue(input.value, input);
    const number = Number(input.value);
    return Number.isFinite(number) ? number : input.value;
  };
  const formatter = options.formatValue ?? options.format ?? defaultRangeFormat;
  const update = () => {
    const value = readValue();
    const formatted = typeof formatter === "function"
      ? formatter(value, input)
      : String(formatter).replace("{}", String(value));
    output.value = String(formatted ?? "");
    output.textContent = output.value;
    return value;
  };
  const setValue = (value, { emit = false, eventType = "input" } = {}) => {
    input.value = String(value);
    const next = update();
    if (emit) dispatchNativeEvent(input, eventType, doc);
    return next;
  };
  const setDisabled = (disabled) => {
    input.disabled = Boolean(disabled);
    setClassState(root, "is-disabled", input.disabled);
    return input.disabled;
  };
  const handleInput = (event) => {
    const value = update();
    options.onInput?.(value, event, root);
  };
  const handleChange = (event) => {
    const value = update();
    options.onChange?.(value, event, root);
  };
  input.addEventListener("input", handleInput);
  input.addEventListener("change", handleChange);

  root.append(heading, input);
  if (description) root.append(description);
  setDisabled(options.disabled);
  update();

  defineApi(root, {
    headingElement: heading,
    labelElement: label,
    input,
    output,
    description,
    setValue,
    setDisabled,
    update,
    destroy() {
      input.removeEventListener("input", handleInput);
      input.removeEventListener("change", handleChange);
    },
  });
  defineGetter(root, "value", readValue);
  defineGetter(root, "disabled", () => input.disabled);
  return root;
}
