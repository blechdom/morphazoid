/** Browser capture preferences shared by I/O setup and live delay effects.
 * Device grants/streams and effect gain are deliberately not stored here.
 */
export const AUDIO_INPUT_STORAGE_KEY = "morphazoid.audio-input.v1";
export function normalizeAudioInputSettings(value = {}) {
  return {
    inputId: typeof value?.inputId === "string" ? value.inputId.slice(0, 512) : "",
    inputChannels: Number(value?.inputChannels) === 2 ? 2 : 1,
    echoCancellation: value?.echoCancellation === true,
  };
}
export function loadAudioInputSettings(runtime = globalThis) {
  try {
    if (runtime?.MorphazoidWAX) return normalizeAudioInputSettings();
    return normalizeAudioInputSettings(JSON.parse(runtime.localStorage.getItem(AUDIO_INPUT_STORAGE_KEY)));
  } catch { return normalizeAudioInputSettings(); }
}
export function saveAudioInputSettings(value, runtime = globalThis) {
  try {
    if (runtime?.MorphazoidWAX) return false;
    runtime.localStorage.setItem(AUDIO_INPUT_STORAGE_KEY, JSON.stringify(normalizeAudioInputSettings(value)));
    return true;
  } catch { return false; }
}
export function audioInputConstraints(runtime = globalThis, preferences = loadAudioInputSettings(runtime)) {
  const settings = normalizeAudioInputSettings(preferences);
  return {
    video: false,
    audio: {
      ...(settings.inputId ? { deviceId: { exact: settings.inputId } } : {}),
      channelCount: { ideal: settings.inputChannels },
      echoCancellation: { ideal: settings.echoCancellation },
      noiseSuppression: { ideal: false },
      autoGainControl: { ideal: false },
    },
  };
}
export function configureAudioInputNode(node, runtime = globalThis, preferences = loadAudioInputSettings(runtime)) {
  node.channelCount = normalizeAudioInputSettings(preferences).inputChannels;
  node.channelCountMode = "explicit";
  node.channelInterpretation = "speakers";
  return node;
}
export function audioInputDescription(stream) {
  const track = stream?.getAudioTracks?.()[0];
  if (!track) return "Mic / line input";
  const count = track.getSettings?.().channelCount;
  return `${track.label || "Audio input"} · ${count === 2 ? "stereo" : count === 1 ? "mono" : "channel count not reported"}`;
}
