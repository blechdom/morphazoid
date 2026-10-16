import { configureAudioInputNode } from "../../audio-input-settings.js";

const RECORDED_STREAM = Object.freeze({ getTracks: () => [], getAudioTracks: () => [] });

/** Routes a recorded entry node through the engine's analyser and input trim,
 * the same chain a captured microphone stream takes. */
export function attachRecordedGraphSource(engine, entry) {
  const { context, audioGraph } = engine;
  if (engine.stream || !context || context.state === "closed" || !audioGraph) return false;
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  const trim = context.createGain();
  configureAudioInputNode(trim, engine.runtime);
  trim.gain.value = engine.settings.inputTrim;
  entry.connect(analyser);
  analyser.connect(trim);
  trim.connect(audioGraph.input);
  audioGraph.inputTrim = trim;
  audioGraph.owned.push(trim);
  engine.source = entry;
  engine.analyser = analyser;
  engine.stream = RECORDED_STREAM;
  return true;
}

export function detachRecordedGraphSource(engine, entry) {
  if (engine.source === entry && engine.stream === RECORDED_STREAM) engine.stopMicrophone();
}
