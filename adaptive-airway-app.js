const SPEED_OF_SOUND = 343;

const PRESETS = Object.freeze({
  bird: Object.freeze([
    {
      id: "corvid",
      label: "Corvid / raven-like",
      description: "Dual-side syrinx with long trachea and strong OEC filtering.",
      values: { pressure: 0.68, tension: 0.44, adduction: 0.63, tracheaLength: 0.26, beakGape: 0.52, oecVolume: 0.58, junctionCoupling: 0.47, liquidLoad: 0.26 },
    },
    {
      id: "songbird",
      label: "Small songbird",
      description: "Higher-tension bilateral source with shorter tract and brighter beak radiation.",
      values: { pressure: 0.56, tension: 0.71, adduction: 0.55, tracheaLength: 0.15, beakGape: 0.68, oecVolume: 0.34, junctionCoupling: 0.39, liquidLoad: 0.18 },
    },
  ]),
  mammal: Object.freeze([
    {
      id: "wolf",
      label: "Wolf / canid",
      description: "Single laryngeal source with moderate tract length and strong oral opening.",
      values: { pressure: 0.62, tension: 0.48, adduction: 0.66, tracheaLength: 0.29, beakGape: 0.57, oecVolume: 0.27, junctionCoupling: 0.41, liquidLoad: 0.29 },
    },
    {
      id: "lion",
      label: "Lion / large felid",
      description: "Low-frequency tissue motion, high pressure, high loading, long airway.",
      values: { pressure: 0.82, tension: 0.24, adduction: 0.76, tracheaLength: 0.44, beakGape: 0.63, oecVolume: 0.4, junctionCoupling: 0.53, liquidLoad: 0.47 },
    },
  ]),
  frog: Object.freeze([
    {
      id: "treefrog",
      label: "Treefrog",
      description: "Pulsed membrane-like source with cavity-dominant filtering and higher radiation band.",
      values: { pressure: 0.59, tension: 0.66, adduction: 0.5, tracheaLength: 0.09, beakGape: 0.46, oecVolume: 0.76, junctionCoupling: 0.58, liquidLoad: 0.33 },
    },
    {
      id: "bullfrog",
      label: "Bullfrog",
      description: "Lower membrane regime with high cavity loading and strong body-like damping.",
      values: { pressure: 0.74, tension: 0.38, adduction: 0.64, tracheaLength: 0.14, beakGape: 0.38, oecVolume: 0.86, junctionCoupling: 0.66, liquidLoad: 0.54 },
    },
  ]),
});

const MODEL_THRESHOLDS = Object.freeze({ bird: 0.35, mammal: 0.42, frog: 0.28 });

const state = {
  family: "bird",
  presetId: "corvid",
  pressure: 0.68,
  tension: 0.44,
  adduction: 0.63,
  tracheaLength: 0.26,
  beakGape: 0.52,
  oecVolume: 0.58,
  junctionCoupling: 0.47,
  liquidLoad: 0.26,
  outputLevel: 0.46,
  running: false,
  audioReady: false,
};

const $ = (id) => document.getElementById(id);

let context = null;
let nodes = null;

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function percent(value) {
  return `${Math.round(clamp(value) * 100)}%`;
}

function formatLength(value) {
  return `${value.toFixed(2)} m`;
}

function formatHz(value) {
  return `${Math.round(Math.max(0, value))} Hz`;
}

function activePreset() {
  return PRESETS[state.family].find((preset) => preset.id === state.presetId) ?? PRESETS[state.family][0];
}

function setOutput(id, value) {
  const element = $(id);
  if (element) element.textContent = value;
}

async function ensureAudio() {
  if (context && nodes) return;
  context = new AudioContext();

  const leftOsc = new OscillatorNode(context, { type: "sawtooth", frequency: 280 });
  const rightOsc = new OscillatorNode(context, { type: "triangle", frequency: 282 });
  const mainOsc = new OscillatorNode(context, { type: "sawtooth", frequency: 140 });
  const flutterOsc = new OscillatorNode(context, { type: "sine", frequency: 8 });

  const noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) data[index] = Math.random() * 2 - 1;
  const noise = new AudioBufferSourceNode(context, { buffer: noiseBuffer, loop: true });

  const leftGain = new GainNode(context, { gain: 0 });
  const rightGain = new GainNode(context, { gain: 0 });
  const mainGain = new GainNode(context, { gain: 0 });
  const noiseGain = new GainNode(context, { gain: 0 });
  const flutterGain = new GainNode(context, { gain: 0 });

  const sourceMix = new GainNode(context, { gain: 1 });
  const driveGain = new GainNode(context, { gain: 1.2 });
  const shaper = new WaveShaperNode(context, { curve: buildDriveCurve(1024), oversample: "4x" });
  const tracheaBand = new BiquadFilterNode(context, { type: "bandpass", frequency: 420, Q: 3.2 });
  const tracheaPeak = new BiquadFilterNode(context, { type: "peaking", frequency: 1320, Q: 1.2, gain: 1 });
  const oecBand = new BiquadFilterNode(context, { type: "peaking", frequency: 850, Q: 0.8, gain: 0 });
  const junctionNotch = new BiquadFilterNode(context, { type: "notch", frequency: 1600, Q: 0.8 });
  const beakShelf = new BiquadFilterNode(context, { type: "highshelf", frequency: 2400, gain: 2 });
  const liquidLowpass = new BiquadFilterNode(context, { type: "lowpass", frequency: 6200, Q: 0.7 });
  const preMaster = new GainNode(context, { gain: 0.45 });
  const activityGain = new GainNode(context, { gain: 0 });
  const master = new GainNode(context, { gain: 0 });

  leftOsc.connect(leftGain).connect(sourceMix);
  rightOsc.connect(rightGain).connect(sourceMix);
  mainOsc.connect(mainGain).connect(sourceMix);
  noise.connect(noiseGain).connect(sourceMix);

  flutterOsc.connect(flutterGain).connect(mainOsc.frequency);
  flutterOsc.connect(flutterGain).connect(leftOsc.frequency);
  flutterOsc.connect(flutterGain).connect(rightOsc.frequency);

  sourceMix
    .connect(driveGain)
    .connect(shaper)
    .connect(tracheaBand)
    .connect(tracheaPeak)
    .connect(oecBand)
    .connect(junctionNotch)
    .connect(beakShelf)
    .connect(liquidLowpass)
    .connect(preMaster)
    .connect(activityGain)
    .connect(master)
    .connect(context.destination);

  leftOsc.start();
  rightOsc.start();
  mainOsc.start();
  noise.start();
  flutterOsc.start();

  nodes = {
    leftOsc,
    rightOsc,
    mainOsc,
    flutterOsc,
    leftGain,
    rightGain,
    mainGain,
    noiseGain,
    flutterGain,
    driveGain,
    tracheaBand,
    tracheaPeak,
    oecBand,
    junctionNotch,
    beakShelf,
    liquidLowpass,
    preMaster,
    activityGain,
    master,
  };

  state.audioReady = true;
  setOutput("audioState", "on");
  $("audioButton")?.setAttribute("aria-pressed", "true");
  applyState();
}

function buildDriveCurve(size) {
  const curve = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const x = (index / (size - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * 2.8);
  }
  return curve;
}

function estimatedSourceHz() {
  const threshold = MODEL_THRESHOLDS[state.family];
  const drive = Math.max(0, state.pressure - threshold);
  const nonlinearLift = drive > 0 ? 1 + drive * (0.45 + state.tension * 0.5) : 0.28;
  if (state.family === "bird") {
    return (220 + state.tension * 520 + state.adduction * 90) * nonlinearLift;
  }
  if (state.family === "mammal") {
    return (52 + state.tension * 240 + state.adduction * 44) * nonlinearLift;
  }
  return (96 + state.tension * 310 + state.adduction * 52) * nonlinearLift;
}

function resonanceTriplet() {
  const length = Math.max(0.02, state.tracheaLength);
  const base = SPEED_OF_SOUND / (4 * length);
  const beakShift = 0.78 + state.beakGape * 0.62;
  const oecShift = 0.58 + (1 - state.oecVolume) * 1.02;
  return [base * beakShift, base * 2.6 * oecShift, base * 4.1 * (0.74 + state.junctionCoupling * 0.65)];
}

function applyAudioModel() {
  if (!nodes || !context) return;
  const now = context.currentTime;
  const baseHz = estimatedSourceHz();
  const [f1, f2, f3] = resonanceTriplet();

  const threshold = MODEL_THRESHOLDS[state.family];
  const aboveThreshold = Math.max(0, state.pressure - threshold);
  const activity = state.running ? clamp(0.07 + aboveThreshold * 2.2, 0, 1) : 0;
  const roughness = clamp(aboveThreshold * (0.7 + state.junctionCoupling * 0.55));

  nodes.mainOsc.frequency.setTargetAtTime(baseHz, now, 0.02);
  nodes.leftOsc.frequency.setTargetAtTime(baseHz * (0.985 - state.adduction * 0.018), now, 0.02);
  nodes.rightOsc.frequency.setTargetAtTime(baseHz * (1.015 + state.adduction * 0.018), now, 0.02);
  nodes.flutterOsc.frequency.setTargetAtTime(2 + state.pressure * 16, now, 0.08);
  nodes.flutterGain.gain.setTargetAtTime(1 + state.tension * 9 + state.liquidLoad * 6, now, 0.07);

  if (state.family === "bird") {
    nodes.leftGain.gain.setTargetAtTime(0.42 + aboveThreshold * 0.58, now, 0.03);
    nodes.rightGain.gain.setTargetAtTime(0.42 + aboveThreshold * 0.58, now, 0.03);
    nodes.mainGain.gain.setTargetAtTime(0.07, now, 0.03);
    nodes.noiseGain.gain.setTargetAtTime(0.02 + (1 - state.adduction) * 0.08 + roughness * 0.04, now, 0.04);
  } else if (state.family === "mammal") {
    nodes.leftGain.gain.setTargetAtTime(0.04, now, 0.03);
    nodes.rightGain.gain.setTargetAtTime(0.04, now, 0.03);
    nodes.mainGain.gain.setTargetAtTime(0.5 + aboveThreshold * 0.45, now, 0.03);
    nodes.noiseGain.gain.setTargetAtTime(0.05 + (1 - state.adduction) * 0.16 + roughness * 0.06, now, 0.04);
  } else {
    const pulse = 0.34 + state.pressure * 0.52;
    nodes.leftGain.gain.setTargetAtTime(0.03, now, 0.03);
    nodes.rightGain.gain.setTargetAtTime(0.03, now, 0.03);
    nodes.mainGain.gain.setTargetAtTime(pulse, now, 0.03);
    nodes.noiseGain.gain.setTargetAtTime(0.06 + state.oecVolume * 0.09 + roughness * 0.05, now, 0.04);
  }

  nodes.driveGain.gain.setTargetAtTime(1.05 + roughness * 2.6 + state.pressure * 0.55, now, 0.03);
  nodes.tracheaBand.frequency.setTargetAtTime(f1, now, 0.03);
  nodes.tracheaBand.Q.setTargetAtTime(1.9 + state.tracheaLength * 6.2 + state.junctionCoupling * 1.6, now, 0.04);

  nodes.tracheaPeak.frequency.setTargetAtTime(f2, now, 0.04);
  nodes.tracheaPeak.Q.setTargetAtTime(0.85 + state.oecVolume * 1.2, now, 0.04);
  nodes.tracheaPeak.gain.setTargetAtTime(-2 + state.beakGape * 8 + state.junctionCoupling * 4, now, 0.04);

  nodes.oecBand.frequency.setTargetAtTime(Math.max(120, 180 + (1 - state.oecVolume) * 1450), now, 0.05);
  nodes.oecBand.Q.setTargetAtTime(0.45 + state.oecVolume * 3.5, now, 0.05);
  nodes.oecBand.gain.setTargetAtTime(-5 + state.oecVolume * 12, now, 0.05);

  nodes.junctionNotch.frequency.setTargetAtTime(Math.max(140, f3), now, 0.05);
  nodes.junctionNotch.Q.setTargetAtTime(0.4 + state.junctionCoupling * 8.2, now, 0.05);

  nodes.beakShelf.frequency.setTargetAtTime(1700 + state.beakGape * 4200, now, 0.05);
  nodes.beakShelf.gain.setTargetAtTime(-8 + state.beakGape * 17, now, 0.05);

  nodes.liquidLowpass.frequency.setTargetAtTime(900 + (1 - state.liquidLoad) * 8600, now, 0.05);
  nodes.preMaster.gain.setTargetAtTime(0.28 + state.pressure * 0.5 + roughness * 0.24, now, 0.05);
  nodes.activityGain.gain.setTargetAtTime(activity, now, 0.025);
  nodes.master.gain.setTargetAtTime(state.outputLevel * Number(state.audioReady), now, 0.04);

  const nonlinearState = aboveThreshold > 0.18
    ? "nonlinear regime"
    : aboveThreshold > 0.03 ? "near threshold" : "sub-threshold";

  setOutput("modelStatus", `${state.family} · ${nonlinearState}${state.running ? " · flowing" : " · stopped"}`);
  setOutput("sourceEstimate", formatHz(baseHz));
  setOutput("resonanceEstimate", `F1 ${formatHz(f1)} · F2 ${formatHz(f2)} · F3 ${formatHz(f3)}`);
}

function applyState() {
  setOutput("pressureOut", percent(state.pressure));
  setOutput("tensionOut", percent(state.tension));
  setOutput("adductionOut", percent(state.adduction));
  setOutput("tracheaLengthOut", formatLength(state.tracheaLength));
  setOutput("beakGapeOut", percent(state.beakGape));
  setOutput("oecVolumeOut", percent(state.oecVolume));
  setOutput("junctionCouplingOut", percent(state.junctionCoupling));
  setOutput("liquidLoadOut", percent(state.liquidLoad));
  setOutput("outputLevelOut", percent(state.outputLevel));
  applyAudioModel();
}

function setRunning(running) {
  state.running = Boolean(running);
  $("playButton")?.setAttribute("aria-pressed", String(state.running));
  setOutput("playLabel", state.running ? "Stop flow" : "Start flow");
  setOutput("playState", state.running ? "active" : "stopped");
  applyAudioModel();
}

function setFamily(family) {
  state.family = PRESETS[family] ? family : "bird";
  const presetSelect = $("animalPreset");
  if (!presetSelect) return;

  const presets = PRESETS[state.family];
  presetSelect.replaceChildren(...presets.map((preset) => {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.label;
    return option;
  }));

  const selected = presets.find((preset) => preset.id === state.presetId) ?? presets[0];
  state.presetId = selected.id;
  presetSelect.value = selected.id;
  applyPreset(selected.id);
}

function applyPreset(presetId) {
  const preset = PRESETS[state.family].find((entry) => entry.id === presetId) ?? PRESETS[state.family][0];
  state.presetId = preset.id;
  for (const [key, value] of Object.entries(preset.values)) {
    state[key] = value;
    const control = $(key);
    if (control) control.value = String(value);
  }
  setOutput("presetDescription", preset.description);
  applyState();
}

async function triggerBurst() {
  await ensureAudio();
  if (!context) return;
  const now = context.currentTime;
  const pressureControl = $("pressure");
  const start = state.pressure;
  const threshold = MODEL_THRESHOLDS[state.family];
  state.pressure = clamp(Math.max(start, threshold + 0.26));
  if (pressureControl) pressureControl.value = String(state.pressure);
  setRunning(true);
  applyState();
  window.setTimeout(() => {
    state.pressure = start;
    if (pressureControl) pressureControl.value = String(start);
    applyState();
  }, 420);
  nodes?.activityGain.gain.cancelScheduledValues(now);
}

function bindSlider(id, assign) {
  const element = $(id);
  if (!element) return;
  element.addEventListener("input", () => {
    assign(Number(element.value));
    applyState();
  });
}

function init() {
  bindSlider("pressure", (value) => { state.pressure = clamp(value); });
  bindSlider("tension", (value) => { state.tension = clamp(value); });
  bindSlider("adduction", (value) => { state.adduction = clamp(value); });
  bindSlider("tracheaLength", (value) => { state.tracheaLength = clamp(value, 0.05, 0.8); });
  bindSlider("beakGape", (value) => { state.beakGape = clamp(value); });
  bindSlider("oecVolume", (value) => { state.oecVolume = clamp(value); });
  bindSlider("junctionCoupling", (value) => { state.junctionCoupling = clamp(value); });
  bindSlider("liquidLoad", (value) => { state.liquidLoad = clamp(value); });
  bindSlider("outputLevel", (value) => { state.outputLevel = clamp(value); });

  $("audioButton")?.addEventListener("click", async () => {
    if (!state.audioReady) {
      await ensureAudio();
      if (context?.state === "suspended") await context.resume();
      applyState();
      return;
    }
    if (context?.state === "running") {
      await context.suspend();
      state.audioReady = false;
      setRunning(false);
      setOutput("audioState", "off");
      $("audioButton")?.setAttribute("aria-pressed", "false");
      applyState();
      return;
    }
    await context?.resume();
    state.audioReady = true;
    setOutput("audioState", "on");
    $("audioButton")?.setAttribute("aria-pressed", "true");
    applyState();
  });

  $("playButton")?.addEventListener("click", async () => {
    await ensureAudio();
    if (context?.state === "suspended") await context.resume();
    state.audioReady = true;
    setOutput("audioState", "on");
    $("audioButton")?.setAttribute("aria-pressed", "true");
    setRunning(!state.running);
  });

  $("burstButton")?.addEventListener("click", triggerBurst);

  $("modelFamily")?.addEventListener("change", (event) => {
    const next = event.target instanceof HTMLSelectElement ? event.target.value : "bird";
    setFamily(next);
  });

  $("animalPreset")?.addEventListener("change", (event) => {
    const next = event.target instanceof HTMLSelectElement ? event.target.value : "";
    applyPreset(next);
  });

  const familySelect = $("modelFamily");
  if (familySelect) familySelect.value = state.family;
  setFamily(state.family);
  applyState();
}

init();
