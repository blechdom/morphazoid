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
import { createButton } from "../primitives/button.js";

function defaultLevelFormat(value) {
  return `${Math.round(Number(value) * 100)}%`;
}

/**
 * Create the compact audio switch and master-level pair used in Morphazoid
 * mastheads. Audio engine ownership remains with the consuming application.
 */
export function createAudioStrip(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const root = doc.createElement("div");
  root.className = classNames("mz-audio-strip", "audio-strip", options.className);
  applyCommonOptions(root, {
    ...options,
    ariaLabel: options.ariaLabel ?? "Audio controls",
  });
  root.setAttribute("role", "group");

  const button = createButton({
    id: options.buttonId,
    label: options.buttonLabel ?? "Audio",
    variant: "audio",
    size: "square",
    audioState: options.audioState ?? "off",
    attention: options.attention,
    disabled: options.audioDisabled,
    ariaLabel: options.audioAriaLabel,
    title: options.audioTitle,
    className: options.buttonClassName,
    onClick(event) {
      options.onAudioClick?.(event, root);
    },
  }, doc);

  const inputId = String(options.levelId ?? nextId("mz-master-level", doc));
  const level = doc.createElement("label");
  level.className = classNames("mz-header-level", "header-level", options.levelClassName);
  level.htmlFor = inputId;

  const heading = doc.createElement("span");
  const label = doc.createElement("b");
  label.textContent = String(options.levelLabel ?? "Master level");
  const output = doc.createElement("output");
  output.setAttribute("for", inputId);
  output.htmlFor = inputId;
  heading.append(label, output);

  const input = doc.createElement("input");
  input.type = "range";
  input.id = inputId;
  input.className = classNames("mz-header-level__input", options.inputClassName);
  input.setAttribute("aria-label", String(options.levelAriaLabel ?? options.levelLabel ?? "Master audio level"));
  input.min = String(options.min ?? 0);
  input.max = String(options.max ?? 1);
  input.step = String(options.step ?? 0.01);
  input.value = String(options.level ?? 0.56);
  if (options.levelName !== undefined) input.name = String(options.levelName);
  level.append(heading, input);

  const formatLevel = options.formatLevel ?? defaultLevelFormat;
  const readLevel = () => {
    const value = Number(input.value);
    return Number.isFinite(value) ? value : input.value;
  };
  const update = () => {
    const value = readLevel();
    const formatted = typeof formatLevel === "function"
      ? formatLevel(value, input)
      : String(formatLevel).replace("{}", String(value));
    output.value = String(formatted ?? "");
    output.textContent = output.value;
    return value;
  };
  const setLevel = (value, { emit = false, eventType = "input" } = {}) => {
    input.value = String(value);
    const next = update();
    if (emit) dispatchNativeEvent(input, eventType, doc);
    return next;
  };
  const setLevelDisabled = (disabled) => {
    input.disabled = Boolean(disabled);
    setClassState(level, "is-disabled", input.disabled);
    return input.disabled;
  };
  const handleInput = (event) => {
    const value = update();
    options.onLevelInput?.(value, event, root);
  };
  const handleChange = (event) => {
    const value = update();
    options.onLevelChange?.(value, event, root);
  };
  input.addEventListener("input", handleInput);
  input.addEventListener("change", handleChange);

  root.append(button, level);
  setLevelDisabled(options.levelDisabled);
  update();

  defineApi(root, {
    audioButton: button,
    levelField: level,
    levelLabelElement: label,
    levelInput: input,
    levelOutput: output,
    setAudioState: button.setAudioState,
    setAttention: button.setAttention,
    setAudioDisabled: button.setDisabled,
    setLevel,
    setLevelDisabled,
    update,
    destroy() {
      button.destroy();
      input.removeEventListener("input", handleInput);
      input.removeEventListener("change", handleChange);
    },
  });
  defineGetter(root, "level", readLevel);
  defineGetter(root, "audioState", () => button.getAttribute("data-audio-state"));
  return root;
}
