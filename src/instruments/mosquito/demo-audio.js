/** An invented wing-tone preview, not a recording or a measured insect model. */
export function createMosquitoDemoAudio(context, destination) {
  const bus = context.createGain();
  bus.gain.value = 0;
  const pan = context.createStereoPanner();
  bus.connect(pan).connect(destination);

  const carrier = context.createOscillator();
  carrier.type = 'sawtooth';
  const second = context.createOscillator();
  second.type = 'triangle';
  const tone = context.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2800;
  const carrierGain = context.createGain();
  carrierGain.gain.value = 0.07;
  const secondGain = context.createGain();
  secondGain.gain.value = 0.025;
  carrier.connect(carrierGain).connect(tone);
  second.connect(secondGain).connect(tone);
  tone.connect(bus);

  const noiseLength = Math.max(64, Math.round(context.sampleRate * 0.35));
  const noise = context.createBuffer(1, noiseLength, context.sampleRate);
  const samples = noise.getChannelData(0);
  let seed = 0x835137;
  for (let i = 0; i < samples.length; i += 1) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    samples[i] = (seed / 0xffffffff) * 2 - 1;
  }
  const air = context.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  const airFilter = context.createBiquadFilter();
  airFilter.type = 'bandpass';
  airFilter.frequency.value = 2400;
  airFilter.Q.value = 0.65;
  const airGain = context.createGain();
  airGain.gain.value = 0.008;
  air.connect(airFilter).connect(airGain).connect(bus);
  carrier.start();
  second.start();
  air.start();
  let disposed = false;

  function update(pose, stroke, active) {
    if (disposed) return;
    const now = context.currentTime;
    const frequency = Math.max(110, Math.min(1120, Number(pose?.pitchHz) || 390));
    carrier.frequency.setTargetAtTime(frequency, now, 0.025);
    second.frequency.setTargetAtTime(frequency * (1.001 + Math.max(0, Math.min(1, stroke)) * 0.006), now, 0.025);
    tone.frequency.setTargetAtTime(1050 + pose.brightness * 5100, now, 0.035);
    airFilter.frequency.setTargetAtTime(850 + pose.brightness * 3400, now, 0.045);
    airFilter.Q.setTargetAtTime(0.65 + pose.legTension * 2.1, now, 0.035);
    airGain.gain.setTargetAtTime(0.005 + Math.max(0, Math.min(1, stroke)) * 0.016
      + pose.legTension * 0.014, now, 0.04);
    pan.pan.setTargetAtTime(pose.pan, now, 0.025);
    bus.gain.setTargetAtTime(active ? 0.64 : 0, now, active ? 0.02 : 0.035);
  }

  function silence() {
    if (!disposed) bus.gain.setTargetAtTime(0, context.currentTime, 0.018);
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const source of [carrier, second, air]) { try { source.stop(); } catch { /* Already stopped. */ } source.disconnect(); }
    for (const node of [carrierGain, secondGain, tone, airFilter, airGain, bus, pan]) node.disconnect();
  }
  return { update, silence, dispose };
}
