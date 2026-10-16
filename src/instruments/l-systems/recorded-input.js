/** Feeds a recorded entry node through the same input gain, reader, generation
 * processor and dry path that the microphone stream uses. */
export function attachRecordedEngineSource(engine, entry) {
  const { processor, generationProcessor, dryGain, inputGain } = engine;
  if (engine.enabled || engine.stream || !engine.context || !processor || !generationProcessor || !dryGain || !inputGain) return false;
  engine.source = entry;
  entry.connect(inputGain);
  inputGain.connect(processor);
  inputGain.connect(generationProcessor);
  inputGain.connect(dryGain);
  engine.enabled = true;
  engine.startRenderCapacityMonitoring();
  engine.setLevel(engine.level);
  engine.setFeedback(engine.feedback);
  engine.setVoices(engine.pendingVoices, { requestedVoiceCount: engine.voiceDemand });
  return true;
}

export function detachRecordedEngineSource(engine, entry) {
  if (engine.source === entry && !engine.stream) engine.disable();
}

/** Runs `onDisable` whenever the engine is disabled, including by mode changes. */
export function onEngineDisable(engine, onDisable) {
  const disable = engine.disable.bind(engine);
  let running = false;
  engine.disable = () => {
    if (!running) { running = true; try { onDisable(); } finally { running = false; } }
    return disable();
  };
}
