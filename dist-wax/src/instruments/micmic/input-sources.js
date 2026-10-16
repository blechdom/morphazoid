import { mountRecordedInputPanel, recordedModeOf, stripSourceOf } from "../../families/recorded-input/recorded-input-panel.js";

/** Samples and files enter graph.input, the node the microphone source feeds.
 * Selecting a source never requests the microphone; only startMicrophone does. */
export function createMicmicRecordedInput({ doc = document, ensureGraph, getContext, getInputNode, isArmed,
  onPlaybackChange, onSourceChange, onError }) {
  const $ = id => doc.getElementById(id);
  const kindSelect = $("inputSourceKind");
  if (!kindSelect || !("innerHTML" in ($("recordedInputPanel") ?? {})) || !$("recordedInputPanel").ownerDocument) return null;
  let lastKey = "", wasPlaying = false, panel = null;
  const paintStrip = () => doc.querySelector(".mz-audio-input-strip")?.setSource?.(stripSourceOf(panel.getMode()));
  panel = mountRecordedInputPanel({
    container: $("recordedInputPanel"), fileInput: $("recordedInputFile"), label: "Recorded input",
    prepare: ensureGraph, getContext, getTarget: getInputNode, isArmed,
    onChange: state => {
      const key = `${state.playing}|${state.mode}`;
      if (key === lastKey) return;
      lastKey = key;
      if (state.playing !== wasPlaying) { wasPlaying = state.playing; onPlaybackChange(state.playing); }
    },
    onError,
  });
  kindSelect.addEventListener("change", () => {
    const mode = recordedModeOf(kindSelect.value) ?? "mic";
    onSourceChange(mode);
    panel.setMode(mode);
    paintStrip();
  });
  globalThis.addEventListener("pagehide", () => panel.destroy(), { once: true });
  paintStrip();
  return {
    panel, getMode: () => panel.getMode(), isRecorded: () => panel.getMode() !== "mic", stop: () => panel.stop(),
    refresh: () => panel.refresh(),
    async start() {
      if (!isArmed()) throw new Error("Turn Audio on before playing an input.");
      if (panel.getMode() === "file" && !panel.snapshot().hasFile) throw new Error("Choose an audio file first.");
      await panel.player.start();
    },
  };
}
