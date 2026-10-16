import { mountRecordedInput, RECORDED_INPUT_SOURCES } from '../micmic/native/recorded-input-player.js';

export const INPUT_MODES = Object.freeze(RECORDED_INPUT_SOURCES.map(source => source.value));

export const normalizeInputMode = value => (INPUT_MODES.includes(value) ? value : 'mic');

/** The worklet treats recorded playback as live input; this decides which message the transition needs. */
export function liveInputMessage({ wasLive, playing, microphoneActive }) {
  const live = Boolean(playing);
  if (live === Boolean(wasLive)) return null;
  if (!live && microphoneActive) return null;
  return { type: 'microphone', value: live };
}

export function createFractalRecordedInput({ audio, container, fileInput, isArmed, startNode, onChange = () => {}, onError = () => {} }) {
  let mode = 'mic', wasLive = false, refreshing = false;
  const sync = state => {
    const message = liveInputMessage({ wasLive, playing: state.playing, microphoneActive: audio.microphoneActive });
    if (message) { wasLive = message.value; audio.send(message); }
    onChange(state);
  };
  const player = mountRecordedInput({
    container, fileInput, isArmed, onError, onChange: sync,
    getMode: () => mode,
    prepare: async () => {
      if (!audio.node) await startNode();
      if (audio.context?.state === 'suspended') await audio.context.resume();
    },
    getContext: () => audio.context,
    getTarget: () => audio.node,
    getGain: () => 1,
  });
  return {
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return mode; },
    get active() { return mode !== 'mic' && player.snapshot().playing; },
    get pending() { return mode !== 'mic' && player.snapshot().pending; },
    setMode(next) { mode = normalizeInputMode(next); player.setMode(mode); },
    start: () => player.start(),
    stop: () => player.stop(),
    refresh() {
      if (refreshing) return;
      refreshing = true;
      try { player.refresh(); } finally { refreshing = false; }
    },
    signal: () => player.getSignal(),
    destroy: () => player.destroy(),
  };
}
