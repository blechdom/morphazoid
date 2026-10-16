import { createRecordedInputCore, recordedModeOf, stripSourceOf } from "../../families/recorded-input/recorded-input-core.js";

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
  let micChannelNode = audio.inputChannelNode, lastKey = "", input = null;

  const kind = () => (audio.sourceMode === "input" ? recordedModeOf(kindSelect.value) ?? "mic" : "mic");
  const recordedLive = () => kind() !== "mic" && Boolean(input?.isPlaying());
  const stripRoot = () => doc.querySelector(".mz-audio-input-strip");
  const paintStrip = () => stripRoot()?.setSource?.(stripSourceOf(kind()));
  const sync = () => {
    controls.hidden = audio.sourceMode !== "input";
    if (input && input.source !== kind()) input.setSource(kind());
    paintStrip();
  };

  Object.defineProperty(audio, "inputActive", { configurable: true, get: () => baseActive.call(audio) || recordedLive() });
  Object.defineProperty(audio, "inputPending", { configurable: true, get: () => basePending.call(audio) || (kind() !== "mic" && Boolean(input?.isPending())) });
  Object.defineProperty(audio, "inputChannelNode", {
    configurable: true,
    get: () => (recordedLive() ? input.signal() : micChannelNode),
    set: value => { micChannelNode = value; },
  });
  audio.stopInput = () => { input.stop(); baseStop(); };
  audio.startInput = preferences => {
    if (kind() === "mic") return baseStart(preferences);
    if (!isAudioOn()) return Promise.reject(new Error("Turn Audio on before playing an input."));
    if (kind() === "file" && !input.snapshot().hasFile) return Promise.reject(new Error("Choose an audio file first."));
    return input.start().then(() => true);
  };

  input = createRecordedInputCore({
    doc, element: $("recordedInputPanel"), fileInput: $("recordedInputFile"), chooseButton: true, stereoBridge: true,
    stopLabel: state => (state.pending ? "Cancel loading" : "Stop input"),
    prepare: async () => {
      await audio.initialize();
      audio.clearSuspendTimer();
    },
    getContext: () => audio.context, targets: () => [audio.node], isArmed: isAudioOn,
    onActiveChange: playing => audio.node?.port.postMessage(playing ? { type: "input-reset", connecting: true } : { type: "input-reset" }),
    onChange: state => {
      const key = `${state.playing}|${state.pending}|${state.mode}`;
      if (key !== lastKey) { lastKey = key; audio.notifyInputState(); }
    },
    onError: error => { stripRoot()?.setError?.(error?.message || "Input could not load."); },
    onDestroy: () => audioObserver.disconnect(),
  });
  kindSelect.addEventListener("change", () => {
    audio.stopInput();
    sync();
    audio.notifyInputState();
  });
  $("sourceMode").addEventListener("change", sync);
  const audioObserver = new MutationObserver(() => input.refresh());
  audioObserver.observe($("audioButton"), { attributes: true, characterData: true, childList: true, subtree: true });
  const observed = audio.onInputStateChange;
  audio.onInputStateChange = state => { observed?.(state); sync(); };
  sync();
  return input;
}
