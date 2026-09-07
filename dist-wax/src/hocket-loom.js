// Pure state, preset, and interlock analysis for Hocket Luigi.

export const HOCKET_STEP_OPTIONS = Object.freeze([8, 12, 16, 24]);
export const HOCKET_VOICE_COLORS = Object.freeze([
  "#ff4f6d",
  "#ffd15c",
  "#55e6cf",
  "#a78bfa",
]);
export const HOCKET_LIMITS = Object.freeze({
  tempoBpm: Object.freeze([36, 220]),
  swing: Object.freeze([0, 0.46]),
  pulseLengthMs: Object.freeze([24, 260]),
  level: Object.freeze([0, 0.62]),
});

const DEFAULT_NAMES = Object.freeze(["Polos", "Sangsih", "Answer", "Relay"]);
const DEFAULT_TONES = Object.freeze([1, 3, 5, 2]);

function clamp(value, minimum, maximum, fallback = minimum) {
  try {
    const numeric = Number(value);
    return Number.isFinite(numeric)
      ? Math.min(maximum, Math.max(minimum, numeric))
      : fallback;
  } catch {
    return fallback;
  }
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function closestStepLength(value) {
  let numeric;
  try {
    numeric = Number(value);
  } catch {
    return 16;
  }
  if (!Number.isFinite(numeric)) return 16;
  return HOCKET_STEP_OPTIONS.reduce((best, option) =>
    Math.abs(option - numeric) < Math.abs(best - numeric) ? option : best
  );
}

function emptyRows(voiceCount, length) {
  return Array.from({ length: voiceCount }, () => Array(length).fill(0));
}

function alternatingRows(composite) {
  const rows = emptyRows(2, composite.length);
  composite.forEach((tone, step) => {
    rows[step % 2][step] = tone;
  });
  return rows;
}

function splitComposite(evenValues, oddValues) {
  const length = Math.max(evenValues.length, oddValues.length) * 2;
  const rows = emptyRows(2, length);
  evenValues.forEach((tone, index) => {
    rows[0][index * 2] = tone;
  });
  oddValues.forEach((tone, index) => {
    rows[1][index * 2 + 1] = tone;
  });
  return rows;
}

function shiftedCells(baseHits, shifts, length, tones) {
  const rows = emptyRows(shifts.length, length);
  const cellLength = 8;
  shifts.forEach((shift, voice) => {
    for (let offset = 0; offset < length; offset += cellLength) {
      baseHits.forEach((hit) => {
        rows[voice][offset + mod(hit + shift, cellLength)] = tones[voice];
      });
    }
  });
  return rows;
}

function relayRows(owners, tones) {
  const rows = emptyRows(tones.length, owners.length);
  owners.forEach((owner, step) => {
    rows[owner][step] = tones[owner];
  });
  return rows;
}

function freezePreset(preset) {
  preset.patterns.forEach(Object.freeze);
  Object.freeze(preset.patterns);
  Object.freeze(preset.names);
  Object.freeze(preset.phases);
  Object.freeze(preset.source);
  return Object.freeze(preset);
}

const OLUTALO_EVEN = [4, 3, 4, 3, 3, 3, 4, 3, 4, 4, 2, 2];
const OLUTALO_ODD = [1, 5, 2, 1, 5, 2, 1, 5, 2, 1, 5, 2];

export const HOCKET_PRESETS = Object.freeze([
  freezePreset({
    id: "nyog-cag",
    name: "Nyog Cag Alternation",
    region: "Bali",
    status: "Structural study",
    description:
      "Two parts alternate every pulse, making one quick composite line. The contour here is newly composed.",
    length: 16,
    pulsesPerBeat: 4,
    tempoBpm: 112,
    swing: 0,
    voiceCount: 2,
    names: ["Polos", "Sangsih"],
    phases: [0, 0],
    patterns: alternatingRows([1, 2, 3, 2, 1, 3, 4, 2, 1, 2, 4, 3, 2, 3, 5, 2]),
    source: {
      title: "Wayne Vitale, Kotekan: the technique of interlocking parts in Balinese music",
      url: "https://gamelan.org.nz/wp-content/uploads/2015/02/Kotekan-article-Balungan.pdf",
      note: "Alternating-part relationship follows the described nyog cag technique; pitches are original.",
    },
  }),
  freezePreset({
    id: "cak-telu",
    name: "Cak Telu Shift",
    region: "Bali",
    status: "Reduced structural study",
    description:
      "Three equal-duration cells enter one pulse apart. This 16-pulse reduction makes their overlaps easy to edit.",
    length: 16,
    pulsesPerBeat: 4,
    tempoBpm: 138,
    swing: 0,
    voiceCount: 3,
    names: ["Polos", "Sanglot", "Sangsih"],
    phases: [0, 0, 0],
    patterns: shiftedCells([0, 3, 6], [0, 1, -1], 16, [1, 3, 5]),
    source: {
      title: "Kendra Stepputat, The Kecak and Cultural Tourism on Bali",
      url: "https://api.pageplace.de/preview/DT0400.9781800103092_A42901913/preview-9781800103092_A42901913.pdf",
      note: "Uses the documented one-pulse entry relation; the pulse selection is an explicit reduction, not a transcription.",
    },
  }),
  freezePreset({
    id: "olutalo",
    name: "Olutalo Amadinda Cipher",
    region: "Buganda, Uganda",
    status: "Published pitch cipher",
    description:
      "Two equal-rate lines land halfway between one another; their 24-pulse composite reveals the inherent melody.",
    length: 24,
    pulsesPerBeat: 6,
    tempoBpm: 78,
    swing: 0,
    voiceCount: 2,
    names: ["Okunaga", "Okwawula"],
    phases: [0, 0],
    patterns: splitComposite(OLUTALO_EVEN, OLUTALO_ODD),
    source: {
      title: "Gerhard Kubik, The Structure of Kiganda Xylophone Music",
      url: "https://journal.ru.ac.za/index.php/africanmusic/article/view/606",
      note: "The numeric pitch cipher is reproduced analytically; browser timbres and tuning are not an amadinda reconstruction.",
    },
  }),
  freezePreset({
    id: "banda-linda-relay",
    name: "Ongo Relay Study",
    region: "Central African Republic",
    status: "New structural study",
    description:
      "Four fixed-pitch players pass a continuous line around the circle. This small study is newly composed, not an ongo transcription.",
    length: 16,
    pulsesPerBeat: 4,
    tempoBpm: 126,
    swing: 0.04,
    voiceCount: 4,
    names: ["Low", "Open", "High", "Edge"],
    phases: [0, 0, 0, 0],
    patterns: relayRows(
      [0, 1, 2, 3, 1, 0, 2, 1, 3, 2, 0, 3, 1, 2, 3, 0],
      [1, 2, 4, 5]
    ),
    source: {
      title: "Simha Arom, African Polyphony and Polyrhythm",
      url: "https://www.cambridge.org/core/books/abs/african-polyphony-and-polyrhythm/polyrhythmics-as-a-way-to-polyphony-hocket/B5695A612A5D11FC8A97DD78D9286081",
      note: "Inspired by fixed-pitch hocket as an ensemble principle; this four-part pattern is an original miniature.",
    },
  }),
  freezePreset({
    id: "solkattu-relay",
    name: "Solkattu Relay",
    region: "South Indian counting grid",
    status: "New cross-tradition experiment",
    description:
      "Ta-ka-di-mi marks a four-subdivision counting grid while four new voices relay the pulses. It is not presented as a traditional Indian hocket.",
    length: 16,
    pulsesPerBeat: 4,
    tempoBpm: 104,
    swing: 0,
    voiceCount: 4,
    names: ["Ta", "Ka", "Di", "Mi"],
    phases: [0, 0, 0, 0],
    patterns: relayRows(
      [0, 1, 2, 3, 0, 2, 1, 3, 0, 1, 3, 2, 3, 2, 1, 0],
      [1, 2, 3, 4]
    ),
    source: {
      title: "David P. Nelson, Solkattu Manual",
      url: "https://www.weslpress.org/9780819575234/solkattu-manual/",
      note: "The subdivision syllables provide a counting grid only; the hocket pattern is newly composed.",
    },
  }),
  freezePreset({
    id: "open-weave",
    name: "Open Weave",
    region: "Hocket Luigi",
    status: "Original composition",
    description:
      "A deliberately porous three-part braid with both silences and collisions for free editing.",
    length: 12,
    pulsesPerBeat: 3,
    tempoBpm: 96,
    swing: 0.08,
    voiceCount: 3,
    names: ["Rose", "Gold", "Aqua"],
    phases: [0, 0, 0],
    patterns: [
      [1, 0, 0, 2, 0, 0, 3, 0, 0, 2, 0, 0],
      [0, 2, 0, 0, 0, 3, 0, 2, 0, 0, 4, 0],
      [0, 0, 4, 4, 0, 0, 0, 0, 5, 0, 0, 3],
    ],
    source: {
      title: "Hocket Luigi original",
      url: "./HOCKET_LOOM_RESEARCH.md",
      note: "A new pattern included to expose gaps and overlaps as compositional material.",
    },
  }),
]);

export const HOCKET_PRESET_BY_ID = Object.freeze(
  Object.fromEntries(HOCKET_PRESETS.map((preset) => [preset.id, preset]))
);

export function presetForHocket(id) {
  return HOCKET_PRESET_BY_ID[id] || HOCKET_PRESETS[0];
}

export function sanitizeHocketState(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const preset = presetForHocket(source.presetId);
  const length = closestStepLength(source.length ?? preset.length);
  const voiceCount = Math.round(clamp(source.voiceCount, 2, 4, preset.voiceCount));
  const sourcePatterns = Array.isArray(source.patterns) ? source.patterns : preset.patterns;
  const patterns = emptyRows(voiceCount, length).map((row, voice) => {
    const candidate = Array.isArray(sourcePatterns[voice]) ? sourcePatterns[voice] : [];
    return row.map((_, step) => Math.round(clamp(candidate[step], 0, 8, 0)));
  });
  const sourcePhases = Array.isArray(source.phases) ? source.phases : preset.phases;
  const sourceNames = Array.isArray(source.names) ? source.names : preset.names;

  return {
    presetId: preset.id,
    variation: Boolean(source.variation),
    voiceCount,
    length,
    pulsesPerBeat: Math.round(clamp(source.pulsesPerBeat, 2, 8, preset.pulsesPerBeat)),
    tempoBpm: clamp(
      source.tempoBpm,
      HOCKET_LIMITS.tempoBpm[0],
      HOCKET_LIMITS.tempoBpm[1],
      preset.tempoBpm
    ),
    swing: clamp(source.swing, HOCKET_LIMITS.swing[0], HOCKET_LIMITS.swing[1], preset.swing),
    pulseLengthMs: clamp(
      source.pulseLengthMs,
      HOCKET_LIMITS.pulseLengthMs[0],
      HOCKET_LIMITS.pulseLengthMs[1],
      92
    ),
    level: clamp(source.level, HOCKET_LIMITS.level[0], HOCKET_LIMITS.level[1], 0.32),
    preserveComposite: source.preserveComposite !== false,
    soundSet: ["wood", "metal", "breath"].includes(source.soundSet) ? source.soundSet : "wood",
    focusMode: ["balanced", "call-answer", "rotating"].includes(source.focusMode)
      ? source.focusMode
      : "balanced",
    patterns,
    phases: Array.from({ length: voiceCount }, (_, voice) =>
      Math.round(clamp(sourcePhases[voice], -length, length, 0))
    ),
    names: Array.from(
      { length: voiceCount },
      (_, voice) => String(sourceNames[voice] || DEFAULT_NAMES[voice]).slice(0, 24)
    ),
  };
}

export function createHocketState(presetId = HOCKET_PRESETS[0].id) {
  const preset = presetForHocket(presetId);
  return sanitizeHocketState({
    ...preset,
    presetId: preset.id,
    patterns: preset.patterns.map((row) => [...row]),
    phases: [...preset.phases],
    names: [...preset.names],
    pulseLengthMs: 92,
    level: 0.32,
    preserveComposite: true,
    soundSet: presetId === "olutalo" ? "metal" : "wood",
    focusMode: "balanced",
  });
}

const defaultHocketState = createHocketState();
defaultHocketState.patterns.forEach(Object.freeze);
Object.freeze(defaultHocketState.patterns);
Object.freeze(defaultHocketState.phases);
Object.freeze(defaultHocketState.names);
export const DEFAULT_HOCKET_STATE = Object.freeze(defaultHocketState);

function patternIndexAt(state, voice, visibleStep) {
  return mod(visibleStep - state.phases[voice], state.length);
}

export function effectiveHocketCell(stateInput, voice, visibleStep) {
  const state = sanitizeHocketState(stateInput);
  if (voice < 0 || voice >= state.voiceCount) return 0;
  return state.patterns[voice][patternIndexAt(state, voice, visibleStep)] || 0;
}

export function hocketEventsAtStep(stateInput, visibleStep) {
  const state = sanitizeHocketState(stateInput);
  return Array.from({ length: state.voiceCount }, (_, voice) => {
    const tone = state.patterns[voice][patternIndexAt(state, voice, visibleStep)] || 0;
    return tone ? { voice, tone } : null;
  }).filter(Boolean);
}

export function compositeHocketTones(stateInput) {
  const state = sanitizeHocketState(stateInput);
  return Array.from({ length: state.length }, (_, step) =>
    hocketEventsAtStep(state, step).map((event) => event.tone)
  );
}

export function analyzeHocketState(stateInput) {
  const state = sanitizeHocketState(stateInput);
  const eventsByStep = Array.from({ length: state.length }, (_, step) =>
    hocketEventsAtStep(state, step)
  );
  const gaps = eventsByStep.reduce((count, events) => count + Number(events.length === 0), 0);
  const collisions = eventsByStep.reduce(
    (count, events) => count + Math.max(0, events.length - 1),
    0
  );
  const coveredSteps = state.length - gaps;
  let handoffs = 0;
  eventsByStep.forEach((events, step) => {
    const nextEvents = eventsByStep[(step + 1) % state.length];
    if (events.length !== 1 || nextEvents.length !== 1) return;
    if (events[0].voice !== nextEvents[0].voice) handoffs += 1;
  });

  return {
    coveredSteps,
    coverage: coveredSteps / state.length,
    gaps,
    collisions,
    handoffs,
    densities: Array.from({ length: state.voiceCount }, (_, voice) =>
      eventsByStep.reduce(
        (count, events) => count + Number(events.some((event) => event.voice === voice)),
        0
      )
    ),
    eventsByStep,
  };
}

function cloneForEdit(stateInput) {
  const state = sanitizeHocketState(stateInput);
  return {
    ...state,
    variation: true,
    patterns: state.patterns.map((row) => [...row]),
    phases: [...state.phases],
    names: [...state.names],
  };
}

function setVisibleCell(state, voice, visibleStep, tone) {
  state.patterns[voice][patternIndexAt(state, voice, visibleStep)] = tone;
}

export function editHocketCell(
  stateInput,
  voiceInput,
  stepInput,
  { tool = "pulse", preserveComposite } = {}
) {
  const state = cloneForEdit(stateInput);
  const voice = Math.round(clamp(voiceInput, 0, state.voiceCount - 1, 0));
  const step = mod(Math.round(clamp(stepInput, -9999, 9999, 0)), state.length);
  const preserve =
    typeof preserveComposite === "boolean" ? preserveComposite : state.preserveComposite;
  const currentEvents = hocketEventsAtStep(state, step);
  const targetEvent = currentEvents.find((event) => event.voice === voice);

  if (tool === "rest") {
    if (!targetEvent) return state;
    if (!preserve || currentEvents.length > 1) {
      setVisibleCell(state, voice, step, 0);
      return state;
    }
    const nextVoice = mod(voice + 1, state.voiceCount);
    setVisibleCell(state, voice, step, 0);
    setVisibleCell(state, nextVoice, step, targetEvent.tone);
    return state;
  }

  const tone = targetEvent?.tone || currentEvents[0]?.tone || DEFAULT_TONES[voice];
  if (preserve) {
    currentEvents.forEach((event) => setVisibleCell(state, event.voice, step, 0));
  }
  setVisibleCell(state, voice, step, tone);
  return state;
}

export function toggleHocketCell(stateInput, voice, step, preserveComposite) {
  const current = effectiveHocketCell(stateInput, voice, step);
  return editHocketCell(stateInput, voice, step, {
    tool: current ? "rest" : "pulse",
    preserveComposite,
  });
}

export function rotateHocketPattern(stateInput, voiceInput, amountInput) {
  const state = cloneForEdit(stateInput);
  const voice = Math.round(clamp(voiceInput, 0, state.voiceCount - 1, 0));
  const amount = Math.round(clamp(amountInput, -state.length, state.length, 0));
  state.phases[voice] = mod(state.phases[voice] + amount, state.length);
  return state;
}

function resizeBoundary(index, fromLength, toLength) {
  return Math.floor((index * toLength) / fromLength + 0.5);
}

function visiblePatternRows(state) {
  return Array.from({ length: state.voiceCount }, (_, voice) =>
    Array.from({ length: state.length }, (_, step) =>
      state.patterns[voice][mod(step - state.phases[voice], state.length)] || 0
    )
  );
}

function columnHasEvent(rows, step) {
  return rows.some((row) => row[step] > 0);
}

function columnOwner(rows, step) {
  return rows.findIndex((row) => row[step] > 0);
}

function handoffRate(owners) {
  if (owners.length < 2) return 0;
  let handoffs = 0;
  for (let index = 1; index < owners.length; index += 1) {
    if (owners[index] !== owners[index - 1]) handoffs += 1;
  }
  return handoffs / (owners.length - 1);
}

function compareResizeScores(left, right) {
  if (!right) return -1;
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index] - right[index];
    if (Math.abs(difference) > 1e-9) return difference;
  }
  return 0;
}

function chooseDownsampleSteps(rows, targetLength) {
  const sourceLength = rows[0]?.length || 0;
  const bins = Array.from({ length: targetLength }, (_, targetStep) => {
    const start = resizeBoundary(targetStep, targetLength, sourceLength);
    const end = resizeBoundary(targetStep + 1, targetLength, sourceLength);
    const candidates = [];
    for (let sourceStep = start; sourceStep < end; sourceStep += 1) {
      if (columnHasEvent(rows, sourceStep)) candidates.push(sourceStep);
    }
    return { start, end, candidates: candidates.length ? candidates : [null] };
  });
  const sourceDensities = rows.map((row) => row.filter((tone) => tone > 0).length);
  const sourceCovered = Array.from(
    { length: sourceLength },
    (_, step) => Number(columnHasEvent(rows, step))
  ).reduce((sum, value) => sum + value, 0);
  const sourceOwners = Array.from({ length: sourceLength }, (_, step) =>
    columnHasEvent(rows, step) ? columnOwner(rows, step) : null
  ).filter((owner) => owner !== null);
  const sourceHandoffRate = handoffRate(sourceOwners);
  let bestSelection = null;
  let bestScore = null;
  const selection = Array(targetLength).fill(null);

  function scoreSelection() {
    const targetDensities = Array(rows.length).fill(0);
    const owners = [];
    let covered = 0;
    let centerDistance = 0;
    selection.forEach((sourceStep, targetStep) => {
      if (sourceStep === null) return;
      covered += 1;
      owners.push(columnOwner(rows, sourceStep));
      rows.forEach((row, voice) => {
        if (row[sourceStep] > 0) targetDensities[voice] += 1;
      });
      const bin = bins[targetStep];
      centerDistance += Math.abs(sourceStep - (bin.start + bin.end - 1) / 2);
    });
    const missingVoices = sourceDensities.reduce(
      (count, density, voice) => count + Number(density > 0 && targetDensities[voice] === 0),
      0
    );
    const densityError = sourceDensities.reduce((error, density, voice) => {
      const expected = sourceCovered ? (density * covered) / sourceCovered : 0;
      return error + (targetDensities[voice] - expected) ** 2;
    }, 0);
    return [
      missingVoices,
      densityError,
      Math.abs(handoffRate(owners) - sourceHandoffRate),
      centerDistance,
      ...selection.map((step) => step ?? sourceLength),
    ];
  }

  function visit(targetStep) {
    if (targetStep === targetLength) {
      const score = scoreSelection();
      if (compareResizeScores(score, bestScore) < 0) {
        bestScore = score;
        bestSelection = [...selection];
      }
      return;
    }
    for (const sourceStep of bins[targetStep].candidates) {
      selection[targetStep] = sourceStep;
      visit(targetStep + 1);
    }
  }

  visit(0);
  return bestSelection || Array(targetLength).fill(null);
}

export function resizeHocketPattern(stateInput, lengthInput) {
  const source = sanitizeHocketState(stateInput);
  const length = closestStepLength(lengthInput);
  if (length === source.length) return cloneForEdit(source);
  const visibleSource = visiblePatternRows(source);
  const visibleTarget = emptyRows(source.voiceCount, length);

  if (length > source.length) {
    for (let sourceStep = 0; sourceStep < source.length; sourceStep += 1) {
      const start = resizeBoundary(sourceStep, source.length, length);
      const end = resizeBoundary(sourceStep + 1, source.length, length);
      for (let targetStep = start; targetStep < end; targetStep += 1) {
        visibleSource.forEach((row, voice) => {
          visibleTarget[voice][targetStep] = row[sourceStep];
        });
      }
    }
  } else {
    chooseDownsampleSteps(visibleSource, length).forEach((sourceStep, targetStep) => {
      if (sourceStep === null) return;
      visibleSource.forEach((row, voice) => {
        visibleTarget[voice][targetStep] = row[sourceStep];
      });
    });
  }

  const phases = source.phases.map((phase) =>
    mod(Math.floor((mod(phase, source.length) * length) / source.length + 0.5), length)
  );
  const patterns = emptyRows(source.voiceCount, length);
  patterns.forEach((row, voice) => {
    for (let targetStep = 0; targetStep < length; targetStep += 1) {
      row[mod(targetStep - phases[voice], length)] = visibleTarget[voice][targetStep];
    }
  });

  return sanitizeHocketState({
    ...source,
    length,
    patterns,
    phases,
    variation: true,
  });
}

export function tightenHocketPattern(stateInput) {
  const state = cloneForEdit(stateInput);
  const analysis = analyzeHocketState(state);
  const gapSteps = [];
  const collisionSteps = [];
  analysis.eventsByStep.forEach((events, step) => {
    if (!events.length) gapSteps.push(step);
    if (events.length > 1) collisionSteps.push(step);
  });

  while (gapSteps.length && collisionSteps.length) {
    const gapStep = gapSteps.shift();
    const collisionStep = collisionSteps.shift();
    const events = hocketEventsAtStep(state, collisionStep);
    const moved = events[events.length - 1];
    setVisibleCell(state, moved.voice, collisionStep, 0);
    setVisibleCell(state, moved.voice, gapStep, moved.tone);
    if (events.length > 2) collisionSteps.push(collisionStep);
  }
  return state;
}

export function hocketStepDurationSeconds(stateInput, absoluteStep = 0) {
  const state = sanitizeHocketState(stateInput);
  const straight = 60 / state.tempoBpm / state.pulsesPerBeat;
  const direction = mod(Math.floor(absoluteStep), 2) === 0 ? 1 : -1;
  return straight * (1 + direction * state.swing * 0.75);
}

export function hocketFocusGain(mode, voice, absoluteStep, voiceCount = 4) {
  if (mode === "call-answer") {
    const leaderTurn = mod(Math.floor(absoluteStep / 4), 2) === 0;
    return leaderTurn === (voice === 0) ? 1.12 : 0.74;
  }
  if (mode === "rotating") {
    return mod(Math.floor(absoluteStep / 4), voiceCount) === voice ? 1.14 : 0.72;
  }
  return 1;
}

export function hocketPatternSignature(stateInput) {
  const state = sanitizeHocketState(stateInput);
  const rows = Array.from({ length: state.voiceCount }, (_, voice) =>
    Array.from(
      { length: state.length },
      (_, step) => effectiveHocketCell(state, voice, step) || "-"
    ).join("")
  );
  return rows.join("|");
}
