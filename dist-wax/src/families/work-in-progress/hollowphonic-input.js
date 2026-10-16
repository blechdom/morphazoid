import { RECORDED_INPUT_SOURCES, createRecordedInputCore } from "../recorded-input/recorded-input-core.js";

/** File and Samples feed the node the microphone feeds; source 3 is that input. */
export function createHollowphonicInput({ audio, snapshot, container, fileInput, selectInput, onChange, onError }) {
  const input = createRecordedInputCore({
    element: container, fileInput, doc: container.ownerDocument, onError,
    prepare: async () => {
      if (!audio.node && !await audio.arm(snapshot, { output: false })) throw new Error("Audio could not start.");
      await audio.context.resume();
    },
    getContext: () => audio.context, targets: () => [audio.node], isArmed: () => audio.armed,
    gain: () => audio.inputGain,
    onChange: (state) => { if (state.playing) selectInput(); onChange(state); },
  });
  audio.onMute = () => input.stop();
  return {
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return input.source; },
    setMode: (next) => input.setSource(next),
    start: () => input.start(),
    stop: () => input.stop(),
    refresh: () => input.refresh(),
    snapshot: () => input.snapshot(),
    signal: () => input.bridge,
    setGain: (value) => input.setGain(value),
    destroy: () => { audio.onMute = null; input.destroy(); },
  };
}
