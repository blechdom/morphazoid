import { mountRecordedInputPanel, recordedModeOf, stripSourceOf } from "../../families/recorded-input/recorded-input-panel.js";

/** Samples and files enter the worklet input exactly where the microphone does.
 * The engine's input lifecycle (active, pending, meter node, stop) is extended
 * on this instance so the shared strip, Audio-off and page-hide paths also
 * release recorded playback. Microphone permission is requested only by startInput. */
export function installRecordedInput({ audio, isAudioOn, doc = document }) {
  const $ = id => doc.getElementById(id);
  const controls = $("recordedSourceControls");
  const kindSelect = $("inputSourceKind");
  if (!controls || !kindSelect || !("innerHTML" in ($("recordedInputPanel") ?? {})) || !$("recordedInputPanel").ownerDocument) return null;
  const prototype = Object.getPrototypeOf(audio);
  const baseActive = Object.getOwnPropertyDescriptor(prototype, "inputActive").get;
  const basePending = Object.getOwnPropertyDescriptor(prototype, "inputPending").get;
  const baseStart = audio.startInput.bind(audio);
  const baseStop = audio.stopInput.bind(audio);
  let micChannelNode = audio.inputChannelNode, wasPlaying = false, lastKey = "", panel = null;

  const kind = () => (audio.sourceMode === "input" ? recordedModeOf(kindSelect.value) ?? "mic" : "mic");
  const recordedLive = () => kind() !== "mic" && Boolean(panel?.isPlaying());
  const stripRoot = () => doc.querySelector(".mz-audio-input-strip");
  const paintStrip = () => stripRoot()?.setSource?.(stripSourceOf(kind()));
  const sync = () => {
    controls.hidden = audio.sourceMode !== "input";
    if (panel && panel.getMode() !== kind()) panel.setMode(kind());
    paintStrip();
  };

  Object.defineProperty(audio, "inputActive", { configurable: true, get: () => baseActive.call(audio) || recordedLive() });
  Object.defineProperty(audio, "inputPending", { configurable: true, get: () => basePending.call(audio) || (kind() !== "mic" && Boolean(panel?.isPending())) });
  Object.defineProperty(audio, "inputChannelNode", {
    configurable: true,
    get: () => (recordedLive() ? panel.getSignal() : micChannelNode),
    set: value => { micChannelNode = value; },
  });
  audio.stopInput = () => { panel?.stop(); baseStop(); };
  audio.startInput = preferences => {
    if (kind() === "mic") return baseStart(preferences);
    if (!isAudioOn()) return Promise.reject(new Error("Turn Audio on before playing an input."));
    if (kind() === "file" && !panel.snapshot().hasFile) return Promise.reject(new Error("Choose an audio file first."));
    return panel.player.start().then(() => true);
  };

  panel = mountRecordedInputPanel({
    container: $("recordedInputPanel"), fileInput: $("recordedInputFile"), label: "Recorded input",
    prepare: async () => {
      await audio.initialize();
      audio.clearSuspendTimer();
    },
    getContext: () => audio.context, getTarget: () => audio.node, isArmed: isAudioOn,
    onChange: state => {
      const key = `${state.playing}|${state.pending}|${state.mode}`;
      if (state.playing !== wasPlaying) {
        wasPlaying = state.playing;
        audio.node?.port.postMessage(state.playing ? { type: "input-reset", connecting: true } : { type: "input-reset" });
      }
      if (key !== lastKey) { lastKey = key; audio.notifyInputState(); }
    },
    onError: error => { stripRoot()?.setError?.(error?.message || "Input could not load."); },
  });
  kindSelect.addEventListener("change", () => {
    audio.stopInput();
    sync();
    audio.notifyInputState();
  });
  $("sourceMode").addEventListener("change", sync);
  const audioObserver = new MutationObserver(() => panel.refresh());
  audioObserver.observe($("audioButton"), { attributes: true, characterData: true, childList: true, subtree: true });
  const observed = audio.onInputStateChange;
  audio.onInputStateChange = state => { observed?.(state); sync(); };
  globalThis.addEventListener("pagehide", () => { audioObserver.disconnect(); panel.destroy(); }, { once: true });
  sync();
  return panel;
}
