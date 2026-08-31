import {
  appendContent,
  applyCommonOptions,
  classNames,
  defineApi,
  requireDocument,
  setClassState,
} from "../internal.js";

const BUTTON_VARIANTS = new Set([
  "default",
  "mini",
  "reset",
  "primary",
  "quiet",
  "danger",
  "play",
  "audio",
]);
const BUTTON_SIZES = new Set(["default", "compact", "square"]);
const AUDIO_STATES = new Set(["off", "starting", "on", "error"]);
const AUDIO_STATE_LABELS = {
  off: ["Turn audio on", "Audio off"],
  starting: ["Starting audio", "Starting audio"],
  on: ["Turn audio off", "Audio on"],
  error: ["Audio unavailable", "Audio unavailable"],
};

function normalizedChoice(value, choices, fallback) {
  return choices.has(value) ? value : fallback;
}

function createSvgElement(doc, name) {
  if (typeof doc.createElementNS === "function") {
    return doc.createElementNS("http://www.w3.org/2000/svg", name);
  }
  return doc.createElement(name);
}

function appendTransportIcons(icon, doc) {
  const play = createSvgElement(doc, "svg");
  play.setAttribute("class", "transport-play");
  play.setAttribute("viewBox", "0 0 24 24");
  play.setAttribute("aria-hidden", "true");
  const playPath = createSvgElement(doc, "path");
  playPath.setAttribute("d", "M8 5.5 18 12 8 18.5Z");
  play.append(playPath);

  const pause = createSvgElement(doc, "svg");
  pause.setAttribute("class", "transport-pause");
  pause.setAttribute("viewBox", "0 0 24 24");
  pause.setAttribute("aria-hidden", "true");
  const pausePath = createSvgElement(doc, "path");
  pausePath.setAttribute("d", "M8 6v12M16 6v12");
  pause.append(pausePath);

  icon.append(play, pause);
}

/**
 * Create a Morphazoid button. The returned button remains an ordinary native
 * element and gains small controller helpers for component demos and apps.
 */
export function createButton(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  const variant = normalizedChoice(options.variant, BUTTON_VARIANTS, "default");
  const size = normalizedChoice(options.size, BUTTON_SIZES, "default");
  const isToggle = typeof options.toggle === "boolean" ? options.toggle : variant === "play";
  const button = doc.createElement("button");
  button.type = options.type ?? "button";
  button.className = classNames(
    "mz-button",
    `mz-button--${variant}`,
    size !== "default" && `mz-button--${size}`,
    variant === "mini" && "mini-action",
    variant === "reset" && "reset-all-button",
    variant === "play" && "play-button",
    variant === "audio" && "audio-button",
    options.className,
  );
  applyCommonOptions(button, options);

  if (options.name !== undefined) button.name = String(options.name);
  if (options.value !== undefined) button.value = String(options.value);

  const icon = doc.createElement("span");
  icon.className = classNames(
    "mz-button__icon",
    variant === "play" && "mz-button__transport-icon",
    variant === "audio" && "mz-button__audio-icon audio-speaker-icon",
    options.iconClassName,
  );
  icon.setAttribute("aria-hidden", "true");
  if (variant === "play" && options.icon === undefined) appendTransportIcons(icon, doc);
  else if (options.icon !== undefined && options.icon !== null) appendContent(icon, options.icon, doc);

  const label = doc.createElement("span");
  label.className = "mz-button__label";
  label.textContent = String(options.label ?? "Button");
  if (options.icon !== undefined || variant === "play" || variant === "audio") button.append(icon);
  button.append(label);

  if (variant === "audio") button.setAttribute("data-audio-icon-ready", "true");

  if (!options.ariaLabel && (variant === "play" || variant === "audio")) {
    button.setAttribute("aria-label", label.textContent);
  }

  const setPressed = (pressed) => {
    const next = Boolean(pressed);
    button.setAttribute("aria-pressed", String(next));
    setClassState(button, "is-pressed", next);
    return next;
  };
  const setDisabled = (disabled) => {
    button.disabled = Boolean(disabled);
    return button.disabled;
  };
  const setAudioState = (state) => {
    const next = normalizedChoice(state, AUDIO_STATES, "off");
    button.setAttribute("data-audio-state", next);
    if (variant === "audio") {
      setPressed(next === "on");
      const [ariaLabel, title] = AUDIO_STATE_LABELS[next];
      if (!options.ariaLabel) button.setAttribute("aria-label", ariaLabel);
      if (!options.title) button.title = title;
    }
    return next;
  };
  const setAttention = (attention) => {
    if (attention) button.setAttribute("data-audio-attention", "true");
    else button.removeAttribute("data-audio-attention");
    return Boolean(attention);
  };

  if (typeof options.pressed === "boolean") setPressed(options.pressed);
  else if (isToggle) setPressed(false);
  if (variant === "audio") {
    setAudioState(options.audioState ?? (options.pressed ? "on" : "off"));
  }
  if (options.attention !== undefined) setAttention(options.attention);
  setDisabled(options.disabled);

  const onClick = (event) => {
    if (button.disabled) return;
    if (isToggle) setPressed(button.getAttribute("aria-pressed") !== "true");
    options.onClick?.(event, button);
  };
  button.addEventListener("click", onClick);

  return defineApi(button, {
    iconElement: icon,
    labelElement: label,
    setPressed,
    setDisabled,
    setAudioState,
    setAttention,
    destroy() {
      button.removeEventListener("click", onClick);
    },
  });
}
