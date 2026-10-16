import { mountRecordedInput, RECORDED_INPUT_SOURCES } from "../micmic/native/recorded-input-player.js";

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
  let mode = "mic";
  let recordArm = false;
  const player = mountRecordedInput({
    container, fileInput, prepare, getContext, getTarget, onError, onChange,
    getMode: () => mode,
    isArmed: () => isAudioOn() || recordArm,
  });
  return {
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return mode; },
    get recorded() { return isRecordedMode(mode); },
    setMode(next) { mode = next; player.setMode(next); },
    setRecordArm(value) { recordArm = Boolean(value); player.refresh(); },
    start: () => player.start(),
    stop: () => player.stop(),
    refresh: () => player.refresh(),
    snapshot: () => player.snapshot(),
    destroy: () => player.destroy(),
  };
}
