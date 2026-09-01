import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
} from "../internal.js";

const DIRECTIONS = new Set(["forward", "reverse"]);
const MODES = new Set(["loop", "pingpong"]);

/** Create the direction + loop/ping-pong button array used by playheads. */
export function createMotionModeGroup(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  let direction = DIRECTIONS.has(options.direction) ? options.direction : "forward";
  let mode = MODES.has(options.mode) ? options.mode : "loop";
  let disabled = Boolean(options.disabled);

  const root = doc.createElement("div");
  root.className = classNames("mz-motion-mode-group", "transport-button-array", options.className);
  root.setAttribute("role", "group");
  applyCommonOptions(root, { ...options, ariaLabel: options.ariaLabel ?? "Direction and movement" });

  const makeButton = (className, glyphText, labelText) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = className;
    const glyph = doc.createElement("span");
    glyph.setAttribute("aria-hidden", "true");
    glyph.textContent = glyphText;
    const label = doc.createElement("small");
    label.textContent = labelText;
    button.append(glyph, label);
    return { button, glyph, label };
  };
  const directionControl = makeButton("mz-motion-mode-group__direction direction-toggle", "→", "FWD");
  const loopControl = makeButton("mz-motion-mode-group__mode", "⟳", "Loop");
  const pingPongControl = makeButton("mz-motion-mode-group__mode", "↔", "Ping-pong");
  root.append(directionControl.button, loopControl.button, pingPongControl.button);

  const update = () => {
    const reverse = direction === "reverse";
    directionControl.glyph.textContent = reverse ? "←" : "→";
    directionControl.label.textContent = reverse
      ? String(options.reverseLabel ?? "REV")
      : String(options.forwardLabel ?? "FWD");
    directionControl.button.setAttribute("aria-label", `Direction: ${reverse ? "reverse" : "forward"}`);
    directionControl.button.setAttribute("data-direction", direction);
    loopControl.button.setAttribute("aria-label", "Loop movement");
    loopControl.button.setAttribute("aria-pressed", String(mode === "loop"));
    pingPongControl.button.setAttribute("aria-label", "Back-and-forth movement");
    pingPongControl.button.setAttribute("aria-pressed", String(mode === "pingpong"));
    [directionControl.button, loopControl.button, pingPongControl.button].forEach((button) => {
      button.disabled = disabled;
    });
  };
  const setDirection = (next, { emit = false, event } = {}) => {
    const normalized = DIRECTIONS.has(next) ? next : "forward";
    const changed = normalized !== direction;
    direction = normalized;
    update();
    if (emit && changed) options.onDirectionChange?.(direction, event, root);
    return direction;
  };
  const setMode = (next, { emit = false, event } = {}) => {
    const normalized = MODES.has(next) ? next : "loop";
    const changed = normalized !== mode;
    mode = normalized;
    update();
    if (emit && changed) options.onModeChange?.(mode, event, root);
    return mode;
  };
  const setDisabled = (next) => {
    disabled = Boolean(next);
    root.setAttribute("aria-disabled", String(disabled));
    update();
    return disabled;
  };
  const toggleDirection = (event) => {
    if (!directionControl.button.disabled) setDirection(direction === "forward" ? "reverse" : "forward", { emit: true, event });
  };
  const chooseLoop = (event) => {
    if (!loopControl.button.disabled) setMode("loop", { emit: true, event });
  };
  const choosePingPong = (event) => {
    if (!pingPongControl.button.disabled) setMode("pingpong", { emit: true, event });
  };
  directionControl.button.addEventListener("click", toggleDirection);
  loopControl.button.addEventListener("click", chooseLoop);
  pingPongControl.button.addEventListener("click", choosePingPong);

  update();
  defineApi(root, {
    directionButton: directionControl.button,
    loopButton: loopControl.button,
    pingPongButton: pingPongControl.button,
    setDirection,
    setMode,
    setDisabled,
    destroy() {
      directionControl.button.removeEventListener("click", toggleDirection);
      loopControl.button.removeEventListener("click", chooseLoop);
      pingPongControl.button.removeEventListener("click", choosePingPong);
    },
  });
  defineGetter(root, "direction", () => direction);
  defineGetter(root, "mode", () => mode);
  defineGetter(root, "disabled", () => disabled);
  return root;
}
