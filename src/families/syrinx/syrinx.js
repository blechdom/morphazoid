const clamp = (value, minimum = 0, maximum = 1) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
};

const freezePoints = (points) => Object.freeze(
  points.map(([time, value]) => Object.freeze([clamp(time), Number(value) || 0])),
);

function freezeGesture({
  id,
  label,
  durationMs,
  pressure,
  frequencyRatio = 1,
  levelTrim = 1,
  ...curves
}) {
  return Object.freeze({
    id,
    label,
    durationMs: clamp(durationMs, 80, 8_000),
    frequencyRatio: clamp(frequencyRatio, 0.03, 24),
    levelTrim: clamp(levelTrim, 0.05, 1),
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
  frequencyRatio: options.frequencyRatio ?? 1,
  levelTrim: options.levelTrim ?? 1,
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
  frequencyRatio: options.frequencyRatio ?? 1,
  levelTrim: options.levelTrim ?? 1,
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
  frequencyRatio: options.frequencyRatio ?? 1,
  levelTrim: options.levelTrim ?? 1,
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
  "cat-meow": held("cat-meow", "Meow", 980, {
    levelTrim: 0.65,
    pressure: [[0, 0], [0.08, 0.8], [0.68, 0.94], [1, 0]],
    tension: [[0, -0.08], [0.28, 0.1], [0.62, 0.2], [1, -0.03]],
    mouthOpening: [[0, -0.2], [0.34, 0.3], [0.78, 0.18], [1, -0.08]],
  }),
  "cat-purr": held("cat-purr", "Purr", 2_600, {
    frequencyRatio: 0.065,
    pressure: [[0, 0], [0.08, 0.6], [0.92, 0.66], [1, 0]],
    adduction: [[0, 0.08], [0.5, 0.14], [1, 0.06]],
    mouthOpening: [[0, -0.28], [1, -0.24]],
    roughness: [[0, 0.04], [0.5, 0.1], [1, 0.04]],
  }),
  "horse-whinny": held("horse-whinny", "Biphonic whinny", 2_350, {
    levelTrim: 0.58,
    pressure: [[0, 0], [0.06, 0.88], [0.58, 1], [0.82, 0.62], [1, 0]],
    tension: [[0, -0.06], [0.18, 0.28], [0.56, 0.08], [0.82, -0.2], [1, -0.3]],
    asymmetry: [[0, 0.08], [0.3, 0.42], [0.72, 0.3], [1, 0.12]],
    roughness: [[0, 0], [0.68, 0.12], [1, 0.34]],
  }),
  "horse-nicker": held("horse-nicker", "Nicker", 920, {
    frequencyRatio: 0.3,
    pressure: [[0, 0], [0.12, 0.64], [0.74, 0.72], [1, 0]],
    tension: [[0, -0.12], [0.6, -0.05], [1, -0.14]],
    mouthOpening: [[0, -0.3], [0.5, -0.18], [1, -0.28]],
  }),
  "reddeer-common-roar": held("reddeer-common-roar", "Common roar", 2_050, {
    pressure: [[0, 0], [0.1, 0.8], [0.76, 0.96], [1, 0]],
    tension: [[0, -0.06], [0.4, 0.08], [1, -0.02]],
    tractLengthM: [[0, 0], [0.78, 0.08], [1, 0.06]],
    mouthOpening: [[0, -0.18], [0.3, 0.22], [1, 0.12]],
  }),
  "reddeer-harsh-roar": held("reddeer-harsh-roar", "Harsh roar", 1_520, {
    levelTrim: 0.9,
    pressure: [[0, 0], [0.03, 1], [0.84, 0.94], [1, 0]],
    tractLengthM: [[0, 0.08], [1, 0.09]],
    asymmetry: [[0, 0.14], [0.45, 0.32], [1, 0.24]],
    roughness: [[0, 0.18], [0.42, 0.46], [1, 0.24]],
  }),
  "moose-bull-grunt": pulse("moose-bull-grunt", "Bull grunt", 240, {
    pressure: [[0, 0], [0.04, 0.96], [0.3, 1], [0.7, 0.55], [1, 0]],
    tension: [[0, -0.08], [0.55, -0.04], [1, -0.1]],
    adduction: [[0, 0.05], [0.08, 0.16], [0.7, 0.1], [1, -0.1]],
    mouthOpening: [[0, -0.22], [0.26, -0.12], [1, -0.2]],
    cavityCoupling: [[0, 0.08], [0.5, 0.13], [1, 0.08]],
    asymmetry: [[0, 0.06], [0.36, 0.18], [1, 0.08]],
    roughness: [[0, 0.12], [0.35, 0.28], [1, 0.14]],
  }),
  // Cow calls are documented as longer and spectrally higher than bull calls,
  // but published wild-call measurements do not isolate their F0. This gentle
  // 1.18 ratio is therefore a conservative modeled distinction, not a claimed
  // measurement. Neither moose gesture invents red-deer-like tract extension.
  "moose-cow-moan": held("moose-cow-moan", "Modeled cow moan", 1_500, {
    frequencyRatio: 1.18,
    pressure: [[0, 0], [0.16, 0.68], [0.48, 0.94], [0.82, 0.78], [1, 0]],
    tension: [[0, -0.08], [0.5, -0.03], [1, -0.09]],
    adduction: [[0, -0.02], [0.22, 0.08], [0.8, 0.05], [1, -0.1]],
    mouthOpening: [[0, -0.18], [0.32, -0.06], [0.78, 0.06], [1, -0.14]],
    cavityCoupling: [[0, 0.12], [0.5, 0.2], [1, 0.1]],
    asymmetry: [[0, 0.02], [0.56, 0.08], [1, 0.03]],
    roughness: [[0, 0.03], [0.5, 0.1], [1, 0.04]],
  }),
  "hyena-whoop": held("hyena-whoop", "Rising whoop", 1_950, {
    levelTrim: 0.6,
    pressure: [[0, 0], [0.1, 0.72], [0.68, 0.98], [1, 0]],
    tension: [[0, -0.16], [0.44, -0.02], [0.76, 0.3], [1, 0.18]],
    asymmetry: [[0, 0.04], [0.55, 0.16], [1, 0.1]],
  }),
  "hyena-giggle": trill("hyena-giggle", "Seven-note giggle", 920, 7, {
    frequencyRatio: 1.28, floor: 0.04, levelTrim: 0.52,
    tension: [[0, -0.08], [0.42, 0.12], [0.72, -0.02], [1, 0.16]],
    roughness: [[0, 0.06], [0.5, 0.18], [1, 0.08]],
  }),
  "wildboar-grunt": pulse("wildboar-grunt", "Low grunt", 540, {
    frequencyRatio: 0.34,
    tension: [[0, -0.12], [1, -0.16]],
    mouthOpening: [[0, -0.28], [1, -0.18]],
    roughness: [[0, 0.14], [0.5, 0.24], [1, 0.12]],
  }),
  "wildboar-squeal": held("wildboar-squeal", "Squeal", 1_280, {
    levelTrim: 0.5,
    frequencyRatio: 2.7,
    pressure: [[0, 0], [0.04, 1], [0.8, 0.92], [1, 0]],
    tension: [[0, 0.18], [0.35, 0.36], [0.7, 0.22], [1, 0.3]],
    mouthOpening: [[0, -0.08], [0.18, 0.32], [1, 0.24]],
    roughness: [[0, 0.12], [0.5, 0.36], [1, 0.18]],
  }),
  "cow-moo": held("cow-moo", "Open-mouth moo", 1_650, {
    pressure: [[0, 0], [0.12, 0.76], [0.78, 0.92], [1, 0]],
    tension: [[0, -0.08], [0.5, 0.02], [1, -0.1]],
    mouthOpening: [[0, -0.14], [0.3, 0.24], [1, 0.16]],
    cavityCoupling: [[0, 0.04], [0.5, 0.16], [1, 0.08]],
  }),
  "cow-contact": held("cow-contact", "Low contact moo", 1_150, {
    frequencyRatio: 0.66,
    pressure: [[0, 0], [0.14, 0.62], [0.76, 0.72], [1, 0]],
    tension: [[0, -0.14], [1, -0.1]],
    mouthOpening: [[0, -0.34], [1, -0.26]],
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
    manualLevelTrim: clamp(animal.manualLevelTrim ?? 1, 0.05, 1),
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
    manualLevelTrim: 0.64,
    controls: { pressure: 0.82, tension: 0.24, adduction: 0.78, sourceScale: 0.92, mouthOpening: 0.7, cavityCoupling: 0.3, asymmetry: 0.28, sourceBalance: 0.5, roughness: 0.52 },
    callIds: ["lion-roar", "lion-grunt"],
  }),
  wolf: freezeAnimal({
    id: "wolf", label: "Wolf", group: "Mammals & reptiles", model: "mammal",
    apparatus: "two-mass larynx", baseFrequencyHz: 190, tractLengthM: 0.3,
    frequencyRangeHz: [80, 700], tractRangeM: [0.24, 0.36],
    rangeBasis: "mammalian two-mass model + body-size tract prior",
    cavityFrequencyHz: 210, description: "Stable fold oscillation with a long, rising howl gesture.",
    manualLevelTrim: 0.39,
    controls: { pressure: 0.68, tension: 0.48, adduction: 0.68, sourceScale: 0.7, mouthOpening: 0.66, cavityCoupling: 0.14, asymmetry: 0.08, sourceBalance: 0.5, roughness: 0.18 },
    callIds: ["wolf-howl", "wolf-yip"],
  }),
  dog: freezeAnimal({
    id: "dog", label: "Dog", group: "Mammals & reptiles", model: "mammal",
    apparatus: "two-mass larynx", baseFrequencyHz: 225, tractLengthM: 0.19,
    frequencyRangeHz: [75, 1_100], tractRangeM: [0.11, 0.28],
    rangeBasis: "mammalian two-mass model + breed-spanning tract prior",
    cavityFrequencyHz: 310, description: "Fast pressure bursts for bark and asymmetric sustained growl.",
    manualLevelTrim: 0.26,
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
    manualLevelTrim: 0.93,
    controls: { pressure: 0.8, tension: 0.22, adduction: 0.8, sourceScale: 0.9, mouthOpening: 0.4, cavityCoupling: 0.46, asymmetry: 0.16, sourceBalance: 0.5, roughness: 0.4 },
    callIds: ["alligator-bellow", "alligator-grunt"],
  }),
  cat: freezeAnimal({
    id: "cat", label: "Cat", group: "Mammals & reptiles", model: "mammal",
    apparatus: "larynx with low-frequency purr mode", baseFrequencyHz: 460, tractLengthM: 0.13,
    frequencyRangeHz: [25, 1_400], tractRangeM: [0.09, 0.18],
    rangeBasis: "meow articulation study + measured 25-30 Hz purr",
    cavityFrequencyHz: 720, description: "Voiced meow plus a low-frequency purr regime.",
    manualLevelTrim: 0.26,
    controls: { pressure: 0.54, tension: 0.52, adduction: 0.62, sourceScale: 0.4, mouthOpening: 0.48, cavityCoupling: 0.24, asymmetry: 0.08, sourceBalance: 0.5, roughness: 0.08 },
    callIds: ["cat-meow", "cat-purr"],
  }),
  horse: freezeAnimal({
    id: "horse", label: "Horse", group: "Mammals & reptiles", model: "mammal",
    apparatus: "asynchronously coupled vocal folds", baseFrequencyHz: 400, tractLengthM: 0.48,
    frequencyRangeHz: [50, 3_100], tractRangeM: [0.36, 0.62],
    rangeBasis: "measured 52-1050 Hz F0 + 493-3012 Hz biphonic G0",
    cavityFrequencyHz: 270, description: "Whinny moves between inharmonic fold regimes; nicker stays low and closed.",
    manualLevelTrim: 0.21,
    controls: { pressure: 0.72, tension: 0.48, adduction: 0.68, sourceScale: 0.82, mouthOpening: 0.58, cavityCoupling: 0.26, asymmetry: 0.28, sourceBalance: 0.5, roughness: 0.22 },
    callIds: ["horse-whinny", "horse-nicker"],
  }),
  reddeer: freezeAnimal({
    id: "reddeer", label: "Red deer", group: "Mammals & reptiles", model: "mammal",
    apparatus: "mobile larynx + 27-30 mm vocal folds", baseFrequencyHz: 112, tractLengthM: 0.52,
    frequencyRangeHz: [60, 300], tractRangeM: [0.42, 0.7],
    rangeBasis: "66-168 Hz common roars + measured retractable vocal tract",
    cavityFrequencyHz: 190, description: "Common roar lengthens the tract; harsh roar pushes folds toward chaos.",
    manualLevelTrim: 0.37,
    controls: { pressure: 0.8, tension: 0.3, adduction: 0.78, sourceScale: 0.86, mouthOpening: 0.62, cavityCoupling: 0.34, asymmetry: 0.18, sourceBalance: 0.5, roughness: 0.3 },
    callIds: ["reddeer-common-roar", "reddeer-harsh-roar"],
  }),
  moose: freezeAnimal({
    id: "moose", label: "Moose", group: "Mammals & reptiles", model: "mammal",
    apparatus: "large cervid larynx represented by two-mass folds", baseFrequencyHz: 125, tractLengthM: 0.6,
    frequencyRangeHz: [70, 260], tractRangeM: [0.52, 0.68],
    rangeBasis: "125 Hz / 0.24 s bull mating grunt + conservative adult cow-call model",
    cavityFrequencyHz: 150, description: "Short repeated bull grunt and longer modeled cow moan through a stable long tract.",
    manualLevelTrim: 0.43,
    controls: { pressure: 0.76, tension: 0.27, adduction: 0.8, sourceScale: 0.94, mouthOpening: 0.38, cavityCoupling: 0.48, asymmetry: 0.18, sourceBalance: 0.5, roughness: 0.44 },
    callIds: ["moose-bull-grunt", "moose-cow-moan"],
  }),
  hyena: freezeAnimal({
    id: "hyena", label: "Spotted hyena", group: "Mammals & reptiles", model: "mammal",
    apparatus: "mammalian larynx with nonlinear regimes", baseFrequencyHz: 430, tractLengthM: 0.31,
    frequencyRangeHz: [180, 1_300], tractRangeM: [0.24, 0.4],
    rangeBasis: "field whoop contours + measured 547 Hz mean giggle notes",
    cavityFrequencyHz: 360, description: "Rising whoops and short, modulated seven-note giggle bouts.",
    manualLevelTrim: 0.2,
    controls: { pressure: 0.7, tension: 0.5, adduction: 0.7, sourceScale: 0.68, mouthOpening: 0.54, cavityCoupling: 0.2, asymmetry: 0.18, sourceBalance: 0.5, roughness: 0.26 },
    callIds: ["hyena-whoop", "hyena-giggle"],
  }),
  wildboar: freezeAnimal({
    id: "wildboar", label: "Wild boar", group: "Mammals & reptiles", model: "mammal",
    apparatus: "two-mass larynx with fry and harsh regimes", baseFrequencyHz: 110, tractLengthM: 0.27,
    frequencyRangeHz: [35, 1_800], tractRangeM: [0.2, 0.36],
    rangeBasis: "sub-100 Hz grunt pulses + broadband squeal classification",
    cavityFrequencyHz: 290, description: "Low pulsatile grunts and higher rough squeals share one tract.",
    manualLevelTrim: 0.68,
    controls: { pressure: 0.7, tension: 0.38, adduction: 0.74, sourceScale: 0.7, mouthOpening: 0.46, cavityCoupling: 0.2, asymmetry: 0.16, sourceBalance: 0.5, roughness: 0.38 },
    callIds: ["wildboar-grunt", "wildboar-squeal"],
  }),
  cow: freezeAnimal({
    id: "cow", label: "Cow", group: "Mammals & reptiles", model: "mammal",
    apparatus: "large two-mass larynx", baseFrequencyHz: 130, tractLengthM: 0.5,
    frequencyRangeHz: [55, 600], tractRangeM: [0.38, 0.64],
    rangeBasis: "80-180 Hz typical F0 + oral and nasal contact-call data",
    cavityFrequencyHz: 250, description: "Stable harmonic moo with open-mouth and low contact gestures.",
    manualLevelTrim: 0.45,
    controls: { pressure: 0.68, tension: 0.34, adduction: 0.7, sourceScale: 0.86, mouthOpening: 0.52, cavityCoupling: 0.38, asymmetry: 0.1, sourceBalance: 0.5, roughness: 0.18 },
    callIds: ["cow-moo", "cow-contact"],
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
    manualLevelTrim: 0.45,
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
    manualLevelTrim: 0.33,
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
  loopGapMs: Object.freeze([0, 8_000]),
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
    loopGapMs: 0,
    level: 0.48,
    tractLengthM: animal.tractLengthM,
    ...animal.controls,
    ...overrides,
  }, null);
}

export const DEFAULT_SYRINX_STATE = Object.freeze(animalState("raven"));

export function resolveSyrinxPresetGain(candidate = DEFAULT_SYRINX_STATE) {
  const hasGestureContour = typeof candidate?.sourceFrequencyRatio === "number"
    && Number.isFinite(candidate.sourceFrequencyRatio);
  const state = sanitizeSyrinxState(candidate);
  const trim = hasGestureContour
    ? CALL_GESTURES[state.callId]?.levelTrim
    : ANIMALS[state.animalId]?.manualLevelTrim;
  return clamp(trim ?? 1, 0.05, 1);
}

/**
 * Applies the selected call's calibrated post-model trim without changing the
 * user's Level control or the physical source/tract simulation.
 */
export function resolveSyrinxOutputLevel(candidate = DEFAULT_SYRINX_STATE) {
  const state = sanitizeSyrinxState(candidate);
  return clamp(state.level * resolveSyrinxPresetGain(candidate));
}

export const RANDOMIZABLE_CONTROLS = Object.freeze([
  "pressure", "tension", "adduction", "sourceScale", "tractLengthM",
  "mouthOpening", "cavityCoupling", "asymmetry", "sourceBalance",
  "roughness", "gestureRate", "loopGapMs", "level",
]);

export const MODULATION_TARGETS = Object.freeze([
  "pressure", "tension", "adduction", "sourceScale", "tractLengthM",
  "mouthOpening", "cavityCoupling", "asymmetry", "sourceBalance", "roughness",
  "gestureRate", "loopGapMs",
]);

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
    biologicalLock: Boolean(source.biologicalLock ?? base.biologicalLock ?? true),
  };
  for (const name of controlNames) {
    const [minimum, maximum] = state.biologicalLock
      ? animal.bounds[name] ?? CONTROL_LIMITS[name]
      : CONTROL_LIMITS[name];
    const animalValue = name === "tractLengthM"
      ? animal.tractLengthM
      : animal.controls[name];
    const defaultValue = name === "gestureRate"
      ? 1
      : name === "loopGapMs"
        ? 0
        : name === "level" ? 0.48 : animalValue;
    state[name] = clamp(source[name] ?? base[name] ?? defaultValue, minimum, maximum);
  }
  return state;
}

export function randomizeSyrinxState(candidate = DEFAULT_SYRINX_STATE, random = Math.random) {
  const base = sanitizeSyrinxState(candidate);
  const animal = ANIMALS[base.animalId];
  const next = { ...base };
  for (const name of RANDOMIZABLE_CONTROLS) {
    const [minimum, maximum] = base.biologicalLock
      ? animal.bounds[name] ?? CONTROL_LIMITS[name]
      : CONTROL_LIMITS[name];
    const unit = clamp(typeof random === "function" ? random() : Math.random());
    const shaped = 0.06 + unit * 0.88;
    next[name] = name === "tractLengthM"
      ? Math.exp(Math.log(minimum) + shaped * Math.log(maximum / minimum))
      : minimum + shaped * (maximum - minimum);
  }
  return sanitizeSyrinxState(next, base);
}

export function sampleModulationWave(shape = "sine", phase = 0, seed = 0) {
  const cycle = ((Number(phase) || 0) % 1 + 1) % 1;
  if (shape === "triangle") return 1 - Math.abs(cycle - 0.5) * 4;
  if (shape === "square") return cycle < 0.5 ? 1 : -1;
  if (shape === "sample-hold") {
    const bucket = Math.floor(Number(phase) || 0);
    const value = Math.sin((bucket + Number(seed || 0) + 1) * 12.9898) * 43_758.5453;
    return (value - Math.floor(value)) * 2 - 1;
  }
  return Math.sin(cycle * Math.PI * 2);
}

export function modulateSyrinxState(candidate, modulators = [], elapsedSeconds = 0) {
  const base = sanitizeSyrinxState(candidate);
  const animal = ANIMALS[base.animalId];
  const next = { ...base };
  modulators.forEach((modulator, index) => {
    if (!modulator?.enabled || !MODULATION_TARGETS.includes(modulator.target)) return;
    const [minimum, maximum] = base.biologicalLock
      ? animal.bounds[modulator.target] ?? CONTROL_LIMITS[modulator.target]
      : CONTROL_LIMITS[modulator.target];
    const rateHz = clamp(modulator.rateHz, 0.02, 20);
    const depth = clamp(modulator.depth);
    const wave = sampleModulationWave(
      modulator.shape,
      elapsedSeconds * rateHz + (Number(modulator.phase) || 0),
      index,
    );
    next[modulator.target] += wave * depth * (maximum - minimum) * 0.35;
  });
  const sourceFrequencyRatio = candidate?.sourceFrequencyRatio;
  return {
    ...sanitizeSyrinxState(next, base),
    active: Boolean(candidate?.active),
    gesturePhase: Number(candidate?.gesturePhase) || 0,
    ...(typeof sourceFrequencyRatio === "number" && Number.isFinite(sourceFrequencyRatio)
      ? { sourceFrequencyRatio: clamp(sourceFrequencyRatio, 0.03, 24) }
      : {}),
  };
}

/**
 * Resolve a call gesture's sounding phase and optional silent loop interval.
 * Keeping this calculation outside the view makes transport continuity
 * independent from preset selection and manual breath overrides.
 */
export function resolveGestureTimeline(elapsedMs, durationMs, loop = false, gapMs = 0) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  const duration = Math.max(1, Number(durationMs) || 1);
  if (!loop) {
    const complete = elapsed >= duration;
    return Object.freeze({
      active: !complete,
      complete,
      phase: clamp(elapsed / duration),
      remainingGapMs: 0,
    });
  }

  const gap = clamp(gapMs, ...CONTROL_LIMITS.loopGapMs);
  const cycleDuration = duration + gap;
  const cycleTime = elapsed % cycleDuration;
  const active = cycleTime < duration;
  return Object.freeze({
    active,
    complete: false,
    phase: active ? clamp(cycleTime / duration) : 1,
    remainingGapMs: active ? 0 : Math.max(0, cycleDuration - cycleTime),
  });
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
  const next = {
    ...base,
    active: phase < 1,
    gesturePhase: phase,
    sourceFrequencyRatio: gesture.frequencyRatio ?? 1,
  };
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
  const sourceFrequencyRatio = clamp(candidate?.sourceFrequencyRatio ?? 1, 0.03, 24);
  const state = sanitizeSyrinxState(candidate);
  const animal = ANIMALS[state.animalId];
  const tensionOffset = state.tension - animal.controls.tension;
  const scaleOffset = animal.controls.sourceScale - state.sourceScale;
  const frequencyHz = clamp(
    animal.baseFrequencyHz * sourceFrequencyRatio * 2 ** (tensionOffset * 2.4 + scaleOffset * 1.15),
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
