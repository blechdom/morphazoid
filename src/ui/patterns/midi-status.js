import {
  applyCommonOptions,
  classNames,
  defineApi,
  defineGetter,
  requireDocument,
  setClassState,
} from "../internal.js";

const STATES = new Set(["off", "enabling", "on", "receiving", "error", "unsupported"]);
const STATE_COPY = {
  off: "off",
  enabling: "enabling",
  on: "ready",
  receiving: "receiving",
  error: "error",
  unsupported: "unavailable",
};

/** Render the shared MIDI connection/activity control without requesting access. */
export function createMidiStatus(options = {}, doc = globalThis.document) {
  requireDocument(doc);
  let state = STATES.has(options.state) ? options.state : "off";
  let deviceLabel = String(options.deviceLabel ?? "ready");

  const root = doc.createElement("div");
  root.className = classNames("mz-midi-status", "midi-toolbar", options.className);
  root.setAttribute("role", "group");
  applyCommonOptions(root, { ...options, ariaLabel: options.ariaLabel ?? "MIDI status" });

  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "mz-midi-status__toggle midi-toggle";
  const statusDot = doc.createElement("i");
  statusDot.className = "mz-midi-status__status midi-status-dot";
  statusDot.setAttribute("aria-hidden", "true");
  const label = doc.createElement("b");
  label.textContent = String(options.label ?? "MIDI");
  const status = doc.createElement("small");
  const activity = doc.createElement("i");
  activity.className = "mz-midi-status__activity midi-activity-light";
  activity.setAttribute("aria-hidden", "true");
  toggle.append(statusDot, label, status, activity);
  root.append(toggle);

  const update = () => {
    const connected = state === "on" || state === "receiving";
    const stateLabel = connected ? deviceLabel : STATE_COPY[state];
    status.textContent = stateLabel;
    toggle.setAttribute("aria-pressed", String(connected));
    toggle.setAttribute("aria-label", connected ? "Disable MIDI" : "Enable MIDI");
    toggle.setAttribute("data-midi-state", state);
    toggle.disabled = state === "unsupported" || state === "enabling" || Boolean(options.disabled);
    toggle.setAttribute("aria-busy", String(state === "enabling"));
    setClassState(root, "is-receiving", state === "receiving");
    setClassState(root, "is-error", state === "error");
    return state;
  };
  const setState = (next) => {
    state = STATES.has(next) ? next : "off";
    update();
    return state;
  };
  const setDeviceLabel = (next) => {
    deviceLabel = String(next ?? "ready");
    update();
    return deviceLabel;
  };
  const setReceiving = (receiving) => setState(receiving ? "receiving" : "on");
  const handleClick = (event) => {
    if (toggle.disabled) return;
    const requested = state === "on" || state === "receiving" ? "off" : "on";
    if (options.controlled !== true) setState(requested);
    options.onToggle?.(requested === "on", event, root);
  };
  if (options.interactive !== false) toggle.addEventListener("click", handleClick);

  update();
  defineApi(root, {
    toggle,
    statusDot,
    labelElement: label,
    statusElement: status,
    activityLight: activity,
    setState,
    setDeviceLabel,
    setReceiving,
    destroy() {
      if (options.interactive !== false) toggle.removeEventListener("click", handleClick);
    },
  });
  defineGetter(root, "state", () => state);
  defineGetter(root, "deviceLabel", () => deviceLabel);
  return root;
}
