export const SPELLING_DIPHONE_ATLAS_URL = new URL(
  "../assets/audio/spelling-diphone-kal16.wav",
  import.meta.url,
);

const CLIP_CALIBRATION = Object.freeze({
  consonant: 1.2,
  cluster: 1.12,
});

// Sustain points are seconds relative to the clip. Literal-vowel points are
// phase-matched inside each steady KAL body; other units deliberately use 0.
function clip(
  offset,
  duration,
  gain = 1,
  kind = "consonant",
  phone = "",
  sustainStart = 0,
  sustainEnd = 0,
) {
  return Object.freeze({
    offset,
    duration,
    gain: gain * (CLIP_CALIBRATION[kind] ?? 1),
    kind,
    phone,
    sustainStart,
    sustainEnd,
  });
}

export const SPELLING_DIPHONE_CLIPS = Object.freeze({
  a: clip(0.018, 0.5775, 1, "vowel", "AE", 0.23875, 0.2705625),
  b: clip(0.6135, 0.0845, 1, "consonant", "B"),
  c: clip(0.716, 0.103, 1, "consonant", "K"),
  d: clip(0.837, 0.069562, 1, "consonant", "D"),
  e: clip(0.924562, 0.537687, 1, "vowel", "EH", 0.2011875, 0.2435625),
  f: clip(1.48025, 0.088313, 1, "consonant", "F"),
  g: clip(1.586563, 0.09875, 1, "consonant", "G"),
  h: clip(1.703313, 0.086625, 1, "consonant", "HH"),
  i: clip(1.807937, 0.499625, 1, "vowel", "IH", 0.1969375, 0.2286875),
  j: clip(2.325563, 0.07475, 1, "consonant", "JH"),
  k: clip(2.418312, 0.103, 1, "consonant", "K"),
  l: clip(2.539312, 0.137375, 1, "liquid", "L"),
  m: clip(2.694688, 0.069687, 1, "consonant", "M"),
  n: clip(2.782375, 0.069437, 1, "consonant", "N"),
  ng: clip(2.869813, 0.10675, 1, "consonant", "NG"),
  o: clip(2.994562, 0.5425, 1, "vowel", "AA", 0.21775, 0.2495625),
  p: clip(3.555063, 0.116625, 1, "consonant", "P"),
  q: clip(3.689687, 0.151, 1, "cluster", "K W"),
  r: clip(3.858687, 0.120625, 1, "liquid", "R"),
  s: clip(3.997313, 0.09025, 1, "consonant", "S"),
  sh: clip(4.105562, 0.121688, 1, "consonant", "SH"),
  t: clip(4.24525, 0.0895, 1, "consonant", "T"),
  th: clip(4.35275, 0.088063, 1, "consonant", "TH"),
  dh: clip(4.458812, 0.032688, 1, "consonant", "DH"),
  u: clip(4.5095, 0.497437, 1, "vowel", "AH", 0.1963125, 0.228),
  v: clip(5.024938, 0.045312, 1, "consonant", "V"),
  w: clip(5.08825, 0.06925, 1, "consonant", "W"),
  x: clip(5.1755, 0.157, 1, "consonant", "K S"),
  y: clip(5.3505, 0.07125, 1, "consonant", "Y"),
  z: clip(5.43975, 0.072313, 1, "consonant", "Z"),
  ch: clip(5.530062, 0.116312, 1, "consonant", "CH"),
  ai: clip(5.664375, 0.455688, 1, "glide", "EY"),
  au: clip(6.138063, 0.399938, 1, "vowel", "AO"),
  ei: clip(6.556, 0.455688, 1, "glide", "EY"),
  oi: clip(7.029687, 0.427938, 1, "glide", "OY"),
  ou: clip(7.475625, 0.462938, 1, "glide", "AW"),
  ee: clip(7.956563, 0.571438, 1, "vowel", "IY"),
  oo: clip(8.546, 0.484687, 1, "vowel", "UW"),
  oa: clip(9.048687, 0.445375, 1, "glide", "OW"),
  ay: clip(9.5120625, 0.4855, 1, "glide", "AY"),
  er: clip(10.0155625, 0.4851875, 1, "vowel", "ER"),
  uh: clip(10.51875, 0.3256875, 1, "vowel", "UH"),
  zh: clip(10.8624375, 0.09675, 1, "consonant", "ZH"),
});

const PAIR_CLIPS = Object.freeze({
  th: "th",
  sh: "sh",
  ch: "ch",
  ph: "f",
  ng: "ng",
  ck: "k",
  qu: "q",
  wh: "w",
  ai: "ai",
  ay: "ai",
  au: "au",
  aw: "au",
  ei: "ei",
  ey: "ei",
  oi: "oi",
  oy: "oi",
  ou: "ou",
  ow: "ou",
  ee: "ee",
  ea: "ee",
  oo: "oo",
  oa: "oa",
});

const ARTICULATION_CLIPS = Object.freeze({
  glottal: "h",
});

export function spellingDiphoneClipKey(event) {
  const requestedSample = String(event?.sampleKey ?? "").toLowerCase();
  if (requestedSample && SPELLING_DIPHONE_CLIPS[requestedSample]) return requestedSample;
  const pairSource = String(event?.character ?? "").toLowerCase();
  if (event?.pair && PAIR_CLIPS[pairSource]) {
    if (Number(event.pairStepIndex) > 0) return "";
    return PAIR_CLIPS[pairSource];
  }
  const articulation = String(event?.articulation ?? "").toLowerCase();
  const key = ARTICULATION_CLIPS[articulation] ?? articulation;
  return SPELLING_DIPHONE_CLIPS[key] ? key : "";
}
