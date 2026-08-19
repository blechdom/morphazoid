const clamp = (value, minimum = 0, maximum = 1) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
};

const freezePoints = (points) => Object.freeze(
  points.map(([time, value]) => Object.freeze([clamp(time), Number(value) || 0])),
);

function freezeGesture({ id, label, durationMs, pressure, ...curves }) {
  return Object.freeze({
    id,
    label,
    durationMs: clamp(durationMs, 80, 8_000),
    curves: Object.freeze({
      pressure: freezePoints(pressure),
      ...Object.fromEntries(
        Object.entries(curves).map(([name, points]) => [name, freezePoints(points)]),
      ),
    }),
  });
}

const held = (id, label, durationMs, options = {}) => freezeGesture({
  id,
  label,
  durationMs,
  pressure: options.pressure ?? [[0, 0], [0.08, 0.88], [0.78, 1], [1, 0]],
  tension: options.tension ?? [[0, 0], [0.5, 0.02], [1, -0.01]],
  adduction: options.adduction ?? [[0, -0.08], [0.12, 0.06], [0.84, 0.03], [1, -0.12]],
  mouthOpening: options.mouthOpening ?? [[0, -0.18], [0.25, 0.08], [1, 0.16]],
  cavityCoupling: options.cavityCoupling ?? [[0, 0], [0.42, 0.06], [1, -0.02]],
  asymmetry: options.asymmetry ?? [[0, 0], [0.55, 0.02], [1, 0]],
  roughness: options.roughness ?? [[0, 0], [0.5, 0.04], [1, -0.02]],
  sourceBalance: options.sourceBalance ?? [[0, 0], [1, 0]],
});

const pulse = (id, label, durationMs, options = {}) => freezeGesture({
  id,
  label,
  durationMs,
  pressure: options.pressure ?? [[0, 0], [0.04, 1], [0.3, 0.82], [0.68, 0.28], [1, 0]],
  tension: options.tension ?? [[0, 0.04], [0.35, -0.03], [1, 0]],
  adduction: options.adduction ?? [[0, -0.18], [0.08, 0.14], [0.52, 0.02], [1, -0.2]],
  mouthOpening: options.mouthOpening ?? [[0, -0.24], [0.18, 0.2], [0.7, 0.08], [1, -0.18]],
  cavityCoupling: options.cavityCoupling ?? [[0, 0], [1, 0]],
  asymmetry: options.asymmetry ?? [[0, 0], [0.3, 0.08], [1, 0]],
  roughness: options.roughness ?? [[0, 0.12], [0.22, 0.04], [1, -0.04]],
  sourceBalance: options.sourceBalance ?? [[0, 0], [1, 0]],
});

const trillPressure = (cycles = 6, floor = 0.08) => {
  const points = [[0, 0]];
  for (let index = 0; index < cycles; index += 1) {
    const start = index / cycles;
    points.push([start + 0.08 / cycles, 1], [start + 0.65 / cycles, 0.82]);
    if (index < cycles - 1) points.push([(index + 0.94) / cycles, floor]);
  }
  points.push([1, 0]);
  return points;
};

const trill = (id, label, durationMs, cycles, options = {}) => freezeGesture({
  id,
  label,
  durationMs,
  pressure: options.pressure ?? trillPressure(cycles, options.floor ?? 0.1),
  tension: options.tension ?? [[0, -0.04], [0.48, 0.08], [1, -0.02]],
  adduction: options.adduction ?? [[0, -0.12], [0.06, 0.08], [0.92, 0.05], [1, -0.16]],
  mouthOpening: options.mouthOpening ?? [[0, -0.12], [0.22, 0.06], [0.7, 0.14], [1, -0.1]],
  cavityCoupling: options.cavityCoupling ?? [[0, 0.04], [0.5, -0.03], [1, 0.03]],
  asymmetry: options.asymmetry ?? [[0, 0], [0.5, 0.06], [1, -0.02]],
  roughness: options.roughness ?? [[0, 0.02], [0.6, 0.08], [1, 0]],
  sourceBalance: options.sourceBalance ?? [[0, -0.08], [0.45, 0.1], [1, -0.04]],
});

export const CALL_GESTURES = Object.freeze({
  "lion-roar": held("lion-roar", "Long roar", 1_850, {
    pressure: [[0, 0], [0.08, 0.72], [0.25, 1], [0.7, 0.92], [0.9, 0.56], [1, 0]],
    tension: [[0, 0.08], [0.28, -0.08], [0.78, -0.13], [1, -0.03]],
    mouthOpening: [[0, -0.22], [0.28, 0.2], [1, 0.12]],
    asymmetry: [[0, 0], [0.38, 0.16], [0.78, 0.24], [1, 0.02]],
    roughness: [[0, 0.04], [0.42, 0.22], [0.86, 0.14], [1, 0]],
  }),
  "lion-grunt": pulse("lion-grunt", "Chest grunt", 520),
  "wolf-howl": held("wolf-howl", "Rising howl", 3_100, {
    pressure: [[0, 0], [0.12, 0.72], [0.28, 1], [0.82, 0.94], [1, 0]],
    tension: [[0, -0.16], [0.32, 0.02], [0.74, 0.16], [1, 0.07]],
    mouthOpening: [[0, -0.18], [0.34, 0.12], [1, 0.2]],
  }),
  "wolf-yip": pulse("wolf-yip", "Yip", 330, {
    tension: [[0, 0.12], [0.28, 0.3], [1, 0.08]],
  }),
  "dog-bark": pulse("dog-bark", "Bark", 410),
  "dog-growl": held("dog-growl", "Growl", 1_400, {
    pressure: [[0, 0], [0.12, 0.78], [0.88, 0.9], [1, 0]],
    tension: [[0, -0.08], [1, -0.12]],
    asymmetry: [[0, 0.08], [0.48, 0.24], [1, 0.15]],
    roughness: [[0, 0.06], [0.5, 0.24], [1, 0.1]],
  }),
  "elephant-rumble": held("elephant-rumble", "Rumble", 2_800, {
    pressure: [[0, 0], [0.16, 0.72], [0.78, 0.9], [1, 0]],
    tension: [[0, -0.12], [0.5, -0.18], [1, -0.08]],
    cavityCoupling: [[0, 0.08], [0.5, 0.16], [1, 0.08]],
  }),
  "elephant-trumpet": held("elephant-trumpet", "Trumpet", 1_150, {
    pressure: [[0, 0], [0.07, 1], [0.62, 0.9], [1, 0]],
    tension: [[0, 0.12], [0.26, 0.34], [0.78, 0.22], [1, 0.04]],
    mouthOpening: [[0, -0.14], [0.22, 0.24], [1, 0.18]],
    roughness: [[0, 0.02], [0.4, 0.1], [1, 0]],
  }),
  "alligator-bellow": held("alligator-bellow", "Bellow", 2_250, {
    pressure: [[0, 0], [0.15, 0.78], [0.38, 1], [0.84, 0.88], [1, 0]],
    tension: [[0, -0.06], [0.5, -0.14], [1, -0.04]],
    cavityCoupling: [[0, 0.04], [0.5, 0.18], [1, 0.05]],
    roughness: [[0, 0.04], [0.5, 0.18], [1, 0.04]],
  }),
  "alligator-grunt": pulse("alligator-grunt", "Grunt", 610),
  "raven-croak": pulse("raven-croak", "Croak", 720, {
    pressure: [[0, 0], [0.08, 0.84], [0.34, 1], [0.72, 0.48], [1, 0]],
    tension: [[0, -0.06], [0.3, 0.08], [0.7, -0.04], [1, 0.02]],
    asymmetry: [[0, -0.12], [0.35, 0.24], [1, -0.08]],
    roughness: [[0, 0.08], [0.4, 0.26], [1, 0.06]],
    sourceBalance: [[0, -0.18], [0.45, 0.16], [1, -0.12]],
  }),
  "raven-rattle": trill("raven-rattle", "Rattle", 920, 7, {
    tension: [[0, -0.1], [0.5, 0.04], [1, -0.08]],
    asymmetry: [[0, 0.08], [0.5, 0.26], [1, 0.12]],
  }),
  "songbird-phrase": trill("songbird-phrase", "Song phrase", 1_350, 5, {
    tension: [[0, -0.18], [0.22, 0.08], [0.5, 0.26], [0.76, -0.02], [1, 0.14]],
    sourceBalance: [[0, -0.22], [0.34, 0.16], [0.68, -0.08], [1, 0.24]],
  }),
  "songbird-trill": trill("songbird-trill", "Fast trill", 860, 10),
  "dove-coo": held("dove-coo", "Coo", 1_900, {
    pressure: [[0, 0], [0.18, 0.74], [0.72, 0.88], [1, 0]],
    tension: [[0, -0.1], [0.48, 0.02], [1, -0.08]],
    cavityCoupling: [[0, 0.04], [0.5, 0.14], [1, 0.05]],
    roughness: [[0, -0.08], [1, -0.04]],
  }),
  "dove-double": trill("dove-double", "Double coo", 1_320, 2, { floor: 0.02 }),
  "owl-hoot": held("owl-hoot", "Hoot", 1_650, {
    pressure: [[0, 0], [0.14, 0.82], [0.76, 0.94], [1, 0]],
    tension: [[0, -0.12], [0.5, -0.02], [1, -0.1]],
    cavityCoupling: [[0, 0.06], [0.5, 0.18], [1, 0.08]],
  }),
  "owl-double": trill("owl-double", "Double hoot", 1_720, 2, { floor: 0.01 }),
  "bullfrog-call": trill("bullfrog-call", "Advertisement", 1_180, 4, {
    floor: 0.03,
    tension: [[0, -0.08], [0.5, 0.04], [1, -0.06]],
    cavityCoupling: [[0, 0.08], [0.5, 0.2], [1, 0.12]],
  }),
  "bullfrog-grunt": pulse("bullfrog-grunt", "Grunt", 460, {
    cavityCoupling: [[0, 0.12], [0.6, 0.22], [1, 0.05]],
  }),
  "treefrog-chirp": pulse("treefrog-chirp", "Chirp", 190, {
    tension: [[0, 0.12], [0.5, 0.28], [1, 0.04]],
  }),
  "treefrog-trill": trill("treefrog-trill", "Trill", 1_180, 12, {
    tension: [[0, 0.04], [0.5, 0.2], [1, 0.08]],
  }),
  "mouse-sweep": held("mouse-sweep", "USV sweep", 480, {
    pressure: [[0, 0], [0.08, 0.82], [0.8, 0.94], [1, 0]],
    tension: [[0, -0.24], [0.45, 0.26], [0.76, 0.08], [1, 0.34]],
    mouthOpening: [[0, -0.08], [0.5, 0.14], [1, -0.04]],
    roughness: [[0, -0.08], [1, -0.06]],
  }),
  "mouse-steps": trill("mouse-steps", "USV steps", 640, 5, {
    tension: [[0, -0.18], [0.24, 0.2], [0.5, -0.04], [0.76, 0.28], [1, 0.1]],
    roughness: [[0, -0.1], [1, -0.08]],
  }),
});

function freezeAnimal(animal) {
  const controls = { ...animal.controls };
  const tractRangeM = animal.tractRangeM ?? [
    Math.max(0.018, animal.tractLengthM * 0.82),
    Math.min(0.82, animal.tractLengthM * 1.18),
  ];
  const unitRange = (name, negative, positive) => Object.freeze([
    clamp(controls[name] - negative),
    clamp(controls[name] + positive),
  ]);
  const bounds = {
    pressure: unitRange("pressure", 0.28, 0.18),
    tension: unitRange("tension", 0.22, 0.24),
    adduction: unitRange("adduction", 0.24, 0.2),
    sourceScale: Object.freeze([
      clamp(controls.sourceScale - 0.18, 0.08, 1),
      clamp(controls.sourceScale + 0.14, 0.08, 1),
    ]),
    tractLengthM: Object.freeze([...tractRangeM]),
    mouthOpening: Object.freeze([0.04, 0.98]),
    cavityCoupling: unitRange("cavityCoupling", 0.3, 0.3),
    asymmetry: Object.freeze([0, clamp(controls.asymmetry + 0.34)]),
    sourceBalance: Object.freeze(animal.model === "bird" ? [0.12, 0.88] : [0.38, 0.62]),
    roughness: Object.freeze([0, clamp(controls.roughness + 0.34)]),
    gestureRate: Object.freeze([0.62, 1.5]),
    level: Object.freeze([0, 1]),
    ...(animal.bounds ?? {}),
  };
  return Object.freeze({
    ...animal,
    biologicalLock: true,
    controls: Object.freeze(controls),
    tractRangeM: Object.freeze([...tractRangeM]),
    frequencyRangeHz: Object.freeze([...(animal.frequencyRangeHz ?? [20, 8_000])]),
    bounds: Object.freeze(bounds),
    callIds: Object.freeze([...animal.callIds]),
  });
}

export const ANIMALS = Object.freeze({
  lion: freezeAnimal({
    id: "lion", label: "Lion", group: "Mammals & reptiles", model: "mammal",
    apparatus: "asymmetric two-mass larynx", baseFrequencyHz: 58, tractLengthM: 0.42,
    frequencyRangeHz: [35, 130], tractRangeM: [0.34, 0.5],
    rangeBasis: "excised lion/tiger source data + tract-length prior",
    cavityFrequencyHz: 118, description: "Heavy folds, long tract and controlled nonlinear roughness.",
    controls: { pressure: 0.82, tension: 0.24, adduction: 0.78, sourceScale: 0.92, mouthOpening: 0.7, cavityCoupling: 0.3, asymmetry: 0.28, sourceBalance: 0.5, roughness: 0.52 },
    callIds: ["lion-roar", "lion-grunt"],
  }),
  wolf: freezeAnimal({
    id: "wolf", label: "Wolf", group: "Mammals & reptiles", model: "mammal",
    apparatus: "two-mass larynx", baseFrequencyHz: 190, tractLengthM: 0.3,
    frequencyRangeHz: [80, 700], tractRangeM: [0.24, 0.36],
    rangeBasis: "mammalian two-mass model + body-size tract prior",
    cavityFrequencyHz: 210, description: "Stable fold oscillation with a long, rising howl gesture.",
    controls: { pressure: 0.68, tension: 0.48, adduction: 0.68, sourceScale: 0.7, mouthOpening: 0.66, cavityCoupling: 0.14, asymmetry: 0.08, sourceBalance: 0.5, roughness: 0.18 },
    callIds: ["wolf-howl", "wolf-yip"],
  }),
  dog: freezeAnimal({
    id: "dog", label: "Dog", group: "Mammals & reptiles", model: "mammal",
    apparatus: "two-mass larynx", baseFrequencyHz: 225, tractLengthM: 0.19,
    frequencyRangeHz: [75, 1_100], tractRangeM: [0.11, 0.28],
    rangeBasis: "mammalian two-mass model + breed-spanning tract prior",
    cavityFrequencyHz: 310, description: "Fast pressure bursts for bark and asymmetric sustained growl.",
    controls: { pressure: 0.78, tension: 0.52, adduction: 0.74, sourceScale: 0.58, mouthOpening: 0.62, cavityCoupling: 0.1, asymmetry: 0.16, sourceBalance: 0.5, roughness: 0.34 },
    callIds: ["dog-bark", "dog-growl"],
  }),
  elephant: freezeAnimal({
    id: "elephant", label: "Elephant", group: "Mammals & reptiles", model: "mammal",
    apparatus: "large two-mass larynx", baseFrequencyHz: 16.4, tractLengthM: 0.75,
    frequencyRangeHz: [5, 60], tractRangeM: [0.62, 0.82],
    rangeBasis: "excised 10.4 cm folds + measured oral-length estimate",
    cavityFrequencyHz: 46, description: "Very large tissue source and long oral-tract delay.",
    controls: { pressure: 0.72, tension: 0.18, adduction: 0.7, sourceScale: 1, mouthOpening: 0.48, cavityCoupling: 0.48, asymmetry: 0.14, sourceBalance: 0.5, roughness: 0.3 },
    callIds: ["elephant-rumble", "elephant-trumpet"],
  }),
  alligator: freezeAnimal({
    id: "alligator", label: "Alligator", group: "Mammals & reptiles", model: "mammal",
    apparatus: "reptile laryngeal tissues", baseFrequencyHz: 42, tractLengthM: 0.5,
    frequencyRangeHz: [20, 130], tractRangeM: [0.38, 0.62],
    rangeBasis: "reptile laryngeal family model + adult tract prior",
    cavityFrequencyHz: 72, description: "Low laryngeal bellow with strong body and tract resonance.",
    controls: { pressure: 0.8, tension: 0.22, adduction: 0.8, sourceScale: 0.9, mouthOpening: 0.4, cavityCoupling: 0.46, asymmetry: 0.16, sourceBalance: 0.5, roughness: 0.4 },
    callIds: ["alligator-bellow", "alligator-grunt"],
  }),
  raven: freezeAnimal({
    id: "raven", label: "Raven", group: "Birds", model: "bird",
    apparatus: "bilateral nonlinear syrinx", baseFrequencyHz: 390, tractLengthM: 0.17,
    frequencyRangeHz: [180, 1_600], tractRangeM: [0.13, 0.21],
    rangeBasis: "bilateral syrinx physiology + corvid-scale tract prior",
    cavityFrequencyHz: 780, description: "Two independently detuned syringeal sides for croak and rattle.",
    controls: { pressure: 0.68, tension: 0.42, adduction: 0.68, sourceScale: 0.66, mouthOpening: 0.52, cavityCoupling: 0.34, asymmetry: 0.3, sourceBalance: 0.46, roughness: 0.42 },
    callIds: ["raven-croak", "raven-rattle"],
  }),
  songbird: freezeAnimal({
    id: "songbird", label: "Songbird", group: "Birds", model: "bird",
    apparatus: "bilateral nonlinear syrinx", baseFrequencyHz: 2_250, tractLengthM: 0.038,
    frequencyRangeHz: [800, 7_200], tractRangeM: [0.024, 0.065],
    rangeBasis: "bilateral syrinx physiology + small-bird tract studies",
    cavityFrequencyHz: 3_900, description: "Fast pressure–tension gestures with independent syrinx sides.",
    controls: { pressure: 0.62, tension: 0.7, adduction: 0.64, sourceScale: 0.28, mouthOpening: 0.68, cavityCoupling: 0.22, asymmetry: 0.18, sourceBalance: 0.5, roughness: 0.08 },
    callIds: ["songbird-phrase", "songbird-trill"],
  }),
  dove: freezeAnimal({
    id: "dove", label: "Dove", group: "Birds", model: "bird",
    apparatus: "bilateral nonlinear syrinx", baseFrequencyHz: 480, tractLengthM: 0.105,
    frequencyRangeHz: [180, 1_200], tractRangeM: [0.075, 0.14],
    rangeBasis: "ex-vivo pigeon syrinx thresholds + tract-scale prior",
    cavityFrequencyHz: 610, description: "Soft syringeal oscillation coupled to a rounded OEC cavity.",
    controls: { pressure: 0.54, tension: 0.38, adduction: 0.58, sourceScale: 0.54, mouthOpening: 0.36, cavityCoupling: 0.5, asymmetry: 0.06, sourceBalance: 0.5, roughness: 0.04 },
    callIds: ["dove-coo", "dove-double"],
  }),
  owl: freezeAnimal({
    id: "owl", label: "Owl", group: "Birds", model: "bird",
    apparatus: "bilateral nonlinear syrinx", baseFrequencyHz: 520, tractLengthM: 0.185,
    frequencyRangeHz: [180, 1_400], tractRangeM: [0.12, 0.24],
    rangeBasis: "bilateral syrinx model + owl-scale tract prior",
    cavityFrequencyHz: 640, description: "Low, stable syrinx source with strong tract filtering.",
    controls: { pressure: 0.62, tension: 0.34, adduction: 0.68, sourceScale: 0.66, mouthOpening: 0.42, cavityCoupling: 0.46, asymmetry: 0.08, sourceBalance: 0.5, roughness: 0.06 },
    callIds: ["owl-hoot", "owl-double"],
  }),
  bullfrog: freezeAnimal({
    id: "bullfrog", label: "Bullfrog", group: "Frogs", model: "frog",
    apparatus: "pressure-driven vocal membranes", baseFrequencyHz: 155, tractLengthM: 0.065,
    frequencyRangeHz: [60, 520], tractRangeM: [0.045, 0.09],
    rangeBasis: "excised anuran membranes + closed-mouth modal radiation",
    cavityFrequencyHz: 330, description: "Pulsed membranes radiating through sac, head and tympanic modes.",
    controls: { pressure: 0.76, tension: 0.36, adduction: 0.72, sourceScale: 0.62, mouthOpening: 0.18, cavityCoupling: 0.78, asymmetry: 0.12, sourceBalance: 0.5, roughness: 0.28 },
    callIds: ["bullfrog-call", "bullfrog-grunt"],
  }),
  treefrog: freezeAnimal({
    id: "treefrog", label: "Tree frog", group: "Frogs", model: "frog",
    apparatus: "pressure-driven vocal membranes", baseFrequencyHz: 1_750, tractLengthM: 0.026,
    frequencyRangeHz: [500, 3_000], tractRangeM: [0.018, 0.045],
    rangeBasis: "excised treefrog larynx + pressure-regime measurements",
    cavityFrequencyHz: 2_850, description: "Small, high membranes with rapid pressure-pulse grammar.",
    controls: { pressure: 0.68, tension: 0.72, adduction: 0.66, sourceScale: 0.24, mouthOpening: 0.14, cavityCoupling: 0.68, asymmetry: 0.08, sourceBalance: 0.5, roughness: 0.18 },
    callIds: ["treefrog-chirp", "treefrog-trill"],
  }),
  mouse: freezeAnimal({
    id: "mouse", label: "Mouse · audible USV map", group: "Jet whistles", model: "rodent",
    apparatus: "wall-impinging glottal jet", baseFrequencyHz: 4_200, tractLengthM: 0.022,
    frequencyRangeHz: [2_500, 8_000], physicalFrequencyRangeHz: Object.freeze([40_000, 100_000]),
    tractRangeM: [0.018, 0.032],
    rangeBasis: "impinging-jet USV physiology; explicitly audible-mapped",
    cavityFrequencyHz: 5_600, description: "Ultrasonic mode trajectories mapped into the audible band.",
    controls: { pressure: 0.6, tension: 0.68, adduction: 0.36, sourceScale: 0.18, mouthOpening: 0.42, cavityCoupling: 0.12, asymmetry: 0.08, sourceBalance: 0.5, roughness: 0.02 },
    callIds: ["mouse-sweep", "mouse-steps"], audibleMapping: true,
  }),
});

export const MODEL_LABELS = Object.freeze({
  mammal: "Two-mass larynx",
  bird: "Dual nonlinear syrinx",
  frog: "Vocal membranes + sac modes",
  rodent: "Impinging-jet whistle",
});

export const CONTROL_LIMITS = Object.freeze({
  pressure: Object.freeze([0, 1]),
  tension: Object.freeze([0, 1]),
  adduction: Object.freeze([0, 1]),
  sourceScale: Object.freeze([0.08, 1]),
  tractLengthM: Object.freeze([0.018, 0.82]),
  mouthOpening: Object.freeze([0, 1]),
  cavityCoupling: Object.freeze([0, 1]),
  asymmetry: Object.freeze([0, 1]),
  sourceBalance: Object.freeze([0, 1]),
  roughness: Object.freeze([0, 1]),
  gestureRate: Object.freeze([0.25, 2.5]),
  level: Object.freeze([0, 1]),
});

const controlNames = Object.freeze(Object.keys(CONTROL_LIMITS));

function fallbackAnimal(id) {
  return ANIMALS[id] ?? ANIMALS.raven;
}

export function callsForAnimal(animalId = "raven") {
  return fallbackAnimal(animalId).callIds.map((id) => CALL_GESTURES[id]).filter(Boolean);
}

export function animalState(animalId = "raven", overrides = {}) {
  const animal = fallbackAnimal(animalId);
  const firstCall = animal.callIds[0];
  return sanitizeSyrinxState({
    animalId: animal.id,
    callId: firstCall,
    sourceModel: animal.model,
    active: false,
    loop: false,
    biologicalLock: true,
    gestureRate: 1,
    level: 0.48,
    tractLengthM: animal.tractLengthM,
    ...animal.controls,
    ...overrides,
  }, null);
}

export const DEFAULT_SYRINX_STATE = Object.freeze(animalState("raven"));

export function sanitizeSyrinxState(candidate = {}, fallback = DEFAULT_SYRINX_STATE) {
  const source = candidate && typeof candidate === "object" ? candidate : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const animal = fallbackAnimal(source.animalId ?? base.animalId);
  const callIds = animal.callIds;
  const requestedCall = String(source.callId ?? base.callId ?? callIds[0]);
  const state = {
    animalId: animal.id,
    callId: callIds.includes(requestedCall) ? requestedCall : callIds[0],
    sourceModel: animal.model,
    active: Boolean(source.active ?? base.active),
    loop: Boolean(source.loop ?? base.loop),
    biologicalLock: true,
  };
  for (const name of controlNames) {
    const [minimum, maximum] = state.biologicalLock
      ? animal.bounds[name] ?? CONTROL_LIMITS[name]
      : CONTROL_LIMITS[name];
    const animalValue = name === "tractLengthM"
      ? animal.tractLengthM
      : animal.controls[name];
    const defaultValue = name === "gestureRate" ? 1 : name === "level" ? 0.48 : animalValue;
    state[name] = clamp(source[name] ?? base[name] ?? defaultValue, minimum, maximum);
  }
  return state;
}

export function sampleGestureCurve(points, phase) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const position = clamp(phase);
  if (position <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index += 1) {
    const right = points[index];
    if (position > right[0]) continue;
    const left = points[index - 1];
    const span = Math.max(1e-9, right[0] - left[0]);
    const amount = clamp((position - left[0]) / span);
    const eased = amount * amount * (3 - 2 * amount);
    return left[1] + (right[1] - left[1]) * eased;
  }
  return points.at(-1)[1];
}

export function interpolateGesture(gestureOrId, normalizedPhase, baseState = DEFAULT_SYRINX_STATE) {
  const gesture = typeof gestureOrId === "string"
    ? CALL_GESTURES[gestureOrId]
    : gestureOrId;
  const base = sanitizeSyrinxState(baseState);
  if (!gesture?.curves) return { ...base, active: false, gesturePhase: 0 };
  const phase = clamp(normalizedPhase);
  const next = { ...base, active: phase < 1, gesturePhase: phase };
  for (const [name, points] of Object.entries(gesture.curves)) {
    const value = sampleGestureCurve(points, phase);
    if (name === "pressure") next.pressure = clamp(base.pressure * value);
    else if (CONTROL_LIMITS[name]) {
      const animal = ANIMALS[base.animalId];
      const [minimum, maximum] = base.biologicalLock
        ? animal.bounds[name] ?? CONTROL_LIMITS[name]
        : CONTROL_LIMITS[name];
      next[name] = clamp(base[name] + value, minimum, maximum);
    }
  }
  return next;
}

export function resolveSourceControls(candidate = DEFAULT_SYRINX_STATE) {
  const state = sanitizeSyrinxState(candidate);
  const animal = ANIMALS[state.animalId];
  const tensionOffset = state.tension - animal.controls.tension;
  const scaleOffset = animal.controls.sourceScale - state.sourceScale;
  const frequencyHz = clamp(
    animal.baseFrequencyHz * 2 ** (tensionOffset * 2.4 + scaleOffset * 1.15),
    ...animal.frequencyRangeHz,
  );
  return Object.freeze({
    model: animal.model,
    frequencyHz,
    pressure: state.active ? state.pressure : 0,
    tension: state.tension,
    adduction: state.adduction,
    breath: clamp(0.025 + state.roughness * 0.24),
    sourceScale: state.sourceScale,
    asymmetry: state.asymmetry,
    sourceBalance: state.sourceBalance * 2 - 1,
    roughness: state.roughness,
    pulseRateHz: clamp(12 + state.tension * 42, 0.5, 250),
    coupling: clamp(animal.model === "bird"
      ? 0.42 - state.asymmetry * 0.32
      : 0.28 + state.adduction * 0.38),
    // Source feedback is the signed pressure at the tract entrance. The
    // separately labeled radiation-mode mix is post-tract and does not claim
    // to be an explicit acoustic side branch.
    feedback: clamp(0.22 + (1 - state.mouthOpening) * 0.42),
    outputGain: 0.78,
    tractLengthM: state.tractLengthM,
    mouthOpening: state.mouthOpening,
    cavityCoupling: state.cavityCoupling,
    cavityFrequencyHz: animal.cavityFrequencyHz,
    audibleMapping: Boolean(animal.audibleMapping),
  });
}

export function animalGroups() {
  const groups = new Map();
  for (const animal of Object.values(ANIMALS)) {
    if (!groups.has(animal.group)) groups.set(animal.group, []);
    groups.get(animal.group).push(animal);
  }
  return [...groups].map(([label, animals]) => Object.freeze({
    label,
    animals: Object.freeze(animals),
  }));
}

export { clamp };
