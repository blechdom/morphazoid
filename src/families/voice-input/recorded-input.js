import { createAudioInputMeter } from "../../audio-input-meter.js";
import { RECORDED_INPUT_SOURCES, createRecordedInputCore } from "../recorded-input/recorded-input-core.js";

/** Adds File and Samples to an existing audio-input strip. Recorded audio is
 * fed to the instrument's own microphone entry node, so the instrument owns
 * arming and the signal path; selecting a source never requests the microphone.
 * The strip's source select, file button, state, channel, error and level
 * reporting are extended on the control instance, and restored on destroy. */
export function mountRecordedInput({
  control, host, prepare, getContext, getTarget, isArmed,
  isEngaged = () => true, channels = () => 2, multiplier = () => Number(control.gainInput.value) || 1, meterNode = null,
  onSourceChange = () => {}, onLiveChange = () => {},
}) {
  const root = control.root;
  const doc = root.ownerDocument;
  const abort = new AbortController();
  const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: abort.signal });
  let meter = null, input = null;

  const select = doc.createElement("select");
  select.className = "mz-input-source";
  select.setAttribute("aria-label", "Input source");
  for (const { value, label } of RECORDED_INPUT_SOURCES) {
    const option = doc.createElement("option");
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  const fileButton = doc.createElement("button");
  fileButton.type = "button";
  fileButton.className = "mz-input-file";
  fileButton.setAttribute("aria-label", "Choose audio file");
  fileButton.title = "Choose audio file";
  fileButton.textContent = "↥";
  fileButton.hidden = true;

  const zero = Object.freeze({ left: 0, right: 0 });
  const releaseMeter = () => { meter?.destroy(); meter = null; };
  const readLevels = () => {
    if (!input.isPlaying()) { releaseMeter(); return zero; }
    const node = meterNode?.() ?? input.bridge;
    if (!node || node.context?.state === "closed") { releaseMeter(); return zero; }
    if (meter?.node !== node) { releaseMeter(); meter = createAudioInputMeter(node, { channels: channels() }); }
    return meter?.read(multiplier()) ?? zero;
  };

  const restore = [];
  const override = (name, wrap) => {
    const original = root[name];
    Object.defineProperty(root, name, { configurable: true, enumerable: false, writable: true, value: wrap(original.bind(root)) });
    restore.push(() => Object.defineProperty(root, name, { configurable: true, enumerable: false, writable: false, value: original }));
  };
  const recorded = () => Boolean(input) && input.source !== "mic";
  override("setInputState", original => next => {
    if (!recorded()) return original(next);
    const state = input.snapshot();
    return original({ active: state.playing, pending: state.pending, supported: true });
  });
  override("setChannels", original => count => original(recorded() ? channels() : count));
  override("setError", original => message => original(recorded() ? input.error : message));
  override("setLevels", original => (left, right) => (recorded() ? original(readLevels()) : original(left, right)));

  input = createRecordedInputCore({
    host, doc, label: "Recorded input", fileLoad: "when-armed", prepare, getContext, targets: () => [getTarget()], isArmed, isEngaged,
    onChange: () => control.refresh(),
    onActiveChange: (live, state) => onLiveChange(live, state),
    onSourceChange: (next, previous) => {
      releaseMeter();
      select.value = next;
      fileButton.hidden = next !== "file";
      root.setSource(next);
      onSourceChange(next, previous);
      control.refresh();
    },
    onDestroy: () => {
      abort.abort();
      releaseMeter();
      for (const undo of restore) undo();
      select.remove(); fileButton.remove();
    },
  });
  root.append(select, input.fileInput, fileButton);

  listen(select, "change", () => input.setSource(select.value));
  listen(fileButton, "click", () => input.fileInput.click());
  listen(root, "click", event => {
    if (!recorded() || !event.target?.closest?.(".mz-input-toggle")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const state = input.snapshot();
    if (state.playing || state.pending) { input.stop(); return; }
    if (input.source === "file" && !state.hasFile && !state.pendingFileName) { input.fileInput.click(); return; }
    void input.run(input.start());
  }, { capture: true });

  return {
    selectSource: value => input.setSource(value), destroy: () => input.destroy(), stop: () => input.stop(),
    source: () => input.source, isLive: () => input.isPlaying(), snapshot: () => input.snapshot(), signal: () => input.bridge,
  };
}
