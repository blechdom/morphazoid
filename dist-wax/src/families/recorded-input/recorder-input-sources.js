import { mountAudioInputControl } from "../../audio-input-control.js";
import { DEFAULT_SAMPLE_ID } from "../../instruments/micmic/native/input-source.js";
import { createRecordedInputCore } from "./recorded-input-core.js";
import { withRecordedInput } from "./recorded-input-sources.js";

/** Adds a Mic / File / Samples source to a loop recorder. File and samples play
 * into the same nodes the microphone feeds; only the mic toggle asks for the mic.
 * A chosen file is decoded when Play or Record needs it. */
export function mountRecorderInput(inputOptions, {
  getContext, prepare, targets, canPlay = () => true,
  onSourceLeave = () => {}, onSourceChange = () => {}, onError = () => {}, onChange = () => {},
}) {
  const { container, before } = inputOptions;
  let control = null;
  const input = createRecordedInputCore({
    doc: container.ownerDocument, getContext, prepare, targets, isArmed: canPlay, fileLoad: "on-play", initialSample: DEFAULT_SAMPLE_ID,
    gain: () => Number(control.gainInput.value),
    onChange: snapshot => { control?.refresh(); onChange(snapshot); }, onError, onSourceChange: next => onSourceChange(next),
  });
  control = mountAudioInputControl(withRecordedInput({
    ...inputOptions, onGainInput: value => { inputOptions.onGainInput?.(value); input.setGain(value); },
  }, input, { onLeave: onSourceLeave }));
  control.root.querySelector(".mz-input-file")?.setAttribute("aria-label", "Choose audio file");
  container.insertBefore(input.element, before ?? null);
  const destroy = input.destroy;
  return {
    control, player: input.player, refresh: () => input.refresh(),
    get source() { return input.source; },
    get bridge() { return input.bridge; },
    stop: input.stop,
    acquireInput: async startMic => (input.source === "mic" ? startMic() : input.acquire()),
    releaseInput(stopMic) { if (input.source === "mic") stopMic?.(); else input.release(); },
    destroy() { control.destroy(); destroy(); },
  };
}
