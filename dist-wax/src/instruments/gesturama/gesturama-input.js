import { RECORDED_INPUT_SOURCES, createRecordedInputCore } from "../../families/recorded-input/recorded-input-core.js";

export function isRecordedMode(mode) {
  return mode === "file" || mode === "samples";
}

export function inputStripState(mode, recorded, mic) {
  return isRecordedMode(mode)
    ? { active: Boolean(recorded.playing), pending: Boolean(recorded.pending), source: mode }
    : { active: Boolean(mic.active), pending: Boolean(mic.pending), source: mode };
}

/** File and Samples play into the node the microphone feeds, so meter and Record sample see them identically. */
export function createGesturamaInput({ container, fileInput, prepare, getContext, getTarget, isAudioOn, onChange = () => {}, onError = () => {} }) {
  let recordArm = false;
  const input = createRecordedInputCore({
    element: container, fileInput, doc: container.ownerDocument, prepare, getContext, targets: () => [getTarget()], onChange, onError,
    isArmed: () => isAudioOn() || recordArm,
  });
  return {
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return input.source; },
    get recorded() { return isRecordedMode(input.source); },
    setMode: next => input.setSource(next),
    setRecordArm(value) { recordArm = Boolean(value); input.refresh(); },
    start: () => input.start(),
    stop: () => input.stop(),
    refresh: () => input.refresh(),
    snapshot: () => input.snapshot(),
    destroy: () => input.destroy(),
  };
}
