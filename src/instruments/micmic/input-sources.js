import { createRecordedInputCore, recordedModeOf, stripSourceOf } from "../../families/recorded-input/recorded-input-core.js";

/** Samples and files enter graph.input, the node the microphone source feeds.
 * Selecting a source never requests the microphone; only startMicrophone does. */
export function createMicmicRecordedInput({ doc = document, ensureGraph, getContext, getInputNode, isArmed,
  onPlaybackChange, onSourceChange, onError }) {
  const $ = id => doc.getElementById(id);
  const kindSelect = $("inputSourceKind");
  if (!kindSelect || !("innerHTML" in ($("recordedInputPanel") ?? {})) || !$("recordedInputPanel").ownerDocument) return null;
  const paintStrip = () => doc.querySelector(".mz-audio-input-strip")?.setSource?.(stripSourceOf(input.source));
  const input = createRecordedInputCore({
    doc, element: $("recordedInputPanel"), fileInput: $("recordedInputFile"), chooseButton: true, stereoBridge: true,
    stopLabel: state => (state.pending ? "Cancel loading" : "Stop input"),
    prepare: ensureGraph, getContext, targets: () => [getInputNode()], isArmed,
    onActiveChange: playing => onPlaybackChange(playing),
    onError,
  });
  kindSelect.addEventListener("change", () => {
    const mode = recordedModeOf(kindSelect.value) ?? "mic";
    onSourceChange(mode);
    input.setSource(mode);
    paintStrip();
  });
  paintStrip();
  return {
    getMode: () => input.source, isRecorded: () => input.source !== "mic", stop: () => input.stop(),
    refresh: () => input.refresh(), destroy: () => input.destroy(),
    async start() {
      if (!isArmed()) throw new Error("Turn Audio on before playing an input.");
      await input.start();
    },
  };
}
