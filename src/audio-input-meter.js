/** A silent, independent input tap. Stereo channels never cancel each other. */
export function createAudioInputMeter(node, { channels = 1 } = {}) {
  const context = node?.context;
  if (!context?.createChannelSplitter || !context?.createAnalyser) return null;
  const count = Number(channels) === 2 ? 2 : 1;
  const splitter = context.createChannelSplitter(2);
  const analysers = Array.from({ length: count }, () => context.createAnalyser());
  const samples = analysers.map(analyser => {
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0;
    return new Float32Array(analyser.fftSize);
  });
  const sink = context.createGain();
  sink.gain.value = 0;
  node.connect(splitter);
  analysers.forEach((analyser, index) => {
    splitter.connect(analyser, index);
    analyser.connect(sink);
  });
  sink.connect(context.destination);
  let disposed = false;
  return {
    node, channels: count,
    read(multiplier = 1) {
      if (disposed || context.state === "closed") return { left: 0, right: 0 };
      const gain = Number.isFinite(Number(multiplier)) ? Math.max(0, Number(multiplier)) : 1;
      const levels = analysers.map((analyser, index) => {
        analyser.getFloatTimeDomainData(samples[index]);
        let peak = 0;
        for (const sample of samples[index]) peak = Math.max(peak, Math.abs(sample));
        return Math.min(1, peak * gain);
      });
      return { left: levels[0], right: levels[1] ?? levels[0] };
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      try { node.disconnect(splitter); } catch { /* owner's node may already be gone */ }
      for (const owned of [splitter, ...analysers, sink]) {
        try { owned.disconnect(); } catch { /* idempotent */ }
      }
    },
  };
}
