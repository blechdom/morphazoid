import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
  setClassState,
} from "../internal.js";

function choiceDefinition(choice) {
  if (choice && typeof choice === "object") return choice;
  return { value: choice, label: choice };
}

/** Create an immediate, mutually exclusive group of native toggle buttons. */
export function createChoiceSwitch(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const root = doc.createElement("div");
  root.className = classNames("mz-field", "mz-choice-field", "control", options.className);
  applyCommonOptions(root, options);

  const label = doc.createElement("span");
  label.className = classNames("mz-field__label", "field-label", options.labelClassName);
  label.textContent = String(options.label ?? "Choose");

  const group = doc.createElement("div");
  group.className = classNames(
    "mz-choice-switch",
    "choice-switch",
    options.compact && "compact",
    options.groupClassName,
  );
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", String(options.ariaLabel ?? options.label ?? "Choose"));

  const definitions = (options.choices ?? options.options ?? []).map(choiceDefinition);
  const buttons = [];
  let selectedValue;
  let globallyDisabled = Boolean(options.disabled);

  const paint = () => {
    for (let index = 0; index < buttons.length; index += 1) {
      const button = buttons[index];
      const definition = definitions[index];
      const selected = String(definition.value ?? definition.label ?? "") === String(selectedValue);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = globallyDisabled || Boolean(definition.disabled);
    }
    setClassState(root, "is-disabled", globallyDisabled);
  };
  const setValue = (value, { notify = false, event = null } = {}) => {
    const match = definitions.find((definition) => (
      String(definition.value ?? definition.label ?? "") === String(value)
    ));
    if (!match) return selectedValue;
    selectedValue = match.value ?? match.label ?? "";
    group.setAttribute("data-value", String(selectedValue));
    paint();
    if (notify) options.onChange?.(selectedValue, event, root);
    return selectedValue;
  };
  const setDisabled = (disabled) => {
    globallyDisabled = Boolean(disabled);
    paint();
    return globallyDisabled;
  };

  definitions.forEach((definition, index) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = classNames("mz-choice-switch__option", definition.className);
    button.textContent = String(definition.label ?? definition.value ?? `Option ${index + 1}`);
    button.value = String(definition.value ?? definition.label ?? "");
    if (definition.ariaLabel) button.setAttribute("aria-label", String(definition.ariaLabel));
    if (definition.title) button.title = String(definition.title);
    const handleClick = (event) => {
      if (button.disabled) return;
      setValue(definition.value ?? definition.label ?? "", { notify: true, event });
    };
    button.addEventListener("click", handleClick);
    Object.defineProperty(button, "_mzDestroy", {
      configurable: true,
      value: () => button.removeEventListener("click", handleClick),
    });
    buttons.push(button);
    group.append(button);
  });

  const initial = options.value ?? definitions.find((definition) => definition.selected)?.value
    ?? definitions[0]?.value ?? definitions[0]?.label;
  if (initial !== undefined) setValue(initial);
  else paint();
  root.append(label, group);

  defineApi(root, {
    labelElement: label,
    group,
    buttons,
    setValue,
    setDisabled,
    destroy() {
      buttons.forEach((button) => button._mzDestroy?.());
    },
  });
  defineGetter(root, "value", () => selectedValue);
  defineGetter(root, "disabled", () => globallyDisabled);
  return root;
}
