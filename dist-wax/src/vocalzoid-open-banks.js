function clip(offset, duration, loopStart = 0, loopEnd = 0) {
  return Object.freeze({ offset, duration, loopStart, loopEnd });
}

function bank(id, name, description, rootMidi, filename, clips) {
  const revision = "33a248af8df88edf5166593bf36b7e24e7bc1f94";
  return Object.freeze({
    id,
    name,
    description,
    rootMidi,
    url: new URL(`../assets/audio/${filename}`, import.meta.url),
    clips: Object.freeze(clips),
    sourceHref: `https://gitlab.com/oddvoices/oddvoices/-/tree/${revision}/voices/${id}`,
    license: "CC0 1.0",
  });
}

export const VOCALZOID_OPEN_BANKS = Object.freeze({
  air: bank(
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
  cicada: bank(
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
  quake: bank(
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
});

const RECIPES = Object.freeze({
  "V OW": Object.freeze({ onset: "voU", sustain: "oU", release: null }),
  "K AH L": Object.freeze({ onset: "k@", sustain: "@", release: "@l" }),
  "Z OY D": Object.freeze({ onset: "z_", sustain: "OI", release: "OId" }),
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
