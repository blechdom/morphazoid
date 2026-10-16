import { RECORDED_INPUT_SOURCES, createRecordedInputCore, normalizeInputSource } from '../../families/recorded-input/recorded-input-core.js';

export const INPUT_MODES = Object.freeze(RECORDED_INPUT_SOURCES.map(source => source.value));

export const normalizeInputMode = normalizeInputSource;

/** The worklet treats recorded playback as live input; this decides which message the transition needs. */
export function liveInputMessage({ wasLive, playing, microphoneActive }) {
  const live = Boolean(playing);
  if (live === Boolean(wasLive)) return null;
  if (!live && microphoneActive) return null;
  return { type: 'microphone', value: live };
}

export function createFractalRecordedInput({ audio, container, fileInput, isArmed, startNode, onChange = () => {}, onError = () => {} }) {
  let wasLive = false, refreshing = false;
  const input = createRecordedInputCore({
    element: container, fileInput, doc: container.ownerDocument, isArmed, onError,
    prepare: async () => {
      if (!audio.node) await startNode();
      if (audio.context?.state === 'suspended') await audio.context.resume();
    },
    getContext: () => audio.context, targets: () => [audio.node],
    onChange: state => {
      const message = liveInputMessage({ wasLive, playing: state.playing, microphoneActive: audio.microphoneActive });
      if (message) { wasLive = message.value; audio.send(message); }
      onChange(state);
    },
  });
  return {
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return input.source; },
    get active() { return input.source !== 'mic' && input.snapshot().playing; },
    get pending() { return input.source !== 'mic' && input.snapshot().pending; },
    setMode: next => input.setSource(next),
    start: () => input.start(),
    stop: () => input.stop(),
    refresh() {
      if (refreshing) return;
      refreshing = true;
      try { input.refresh(); } finally { refreshing = false; }
    },
    signal: () => input.bridge,
    destroy: () => input.destroy(),
  };
}
