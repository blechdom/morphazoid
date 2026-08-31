import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
  setClassState,
} from "../internal.js";

function clampLevel(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

/** Create one stateful step cell; parent sequencers retain scheduling and grid logic. */
export function createStepButton(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const index = Math.max(0, Math.round(Number(options.index) || 0));
  const displayIndex = options.displayIndex ?? index + 1;
  const defaultLevel = clampLevel(options.defaultLevel ?? options.level ?? 0.72) || 0.72;
  let level = clampLevel(options.active === false ? 0 : options.level ?? (options.active ? defaultLevel : 0));
  let current = Boolean(options.current);
  let outsideLoop = Boolean(options.outsideLoop);
  let loopEnd = Boolean(options.loopEnd);

  const button = doc.createElement("button");
  button.type = "button";
  button.className = classNames("mz-step-button", options.className);
  applyCommonOptions(button, options);
  button.setAttribute("data-step", String(index));

  const number = doc.createElement("span");
  number.className = "mz-step-button__number";
  number.textContent = String(displayIndex);
  const indicator = doc.createElement("i");
  indicator.className = "mz-step-button__indicator";
  indicator.setAttribute("aria-hidden", "true");
  button.append(number, indicator);

  const updateLabel = () => {
    const state = outsideLoop
      ? "outside loop"
      : level > 0
        ? `active, ${Math.round(level * 100)}% level`
        : "inactive";
    const suffix = [state, loopEnd && "loop end", current && "current"].filter(Boolean).join(", ");
    button.setAttribute("aria-label", String(options.ariaLabel ?? `Step ${displayIndex}, ${suffix}`));
  };
  const update = () => {
    button.setAttribute("aria-pressed", String(level > 0));
    button.setAttribute("data-level", String(level));
    if (button.style?.setProperty) button.style.setProperty("--mz-step-height", `${6 + 20 * level}px`);
    setClassState(button, "is-current", current);
    setClassState(button, "is-outside-loop", outsideLoop);
    setClassState(button, "is-loop-end", loopEnd);
    if (current) button.setAttribute("aria-current", "step");
    else button.removeAttribute("aria-current");
    updateLabel();
    return level;
  };
  const setLevel = (next, { emit = false, event } = {}) => {
    const previous = level;
    level = clampLevel(next);
    update();
    if (emit && level !== previous) options.onChange?.(level, index, event, button);
    return level;
  };
  const setCurrent = (next) => { current = Boolean(next); update(); return current; };
  const setOutsideLoop = (next) => { outsideLoop = Boolean(next); update(); return outsideLoop; };
  const setLoopEnd = (next) => { loopEnd = Boolean(next); update(); return loopEnd; };
  const setDisabled = (next) => { button.disabled = Boolean(next); return button.disabled; };
  const handleClick = (event) => {
    if (!button.disabled && !outsideLoop) setLevel(level > 0 ? 0 : defaultLevel, { emit: true, event });
  };
  button.addEventListener("click", handleClick);

  update();
  setDisabled(options.disabled);
  defineApi(button, {
    numberElement: number,
    indicator,
    setLevel,
    setCurrent,
    setOutsideLoop,
    setLoopEnd,
    setDisabled,
    destroy() { button.removeEventListener("click", handleClick); },
  });
  defineGetter(button, "level", () => level);
  defineGetter(button, "current", () => current);
  defineGetter(button, "outsideLoop", () => outsideLoop);
  return button;
}
