import { mountRecordedInput, RECORDED_INPUT_SOURCES } from "../../instruments/micmic/native/recorded-input-player.js";

/** File and Samples feed the node the microphone feeds; source 3 is that input. */
export function createHollowphonicInput({ audio, snapshot, container, fileInput, selectInput, onChange, onError }) {
  let mode = "mic";
  const player = mountRecordedInput({
    container, fileInput, getMode: () => mode, onError,
    prepare: async () => {
      if (!audio.node && !await audio.arm(snapshot, { output: false })) throw new Error("Audio could not start.");
      await audio.context.resume();
    },
    getContext: () => audio.context, getTarget: () => audio.node, isArmed: () => audio.armed,
    getGain: () => audio.inputGain,
    onChange: (state) => { if (state.playing) selectInput(); onChange(state); },
  });
  audio.onMute = () => player.stop();
  return {
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return mode; },
    setMode(next) { mode = next; player.setMode(next); },
    start: () => player.start(),
    stop: () => player.stop(),
    refresh: () => player.refresh(),
    snapshot: () => player.snapshot(),
    signal: () => player.getSignal(),
    setGain: (value) => player.setGain(value),
    destroy: () => { audio.onMute = null; player.destroy(); },
  };
}
