const DEFAULT_MAX_DURATION_SECONDS = 45;

const COMMON_INFERENCE_LIMITS = Object.freeze([
  "The selected profile supplies analysis ranges and a synthesis strategy; it does not identify a species.",
  "Events are operationally defined by activity, windows, and pauses, so one node is an occurrence rather than a learned call type.",
  "PCA coordinates are a lossy projection of acoustic features; proximity is not identity, syntax, meaning, or anatomy.",
  "Three fixed envelope windows are multiscale summaries, not an estimate of a multifractal spectrum.",
]);

function evidence(items = []) {
  return Object.freeze(items.map(([label, url, note = "Primary research source"]) => Object.freeze({
    label,
    url,
    note,
  })));
}

function profile(spec) {
  const [minimumSpectralHz, maximumSpectralHz] = spec.band;
  const [minimumEventSeconds, maximumEventSeconds] = spec.duration;
  const stropheGapSeconds = spec.gap ?? 0.2;
  const analysisTargetRate = spec.targetRate ?? Math.min(
    480_000,
    Math.max(8_000, spec.recommendedSampleRate ?? maximumSpectralHz / 0.46),
  );
  const maxDurationSeconds = spec.maxDurationSeconds ?? DEFAULT_MAX_DURATION_SECONDS;
  const fixedWindowSeconds = spec.fixedWindowSeconds ?? 0;
  const modelLabel = spec.modelLabel
    ?? (spec.frequencyScale && spec.frequencyScale !== 1
      ? "Audible frequency-scaled descriptor sonification"
      : "Neutral modal descriptor sonification");
  const analysisDefaults = Object.freeze({
    stropheGapSeconds,
    minimumStropheSeconds: minimumEventSeconds,
    minimumSpectralHz,
    maximumSpectralHz,
    maxDurationSeconds,
    analysisTargetRate,
    frameSize: spec.frameSize ?? 512,
    hopSize: spec.hopSize ?? 128,
    minimumGapLimitSeconds: Math.min(0.08, stropheGapSeconds),
    maximumGapLimitSeconds: Math.max(1.5, stropheGapSeconds),
    minimumDurationLimitSeconds: Math.min(0.06, minimumEventSeconds),
    maximumDurationLimitSeconds: Math.max(2, maximumEventSeconds),
    fixedWindowSeconds,
    fixedWindowOverlap: spec.fixedWindowOverlap ?? 0.5,
    minimumWindowActiveRatio: spec.minimumWindowActiveRatio ?? 0.01,
    sequenceGapSeconds: spec.sequenceGapSeconds ?? null,
  });
  const synthesis = Object.freeze({
    specialist: spec.specialist ?? "neutral",
    modelId: spec.modelId ?? "neutral-descriptor-modal-v1",
    label: modelLabel,
    scope: spec.modelScope
      ?? "coarse amplitude envelope and spectral summaries driving a generic oscillator bank",
    frequencyScale: spec.frequencyScale ?? 1,
    recoversAnatomy: false,
  });
  const expectedFocus = spec.focus
    ? Object.freeze({ kind: spec.focus[0], minimumHz: spec.focus[1], maximumHz: spec.focus[2] })
    : null;
  const recommendedSampleRate = spec.recommendedSampleRate ?? Math.ceil(maximumSpectralHz / 0.46);
  const sourceRateNote = spec.sourceRateNote ?? (
    maximumSpectralHz > 24_000
      ? `Full-band analysis needs a source-rate PCM WAV near ${Math.round(recommendedSampleRate / 1_000)} kHz or higher; ordinary browser microphones and compressed decoding often omit this band.`
      : minimumSpectralHz < 20
        ? "Low-frequency capture needs an infrasonic-capable sensor, wind control, and an honest recorder response; sample rate alone is not enough."
        : `A source rate near ${Math.round(recommendedSampleRate / 1_000)} kHz or higher is recommended for the stated analysis band.`
  );
  const segmentationMode = fixedWindowSeconds > 0 ? "fixed-window" : "pause-bounded";
  const operationalDefinition = spec.operationalDefinition ?? (
    fixedWindowSeconds > 0
      ? `one ${fixedWindowSeconds}-second analysis window with ${Math.round((spec.fixedWindowOverlap ?? 0.5) * 100)}% overlap`
      : `one active ${spec.eventSingular} occurrence bounded by a pause longer than ${stropheGapSeconds} seconds; shorter internal gaps are joined`
  );
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    shortLabel: spec.shortLabel ?? spec.label,
    category: spec.category,
    eventIdPrefix: spec.eventIdPrefix ?? "E",
    eventSingular: spec.eventSingular,
    eventPlural: spec.eventPlural,
    eventDurationRangeSeconds: Object.freeze({ minimum: minimumEventSeconds, maximum: maximumEventSeconds }),
    withinEventGapSeconds: stropheGapSeconds,
    sequenceGapSeconds: spec.sequenceGapSeconds ?? null,
    expectedFocus,
    basis: spec.basis,
    evidence: evidence(spec.sources),
    recording: Object.freeze({
      recommendedSampleRate,
      sourceRateNote,
      sourceRatePcmPreferred: maximumSpectralHz > 24_000,
      infrasonicSensorNeeded: minimumSpectralHz < 20,
    }),
    segmentationMode,
    operationalDefinition,
    ...analysisDefaults,
    analysisDefaults,
    synthesis,
    inferenceLimits: Object.freeze([
      ...COMMON_INFERENCE_LIMITS,
      spec.inferenceLimit ?? "This operational preset is exploratory and is not a validated detector.",
    ]),
  });
}

const specs = [
  {
    id: "general", label: "General sound events", category: "General", eventSingular: "event", eventPlural: "events", eventIdPrefix: "E",
    band: [60, 11_000], focus: null, duration: [0.18, 2], gap: 0.35, targetRate: 24_000, frameSize: 512, hopSize: 256,
    basis: "A conservative audible-band baseline for exploratory recordings; it is not tied to a taxon or published detector.", sources: [],
    inferenceLimit: "The neutral model deliberately makes no claim about the source mechanism.",
  },

  // Birds
  {
    id: "songbird", label: "Nightingale / songbird strophes", shortLabel: "Songbird · strophes", category: "Birds", eventSingular: "strophe", eventPlural: "strophes", eventIdPrefix: "S",
    band: [250, 11_000], focus: ["song energy", 500, 10_000], duration: [0.5, 6], gap: 0.8, sequenceGapSeconds: 4, recommendedSampleRate: 48_000, targetRate: 24_000, frameSize: 512, hopSize: 256,
    specialist: "songbird", modelId: "effective-bilateral-syrinx-v0", modelLabel: "Reduced syrinx trajectory sketch", modelScope: "pitch and envelope proxies driving a reduced bilateral syrinx source",
    basis: "A pause-bounded song/strophe preset; natural nightingale pauses may be much longer than the operational split used here.",
    sources: [["Thrush-nightingale multifractal rhythm", "https://doi.org/10.1038/s41598-018-22933-2"], ["Nightingale song structure", "https://doi.org/10.3389/fevo.2022.778610"]],
    inferenceLimit: "Syrinx controls are effective acoustic proxies, not measurements of pressure, tissue tension, or anatomy.",
  },
  {
    id: "passerine-window", label: "Passerine survey · 3 s windows", category: "Birds", eventSingular: "window", eventPlural: "windows", eventIdPrefix: "BW",
    band: [150, 15_000], focus: ["global species peak distribution", 215, 10_659], duration: [1.5, 3], gap: 0.5, fixedWindowSeconds: 3, fixedWindowOverlap: 0.5, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 1024, hopSize: 256,
    basis: "Borrows BirdNET's published 3-second input geometry and broad passerine band for unlabeled exploratory windows; it does not run BirdNET.",
    sources: [["Official BirdNET model documentation", "https://github.com/birdnet-team/birdnet/blob/main/docs/models.rst", "Official model geometry"], ["Global bird peak-frequency study", "https://doi.org/10.1111/ele.13662"]],
    inferenceLimit: "This uses BirdNET-like window geometry only; no BirdNET classifier, labels, or confidence scores are produced.",
  },
  {
    id: "bird-syllable", label: "Bird syllables", category: "Birds", eventSingular: "syllable", eventPlural: "syllables", eventIdPrefix: "BS",
    band: [500, 15_000], focus: ["analysis band", 500, 15_000], duration: [0.02, 2], gap: 0.04, sequenceGapSeconds: 0.5, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 1024, hopSize: 128,
    basis: "Short continuous vocalizations bounded by silence, with fine temporal hops and a broad songbird band.",
    sources: [["Dynamic bird-syllable segmentation", "https://doi.org/10.1038/s41467-019-11605-y"], ["Cross-species syllable segmentation", "https://pmc.ncbi.nlm.nih.gov/articles/PMC9728902/"]],
    inferenceLimit: "Silence segmentation can split noisy or overlapping syllables and does not infer learned repertoire categories.",
  },
  {
    id: "bird-flight-call", label: "Nocturnal bird flight calls", category: "Birds", eventSingular: "flight call", eventPlural: "flight calls", eventIdPrefix: "FC",
    band: [1_000, 11_000], focus: ["call energy", 1_000, 11_000], duration: [0.03, 0.35], gap: 0.12, recommendedSampleRate: 24_000, targetRate: 24_000, frameSize: 512, hopSize: 64,
    basis: "A short-call preset based on the BirdVox research ecosystem and its 24 kHz field recordings.",
    sources: [["BirdVoxDetect", "https://github.com/BirdVox/birdvoxdetect", "Official research software"], ["BirdVox-full-night dataset", "https://zenodo.org/records/1205569", "Published dataset"]],
    inferenceLimit: "Weather, insects, and distant calls create confounds; this preset does not perform BirdVox classification.",
  },
  {
    id: "owl-hoot", label: "Forest owl hoots", category: "Birds", eventSingular: "hoot", eventPlural: "hoots", eventIdPrefix: "OH",
    band: [60, 1_200], focus: ["detector band", 0, 1_200], duration: [0.5, 7.5], gap: 2, recommendedSampleRate: 32_000, targetRate: 8_000, frameSize: 2048, hopSize: 256,
    basis: "Matches the broad duration, inter-syllable gap, and low-frequency band used in a six-species owl detector study.",
    sources: [["Automated owl-call detection", "https://doi.org/10.1002/rse2.125"]],
    inferenceLimit: "Published precision varied strongly by species and site, so manual validation remains necessary.",
  },
  {
    id: "woodpecker-drum", label: "Woodpecker drum rolls", category: "Birds", eventSingular: "drum", eventPlural: "drums", eventIdPrefix: "WD",
    band: [100, 12_000], focus: ["broadband impacts", 100, 12_000], duration: [0.06, 3], gap: 0.25, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 512, hopSize: 64,
    basis: "Treats a roll of repeated bill impacts as one event while retaining onset count, rate, and interval variation.",
    sources: [["Woodpecker drumming signals", "https://pmc.ncbi.nlm.nih.gov/articles/PMC5832706/"], ["Drum-roll acoustic variables", "https://pmc.ncbi.nlm.nih.gov/articles/PMC7532446/"]],
    inferenceLimit: "The shared descriptor records onsets but is not the full beat-by-beat feature set used by specialist woodpecker studies.",
  },

  // Terrestrial mammals and primates
  {
    id: "wolf-howl", label: "Wolf solo howls", category: "Terrestrial mammals", eventSingular: "howl", eventPlural: "howls", eventIdPrefix: "WH",
    band: [100, 2_500], focus: ["fundamental", 92, 1_116], duration: [1, 14], gap: 0.4, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 2048, hopSize: 256,
    basis: "Long tonal occurrences with a padded band around measured Iberian-wolf fundamentals and harmonics.",
    sources: [["Iberian wolf howl measurements", "https://doi.org/10.1644/06-MAMM-A-151R1.1"]],
    inferenceLimit: "The focus range describes fundamental frequency, not a complete species-specific bandwidth.",
  },
  {
    id: "wolf-chorus", label: "Wolf chorus · 5 s windows", category: "Terrestrial mammals", eventSingular: "chorus window", eventPlural: "chorus windows", eventIdPrefix: "WC",
    band: [200, 2_500], focus: ["energy concentration", 300, 1_900], duration: [2.5, 5], gap: 0.5, fixedWindowSeconds: 5, fixedWindowOverlap: 0.5, recommendedSampleRate: 44_100, targetRate: 8_000, frameSize: 2048, hopSize: 256, maxDurationSeconds: 120,
    basis: "Five-second overlapping windows reflect a published chorus analysis; whole choruses can last minutes.",
    sources: [["Wolf chorus acoustic structure", "https://doi.org/10.1371/journal.pone.0153858"]],
    inferenceLimit: "A five-second window is a tractable sample of a chorus, not an individual or a complete group vocalization.",
  },
  {
    id: "coyote-howl", label: "Coyote solo howls", category: "Terrestrial mammals", eventSingular: "howl", eventPlural: "howls", eventIdPrefix: "CY",
    band: [100, 4_000], focus: ["fundamental and lower harmonics", 200, 2_000], duration: [0.3, 12], gap: 0.55, sequenceGapSeconds: 4, recommendedSampleRate: 16_000, targetRate: 12_000, frameSize: 2048, hopSize: 256,
    basis: "A deliberately padded long-range-call profile for flat, irregular, and combination howls; frequency contour and duration remain central descriptors.",
    sources: [["Coyote bark and howl information content", "https://doi.org/10.1080/09524622.2006.9753555"], ["Coyote long-distance vocalizations", "https://doi.org/10.2307/1379656"]],
    inferenceLimit: "Coyote calls form a graded continuum, so a pause-bounded event is not automatically one named call type or one individual.",
  },
  {
    id: "coyote-group-yip-howl", label: "Coyote group yip-howls · 5 s windows", category: "Terrestrial mammals", eventSingular: "bout window", eventPlural: "bout windows", eventIdPrefix: "YH",
    band: [150, 6_000], focus: ["barks, howls, and yips", 200, 4_000], duration: [2.5, 5], gap: 0.5, fixedWindowSeconds: 5, fixedWindowOverlap: 0.5, recommendedSampleRate: 24_000, targetRate: 16_000, frameSize: 1024, hopSize: 128, maxDurationSeconds: 120,
    basis: "Overlapping windows preserve changes inside mixed group sequences without pretending that every bark, yip, warble, and joined howl has a clean universal boundary.",
    sources: [["Coyote long-distance vocalizations", "https://doi.org/10.2307/1379656"], ["Coyote bark and howl information content", "https://doi.org/10.1080/09524622.2006.9753555"]],
    inferenceLimit: "Apparent chorus density cannot establish group size, caller sex, identity, social context, or meaning.",
  },
  {
    id: "elephant-rumble", label: "Elephant infrasonic rumbles", category: "Terrestrial mammals", eventSingular: "rumble", eventPlural: "rumbles", eventIdPrefix: "ER",
    band: [8, 250], focus: ["fundamental", 15, 35], duration: [0.5, 12], gap: 1, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 4096, hopSize: 512, frequencyScale: 10,
    basis: "Long, low-resolution frames expose rumble fundamentals while a wider analysis band retains harmonics.",
    sources: [["Elephant-call feature analysis", "https://doi.org/10.1080/09524622.2014.906321"], ["Elephant rumble measurements", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4430816/"]],
    inferenceLimit: "The 15–35 Hz figure is an expected fundamental range, not a band-pass edge; ordinary microphones may not capture it.",
  },
  {
    id: "marmoset-call", label: "Common marmoset calls", category: "Terrestrial mammals", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "MC",
    band: [3_000, 20_000], focus: ["high-pass repertoire subset", 3_000, 18_300], duration: [0.04, 5], gap: 0.5, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 1024, hopSize: 128,
    basis: "A high-frequency colony-call preset whose half-second grouping can retain compound calls.",
    sources: [["Marmoset vocal-repertoire analysis", "https://doi.org/10.1121/1.4934268"]],
    inferenceLimit: "This high-pass preset omits low-frequency ock/egg calls and does not separate overlapping colony callers.",
  },
  {
    id: "gibbon-phrase", label: "Gibbon song phrases", category: "Terrestrial mammals", eventSingular: "phrase", eventPlural: "phrases", eventIdPrefix: "GP",
    band: [400, 2_000], focus: ["fundamental", 500, 1_600], duration: [0.02, 60], gap: 2, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 2048, hopSize: 256, maxDurationSeconds: 120,
    basis: "Joins song units into phrases when breaks remain under two seconds, while retaining onset rhythm.",
    sources: [["Northern grey gibbon song", "https://doi.org/10.3389/fevo.2023.1071640"], ["Gibbon phrase units", "https://doi.org/10.1098/rsos.200151"]],
    inferenceLimit: "Phrase duration and organization are species- and context-dependent; the two-second grouping rule is operational.",
  },
  {
    id: "chimp-hoot", label: "Chimpanzee hoots", category: "Terrestrial mammals", eventSingular: "hoot", eventPlural: "hoots", eventIdPrefix: "CH",
    band: [120, 1_000], focus: ["published call range", 200, 700], duration: [0.12, 1.5], gap: 0.3, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 2048, hopSize: 256,
    basis: "Padded operational band and duration around published rainforest-primate detector measurements.",
    sources: [["Rainforest primate sound detection", "https://doi.org/10.1111/2041-210X.12384"]],
    inferenceLimit: "The source study warns that 16 kHz field audio can itself be limiting; this is not a universal chimpanzee-call model.",
  },
  {
    id: "chimp-scream", label: "Chimpanzee screams", category: "Terrestrial mammals", eventSingular: "scream", eventPlural: "screams", eventIdPrefix: "CS",
    band: [600, 2_500], focus: ["published call range", 800, 2_000], duration: [0.35, 1.3], gap: 0.25, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 1024, hopSize: 128,
    basis: "Padded operational band and duration around one published automated-monitoring call class.",
    sources: [["Rainforest primate sound detection", "https://doi.org/10.1111/2041-210X.12384"]],
    inferenceLimit: "Other chimpanzee calls and noisy scream contours need separate validation and training data.",
  },
  {
    id: "forest-monkey-loud-call", label: "Low forest-monkey loud calls", category: "Terrestrial mammals", eventSingular: "loud call", eventPlural: "loud calls", eventIdPrefix: "FM",
    band: [20, 1_000], focus: ["reported fundamentals", 25, 70], duration: [0.1, 10], gap: 0.5, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 4096, hopSize: 512, frequencyScale: 6,
    basis: "A discovery preset spanning published Diana-monkey and king-colobus low calls, with a broader band for harmonics.",
    sources: [["Rainforest primate sound detection", "https://doi.org/10.1111/2041-210X.12384"]],
    inferenceLimit: "This deliberately broad discovery profile combines call classes and cannot identify monkey species.",
  },

  // Amphibians
  {
    id: "frog", label: "General frog calls", shortLabel: "Frog · general calls", category: "Amphibians", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "FR",
    band: [300, 8_000], focus: ["dominant-frequency examples", 500, 4_600], duration: [0.02, 6], gap: 0.2, recommendedSampleRate: 44_100, targetRate: 24_000, frameSize: 1024, hopSize: 128,
    basis: "A conservative multi-species discovery preset; species-specific profiles are preferable when available.",
    sources: [["Automatic anuran recognition", "https://doi.org/10.1016/j.ecoinf.2014.08.009"], ["AnuraSet", "https://pmc.ncbi.nlm.nih.gov/articles/PMC10628131/"]],
    inferenceLimit: "No frog vocal-sac, laryngeal, or species-specific production model is inferred.",
  },
  {
    id: "boreal-chorus-frog", label: "Boreal chorus frog · 2 s windows", category: "Amphibians", eventSingular: "call window", eventPlural: "call windows", eventIdPrefix: "BC",
    band: [1_000, 3_300], focus: ["detector band", 1_000, 3_300], duration: [1, 2], gap: 0.2, fixedWindowSeconds: 2, fixedWindowOverlap: 0.5, recommendedSampleRate: 32_000, targetRate: 16_000, frameSize: 512, hopSize: 64,
    basis: "Uses the RIBBIT study's exact spectral band and two-second window geometry for pulse-rate exploration.",
    sources: [["RIBBIT frog-call detection", "https://doi.org/10.1111/cobi.13718"]],
    inferenceLimit: "The published detector also required 20-second continuity; this map does not reproduce that classifier decision.",
  },
  {
    id: "harlequin-frog", label: "Harlequin frog pulsed calls", category: "Amphibians", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "HF",
    band: [1_500, 2_500], focus: ["detector band", 1_500, 2_500], duration: [0.12, 0.6], gap: 0.08, recommendedSampleRate: 22_050, targetRate: 16_000, frameSize: 256, hopSize: 32,
    basis: "Fine temporal framing follows a published high pulse-rate RIBBIT preset for roughly 0.3-second calls.",
    sources: [["RIBBIT frog-call detection", "https://doi.org/10.1111/cobi.13718"]],
    inferenceLimit: "This map does not explicitly estimate the published 120–150 Hz pulse-rate classifier feature.",
  },
  {
    id: "glassfrog-note", label: "Glassfrog notes", category: "Amphibians", eventSingular: "note", eventPlural: "notes", eventIdPrefix: "GF",
    band: [2_500, 8_000], focus: ["peak-frequency span", 2_713, 7_407], duration: [0.003, 0.7], gap: 0.08, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 256, hopSize: 32,
    basis: "Padded around measurements across 97 species, with short frames for the shortest reported notes.",
    sources: [["Glassfrog call evolution", "https://doi.org/10.1093/evolut/qpac041"]],
    inferenceLimit: "Tonal and pulsed note types need different specialist features; peak-frequency span is not full bandwidth.",
  },

  // Insects
  {
    id: "insect", label: "Cricket / insect chirps", shortLabel: "Insect · chirps", category: "Insects", eventSingular: "chirp", eventPlural: "chirps", eventIdPrefix: "C",
    band: [700, 11_000], focus: ["audible carrier region", 700, 11_000], duration: [0.08, 2], gap: 0.18, recommendedSampleRate: 48_000, targetRate: 24_000, frameSize: 512, hopSize: 256,
    specialist: "cricket", modelId: "two-dof-cricket-wings-v1", modelLabel: "Reduced two-wing stridulation sketch", modelScope: "detected pulse envelope driving a coupled two-wing oscillator",
    basis: "A broad audible stridulation preset retained for mixed cricket material and the bundled demonstrations.", sources: [["Cricket auditory behavior review", "https://doi.org/10.3389/fphys.2016.00046"]],
    inferenceLimit: "Carrier timing is fitted, while wing Q and coupling remain hypotheses rather than recovered anatomy.",
  },
  {
    id: "gryllus-calling", label: "Gryllus calling chirps", category: "Insects", eventSingular: "chirp", eventPlural: "chirps", eventIdPrefix: "GC",
    band: [3_500, 6_000], focus: ["carrier", 4_300, 5_200], duration: [0.07, 0.22], gap: 0.035, sequenceGapSeconds: 0.3, recommendedSampleRate: 24_000, targetRate: 24_000, frameSize: 512, hopSize: 64,
    specialist: "cricket", modelId: "two-dof-cricket-wings-v1", modelLabel: "Reduced two-wing stridulation sketch", modelScope: "pulse envelope and carrier estimates driving a coupled two-wing oscillator",
    basis: "Joins 15–20 ms pulses into three-to-five-pulse chirps around the published carrier region.", sources: [["Gryllus song pattern review", "https://doi.org/10.3389/fphys.2016.00046"]],
    inferenceLimit: "This calling-song preset excludes the higher-frequency courtship components described in the same literature.",
  },
  {
    id: "fall-field-cricket", label: "Fall field-cricket chirps", category: "Insects", eventSingular: "chirp", eventPlural: "chirps", eventIdPrefix: "FF",
    band: [4_000, 5_500], focus: ["carrier", 4_501, 4_867], duration: [0.07, 0.16], gap: 0.2, recommendedSampleRate: 48_000, targetRate: 24_000, frameSize: 512, hopSize: 64,
    specialist: "cricket", modelId: "two-dof-cricket-wings-v1", modelLabel: "Reduced two-wing stridulation sketch", modelScope: "chirp envelope and carrier estimates driving a coupled two-wing oscillator",
    basis: "A narrow calling-song profile around measured Gryllus pennsylvanicus carrier and chirp duration.", sources: [["Fall field-cricket calling song", "https://doi.org/10.1371/journal.pone.0060356"]],
    inferenceLimit: "Temperature and behavioral context move carrier and cadence; courtship ticks require another profile.",
  },
  {
    id: "cicada-echeme", label: "Cicada echemes", category: "Insects", eventSingular: "echeme", eventPlural: "echemes", eventIdPrefix: "CE",
    band: [5_000, 13_000], focus: ["source spectrum", 5_500, 12_000], duration: [0.04, 0.3], gap: 0.02, sequenceGapSeconds: 0.25, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 512, hopSize: 64,
    basis: "Separates individual Cicadatra-like echemes while retaining their temporal sequence for graph traversal.", sources: [["Cicadatra platyptera song modes", "https://doi.org/10.3897/zookeys.296.4855"]],
    inferenceLimit: "Calling, courtship, and alarm modes overlap spectrally; sequence timing supplies important context.",
  },
  {
    id: "new-forest-cicada", label: "New Forest cicada · 30 s windows", category: "Insects", eventSingular: "buzz window", eventPlural: "buzz windows", eventIdPrefix: "NF",
    band: [12_500, 15_500], focus: ["dominant energy", 13_500, 14_500], duration: [10, 30], gap: 0.3, fixedWindowSeconds: 30, fixedWindowOverlap: 0.5, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 1024, hopSize: 256, maxDurationSeconds: 120,
    basis: "Long fixed windows expose the sustained 14 kHz buzz used to evaluate low-cost AudioMoth monitoring.", sources: [["AudioMoth cicada evaluation", "https://doi.org/10.1111/2041-210X.12955"]],
    inferenceLimit: "This window geometry does not reproduce the paper's 14-versus-8 kHz detector or establish species presence.",
  },
  {
    id: "okanagana-cicada", label: "Okanagana cicada trains", category: "Insects", eventSingular: "train", eventPlural: "trains", eventIdPrefix: "OC",
    band: [6_000, 12_000], focus: ["energy peak", 8_000, 10_000], duration: [2, 65], gap: 0.2, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 512, hopSize: 64, maxDurationSeconds: 120,
    basis: "A long-bout profile where onset rate helps distinguish temporally different songs with similar spectra.", sources: [["Okanagana song differentiation", "https://doi.org/10.1016/j.zool.2004.07.003"]],
    inferenceLimit: "Frequency alone is unsafe because related species in the study differed mainly in chirp rate.",
  },
  {
    id: "mosquito-flight", label: "Mosquito flight traces · 1.2 s", category: "Insects", eventSingular: "flight window", eventPlural: "flight windows", eventIdPrefix: "MF",
    band: [150, 2_000], focus: ["female fundamental", 200, 700], duration: [0.6, 1.2], gap: 0.2, fixedWindowSeconds: 1.2, fixedWindowOverlap: 0.5, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 1024, hopSize: 128,
    basis: "Uses the published minimum stable-trace duration and keeps harmonics above the overlapping fundamental distributions.", sources: [["Mobile mosquito acoustic surveillance", "https://doi.org/10.7554/eLife.27854"]],
    inferenceLimit: "Wingbeat frequency overlaps among species and changes with population and temperature; this is not species identification.",
  },
  {
    id: "bee-flight", label: "Bee flight bouts", category: "Insects", eventSingular: "flight bout", eventPlural: "flight bouts", eventIdPrefix: "BF",
    band: [80, 1_000], focus: ["fundamental", 129, 243], duration: [0.3, 6], gap: 0.25, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 1024, hopSize: 128,
    basis: "A padded band around measured honeybee and wild-bee fundamentals, retaining harmonics and flight-envelope shape.", sources: [["Bee flight acoustics", "https://doi.org/10.1098/rstb.2023.0111"]],
    inferenceLimit: "Size, temperature, stress, and flight pattern affect the fundamental; microphone audio is an indirect proxy.",
  },
  {
    id: "pollination-buzz", label: "Bee pollination buzzes", category: "Insects", eventSingular: "buzz", eventPlural: "buzzes", eventIdPrefix: "PB",
    band: [80, 1_500], focus: ["fundamental", 100, 500], duration: [0.02, 2.5], gap: 0.08, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 256, hopSize: 32,
    basis: "Short buzz events with a broader band for harmonics and fine envelope variation.", sources: [["Floral-buzz biomechanics", "https://doi.org/10.1242/jeb.198176"]],
    inferenceLimit: "Pollination buzz is substrate vibration; microphone amplitude is not flower or anther vibration amplitude.",
  },

  // Airborne ultrasound
  {
    id: "bat-echolocation", label: "Bat FM echolocation pulses", category: "Ultrasound", eventSingular: "pulse", eventPlural: "pulses", eventIdPrefix: "BE",
    band: [15_000, 130_000], focus: ["measured big-brown-bat band", 23_000, 105_000], duration: [0.0003, 0.025], gap: 0.0005, sequenceGapSeconds: 0.25, recommendedSampleRate: 384_000, targetRate: 384_000, frameSize: 512, hopSize: 64, maxDurationSeconds: 8, frequencyScale: 0.075,
    basis: "Millisecond framing preserves FM pulses; sequence timing remains separate from the sub-millisecond pulse boundary.", sources: [["Big-brown-bat interception calls", "https://doi.org/10.1121/1.2714920"], ["Official ultrasonic recorder guidance", "https://answers.wildlifeacoustics.com/r/en-US/Song-Meter-SM5BAT-User-Guide/Ultrasonic-Sample-Rate", "Official capture guidance"]],
    inferenceLimit: "Off-axis angle and recorder response alter spectra; ordinary live input cannot faithfully capture this band.",
  },
  {
    id: "mouse-usv", label: "Mouse ultrasonic syllables", category: "Ultrasound", eventSingular: "syllable", eventPlural: "syllables", eventIdPrefix: "MU",
    band: [25_000, 110_000], focus: ["detector band", 25_000, 110_000], duration: [0.005, 0.2], gap: 0.03, sequenceGapSeconds: 0.4, recommendedSampleRate: 256_000, targetRate: 256_000, frameSize: 512, hopSize: 128, maxDurationSeconds: 10, frequencyScale: 0.08,
    basis: "Uses published source-rate, band, call-duration, and inter-syllable settings while keeping bout grouping as metadata.", sources: [["Mouse pup USV detector", "https://doi.org/10.3389/fnbeh.2022.1015484"], ["Mouse ultrasonic song", "https://doi.org/10.1371/journal.pbio.0030386"]],
    inferenceLimit: "Developmental stage and context change mouse repertoires; the selected profile does not classify syllable types.",
  },
  {
    id: "rat-22k", label: "Rat 22 kHz calls", category: "Ultrasound", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "R2",
    band: [18_000, 32_000], focus: ["reported concentration", 20_000, 29_000], duration: [0.02, 3.5], gap: 0.05, recommendedSampleRate: 96_000, targetRate: 96_000, frameSize: 1024, hopSize: 128, maxDurationSeconds: 20, frequencyScale: 0.25,
    basis: "Covers both short and long 22-kHz call forms with a padded band and fine pause boundary.", sources: [["Rat 22-kHz call classes", "https://doi.org/10.1016/0031-9384(93)90102-L"], ["Rat USV analysis method", "https://doi.org/10.1016/j.jneumeth.2014.08.007"]],
    inferenceLimit: "Short and long forms carry different contexts and should not be interpreted as one behavioral label.",
  },
  {
    id: "rat-50k", label: "Rat 50 kHz calls", category: "Ultrasound", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "R5",
    band: [35_000, 80_000], focus: ["typical call range", 35_000, 80_000], duration: [0.005, 0.2], gap: 0.04, recommendedSampleRate: 250_000, targetRate: 192_000, frameSize: 512, hopSize: 64, maxDurationSeconds: 10, frequencyScale: 0.12,
    basis: "Short high-frequency calls with a source rate high enough to avoid browser-audio Nyquist truncation.", sources: [["Rat 50-kHz playback study", "https://doi.org/10.3389/fnbeh.2021.812142"]],
    inferenceLimit: "The broad 50-kHz repertoire contains distinct contours and contexts not modeled by this pause-only preset.",
  },

  // Low-frequency and tonal marine calls
  {
    id: "marine", label: "General marine phrases", shortLabel: "Marine · broad phrases", category: "Marine · tonal calls", eventSingular: "phrase", eventPlural: "phrases", eventIdPrefix: "P",
    band: [20, 5_000], focus: null, duration: [0.5, 10], gap: 1, recommendedSampleRate: 16_000, targetRate: 16_000, frameSize: 2048, hopSize: 256,
    basis: "A broad hydrophone discovery preset retained for uncategorized low- and mid-frequency marine sound.", sources: [["NOAA Sounds in the Ocean", "https://www.fisheries.noaa.gov/national/science-data/sounds-ocean", "Official overview"]],
    inferenceLimit: "No cetacean, fish, vessel, or other marine production mechanism is inferred.",
  },
  {
    id: "right-whale-upcall", label: "North Atlantic right-whale upcalls", category: "Marine · tonal calls", eventSingular: "upcall", eventPlural: "upcalls", eventIdPrefix: "RU",
    band: [40, 400], focus: ["reported call band", 50, 250], duration: [0.25, 2], gap: 0.2, recommendedSampleRate: 2_000, targetRate: 8_000, frameSize: 2048, hopSize: 256, frequencyScale: 6,
    basis: "Padded around published upcall frequency and duration bounds with low-frequency frames.", sources: [["BOEM large-whale acoustic survey", "https://www.boem.gov/about-boem/northeast-large-pelagic-survey-collaborative-aerial-and-acoustic-surveys-large-whales", "Official survey documentation"], ["NOAA right-whale acoustic data", "https://www.fisheries.noaa.gov/resource/data/noaa-nefsc-north-atlantic-right-whale-acoustic-data-and-annotations", "Official annotated data"]],
    inferenceLimit: "Humpback upsweeps and noise can resemble isolated upcalls; presence decisions normally need multiple calls and review.",
  },
  {
    id: "sei-whale-downsweep", label: "Sei-whale downsweeps", category: "Marine · tonal calls", eventSingular: "downsweep", eventPlural: "downsweeps", eventIdPrefix: "SD",
    band: [20, 120], focus: ["mean contour", 34, 82], duration: [0.7, 2.2], gap: 0.25, sequenceGapSeconds: 4, recommendedSampleRate: 2_000, targetRate: 8_000, frameSize: 4096, hopSize: 512, frequencyScale: 12,
    basis: "Targets the measured 82-to-34 Hz contour and retains doublet/triplet cadence in the graph order.", sources: [["Sei-whale call detection", "https://doi.org/10.1121/1.2945155"]],
    inferenceLimit: "The original detector reported both misses and false positives; cadence is more distinctive than one downsweep.",
  },
  {
    id: "fin-whale-20hz", label: "Fin-whale 20 Hz pulses", category: "Marine · tonal calls", eventSingular: "pulse", eventPlural: "pulses", eventIdPrefix: "F2",
    band: [10, 40], focus: ["mean contour", 14, 22], duration: [0.4, 2.5], gap: 0.3, sequenceGapSeconds: 17, recommendedSampleRate: 2_000, targetRate: 8_000, frameSize: 4096, hopSize: 512, frequencyScale: 30,
    basis: "Low-frequency pulse occurrences whose 7–17 second cadence remains visible as succession timing.", sources: [["Fin-whale pulse measurements", "https://doi.org/10.1371/journal.pone.0329398"], ["NOAA LFDCS guide", "https://repository.library.noaa.gov/view/noaa/30726/noaa_30726_DS1.pdf", "Official guide"]],
    inferenceLimit: "Shipping and geophysical noise occupy this band; a robust train normally requires several pulses.",
  },
  {
    id: "fin-whale-40hz", label: "Fin-whale 40 Hz calls", category: "Marine · tonal calls", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "F4",
    band: [35, 100], focus: ["mean contour", 51, 74], duration: [0.3, 1.5], gap: 0.25, recommendedSampleRate: 2_000, targetRate: 8_000, frameSize: 4096, hopSize: 512, frequencyScale: 16,
    basis: "A separate profile for the measured 74-to-51 Hz call, rather than treating it as a 20-Hz-pulse variant.", sources: [["Fin-whale call measurements", "https://doi.org/10.1371/journal.pone.0329398"]],
    inferenceLimit: "Region, season, behavior, propagation, and recorder response affect occurrence and apparent contour.",
  },
  {
    id: "blue-whale-tonal", label: "Blue-whale low tonal calls", category: "Marine · tonal calls", eventSingular: "tonal call", eventPlural: "tonal calls", eventIdPrefix: "BT",
    band: [10, 80], focus: ["central North Pacific mean", 17, 21], duration: [1, 30], gap: 3, recommendedSampleRate: 2_000, targetRate: 8_000, frameSize: 4096, hopSize: 512, maxDurationSeconds: 120, frequencyScale: 24,
    basis: "Long infrasonic tonal occurrences with resolution suitable for slow contours and secular frequency change.", sources: [["Blue/fin call measurements", "https://doi.org/10.1371/journal.pone.0329398"], ["Blue-whale frequency drift", "https://pmc.ncbi.nlm.nih.gov/articles/PMC8975115/"]],
    inferenceLimit: "Blue-whale song frequency drifts over years, so fixed templates age and this preset cannot establish identity.",
  },
  {
    id: "minke-bioduck", label: "Antarctic minke bio-duck series", category: "Marine · tonal calls", eventSingular: "pulse series", eventPlural: "pulse series", eventIdPrefix: "BD",
    band: [40, 1_200], focus: ["pulse and harmonics", 50, 1_000], duration: [0.3, 2], gap: 1, sequenceGapSeconds: 3.1, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 1024, hopSize: 128,
    basis: "Joins five-to-twelve roughly 0.1-second pulses into a series and preserves series cadence.", sources: [["Antarctic minke bio-duck identification", "https://doi.org/10.1098/rsbl.2014.0175"]],
    inferenceLimit: "Pulse and series levels are distinct; this flat graph retains onset rhythm but not explicit parent-child hierarchy.",
  },
  {
    id: "minke-boing", label: "North Pacific minke boings", category: "Marine · tonal calls", eventSingular: "boing", eventPlural: "boings", eventIdPrefix: "MB",
    band: [500, 4_000], focus: ["peak region", 1_200, 1_600], duration: [0.7, 6], gap: 0.5, recommendedSampleRate: 16_000, targetRate: 16_000, frameSize: 1024, hopSize: 128,
    basis: "Long mid-frequency events around the characteristic 1.4 kHz peak region.", sources: [["North Pacific minke boing study", "https://doi.org/10.3389/fmars.2021.660122"]],
    inferenceLimit: "Minute-scale recurrence is behavioral and density-dependent, not a safe event-segmentation threshold.",
  },
  {
    id: "humpback-social", label: "Humpback social calls", category: "Marine · tonal calls", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "HS",
    band: [40, 12_000], focus: ["majority energy", 50, 3_000], duration: [0.05, 6], gap: 0.3, recommendedSampleRate: 96_000, targetRate: 48_000, frameSize: 1024, hopSize: 128,
    basis: "Broad social-call discovery band and duration, retaining harmonics above the main low-frequency energy.", sources: [["Humpback social-call repertoire", "https://doi.org/10.1111/mms.13138"], ["Humpback high-frequency harmonics", "https://doi.org/10.1121/1.2211547"]],
    inferenceLimit: "The repertoire is graded; humpback song needs unit, phrase, theme, and song hierarchy beyond this event graph.",
  },

  // Odontocetes and high-frequency marine signals
  {
    id: "dolphin-whistle", label: "General delphinid whistles", category: "Marine · odontocetes", eventSingular: "whistle", eventPlural: "whistles", eventIdPrefix: "DW",
    band: [1_000, 40_000], focus: ["fundamental span", 1_200, 23_000], duration: [0.03, 5], gap: 0.2, recommendedSampleRate: 96_000, targetRate: 96_000, frameSize: 1024, hopSize: 256, maxDurationSeconds: 30, frequencyScale: 0.3,
    basis: "Broad contour profile for delphinid whistle fundamentals and higher-frequency extensions.", sources: [["Bottlenose whistle measurements", "https://doi.org/10.1121/1.2713726"], ["Delphinid whistle bandwidth", "https://doi.org/10.1121/1.1804635"]],
    inferenceLimit: "Separate fundamentals from harmonics and overlapping animals; a 48 kHz source truncates contours above 24 kHz.",
  },
  {
    id: "beluga-whistle", label: "Beluga whistles", category: "Marine · odontocetes", eventSingular: "whistle", eventPlural: "whistles", eventIdPrefix: "BL",
    band: [300, 30_000], focus: ["fundamental", 400, 25_000], duration: [0.03, 4.5], gap: 0.2, recommendedSampleRate: 96_000, targetRate: 96_000, frameSize: 1024, hopSize: 256, maxDurationSeconds: 30, frequencyScale: 0.35,
    basis: "A graded whistle-repertoire profile with a band wider than its measured fundamental span.", sources: [["Beluga whistle repertoire", "https://doi.org/10.1121/1.5119249"]],
    inferenceLimit: "This covers whistles, not the full beluga repertoire or broadband echolocation clicks.",
  },
  {
    id: "killer-whale-hf-call", label: "Killer-whale high-frequency calls", category: "Marine · odontocetes", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "KW",
    band: [15_000, 50_000], focus: ["median peak", 19_600, 36_100], duration: [0.03, 0.3], gap: 0.08, recommendedSampleRate: 192_000, targetRate: 128_000, frameSize: 512, hopSize: 64, maxDurationSeconds: 15, frequencyScale: 0.2,
    basis: "Short high-frequency modulated-call profile with fine framing around measured peak frequencies.", sources: [["Killer-whale high-frequency calls", "https://doi.org/10.1121/1.3690963"]],
    inferenceLimit: "A 96 kHz recording is marginal at the upper band edge; repetitive contours are context, not automatic identity.",
  },
  {
    id: "killer-whale-call", label: "Killer-whale audible calls and whistles", category: "Marine · odontocetes", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "KO",
    band: [500, 25_000], focus: ["burst-pulse energy and whistle fundamentals", 500, 18_500], duration: [0.06, 18.3], gap: 0.35, sequenceGapSeconds: 3, recommendedSampleRate: 96_000, targetRate: 64_000, frameSize: 1024, hopSize: 128, maxDurationSeconds: 45, frequencyScale: 0.5,
    basis: "A broad audible-repertoire profile spanning social burst-pulse calls and whistles while keeping the separate high-frequency preset available.",
    sources: [["Ross Sea killer-whale acoustic repertoire", "https://doi.org/10.1098/rsos.191228"], ["Resident killer-whale whistle characteristics", "https://doi.org/10.1121/1.1349537"]],
    inferenceLimit: "Repertoires vary among populations and ecotypes; acoustic proximity cannot establish dialect, group membership, caller identity, or meaning.",
  },
  {
    id: "delphinid-burst-pulse", label: "Delphinid burst-pulse trains", category: "Marine · odontocetes", eventSingular: "burst-pulse train", eventPlural: "burst-pulse trains", eventIdPrefix: "BP",
    band: [1_000, 55_000], focus: ["reported mean peak", 30_000, 46_500], duration: [0.02, 0.8], gap: 0.03, recommendedSampleRate: 192_000, targetRate: 128_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 15, frequencyScale: 0.18,
    basis: "Retains rapid pulse-envelope modulation instead of treating burst-pulse calls as ordinary whistles.", sources: [["White-beaked-dolphin burst pulses", "https://www.aquaticmammalsjournal.org/burst-pulse-sounds-recorded-from-white-beaked-dolphins-lagenorhynchus-albirostris/"]],
    inferenceLimit: "Pulse-rate thresholds vary by repertoire and context; the shared descriptor is exploratory, not a burst-pulse classifier.",
  },
  {
    id: "delphinid-click", label: "Broadband delphinid clicks", category: "Marine · odontocetes", eventSingular: "click", eventPlural: "clicks", eventIdPrefix: "DC",
    band: [20_000, 200_000], focus: ["common bottlenose peak", 40_000, 120_000], duration: [0.00002, 0.0005], gap: 0.0002, sequenceGapSeconds: 0.25, recommendedSampleRate: 500_000, targetRate: 480_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 4, frequencyScale: 0.04,
    basis: "Sub-millisecond impulse frames preserve individual clicks; graph succession retains inter-click timing.", sources: [["Bottlenose echolocation beam/click study", "https://doi.org/10.1371/journal.pone.0047478"]],
    inferenceLimit: "Range and angle strongly change apparent spectra; low-rate recordings contain only unfaithful off-axis remnants.",
  },
  {
    id: "harbor-porpoise-click", label: "Harbor-porpoise NBHF clicks", category: "Marine · odontocetes", eventSingular: "click", eventPlural: "clicks", eventIdPrefix: "HP",
    band: [100_000, 180_000], focus: ["centroid", 130_000, 142_000], duration: [0.00003, 0.00025], gap: 0.0002, sequenceGapSeconds: 0.25, recommendedSampleRate: 500_000, targetRate: 480_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 4, frequencyScale: 0.035,
    basis: "A narrow-band high-frequency click preset with train timing separated from individual impulse boundaries.", sources: [["Wild harbor-porpoise echolocation", "https://doi.org/10.1242/jeb.02618"]],
    inferenceLimit: "Directionality makes amplitude and bandwidth unreliable unless the animal is close to the acoustic axis.",
  },
  {
    id: "beaked-whale-click", label: "Beaked-whale FM clicks", category: "Marine · odontocetes", eventSingular: "click", eventPlural: "clicks", eventIdPrefix: "BZ",
    band: [10_000, 90_000], focus: ["peak span across types", 16_000, 66_000], duration: [0.0001, 0.0015], gap: 0.001, sequenceGapSeconds: 0.55, recommendedSampleRate: 384_000, targetRate: 384_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 6, frequencyScale: 0.09,
    basis: "Individual FM click events with train-level inter-pulse intervals retained in chronology.", sources: [["Beaked-whale echolocation types", "https://doi.org/10.1121/1.4817832"]],
    inferenceLimit: "Orientation changes apparent duration; spectrum plus median inter-pulse interval is more reliable than duration alone.",
  },
  {
    id: "kogia-click", label: "Kogia NBHF clicks", category: "Marine · odontocetes", eventSingular: "click", eventPlural: "clicks", eventIdPrefix: "KG",
    band: [60_000, 180_000], focus: ["principal energy", 60_000, 180_000], duration: [0.00003, 0.0003], gap: 0.0002, sequenceGapSeconds: 0.15, recommendedSampleRate: 500_000, targetRate: 480_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 4, frequencyScale: 0.04,
    basis: "Very-high-frequency click occurrences with a separate train grouping interval.", sources: [["Kogia echolocation in the western Atlantic", "https://doi.org/10.1371/journal.pone.0264988"]],
    inferenceLimit: "A 200 kHz recorder captures only part of the spectrum and should not train full click morphology.",
  },
  {
    id: "sperm-whale-click-train", label: "Sperm-whale foraging click trains", category: "Marine · odontocetes", eventSingular: "click", eventPlural: "clicks", eventIdPrefix: "SC",
    band: [2_000, 40_000], focus: ["broad click energy", 2_000, 40_000], duration: [0.0002, 0.02], gap: 0.01, sequenceGapSeconds: 2.5, recommendedSampleRate: 192_000, targetRate: 96_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 30, frequencyScale: 0.3,
    basis: "Preserves individual usual clicks while recording inter-click timing for train exploration.", sources: [["Sperm-whale click temporal patterns", "https://doi.org/10.1016/S0022-0981(02)00411-2"]],
    inferenceLimit: "Slow clicks are a distinct mode, and body reflections plus orientation alter apparent multipulse structure.",
  },
  {
    id: "sperm-whale-coda", label: "Sperm-whale codas", category: "Marine · odontocetes", eventSingular: "coda", eventPlural: "codas", eventIdPrefix: "CO",
    band: [2_000, 30_000], focus: ["click energy", 2_000, 30_000], duration: [0.2, 2.5], gap: 0.3, recommendedSampleRate: 96_000, targetRate: 96_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 30, frequencyScale: 0.35,
    basis: "Joins patterned clicks into whole codas so rhythm, tempo, rubato, and ornamentation influence similarity.", sources: [["Project CETI coda combinatorics", "https://doi.org/10.1038/s41467-024-47221-8"]],
    inferenceLimit: "Acoustic clustering alone cannot assign semantic meaning to a coda or identify an individual whale.",
  },

  // Fish and invertebrates
  {
    id: "fish-pulse", label: "General fish pulse calls", category: "Marine · fish and invertebrates", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "FP",
    band: [20, 4_000], focus: ["survey peak span", 274, 2_803], duration: [0.02, 1.3], gap: 0.2, recommendedSampleRate: 16_000, targetRate: 16_000, frameSize: 1024, hopSize: 128,
    basis: "Broad discovery preset covering duration, pulse, and peak-frequency variation reported across fish sound types.", sources: [["Fish sound-type feature study", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4434729/"]],
    inferenceLimit: "This combines many sound types; temperature, fish size, behavior, and propagation confound species interpretation.",
  },
  {
    id: "cod-grunt", label: "Atlantic cod grunts", category: "Marine · fish and invertebrates", eventSingular: "grunt", eventPlural: "grunts", eventIdPrefix: "CG",
    band: [20, 500], focus: ["reported energy", 50, 260], duration: [0.04, 0.65], gap: 0.1, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 512, hopSize: 32, frequencyScale: 4,
    basis: "Low-frequency, multi-pulse grunt events with onset count and inter-onset variation retained.", sources: [["Atlantic cod sound measurements", "https://pmc.ncbi.nlm.nih.gov/articles/PMC5676770/"]],
    inferenceLimit: "Temperature, size, spawning state, and propagation affect call features and cadence.",
  },
  {
    id: "hardhead-catfish-knock", label: "Hardhead catfish knocks", category: "Marine · fish and invertebrates", eventSingular: "knock", eventPlural: "knocks", eventIdPrefix: "HC",
    band: [500, 1_400], focus: ["dominant frequency", 855, 930], duration: [0.01, 0.06], gap: 0.08, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 128, hopSize: 16,
    basis: "Short knocks around measured dominant frequencies, with fine temporal hops for call-rate structure.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Field attribution was literature-guided and based on limited exemplars; treat clusters as candidates.",
  },
  {
    id: "silver-perch-knock", label: "Silver-perch knocks", category: "Marine · fish and invertebrates", eventSingular: "knock", eventPlural: "knocks", eventIdPrefix: "SP",
    band: [400, 1_400], focus: ["dominant frequency", 665, 1_170], duration: [0.015, 0.07], gap: 0.12, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 128, hopSize: 16,
    basis: "Short percussive calls with a wider pause boundary for their slower reported cadence.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Cadence varies with temperature and aggregation size, so it is not a fixed species signature.",
  },
  {
    id: "atlantic-croaker-knock", label: "Atlantic-croaker knocks", category: "Marine · fish and invertebrates", eventSingular: "knock", eventPlural: "knocks", eventIdPrefix: "AC",
    band: [700, 1_500], focus: ["dominant frequency", 1_030, 1_170], duration: [0.008, 0.045], gap: 0.04, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 128, hopSize: 16,
    basis: "Very short knocks with a tight join threshold suitable for the reported high call rate.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Dense choruses can make individual-event segmentation meaningless even when spectral focus is stable.",
  },
  {
    id: "seatrout-grunt", label: "Spotted-seatrout grunts", category: "Marine · fish and invertebrates", eventSingular: "grunt", eventPlural: "grunts", eventIdPrefix: "TG",
    band: [150, 800], focus: ["reported grunt band", 250, 620], duration: [0.07, 0.4], gap: 0.15, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 1024, hopSize: 64,
    basis: "Keeps short grunts separate from the same species' longer purr vocalization.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Grunts and purrs are separate operational profiles and should not be collapsed into one call class.",
  },
  {
    id: "seatrout-purr", label: "Spotted-seatrout purrs", category: "Marine · fish and invertebrates", eventSingular: "purr", eventPlural: "purrs", eventIdPrefix: "TP",
    band: [150, 800], focus: ["reported peak region", 250, 450], duration: [0.5, 2], gap: 0.25, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 2048, hopSize: 128,
    basis: "A longer-duration companion to the spotted-seatrout grunt profile.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Overlapping callers and chorus reverberation can inflate apparent purr duration.",
  },
  {
    id: "toadfish-boatwhistle", label: "Gulf-toadfish boatwhistles", category: "Marine · fish and invertebrates", eventSingular: "boatwhistle", eventPlural: "boatwhistles", eventIdPrefix: "TB",
    band: [150, 1_000], focus: ["dominant frequency", 390, 600], duration: [0.2, 1.5], gap: 0.2, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 1024, hopSize: 128,
    basis: "Mid-length tonal fish calls around documented Gulf-toadfish examples.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Other toadfish species and populations can produce longer and lower calls.",
  },
  {
    id: "black-drum-croak", label: "Black-drum croaks", category: "Marine · fish and invertebrates", eventSingular: "croak", eventPlural: "croaks", eventIdPrefix: "BK",
    band: [100, 600], focus: ["dominant frequency", 225, 315], duration: [0.15, 0.8], gap: 0.15, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 1024, hopSize: 128,
    basis: "Low-frequency croak occurrences with a duration range padded around field examples.", sources: [["Estuarine fish call library", "https://doi.org/10.1093/icesjms/fsad085"]],
    inferenceLimit: "Chorusing changes measured duration and amplitude and can erase pause boundaries.",
  },
  {
    id: "fish-chorus-window", label: "Fish chorus · 60 s windows", category: "Marine · fish and invertebrates", eventSingular: "soundscape window", eventPlural: "soundscape windows", eventIdPrefix: "FW",
    band: [20, 3_500], focus: ["common chorus bands", 20, 2_500], duration: [30, 60], gap: 0.5, fixedWindowSeconds: 60, fixedWindowOverlap: 0.5, recommendedSampleRate: 16_000, targetRate: 8_000, frameSize: 2048, hopSize: 512, maxDurationSeconds: 120,
    basis: "Fixed soundscape windows, rather than fictitious individual events, for dense band-level choruses.", sources: [["Fish-chorus ecoacoustic method", "https://doi.org/10.1016/j.ecoinf.2017.07.001"], ["Reef chorus bands", "https://doi.org/10.1038/s41598-017-15838-z"]],
    inferenceLimit: "Duty cycle and recorder schedule bias presence; this is a soundscape-window profile, not a fish detector.",
  },
  {
    id: "snapping-shrimp", label: "Snapping-shrimp snaps", category: "Marine · fish and invertebrates", eventSingular: "snap", eventPlural: "snaps", eventIdPrefix: "SS",
    band: [1_500, 200_000], focus: ["core peak", 2_000, 5_000], duration: [0.00015, 0.001], gap: 0.0003, recommendedSampleRate: 500_000, targetRate: 480_000, frameSize: 256, hopSize: 64, maxDurationSeconds: 4, frequencyScale: 0.04,
    basis: "Sub-millisecond broadband impulses; the high source rate retains energy that extends far beyond the low-kHz core peak.", sources: [["Field snapping-shrimp spectra", "https://doi.org/10.3389/fmars.2023.1029003"]],
    inferenceLimit: "At dense snap rates, count distributions outperform isolated embeddings, and species attribution is usually unavailable.",
  },
  {
    id: "mantis-shrimp-rumble", label: "Mantis-shrimp rumbles", category: "Marine · fish and invertebrates", eventSingular: "rumble", eventPlural: "rumbles", eventIdPrefix: "MR",
    band: [20, 500], focus: ["dominant frequency", 53, 257], duration: [0.04, 0.8], gap: 0.25, recommendedSampleRate: 8_000, targetRate: 8_000, frameSize: 512, hopSize: 32, frequencyScale: 4,
    basis: "Low-frequency rumble events grouped using the published quarter-second separation.", sources: [["Mantis-shrimp rumble communication", "https://doi.org/10.3354/ab00361"]],
    inferenceLimit: "Other stomatopods and settings report lower fundamentals, so this is not a universal template.",
  },

  // Other marine mammals
  {
    id: "dugong-call", label: "Dugong chirps and trills", category: "Marine · other mammals", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "DG",
    band: [500, 12_000], focus: ["catalog range", 1_000, 8_600], duration: [0.03, 6], gap: 1, recommendedSampleRate: 48_000, targetRate: 48_000, frameSize: 1024, hopSize: 128,
    basis: "A broad profile spanning short chirps and longer trills from a published call catalog.", sources: [["Dugong vocal repertoire catalog", "https://cir.nii.ac.jp/crid/1050570784683129344?lang=en"]],
    inferenceLimit: "Evidence is less standardized than cetacean profiles, with substantial population and captive/wild differences.",
  },
  {
    id: "pinniped-call", label: "Pinniped calls and trills", category: "Marine · other mammals", eventSingular: "call", eventPlural: "calls", eventIdPrefix: "PI",
    band: [30, 20_000], focus: ["leopard-seal trill peaks", 330, 2_820], duration: [0.1, 10], gap: 1, recommendedSampleRate: 96_000, targetRate: 48_000, frameSize: 2048, hopSize: 256,
    basis: "Broad discovery profile for low/mid-frequency pinniped material; species-specific presets remain preferable.", sources: [["NOAA Sounds in the Ocean", "https://www.fisheries.noaa.gov/national/science-data/sounds-ocean", "Official overview"], ["Leopard-seal trill study", "https://pmc.ncbi.nlm.nih.gov/articles/PMC11272605/"]],
    inferenceLimit: "Pinniped repertoires differ substantially by species, sex, season, and whether calls are underwater or airborne.",
  },
];

export const ACOUSTIC_PROFILES = Object.freeze(Object.fromEntries(
  specs.map((spec) => {
    const built = profile(spec);
    return [built.id, built];
  }),
));

export const ACOUSTIC_PROFILE_GROUPS = Object.freeze(
  [...new Set(specs.map((spec) => spec.category))].map((category) => Object.freeze({
    label: category,
    profileIds: Object.freeze(specs.filter((spec) => spec.category === category).map((spec) => spec.id)),
  })),
);
