import { RECORDED_INPUT_SOURCES, createRecordedInputCore } from "../recorded-input/recorded-input-core.js";

/** File and Samples play through the bounded input source into the same trim
 * node the microphone uses, so gain, meters, recording and the lab engine see
 * one input path. Nothing here ever requests the microphone or arms Audio. */
export function createWaveLabInputSources({ container, before = null, prepare, getContext, getTarget,
  isArmed, onChange = () => {}, onError = () => {} }) {
  const input = createRecordedInputCore({
    host: { container, before }, doc: container.ownerDocument, fileInputId: "waveLabFilePicker",
    prepare, getContext, targets: () => [getTarget()], isArmed, onChange, onError,
  });
  return {
    fileInput: input.fileInput,
    panel: input.element,
    sources: RECORDED_INPUT_SOURCES,
    get mode() { return input.source; },
    snapshot: () => input.snapshot(),
    selectMode: next => input.setSource(next),
    start: () => input.start(),
    stop: () => input.stop(),
    refresh: () => input.refresh(),
    destroy: () => input.destroy(),
  };
}
