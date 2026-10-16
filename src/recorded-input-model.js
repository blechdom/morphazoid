export const RECORDED_INPUT_SOURCES = Object.freeze([
  Object.freeze({ value: 'mic', label: 'Mic' }),
  Object.freeze({ value: 'file', label: 'File' }),
  Object.freeze({ value: 'samples', label: 'Samples' }),
]);

export function normalizeInputSource(value) {
  return RECORDED_INPUT_SOURCES.some(source => source.value === value) ? value : 'mic';
}

/** Empty string means playback may start; otherwise the user-facing reason. */
export function recordedStartBlocker({ source, armed, hasFile }) {
  if (source === 'mic') return 'Mic input starts from the microphone button.';
  if (!armed) return source === 'file' ? 'Switch Audio on before playing a file.' : 'Switch Audio on before playing a sample.';
  if (source === 'file' && !hasFile) return 'Choose an audio file first.';
  return '';
}

/** Playback must end when its host stops being armed, available or open. */
export function shouldStopRecorded({ active, armed, available, contextClosed }) {
  return Boolean(active) && (!armed || !available || Boolean(contextClosed));
}

/** Reports only true/false transitions of the recorded-input active flag. */
export function createActiveEdge(onEdge) {
  let previous = false;
  return next => {
    const value = Boolean(next);
    if (value === previous) return false;
    previous = value;
    onEdge(value);
    return true;
  };
}
