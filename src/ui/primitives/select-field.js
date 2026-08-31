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

function optionDefinition(option) {
  if (option && typeof option === "object") return option;
  return { value: option, label: option };
}

function appendOption(parent, definition, doc) {
  const spec = optionDefinition(definition);
  const option = doc.createElement("option");
  option.value = String(spec.value ?? spec.label ?? "");
  option.textContent = String(spec.label ?? spec.value ?? "");
  option.disabled = Boolean(spec.disabled);
  option.selected = Boolean(spec.selected);
  if (spec.title) option.title = String(spec.title);
  parent.append(option);
  return option;
}

/** Create a labelled native select, including optional optgroup definitions. */
export function createSelectField(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const root = doc.createElement("label");
  root.className = classNames("mz-field", "mz-select-field", "select-control", options.className);
  applyCommonOptions(root, { ...options, id: options.rootId });

  const selectId = String(options.id ?? nextId("mz-select", doc));
  const label = doc.createElement("span");
  label.className = classNames("mz-field__label", "field-label", options.labelClassName);
  label.textContent = String(options.label ?? "Choose an option");

  const shell = doc.createElement("span");
  shell.className = classNames("mz-select-field__shell", "select-shell", options.shellClassName);
  const select = doc.createElement("select");
  select.id = selectId;
  select.className = classNames("mz-select-field__select", options.selectClassName);
  if (options.name !== undefined) select.name = String(options.name);
  if (options.ariaLabel) select.setAttribute("aria-label", String(options.ariaLabel));
  if (options.selectAttributes) {
    for (const [name, value] of Object.entries(options.selectAttributes)) {
      if (value !== undefined && value !== null && value !== false) {
        select.setAttribute(name, value === true ? "" : String(value));
      }
    }
  }
  root.htmlFor = selectId;

  let description = null;
  if (options.description !== undefined && options.description !== null) {
    description = doc.createElement("small");
    description.id = String(options.descriptionId ?? `${selectId}-description`);
    description.className = classNames("mz-field__description", "control-note", options.descriptionClassName);
    description.textContent = String(options.description);
    select.setAttribute("aria-describedby", description.id);
  }

  const populate = (definitions = []) => {
    select.replaceChildren();
    if (options.placeholder !== undefined) {
      const placeholder = appendOption(select, {
        value: "",
        label: options.placeholder,
        disabled: options.placeholderDisabled !== false,
      }, doc);
      placeholder.hidden = Boolean(options.placeholderHidden);
    }
    for (const definition of definitions ?? []) {
      if (definition && typeof definition === "object" && Array.isArray(definition.options)) {
        const group = doc.createElement("optgroup");
        group.label = String(definition.label ?? "Options");
        group.disabled = Boolean(definition.disabled);
        for (const child of definition.options) appendOption(group, child, doc);
        select.append(group);
      } else {
        appendOption(select, definition, doc);
      }
    }
  };
  const setValue = (value, { emit = false, eventType = "change" } = {}) => {
    select.value = value === undefined || value === null ? "" : String(value);
    if (emit) dispatchNativeEvent(select, eventType, doc);
    return select.value;
  };
  const setOptions = (definitions, { value = select.value } = {}) => {
    populate(definitions);
    setValue(value);
    return select.options;
  };
  const setDisabled = (disabled) => {
    select.disabled = Boolean(disabled);
    setClassState(root, "is-disabled", select.disabled);
    return select.disabled;
  };
  const handleInput = (event) => options.onInput?.(select.value, event, root);
  const handleChange = (event) => options.onChange?.(select.value, event, root);
  select.addEventListener("input", handleInput);
  select.addEventListener("change", handleChange);

  populate(options.options);
  if (options.value !== undefined) setValue(options.value);
  shell.append(select);
  root.append(label, shell);
  if (description) root.append(description);
  setDisabled(options.disabled);

  defineApi(root, {
    labelElement: label,
    shell,
    select,
    description,
    setValue,
    setOptions,
    setDisabled,
    destroy() {
      select.removeEventListener("input", handleInput);
      select.removeEventListener("change", handleChange);
    },
  });
  defineGetter(root, "value", () => select.value);
  defineGetter(root, "disabled", () => select.disabled);
  return root;
}
