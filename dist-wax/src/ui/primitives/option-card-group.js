import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
} from "../internal.js";

function normalizedOption(option, index) {
  if (typeof option === "string" || typeof option === "number") {
    return { value: option, label: String(option), key: `option-${index}` };
  }
  return {
    ...option,
    value: option?.value ?? option?.label ?? index,
    label: String(option?.label ?? option?.value ?? `Option ${index + 1}`),
    key: String(option?.key ?? option?.value ?? index),
  };
}

/** Create a selectable grid of named preset/patch cards. */
export function createOptionCardGroup(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  let entries = [];
  let buttons = [];
  let value = options.value;
  let disabled = Boolean(options.disabled);

  const root = doc.createElement("fieldset");
  root.className = classNames("mz-option-card-group", options.compact && "is-compact", options.className);
  applyCommonOptions(root, options);

  const legend = doc.createElement("legend");
  legend.className = "mz-option-card-group__legend mz-field__label";
  legend.textContent = String(options.label ?? options.ariaLabel ?? "Options");
  if (!options.label) legend.classList.add("mz-sr-only");

  const grid = doc.createElement("div");
  grid.className = "mz-option-card-group__grid";
  if (options.columns) grid.setAttribute("style", `--mz-option-columns:${Math.max(1, Number(options.columns) || 1)}`);
  root.append(legend, grid);

  const update = () => {
    buttons.forEach((button, index) => {
      const selected = Object.is(entries[index]?.value, value);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = disabled || Boolean(entries[index]?.disabled);
    });
    root.disabled = disabled;
    return value;
  };
  const setValue = (next, { emit = false, event } = {}) => {
    const entry = entries.find((candidate) => Object.is(candidate.value, next));
    if (!entry || entry.disabled) return value;
    const previous = value;
    value = entry.value;
    update();
    if (emit && !Object.is(previous, value)) options.onChange?.(value, event, root);
    return value;
  };
  const render = () => {
    grid.replaceChildren();
    buttons = entries.map((entry) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "mz-option-card-group__option";
      button.setAttribute("data-value", String(entry.value));
      const title = doc.createElement("b");
      title.textContent = entry.label;
      button.append(title);
      if (entry.description) {
        const description = doc.createElement("small");
        description.textContent = String(entry.description);
        button.append(description);
      }
      button.addEventListener("click", (event) => {
        if (!button.disabled) setValue(entry.value, { emit: true, event });
      });
      grid.append(button);
      return button;
    });
    if (!buttons.length) {
      const empty = doc.createElement("p");
      empty.className = "mz-option-card-group__empty mz-control-note";
      empty.textContent = String(options.emptyLabel ?? "No options available");
      grid.append(empty);
    }
    if (!entries.some((entry) => Object.is(entry.value, value) && !entry.disabled)) {
      value = entries.find((entry) => !entry.disabled)?.value;
    }
    update();
  };
  const setOptions = (nextOptions, nextValue = value) => {
    entries = (nextOptions ?? []).map(normalizedOption);
    value = nextValue;
    render();
    return entries;
  };
  const setDisabled = (next) => {
    disabled = Boolean(next);
    update();
    return disabled;
  };

  setOptions(options.options ?? [], value);
  setDisabled(disabled);
  defineApi(root, { legend, grid, setValue, setOptions, setDisabled });
  defineGetter(root, "buttons", () => buttons);
  defineGetter(root, "value", () => value);
  return root;
}
