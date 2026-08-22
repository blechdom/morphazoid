function clip(offset, duration, loopStart = 0, loopEnd = 0) {
  return Object.freeze({ offset, duration, loopStart, loopEnd });
}

function bank(id, name, description, rootMidi, filename, clips, sourceHref, license) {
  return Object.freeze({
    id,
    name,
    description,
    rootMidi,
    url: new URL(`../assets/audio/${filename}`, import.meta.url),
    clips: Object.freeze(clips),
    sourceHref,
    license,
  });
}

function oddVoiceBank(id, name, description, rootMidi, filename, clips) {
  const revision = "33a248af8df88edf5166593bf36b7e24e7bc1f94";
  return bank(
    id,
    name,
    description,
    rootMidi,
    filename,
    clips,
    `https://gitlab.com/oddvoices/oddvoices/-/tree/${revision}/voices/${id}`,
    "CC0 1.0",
  );
}

function arcticBank(id, name, description, rootMidi, clips) {
  return bank(
    id,
    name,
    description,
    rootMidi,
    `vocalzoid-cmu-arctic-${id}.wav`,
    clips,
    `http://festvox.org/cmu_arctic/cmu_arctic/cmu_us_${id}_arctic/`,
    "CMU ARCTIC permissive",
  );
}

export const VOCALZOID_OPEN_BANKS = Object.freeze({
  air: oddVoiceBank(
    "air",
    "OddVoices · Air",
    "Soft, breathy alto",
    62,
    "vocalzoid-oddvoices-air.wav",
    {
      voU: clip(0.022, 0.100812),
      oU: clip(0.144813, 0.380021, 0.092021, 0.289812),
      "k@": clip(0.546833, 0.141292),
      "@": clip(0.710125, 0.380021, 0.092167, 0.288938),
      "@l": clip(1.112146, 0.258562),
      "z_": clip(1.392708, 0.189167),
      OI: clip(1.603875, 0.380021, 0.091229, 0.289521),
      OId: clip(2.005896, 0.417687),
    },
  ),
  cicada: oddVoiceBank(
    "cicada",
    "OddVoices · Cicada",
    "Bright, buzzy baritone",
    55,
    "vocalzoid-oddvoices-cicada.wav",
    {
      voU: clip(0.022, 0.150354),
      oU: clip(0.194354, 0.380021, 0.091396, 0.288833),
      "k@": clip(0.596375, 0.124771),
      "@": clip(0.743146, 0.380021, 0.090667, 0.288896),
      "@l": clip(1.145167, 0.217854),
      "z_": clip(1.385021, 0.138208),
      OI: clip(1.545229, 0.380021, 0.091479, 0.288562),
      OId: clip(1.94725, 0.269958),
    },
  ),
  quake: oddVoiceBank(
    "quake",
    "OddVoices · Quake",
    "Deep, dark bass",
    44,
    "vocalzoid-oddvoices-quake.wav",
    {
      voU: clip(0.022, 0.284604),
      oU: clip(0.328604, 0.380021, 0.090625, 0.288604),
      "k@": clip(0.730625, 0.315146),
      "@": clip(1.067771, 0.380021, 0.09125, 0.289375),
      "@l": clip(1.469792, 0.288958),
      "z_": clip(1.78075, 0.319292),
      OI: clip(2.122042, 0.380021, 0.091417, 0.288583),
      OId: clip(2.524062, 0.75625),
    },
  ),
  bdl: arcticBank(
    "bdl",
    "CMU ARCTIC · BDL",
    "Warm North Midland US male",
    49,
    {
      voU: clip(0.022, 0.26),
      oU: clip(0.304, 0.15, 0.038062, 0.111437),
      "k@": clip(0.476, 0.18),
      "@": clip(0.678, 0.24, 0.06275, 0.179375),
      "@l": clip(0.94, 0.21),
      "z_": clip(1.172, 0.140063),
      OI: clip(1.334062, 0.26, 0.066187, 0.194188),
      OId: clip(1.616062, 0.28),
    },
  ),
  clb: arcticBank(
    "clb",
    "CMU ARCTIC · CLB",
    "Clear US female",
    54,
    {
      voU: clip(0.022, 0.25),
      oU: clip(0.294, 0.12, 0.0225, 0.092188),
      "k@": clip(0.436, 0.23),
      "@": clip(0.688, 0.22, 0.05625, 0.16225),
      "@l": clip(0.93, 0.19),
      "z_": clip(1.142, 0.180062),
      OI: clip(1.344062, 0.28, 0.074, 0.205937),
      OId: clip(1.646062, 0.45),
    },
  ),
  jmk: arcticBank(
    "jmk",
    "CMU ARCTIC · JMK",
    "Resonant Ontario Canadian male",
    46,
    {
      voU: clip(0.022, 0.23875),
      oU: clip(0.28275, 0.125, 0.02325, 0.094),
      "k@": clip(0.42975, 0.1825),
      "@": clip(0.63425, 0.2375, 0.042, 0.181312),
      "@l": clip(0.89375, 0.1575),
      "z_": clip(1.07325, 0.1325),
      OI: clip(1.22775, 0.24375, 0.057938, 0.173125),
      OId: clip(1.4935, 0.32625),
    },
  ),
  ksp: arcticBank(
    "ksp",
    "CMU ARCTIC · KSP",
    "Focused Indian English male",
    50,
    {
      voU: clip(0.022, 0.22),
      oU: clip(0.264, 0.135, 0.031625, 0.099625),
      "k@": clip(0.421, 0.225),
      "@": clip(0.668, 0.165, 0.039813, 0.124125),
      "@l": clip(0.855, 0.11),
      "z_": clip(0.987, 0.165),
      OI: clip(1.174, 0.255, 0.062875, 0.188),
      OId: clip(1.451, 0.335),
    },
  ),
  slt: arcticBank(
    "slt",
    "CMU ARCTIC · SLT",
    "Light North Midland US female",
    54,
    {
      voU: clip(0.022, 0.25125),
      oU: clip(0.29525, 0.14375, 0.037812, 0.106438),
      "k@": clip(0.461, 0.195),
      "@": clip(0.678, 0.2125, 0.055625, 0.161812),
      "@l": clip(0.9125, 0.2075),
      "z_": clip(1.142, 0.13875),
      OI: clip(1.30275, 0.24375, 0.060312, 0.18175),
      OId: clip(1.5685, 0.395),
    },
  ),
});

const RECIPES = Object.freeze({
  "V OW": Object.freeze({ onset: "voU", sustain: "oU", release: null }),
  OW: Object.freeze({ onset: null, sustain: "oU", release: null }),
  "K AH L": Object.freeze({ onset: "k@", sustain: "@", release: "@l" }),
  "K AH": Object.freeze({ onset: "k@", sustain: "@", release: null }),
  "AH L": Object.freeze({ onset: null, sustain: "@", release: "@l" }),
  "Z OY D": Object.freeze({ onset: "z_", sustain: "OI", release: "OId" }),
  "Z OY": Object.freeze({ onset: "z_", sustain: "OI", release: null }),
  "OY D": Object.freeze({ onset: null, sustain: "OI", release: "OId" }),
});

export function vocalzoidOpenBank(value) {
  return VOCALZOID_OPEN_BANKS[value] ?? null;
}

export function vocalzoidOpenBankRecipe(note) {
  return RECIPES[[...(note?.phones ?? [])].join(" ")] ?? null;
}

export function vocalzoidOpenBankCoverage(notes) {
  const matched = (notes ?? []).filter(vocalzoidOpenBankRecipe).length;
  return Object.freeze({
    matched,
    total: notes?.length ?? 0,
    ratio: notes?.length ? matched / notes.length : 0,
  });
}
