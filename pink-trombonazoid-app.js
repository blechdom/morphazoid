import {
  DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET,
  PINK_TROMBONAZOID_VOICE_HARMONIES,
  PINK_TROMBONAZOID_VOICE_PRESETS,
  PINK_TROMBONAZOID_PHONE_CATALOG,
  PINK_TROMBONAZOID_LANES,
  addPinkTrombonazoidKeyframe,
  compilePinkTrombonazoid,
  insertPinkTrombonazoidPhone,
  movePinkTrombonazoidPhone,
  pinkTrombonazoidAudioEvent,
  removePinkTrombonazoidKeyframe,
  removePinkTrombonazoidPhone,
  replacePinkTrombonazoidPhone,
  retimePinkTrombonazoidSequence,
  samplePinkTrombonazoidAutomation,
  samplePinkTrombonazoidLfo,
  updatePinkTrombonazoidKeyframe,
  updatePinkTrombonazoidPersonality,
  updatePinkTrombonazoidSegment,
} from "./src/pink-trombonazoid.js?v=pink-trombonazoid-20260822-12";
import {
  loadSpellingPronunciations,
} from "./src/spelling-pronunciation.js?v=pink-trombonazoid-20260821-6";
import { SpellingSynthesizerAudio } from "./src/spelling-synthesizer-audio.js?v=pink-trombonazoid-20260821-6";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const TIMELINE_MIN_WIDTH = 920;
const TIMELINE_PIXELS_PER_MS = 0.72;
const PHONE_MIN_WIDTH = 132;
const LANE_TOP = 18;
const LANE_HEIGHT = 40;
const LANE_GRAPH_HEIGHT = 27;
const TIMELINE_BOTTOM = 28;

const state = {
  sequence: null,
  pronunciations: new Map(),
  selectedSegmentId: "",
  selectedPitchBaseHz: 140,
  audioEnabled: false,
  audioStarting: false,
  playing: false,
  loop: false,
  playStartedAt: 0,
  loopRestartAt: 0,
  elapsedMs: 0,
  activeSegmentIndex: -1,
  animationFrame: 0,
  lastAudioModulationAt: 0,
  drag: null,
  draggedPhoneId: "",
  timelineZoomY: 1,
  timelineResizeFrame: 0,
  timelineViewportWidth: 0,
  buildGeneration: 0,
};

const audio = new SpellingSynthesizerAudio({
  engine: "tube",
  level: Number($("level").value),
  onFallback: ({ actual }) => {
    announce(`The physical tube was unavailable. ${actual} speech is active.`);
  },
});

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : minimum));
}

function announce(message) {
  $("liveStatus").textContent = String(message ?? "");
}

function svgElement(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  }
  return node;
}

function selectedSegment() {
  return state.sequence?.segments.find(({ id }) => id === state.selectedSegmentId)
    ?? state.sequence?.articulationSegments?.[0]
    ?? state.sequence?.segments?.[0]
    ?? null;
}

function formatDuration(milliseconds) {
  const duration = Math.max(0, Number(milliseconds) || 0);
  if (duration < 1_000) return `${Math.round(duration)} ms`;
  return `${(duration / 1_000).toFixed(duration < 10_000 ? 2 : 1)} s`;
}

function normalizedPitch(hertz) {
  return clamp(((Number(hertz) || 40) - 40) / 480);
}

function rawPitch(normalized) {
  return 40 + clamp(normalized) * 480;
}

const PHONE_CATALOG_BY_ID = new Map(
  PINK_TROMBONAZOID_PHONE_CATALOG.map((phone) => [phone.id, phone]),
);
const VOICE_PRESET_BY_ID = new Map(
  Object.values(PINK_TROMBONAZOID_VOICE_PRESETS).map((preset) => [preset.id, preset]),
);
const PHONE_MENU_GROUPS = Object.freeze([
  Object.freeze(["vowel", "Vowels"]),
  Object.freeze(["gliding-vowel", "Diphthongs + R-colored vowels"]),
  Object.freeze(["consonant", "Consonants"]),
]);
const VOICE_CONTROL_IDS = Object.freeze([
  "voiceThroats",
  "voiceHarmony",
  "voiceRegister",
  "voiceDetune",
  "voiceBody",
  "voiceTension",
  "voiceVariation",
  "voiceCoupling",
  "voiceSpread",
]);

function populatePhoneOptions(select, {
  placeholder = false,
  placeholderLabel = "Choose a phoneme",
} = {}) {
  select.replaceChildren();
  if (placeholder) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = placeholderLabel;
    select.append(option);
  }
  for (const [groupId, label] of PHONE_MENU_GROUPS) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const phone of PINK_TROMBONAZOID_PHONE_CATALOG) {
      if (phone.group !== groupId) continue;
      const option = document.createElement("option");
      option.value = phone.id;
      option.textContent = phone.label;
      group.append(option);
    }
    select.append(group);
  }
}

function populatePhoneMenu() {
  populatePhoneOptions($("selectedPhone"), { placeholder: true });
}

function populateVoiceMenus() {
  const presetSelect = $("personality");
  const presetGroups = [
    ["core", "Core voices"],
    ["register", "Register voices"],
    ["texture", "Textures"],
    ["ensemble", "Ensembles · layered throats"],
  ];
  presetSelect.replaceChildren();
  for (const [groupId, label] of presetGroups) {
    const group = document.createElement("optgroup");
    group.label = label;
    for (const preset of VOICE_PRESET_BY_ID.values()) {
      if (preset.group !== groupId) continue;
      const option = document.createElement("option");
      option.value = preset.id;
      option.textContent = `${preset.name} · ${preset.note}`;
      group.append(option);
    }
    presetSelect.append(group);
  }
  presetSelect.value = DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET;

  const harmonySelect = $("voiceHarmony");
  harmonySelect.replaceChildren();
  for (const harmony of Object.values(PINK_TROMBONAZOID_VOICE_HARMONIES)) {
    const option = document.createElement("option");
    option.value = harmony.id;
    option.textContent = harmony.name;
    harmonySelect.append(option);
  }
}

function selectedVoicePreset() {
  return VOICE_PRESET_BY_ID.get($("personality").value)
    ?? VOICE_PRESET_BY_ID.get(DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET);
}

function voiceSettings() {
  return {
    preset: selectedVoicePreset().id,
    throatCount: Number($("voiceThroats").value),
    harmony: $("voiceHarmony").value,
    registerSemitones: Number($("voiceRegister").value),
    detuneCents: Number($("voiceDetune").value),
    bodyLengthOffset: Number($("voiceBody").value),
    tensionOffset: Number($("voiceTension").value),
    mouthVariation: Number($("voiceVariation").value),
    coupling: Number($("voiceCoupling").value),
    spread: Number($("voiceSpread").value),
  };
}

function updateVoiceReadouts() {
  const signed = (value, suffix) => `${value > 0 ? "+" : ""}${value}${suffix}`;
  $("voiceThroatsOut").textContent = $("voiceThroats").value;
  $("voiceRegisterOut").textContent = signed(Number($("voiceRegister").value), " st");
  $("voiceDetuneOut").textContent = `${Math.round(Number($("voiceDetune").value))} ct`;
  $("voiceBodyOut").textContent = signed(Math.round(Number($("voiceBody").value) * 100), "%");
  $("voiceTensionOut").textContent = signed(Math.round(Number($("voiceTension").value) * 100), "%");
  $("voiceVariationOut").textContent = `${Math.round(Number($("voiceVariation").value) * 100)}%`;
  $("voiceCouplingOut").textContent = `${Math.round(Number($("voiceCoupling").value) * 100)}%`;
  $("voiceSpreadOut").textContent = `${Math.round(Number($("voiceSpread").value) * 100)}%`;
}

function setVoiceControls(settings) {
  const voice = settings ?? selectedVoicePreset().voice;
  $("voiceThroats").value = String(voice.throatCount);
  $("voiceHarmony").value = voice.harmony;
  $("voiceRegister").value = String(voice.registerSemitones);
  $("voiceDetune").value = String(voice.detuneCents);
  $("voiceBody").value = String(voice.bodyLengthOffset);
  $("voiceTension").value = String(voice.tensionOffset);
  $("voiceVariation").value = String(voice.mouthVariation);
  $("voiceCoupling").value = String(voice.coupling);
  $("voiceSpread").value = String(voice.spread);
  updateVoiceReadouts();
  updateVoiceControlAvailability();
}

function updateVoiceControlAvailability() {
  const fallback = state.audioEnabled && audio.activeEngine !== "tube";
  const throatCount = Number($("voiceThroats").value);
  const shared = $("voiceHarmony").value === "shared";
  for (const id of VOICE_CONTROL_IDS) $(id).disabled = fallback;
  if (!fallback) {
    $("voiceDetune").disabled = shared;
    for (const id of ["voiceVariation", "voiceCoupling", "voiceSpread"]) {
      $(id).disabled = throatCount <= 1;
    }
  }
  $("voiceEngineNote").textContent = fallback
    ? "Multi-throat shaping needs the physical tube. The fallback keeps the selected base voice and pronunciation."
    : "Source and resonator controls only. Ensemble presets layer the same phone across throats; they never add timeline phones. Pronunciation, tongue, lip, nose, closure, and timing remain in the timeline.";
}

function voiceDescription() {
  const voice = voiceSettings();
  const harmony = PINK_TROMBONAZOID_VOICE_HARMONIES[voice.harmony];
  const mode = voice.harmony === "shared" ? "linked" : "independently pitched";
  return `${voice.throatCount} ${mode} ${voice.throatCount === 1 ? "throat" : "throats"}, ${harmony.name.toLowerCase()}, ${voice.registerSemitones > 0 ? "+" : ""}${voice.registerSemitones} semitones`;
}

function updateAudioUi() {
  const live = state.audioEnabled && audio.running;
  $("audioButton").setAttribute("aria-pressed", String(live));
  $("audioButton").disabled = state.audioStarting;
  $("audioState").textContent = live ? "on" : "off";
  $("playButton").setAttribute("aria-pressed", String(state.playing));
  $("playLabel").textContent = state.playing ? "Stop word" : "Say word";
  $("playState").textContent = state.playing ? "speaking" : "ready";
  $("stopButton").disabled = !state.playing;
  $("loopButton").setAttribute("aria-pressed", String(state.loop));
  $("loopState").textContent = state.loop ? "on" : "off";
  updateVoiceControlAvailability();
}

async function enableAudio() {
  if (state.audioEnabled && audio.running) return true;
  if (state.audioStarting) return false;
  state.audioStarting = true;
  updateAudioUi();
  try {
    await audio.enable();
    state.audioEnabled = true;
    applyEffects();
    announce(
      audio.activeEngine === "tube"
        ? "Throatazoid tube awake."
        : `${audio.activeEngine} fallback voice awake.`,
    );
    return true;
  } catch (error) {
    state.audioEnabled = false;
    announce(error?.message ?? "Audio could not start.");
    return false;
  } finally {
    state.audioStarting = false;
    updateAudioUi();
  }
}

async function disableAudio() {
  stopPlayback({ announceStop: false });
  state.audioEnabled = false;
  await audio.disable();
  updateAudioUi();
  announce("Audio off.");
}

function timelineWidth() {
  const sequence = state.sequence;
  const rulerEntries = sequence
    ? [...sequence.phones, ...sequence.boundarySegments]
    : [];
  const requiredScale = rulerEntries.reduce((scale, entry) => {
    if (!(entry.durationMs > 0)) return scale;
    const targetWidth = entry.type === "boundary" ? 22 : PHONE_MIN_WIDTH;
    return Math.max(scale, targetWidth / entry.durationMs);
  }, TIMELINE_PIXELS_PER_MS) ?? TIMELINE_PIXELS_PER_MS;
  const timelineScroll = $("timelineScroll");
  const gutterWidth = $("laneGutter")?.getBoundingClientRect().width ?? 0;
  const availableWidth = Math.max(0, (timelineScroll?.clientWidth ?? 0) - gutterWidth);
  return Math.max(
    TIMELINE_MIN_WIDTH,
    Math.floor(availableWidth),
    Math.round((state.sequence?.durationMs ?? 1) * Math.min(2.4, requiredScale)),
  );
}

function durationHandle(segment, { edgePercent = null } = {}) {
  const handle = document.createElement("span");
  handle.className = "ptz-duration-grab";
  handle.dataset.segmentId = segment.id;
  handle.tabIndex = 0;
  handle.setAttribute("role", "slider");
  handle.setAttribute("aria-label", `Duration of ${segment.phoneLabel ?? "pause"}`);
  handle.setAttribute("aria-valuemin", segment.type === "boundary" ? "0" : "24");
  handle.setAttribute("aria-valuemax", "2400");
  handle.setAttribute("aria-valuenow", String(Math.round(segment.durationMs)));
  if (Number.isFinite(edgePercent)) {
    handle.classList.add("is-internal");
    handle.style.setProperty("--edge-position", `${edgePercent}%`);
  }
  handle.addEventListener("pointerdown", (event) => beginDurationDrag(event, segment));
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const step = event.shiftKey ? 25 : 5;
    editSegment(segment.id, {
      durationMs: segment.durationMs + (event.key === "ArrowRight" ? step : -step),
    }, {
      focus: { type: "duration", segmentId: segment.id },
    });
  });
  return handle;
}

function phoneAddSelect(afterPhone = null) {
  const shell = document.createElement("span");
  const glyph = document.createElement("span");
  const select = document.createElement("select");
  shell.className = afterPhone
    ? "ptz-phone-add-shell"
    : "ptz-phone-add-shell ptz-empty-phone-add-shell";
  glyph.className = "ptz-phone-add-glyph";
  glyph.textContent = "+";
  glyph.setAttribute("aria-hidden", "true");
  select.className = afterPhone
    ? "ptz-phone-add"
    : "ptz-phone-add ptz-empty-phone-add";
  select.dataset.afterPhoneId = afterPhone?.id ?? "";
  populatePhoneOptions(select, { placeholder: true, placeholderLabel: "+" });
  select.value = "";
  select.setAttribute(
    "aria-label",
    afterPhone
      ? `Add a phoneme after ${afterPhone.phoneLabel}`
      : "Add the first phoneme to the pronunciation timeline",
  );
  select.title = afterPhone ? `Add after ${afterPhone.phoneLabel}` : "Add first phoneme";
  select.addEventListener("pointerdown", (event) => event.stopPropagation());
  select.addEventListener("change", (event) => {
    event.stopPropagation();
    if (event.currentTarget.value) {
      insertPhone(afterPhone?.id ?? null, event.currentTarget.value);
    }
  });
  shell.append(glyph, select);
  return shell;
}

function renderPhonemeRuler() {
  const ruler = $("phonemeRuler");
  const sequence = state.sequence;
  ruler.replaceChildren();
  if (!sequence) return;
  const width = timelineWidth();
  const activeSegment = sequence.segments[state.activeSegmentIndex];
  const entries = [...sequence.phones, ...sequence.boundarySegments]
    .sort((left, right) => left.startMs - right.startMs);
  if (!sequence.phones.length) {
    const emptyAdd = document.createElement("div");
    emptyAdd.className = "ptz-empty-phone-slot";
    emptyAdd.append(phoneAddSelect());
    ruler.append(emptyAdd);
  }
  for (const entry of entries) {
    const boundary = entry.type === "boundary";
    const selectedArticulation = boundary
      ? null
      : entry.articulations.find(({ id }) => id === state.selectedSegmentId)
        ?? entry.articulations[0];
    const cell = document.createElement("div");
    cell.className = [
      "ptz-phoneme-cell",
      boundary ? "is-boundary" : "",
      entry.vowel ? "is-vowel" : "",
    ].filter(Boolean).join(" ");
    cell.dataset.segmentId = boundary ? entry.id : selectedArticulation.id;
    if (!boundary) cell.dataset.phoneId = entry.id;
    cell.style.setProperty(
      "--segment-width",
      `${Math.max(boundary ? 22 : PHONE_MIN_WIDTH, entry.durationMs / sequence.durationMs * width)}px`,
    );
    cell.classList.toggle(
      "is-selected",
      boundary
        ? entry.id === state.selectedSegmentId
        : entry.articulations.some(({ id }) => id === state.selectedSegmentId),
    );
    cell.classList.toggle(
      "is-playing",
      activeSegment?.type === "articulation"
        ? !boundary && entry.id === activeSegment.phoneId
        : boundary && entry.id === activeSegment?.id,
    );
    if (boundary) {
      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "ptz-phoneme-trigger";
      trigger.dataset.segmentId = entry.id;
      trigger.setAttribute("aria-pressed", String(entry.id === state.selectedSegmentId));
      trigger.innerHTML = `<b aria-hidden="true">·</b><small>${Math.round(entry.durationMs)} ms pause</small>`;
      trigger.setAttribute("aria-label", `${Math.round(entry.durationMs)} millisecond pause`);
      trigger.addEventListener("click", () => selectSegment(entry.id));
      cell.append(trigger);
    } else {
      const phone = PHONE_CATALOG_BY_ID.get(entry.phone);
      const shell = document.createElement("span");
      const select = document.createElement("select");
      const meta = document.createElement("small");
      const shortLabel = document.createElement("span");
      const tools = document.createElement("span");
      const moveButton = document.createElement("button");
      const addSelect = phoneAddSelect(entry);
      const removeButton = document.createElement("button");
      shell.className = "ptz-phoneme-select-shell";
      select.className = "ptz-phoneme-select ptz-inline-phone-select";
      select.dataset.segmentId = selectedArticulation.id;
      select.dataset.phoneId = entry.id;
      select.dataset.articulationIndex = String(selectedArticulation.articulationIndex);
      populatePhoneOptions(select);
      select.value = entry.phone;
      shortLabel.className = "ptz-phoneme-short";
      shortLabel.textContent = entry.phoneLabel;
      shortLabel.setAttribute("aria-hidden", "true");
      meta.className = "sr-only";
      meta.id = `${entry.id}-phone-meta`;
      meta.textContent = `${entry.articulations.map(({ articulationLabel }) => articulationLabel).join(" to ")} gesture, ${Math.round(entry.durationMs)} milliseconds`;
      tools.className = "ptz-phone-tools";
      tools.setAttribute("role", "group");
      tools.setAttribute("aria-label", `${entry.phoneLabel} phone actions`);
      moveButton.type = "button";
      moveButton.className = "ptz-phone-move";
      moveButton.dataset.phoneId = entry.id;
      moveButton.draggable = true;
      moveButton.textContent = "↔";
      moveButton.setAttribute(
        "aria-label",
        `Move ${entry.phoneLabel}; drag, or use the left and right arrow keys`,
      );
      moveButton.title = `Move ${entry.phoneLabel}`;
      removeButton.type = "button";
      removeButton.className = "ptz-phone-delete";
      removeButton.textContent = "x";
      removeButton.setAttribute("aria-label", `Remove ${entry.phoneLabel} from the pronunciation timeline`);
      removeButton.title = `Remove ${entry.phoneLabel}`;
      select.setAttribute(
        "aria-label",
        `Change pronunciation for ${entry.phoneLabel}, /${phone?.ipa ?? entry.phoneLabel}/ as in ${phone?.example ?? "this sound"}`,
      );
      select.setAttribute("aria-describedby", meta.id);
      const selectCurrentArticulation = () => {
        const current = selectedSegment();
        selectSegment(current?.phoneId === entry.id ? current.id : entry.articulations[0].id);
      };
      select.addEventListener("focus", selectCurrentArticulation);
      select.addEventListener("pointerdown", selectCurrentArticulation);
      select.addEventListener("click", (event) => event.stopPropagation());
      select.addEventListener("change", (event) => {
        event.stopPropagation();
        const current = selectedSegment();
        replacePhone(entry.id, event.currentTarget.value, {
          articulationIndex: current?.phoneId === entry.id ? current.articulationIndex : 0,
          focusOrigin: "timeline",
        });
      });
      moveButton.addEventListener("click", () => {
        selectSegment(entry.articulations[0].id);
        announce(`Move ${entry.phoneLabel} with the left and right arrow keys, or drag this handle.`);
      });
      moveButton.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
        event.preventDefault();
        const phoneIndex = state.sequence?.phones.findIndex(({ id }) => id === entry.id) ?? -1;
        movePhone(entry.id, phoneIndex + (event.key === "ArrowRight" ? 1 : -1));
      });
      moveButton.addEventListener("dragstart", (event) => beginPhoneDrag(event, entry.id));
      moveButton.addEventListener("dragend", endPhoneDrag);
      cell.addEventListener("dragover", (event) => continuePhoneDrag(event, entry.id));
      cell.addEventListener("drop", (event) => dropPhone(event, entry.id));
      cell.addEventListener("dragleave", (event) => {
        if (!cell.contains(event.relatedTarget)) cell.classList.remove("is-drop-before", "is-drop-after");
      });
      removeButton.addEventListener("pointerdown", (event) => event.stopPropagation());
      removeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        removePhone(entry.id);
      });
      shell.append(select, shortLabel);
      tools.append(moveButton, addSelect, removeButton);
      cell.append(tools, shell, meta);
    }
    const articulations = boundary ? [entry] : entry.articulations;
    articulations.forEach((segment, index) => {
      const edgePercent = !boundary && index < articulations.length - 1
        ? (segment.endMs - entry.startMs) / Math.max(1, entry.durationMs) * 100
        : null;
      cell.append(durationHandle(segment, { edgePercent }));
    });
    ruler.append(cell);
  }
}

function laneValueText(lane, value) {
  const normalized = clamp(value);
  if (lane.id === "pitch") return `${Math.round(rawPitch(normalized))} Hz`;
  if (lane.id === "lipOpening") return `${(normalized * 4).toFixed(1)} cm`;
  return `${Math.round(normalized * 100)}%`;
}

function timelineGeometry() {
  const zoomY = clamp(state.timelineZoomY, 1, 4);
  const laneHeight = LANE_HEIGHT * state.timelineZoomY;
  const graphHeight = Math.max(
    LANE_GRAPH_HEIGHT,
    laneHeight - (LANE_HEIGHT - LANE_GRAPH_HEIGHT),
  );
  return {
    zoomY,
    laneHeight,
    graphHeight,
    height: LANE_TOP + PINK_TROMBONAZOID_LANES.length * laneHeight + TIMELINE_BOTTOM,
  };
}

function lanePath(samples, laneY, plotWidth, graphHeight) {
  if (!samples.length) return "";
  return samples.map((value, index) => {
    const x = index / Math.max(1, samples.length - 1) * plotWidth;
    const y = laneY + (1 - clamp(value)) * graphHeight;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function laneKeyframes(segment, laneId) {
  return segment?.laneKeyframes?.[laneId] ?? [];
}

function keyframeTimeMs(segment, keyframe) {
  return segment.startMs + clamp(keyframe.phase) * segment.durationMs;
}

function articulationAtTime(timeMs) {
  const articulations = state.sequence?.articulationSegments ?? [];
  return articulations.find((segment) => timeMs >= segment.startMs && timeMs <= segment.endMs)
    ?? null;
}

function activeKeyframeSegment() {
  const selected = selectedSegment();
  if (selected?.type === "articulation") return selected;
  return articulationAtTime(state.elapsedMs)
    ?? state.sequence?.articulationSegments?.[0]
    ?? null;
}

function suggestedKeyframePhase(segment, laneId) {
  const phases = laneKeyframes(segment, laneId)
    .map(({ phase }) => clamp(phase))
    .sort((left, right) => left - right);
  const stops = [0, ...phases, 1];
  let largestStart = 0;
  let largestEnd = 0;
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index] - stops[index - 1] > largestEnd - largestStart) {
      largestStart = stops[index - 1];
      largestEnd = stops[index];
    }
  }
  return (largestStart + largestEnd) / 2;
}

function svgPointerPosition(event, svg = $("timelineSvg")) {
  const rect = svg.getBoundingClientRect();
  const viewBox = svg.viewBox.baseVal;
  return {
    x: (event.clientX - rect.left) / Math.max(1, rect.width) * viewBox.width,
    y: (event.clientY - rect.top) / Math.max(1, rect.height) * viewBox.height,
  };
}

function renderTimeline() {
  const sequence = state.sequence;
  const svg = $("timelineSvg");
  const gutter = $("laneGutter");
  svg.replaceChildren();
  gutter.replaceChildren();
  if (!sequence) return;

  const plotWidth = timelineWidth();
  const geometry = timelineGeometry();
  const { laneHeight, graphHeight, height } = geometry;
  svg.setAttribute("viewBox", `0 0 ${plotWidth} ${height}`);
  svg.setAttribute("width", String(plotWidth));
  svg.setAttribute("height", String(height));
  svg.style.minWidth = `${plotWidth}px`;
  gutter.style.setProperty("--timeline-height", `${height}px`);
  $("timelineScroll").style.setProperty("--timeline-height", `${height}px`);

  const title = svgElement("title", { id: "timelineSvgTitle" });
  title.textContent = `${sequence.source} Pink Trombonazoid automation`;
  const description = svgElement("desc", { id: "timelineSvgDescription" });
  description.textContent = `${PINK_TROMBONAZOID_LANES.length} editable lanes across ${sequence.articulationSegments.length} articulation segments.`;
  svg.append(title, description);

  const grid = svgElement("g", { class: "ptz-grid" });
  for (const segment of sequence.segments) {
    const x = segment.phaseStart * plotWidth;
    grid.append(svgElement("line", {
      class: "ptz-time-grid",
      x1: x,
      x2: x,
      y1: 0,
      y2: height - TIMELINE_BOTTOM,
    }));
  }
  svg.append(grid);

  PINK_TROMBONAZOID_LANES.forEach((lane, laneIndex) => {
    const laneY = LANE_TOP + laneIndex * laneHeight;
    const label = document.createElement("div");
    const dot = document.createElement("i");
    const name = document.createElement("b");
    const output = document.createElement("output");
    const addButton = document.createElement("button");
    label.className = "ptz-lane-label";
    label.style.setProperty("--lane-top", `${laneY - 7}px`);
    label.style.setProperty("--lane-height", `${laneHeight}px`);
    label.style.setProperty("--lane-color", lane.color);
    dot.setAttribute("aria-hidden", "true");
    name.textContent = lane.shortLabel;
    output.dataset.laneOutput = lane.id;
    output.textContent = "—";
    addButton.type = "button";
    addButton.className = "ptz-lane-key-add";
    addButton.textContent = "+";
    addButton.title = `Add a ${lane.label.toLowerCase()} keyframe`;
    addButton.setAttribute("aria-label", `Add ${lane.label} keyframe in the selected phoneme`);
    addButton.addEventListener("click", () => {
      const segment = activeKeyframeSegment();
      if (!segment) return;
      addKeyframe(segment.id, lane.id, {
        phase: suggestedKeyframePhase(segment, lane.id),
      });
    });
    label.append(dot, name, output, addButton);
    gutter.append(label);

    const group = svgElement("g", {
      class: "ptz-lane",
      "data-lane": lane.id,
      style: `--lane-color:${lane.color}`,
    });
    group.append(
      svgElement("rect", {
        class: `ptz-lane-background${laneIndex % 2 ? " is-even" : ""}`,
        x: 0,
        y: laneY - 7,
        width: plotWidth,
        height: laneHeight,
      }),
      svgElement("line", {
        class: "ptz-lane-midline",
        x1: 0,
        x2: plotWidth,
        y1: laneY + graphHeight / 2,
        y2: laneY + graphHeight / 2,
      }),
      svgElement("path", {
        class: "ptz-lane-curve",
        d: lanePath(sequence.automation[lane.id].samples, laneY, plotWidth, graphHeight),
      }),
    );

    sequence.articulationSegments.forEach((segment) => {
      const keys = laneKeyframes(segment, lane.id);
      keys.forEach((keyframe, keyframeIndex) => {
        const timeMs = keyframeTimeMs(segment, keyframe);
        const x = timeMs / Math.max(1, sequence.durationMs) * plotWidth;
        const value = clamp(keyframe.value);
        const y = laneY + (1 - value) * graphHeight;
        const key = svgElement("g", {
          class: [
            "ptz-keyframe",
            segment.id === state.selectedSegmentId ? "is-selected" : "",
            state.drag?.keyframeId === keyframe.id ? "is-dragging" : "",
          ].filter(Boolean).join(" "),
          "data-keyframe-id": keyframe.id,
          "data-segment-id": segment.id,
          "data-lane": lane.id,
          tabindex: 0,
          role: "slider",
          "aria-label": `${lane.label} keyframe ${keyframeIndex + 1} of ${keys.length} for ${segment.phoneLabel}`,
          "aria-valuemin": 0,
          "aria-valuemax": 1,
          "aria-valuenow": value.toFixed(3),
          "aria-valuetext": `${laneValueText(lane, value)} at ${Math.round(keyframe.phase * 100)}% of ${segment.phoneLabel}`,
        });
        key.append(
          svgElement("circle", { class: "ptz-keyframe-hit", cx: x, cy: y, r: 10 }),
          svgElement("rect", {
            class: "ptz-keyframe-mark",
            x: x - 3.4,
            y: y - 3.4,
            width: 6.8,
            height: 6.8,
            transform: `rotate(45 ${x} ${y})`,
          }),
        );
        key.addEventListener("pointerdown", (event) => (
          beginLaneDrag(event, lane, segment, keyframe, laneY, graphHeight)
        ));
        key.addEventListener("click", () => selectSegment(segment.id));
        key.addEventListener("keydown", (event) => {
          const vertical = ["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key);
          const horizontal = ["ArrowLeft", "ArrowRight"].includes(event.key);
          const removing = ["Delete", "Backspace"].includes(event.key);
          if (!vertical && !horizontal && !removing) return;
          event.preventDefault();
          if (removing) {
            removeKeyframe(segment.id, lane.id, keyframe.id);
            return;
          }
          const patch = {};
          if (horizontal) {
            const stepMs = event.shiftKey ? 25 : 5;
            patch.timeMs = timeMs + (event.key === "ArrowRight" ? stepMs : -stepMs);
          } else if (event.key === "Home" || event.key === "End") {
            patch.value = event.key === "Home" ? 1 : 0;
          } else {
            const amount = event.shiftKey ? 0.1 : 0.02;
            patch.value = value + (event.key === "ArrowUp" ? amount : -amount);
          }
          editKeyframe(segment.id, lane.id, keyframe.id, patch, { focus: true });
        });
        group.append(key);
      });
    });
    group.addEventListener("dblclick", (event) => {
      if (event.target.closest?.(".ptz-keyframe")) return;
      const point = svgPointerPosition(event, svg);
      const timeMs = clamp(point.x / Math.max(1, plotWidth)) * sequence.durationMs;
      const segment = articulationAtTime(timeMs);
      if (!segment) {
        announce("Choose a sounding phoneme lane, not a pause, to add a keyframe.");
        return;
      }
      event.preventDefault();
      addKeyframe(segment.id, lane.id, {
        timeMs,
        value: 1 - (point.y - laneY) / graphHeight,
      });
    });
    svg.append(group);
  });

  const playhead = svgElement("line", {
    class: "ptz-playhead",
    id: "timelinePlayhead",
    x1: 0,
    x2: 0,
    y1: 0,
    y2: height - TIMELINE_BOTTOM + 4,
  });
  const cap = svgElement("path", {
    class: "ptz-playhead-cap",
    id: "timelinePlayheadCap",
    d: "M0 0 L8 0 L4 6 Z",
  });
  svg.append(playhead, cap);
}

function renderAll({ preserveSelection = true } = {}) {
  const sequence = state.sequence;
  if (!sequence) return;
  if (!preserveSelection || !sequence.segments.some(({ id }) => id === state.selectedSegmentId)) {
    state.selectedSegmentId = sequence.articulationSegments[0]?.id ?? sequence.segments[0]?.id ?? "";
  }
  renderPhonemeRuler();
  renderTimeline();
  updateSelectedEditor();
  updatePlayhead(state.elapsedMs);
}

function selectSegment(id) {
  const segment = state.sequence?.segments.find((candidate) => candidate.id === id);
  if (!segment) return;
  state.selectedSegmentId = segment.id;
  state.selectedPitchBaseHz = segment.performance?.exciterPitch ?? 140;
  document.querySelectorAll(".ptz-phoneme-cell").forEach((cell) => {
    cell.classList.toggle(
      "is-selected",
      segment.type === "articulation"
        ? cell.dataset.phoneId === segment.phoneId
        : cell.dataset.segmentId === id,
    );
  });
  document.querySelectorAll(".ptz-phoneme-trigger").forEach((trigger) => {
    trigger.setAttribute("aria-pressed", String(trigger.dataset.segmentId === id));
  });
  updateSelectedEditor();
  document.querySelectorAll(".ptz-keyframe").forEach((key) => {
    key.classList.toggle("is-selected", key.dataset.segmentId === id);
  });
}

function updateSelectedEditor() {
  const segment = selectedSegment();
  if (!segment) {
    $("selectedTitle").textContent = "No phone selected";
    $("selectedTimeOut").textContent = "—";
    $("selectedPhone").value = "";
    $("selectedPhone").disabled = true;
    $("selectedPhoneKind").textContent = "timeline is empty";
    $("selectedPhoneHelp").textContent = "Build another word or choose a word preset to restore pronunciation phones.";
    for (const id of ["segmentDuration", "segmentPitch", "segmentIntensity", "segmentBreath"]) {
      $(id).disabled = true;
    }
    return;
  }
  const articulation = segment.type === "articulation";
  const phone = articulation ? PHONE_CATALOG_BY_ID.get(segment.phone) : null;
  $("selectedTitle").textContent = articulation
    ? `${segment.phoneLabel} · ${segment.manner}`
    : "Pause · boundary";
  $("selectedTimeOut").textContent = formatDuration(segment.durationMs);
  $("segmentDuration").min = articulation ? "24" : "0";
  $("segmentDuration").value = String(segment.durationMs);
  $("segmentDurationOut").textContent = formatDuration(segment.durationMs);
  for (const id of ["segmentPitch", "segmentIntensity", "segmentBreath"]) $(id).disabled = !articulation;
  $("selectedPhone").disabled = !phone;
  $("selectedPhone").value = phone?.id ?? "";
  $("selectedPhoneKind").textContent = phone?.gliding
    ? "two-gesture vowel"
    : phone?.vowel
      ? "vowel phoneme"
      : phone
        ? `${segment.manner} consonant`
        : "select a phone block";
  $("selectedPhoneHelp").textContent = phone
    ? phone.gliding
      ? `${phone.id} is one phoneme rendered as ${phone.gestures.join(" → ")}. Changing it keeps the phone's total time.`
      : `Choose another phoneme for this whole phone. Timing and expressive edits are preserved.`
    : "Choose a phone block in the pronunciation timeline before changing its sound.";
  updateLaneReadouts(segment.startMs + segment.durationMs * 0.5);
  if (!articulation) return;
  state.selectedPitchBaseHz = segment.performance?.exciterPitch ?? rawPitch(segment.laneValues.pitch);
  $("segmentPitch").value = "0";
  $("segmentPitchOut").textContent = "0 st";
  $("segmentIntensity").value = String(segment.laneValues.intensity);
  $("segmentIntensityOut").textContent = `${Math.round(segment.laneValues.intensity * 100)}%`;
  $("segmentBreath").value = String(segment.laneValues.breath);
  $("segmentBreathOut").textContent = `${Math.round(segment.laneValues.breath * 100)}%`;
}

function playbackSegmentIndex(elapsedMs = state.elapsedMs) {
  const segments = state.sequence?.segments ?? [];
  const index = segments.findIndex(({ startMs, endMs }) => (
    elapsedMs >= startMs && elapsedMs < endMs
  ));
  return index >= 0 ? index : Math.max(-1, segments.length - 1);
}

function keepPlaybackAfterEdit(elapsedMs = state.elapsedMs, { rearticulate = false } = {}) {
  if (!state.playing) return;
  if (!state.sequence?.segments.length) {
    stopPlayback({ announceStop: false });
    return;
  }
  state.elapsedMs = clamp(elapsedMs, 0, Math.max(0, state.sequence.durationMs - 1));
  if (!state.loopRestartAt) state.playStartedAt = performance.now() - state.elapsedMs;
  state.activeSegmentIndex = state.loopRestartAt || rearticulate
    ? -1
    : playbackSegmentIndex(state.elapsedMs);
  updateAudioUi();
}

function editSegment(id, patch, { focus = null } = {}) {
  if (!state.sequence) return;
  const elapsedMs = state.elapsedMs;
  state.sequence = updatePinkTrombonazoidSegment(state.sequence, id, patch);
  renderAll();
  keepPlaybackAfterEdit(elapsedMs);
  if (state.drag?.type === "lane") state.drag.svg = $("timelineSvg");
  if (focus?.type === "duration") {
    [...document.querySelectorAll(".ptz-duration-grab")]
      .find((handle) => handle.dataset.segmentId === focus.segmentId)
      ?.focus();
  } else if (focus?.type === "lane") {
    [...document.querySelectorAll(".ptz-keyframe")]
      .find((key) => (
        key.dataset.segmentId === focus.segmentId && key.dataset.lane === focus.laneId
      ))
      ?.focus();
  }
}

function focusKeyframe(segmentId, laneId, keyframeId) {
  if (!keyframeId) return;
  [...document.querySelectorAll(".ptz-keyframe")]
    .find((key) => (
      key.dataset.segmentId === segmentId
        && key.dataset.lane === laneId
        && key.dataset.keyframeId === keyframeId
    ))
    ?.focus({ preventScroll: true });
}

function addKeyframe(segmentId, laneId, request = {}) {
  if (!state.sequence) return;
  const segment = state.sequence.segments.find(({ id }) => id === segmentId);
  if (!segment || segment.type !== "articulation") return;
  const previousIds = new Set(laneKeyframes(segment, laneId).map(({ id }) => id));
  const elapsedMs = state.elapsedMs;
  const scroller = $("timelineScroll");
  const scrollLeft = scroller.scrollLeft;
  const scrollTop = scroller.scrollTop;
  const next = addPinkTrombonazoidKeyframe(
    state.sequence,
    segmentId,
    laneId,
    request,
  );
  if (next === state.sequence) return;
  state.sequence = next;
  state.selectedSegmentId = segmentId;
  const changedSegment = next.segments.find(({ id }) => id === segmentId);
  const added = laneKeyframes(changedSegment, laneId)
    .find(({ id }) => !previousIds.has(id));
  renderAll();
  keepPlaybackAfterEdit(elapsedMs);
  scroller.scrollLeft = scrollLeft;
  scroller.scrollTop = scrollTop;
  $("phonemeRuler").scrollLeft = scrollLeft;
  focusKeyframe(segmentId, laneId, added?.id);
  announce(`Keyframe added${state.playing ? ". Playback continues." : "."}`);
}

function editKeyframe(segmentId, laneId, keyframeId, patch, { focus = false } = {}) {
  if (!state.sequence) return;
  const elapsedMs = state.elapsedMs;
  const scroller = $("timelineScroll");
  const scrollLeft = scroller.scrollLeft;
  const scrollTop = scroller.scrollTop;
  const next = updatePinkTrombonazoidKeyframe(
    state.sequence,
    segmentId,
    laneId,
    keyframeId,
    patch,
  );
  if (next === state.sequence) return;
  state.sequence = next;
  state.selectedSegmentId = segmentId;
  renderAll();
  keepPlaybackAfterEdit(elapsedMs);
  scroller.scrollLeft = scrollLeft;
  scroller.scrollTop = scrollTop;
  $("phonemeRuler").scrollLeft = scrollLeft;
  if (state.drag?.type === "lane") {
    state.drag.svg = $("timelineSvg");
    [...document.querySelectorAll(".ptz-keyframe")]
      .find((key) => (
        key.dataset.segmentId === segmentId
          && key.dataset.lane === laneId
          && key.dataset.keyframeId === keyframeId
      ))
      ?.classList.add("is-dragging");
  }
  if (focus) focusKeyframe(segmentId, laneId, keyframeId);
}

function removeKeyframe(segmentId, laneId, keyframeId) {
  if (!state.sequence) return;
  const segment = state.sequence.segments.find(({ id }) => id === segmentId);
  const keys = laneKeyframes(segment, laneId);
  const removedIndex = keys.findIndex(({ id }) => id === keyframeId);
  if (removedIndex < 0) return;
  const elapsedMs = state.elapsedMs;
  const next = removePinkTrombonazoidKeyframe(
    state.sequence,
    segmentId,
    laneId,
    keyframeId,
  );
  if (next === state.sequence) {
    announce("Each phoneme lane keeps at least one keyframe.");
    return;
  }
  state.sequence = next;
  state.selectedSegmentId = segmentId;
  const changedSegment = next.segments.find(({ id }) => id === segmentId);
  const remaining = laneKeyframes(changedSegment, laneId);
  const focusId = remaining[Math.min(removedIndex, remaining.length - 1)]?.id;
  renderAll();
  keepPlaybackAfterEdit(elapsedMs);
  focusKeyframe(segmentId, laneId, focusId);
  announce(`Keyframe removed${state.playing ? ". Playback continues." : "."}`);
}

function replacePhone(phoneId, replacementId, {
  articulationIndex = 0,
  focusOrigin = "side",
} = {}) {
  const replacement = PHONE_CATALOG_BY_ID.get(String(replacementId ?? ""));
  if (!state.sequence || !replacement) return;
  const previousPhone = state.sequence.phones.find(({ id }) => id === phoneId);
  if (!previousPhone || previousPhone.phone === replacement.id) return;
  const wasPlaying = state.playing;
  const elapsedMs = state.elapsedMs;
  const rulerScrollLeft = $("phonemeRuler").scrollLeft;
  const timelineScrollLeft = $("timelineScroll").scrollLeft;
  const previousId = previousPhone.phone;
  const previousDurationMs = previousPhone.durationMs;
  const next = replacePinkTrombonazoidPhone(
    state.sequence,
    previousPhone.id,
    replacement.id,
  );
  if (next === state.sequence) return;
  state.sequence = next;
  const nextPhone = next.phones.find(({ id }) => id === previousPhone.id);
  const nextArticulationIndex = Math.min(
    Math.max(0, Math.round(Number(articulationIndex) || 0)),
    Math.max(0, (nextPhone?.articulations?.length ?? 1) - 1),
  );
  state.selectedSegmentId = nextPhone?.articulations?.[nextArticulationIndex]?.id
    ?? next.articulationSegments[0]?.id
    ?? "";
  state.elapsedMs = wasPlaying ? elapsedMs : 0;
  renderAll();
  keepPlaybackAfterEdit(state.elapsedMs);
  $("phonemeRuler").scrollLeft = rulerScrollLeft;
  $("timelineScroll").scrollLeft = timelineScrollLeft;
  if (focusOrigin === "timeline") {
    const inlineSelects = [...document.querySelectorAll(".ptz-inline-phone-select")]
      .filter((select) => select.dataset.phoneId === previousPhone.id);
    const focusTarget = inlineSelects.find(
      (select) => Number(select.dataset.articulationIndex) === nextArticulationIndex,
    ) ?? inlineSelects[0];
    focusTarget?.focus({ preventScroll: true });
  } else {
    $("selectedPhone").focus({ preventScroll: true });
  }
  const timingPreserved = Math.abs((nextPhone?.durationMs ?? 0) - previousDurationMs) < 0.01;
  announce(
    `${previousId} changed to ${replacement.id}, /${replacement.ipa}/ as in ${replacement.example}. `
      + `${replacement.gliding ? "It moves through two tract gestures. " : ""}`
      + `${timingPreserved ? "Phone timing preserved." : "The phone was lengthened to fit both gestures."}`
      + `${wasPlaying ? ` ${state.loop ? "Loop" : "Playback"} continues.` : ""}`,
  );
}

function replaceSelectedPhone(replacementId) {
  const segment = selectedSegment();
  if (!segment || segment.type !== "articulation") return;
  replacePhone(segment.phoneId, replacementId, {
    articulationIndex: segment.articulationIndex,
    focusOrigin: "side",
  });
}

function insertPhone(afterPhoneId, insertedId) {
  if (!state.sequence || !PHONE_CATALOG_BY_ID.has(String(insertedId ?? ""))) return;
  const wasPlaying = state.playing;
  const elapsedMs = state.elapsedMs;
  const previousPhones = state.sequence.phones;
  const anchorIndex = afterPhoneId
    ? previousPhones.findIndex(({ id }) => id === afterPhoneId)
    : -1;
  const insertionIndex = anchorIndex >= 0 ? anchorIndex + 1 : 0;
  const insertionMs = anchorIndex >= 0 ? previousPhones[anchorIndex].endMs : 0;
  const rulerScrollLeft = $("phonemeRuler").scrollLeft;
  const timelineScrollLeft = $("timelineScroll").scrollLeft;
  const next = insertPinkTrombonazoidPhone(
    state.sequence,
    afterPhoneId,
    insertedId,
  );
  if (next === state.sequence) return;
  state.sequence = next;
  const inserted = next.phones[insertionIndex];
  state.selectedSegmentId = inserted?.articulations?.[0]?.id
    ?? next.articulationSegments[0]?.id
    ?? "";
  const mappedElapsed = wasPlaying && elapsedMs >= insertionMs
    ? elapsedMs + (inserted?.durationMs ?? 0)
    : elapsedMs;
  state.elapsedMs = wasPlaying ? mappedElapsed : 0;
  renderAll();
  keepPlaybackAfterEdit(state.elapsedMs);
  $("phonemeRuler").scrollLeft = rulerScrollLeft;
  $("timelineScroll").scrollLeft = timelineScrollLeft;
  [...document.querySelectorAll(".ptz-inline-phone-select")]
    .find((select) => select.dataset.phoneId === inserted?.id)
    ?.focus({ preventScroll: true });
  announce(
    `${insertedId} added to the pronunciation timeline.`
      + `${wasPlaying ? ` ${state.loop ? "Loop" : "Playback"} continues.` : ""}`,
  );
}

function movePhone(phoneId, targetIndex) {
  if (!state.sequence) return;
  const sourceIndex = state.sequence.phones.findIndex(({ id }) => id === phoneId);
  const destination = Math.round(clamp(targetIndex, 0, state.sequence.phones.length - 1));
  const source = state.sequence.phones[sourceIndex];
  const destinationPhone = state.sequence.phones[destination];
  if (!source || !destinationPhone || sourceIndex === destination) return;
  if (source.wordIndex !== destinationPhone.wordIndex) {
    announce("Phones can move within a word; pauses and word boundaries stay fixed.");
    return;
  }
  const wasPlaying = state.playing;
  const elapsedMs = state.elapsedMs;
  const rulerScrollLeft = $("phonemeRuler").scrollLeft;
  const timelineScrollLeft = $("timelineScroll").scrollLeft;
  const next = movePinkTrombonazoidPhone(state.sequence, phoneId, destination);
  if (next === state.sequence) return;
  state.sequence = next;
  const moved = next.phones[destination];
  state.selectedSegmentId = moved?.articulations?.[0]?.id
    ?? next.articulationSegments[0]?.id
    ?? "";
  state.elapsedMs = wasPlaying ? elapsedMs : 0;
  renderAll();
  keepPlaybackAfterEdit(state.elapsedMs, { rearticulate: true });
  $("phonemeRuler").scrollLeft = rulerScrollLeft;
  $("timelineScroll").scrollLeft = timelineScrollLeft;
  [...document.querySelectorAll(".ptz-phone-move")]
    .find((button) => button.dataset.phoneId === moved?.id)
    ?.focus({ preventScroll: true });
  announce(
    `${source.phoneLabel} moved to position ${destination + 1}.`
      + `${wasPlaying ? ` ${state.loop ? "Loop" : "Playback"} continues.` : ""}`,
  );
}

function clearPhoneDropTargets() {
  document.querySelectorAll(".ptz-phoneme-cell").forEach((cell) => {
    cell.classList.remove("is-phone-dragging", "is-drop-before", "is-drop-after");
    delete cell.dataset.dropPosition;
  });
}

function beginPhoneDrag(event, phoneId) {
  const source = state.sequence?.phones.find(({ id }) => id === phoneId);
  if (!source) return;
  state.draggedPhoneId = source.id;
  selectSegment(source.articulations[0].id);
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", source.id);
  }
  requestAnimationFrame(() => {
    document.querySelector(`.ptz-phoneme-cell[data-phone-id="${source.id}"]`)
      ?.classList.add("is-phone-dragging");
  });
}

function continuePhoneDrag(event, targetPhoneId) {
  const source = state.sequence?.phones.find(({ id }) => id === state.draggedPhoneId);
  const target = state.sequence?.phones.find(({ id }) => id === targetPhoneId);
  if (!source || !target || source.wordIndex !== target.wordIndex) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  const cell = event.currentTarget;
  const before = event.clientX < cell.getBoundingClientRect().left + cell.clientWidth / 2;
  document.querySelectorAll(".ptz-phoneme-cell").forEach((candidate) => {
    if (candidate !== cell) candidate.classList.remove("is-drop-before", "is-drop-after");
  });
  cell.classList.toggle("is-drop-before", before);
  cell.classList.toggle("is-drop-after", !before);
  cell.dataset.dropPosition = before ? "before" : "after";
}

function dropPhone(event, targetPhoneId) {
  event.preventDefault();
  const sourceIndex = state.sequence?.phones.findIndex(({ id }) => id === state.draggedPhoneId) ?? -1;
  const targetIndex = state.sequence?.phones.findIndex(({ id }) => id === targetPhoneId) ?? -1;
  const after = event.currentTarget.dataset.dropPosition === "after";
  const destination = state.draggedPhoneId === targetPhoneId
    ? sourceIndex
    : targetIndex + (after ? 1 : 0) - (sourceIndex < targetIndex ? 1 : 0);
  const sourceId = state.draggedPhoneId;
  endPhoneDrag();
  if (sourceIndex >= 0 && targetIndex >= 0) movePhone(sourceId, destination);
}

function endPhoneDrag() {
  state.draggedPhoneId = "";
  clearPhoneDropTargets();
}

function removePhone(phoneId) {
  if (!state.sequence) return;
  const target = state.sequence.phones.find(({ id }) => id === phoneId);
  if (!target) return;
  const wasPlaying = state.playing;
  const rulerScrollLeft = $("phonemeRuler").scrollLeft;
  const timelineScrollLeft = $("timelineScroll").scrollLeft;
  const targetIndex = state.sequence.segments.findIndex(({ phoneId: id }) => id === phoneId);
  let elapsedMs = state.elapsedMs;
  if (elapsedMs >= target.endMs) elapsedMs -= target.durationMs;
  else if (elapsedMs > target.startMs) elapsedMs = target.startMs;
  const next = removePinkTrombonazoidPhone(state.sequence, phoneId);
  if (next === state.sequence) return;
  state.sequence = next;
  const nextSelected = next.segments[Math.min(Math.max(0, targetIndex), next.segments.length - 1)]
    ?? next.segments.at(-1)
    ?? null;
  state.selectedSegmentId = nextSelected?.id ?? "";
  state.elapsedMs = wasPlaying ? elapsedMs : 0;
  renderAll();
  keepPlaybackAfterEdit(state.elapsedMs, { rearticulate: true });
  $("phonemeRuler").scrollLeft = rulerScrollLeft;
  $("timelineScroll").scrollLeft = timelineScrollLeft;
  const selected = selectedSegment();
  const focusTarget = selected?.type === "articulation"
    ? [...document.querySelectorAll(".ptz-inline-phone-select")]
      .find((select) => select.dataset.phoneId === selected.phoneId)
    : document.querySelector(`.ptz-phoneme-trigger[data-segment-id="${selected?.id ?? ""}"]`);
  (focusTarget ?? $("wordInput")).focus({ preventScroll: true });
  announce(
    `${target.phone} removed. Timeline shortened by ${Math.round(target.durationMs)} milliseconds.`
      + `${wasPlaying ? ` ${state.loop ? "Loop" : "Playback"} continues.` : ""}`,
  );
}

function beginDurationDrag(event, segment) {
  event.preventDefault();
  event.stopPropagation();
  selectSegment(segment.id);
  state.drag = {
    type: "duration",
    pointerId: event.pointerId,
    startX: event.clientX,
    startDuration: segment.durationMs,
  };
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function beginLaneDrag(event, lane, segment, keyframe, laneY, graphHeight) {
  event.preventDefault();
  event.stopPropagation();
  selectSegment(segment.id);
  state.drag = {
    type: "lane",
    pointerId: event.pointerId,
    laneId: lane.id,
    laneY,
    graphHeight,
    segmentId: segment.id,
    keyframeId: keyframe.id,
    svg: $("timelineSvg"),
  };
  event.currentTarget.classList.add("is-dragging");
  event.currentTarget.setPointerCapture?.(event.pointerId);
}

function continueDrag(event) {
  if (!state.drag || event.pointerId !== state.drag.pointerId) return;
  if (state.drag.type === "duration") {
    const scale = timelineWidth() / Math.max(1, state.sequence.durationMs);
    editSegment(state.selectedSegmentId, {
      durationMs: state.drag.startDuration + (event.clientX - state.drag.startX) / scale,
    });
    return;
  }
  event.preventDefault();
  const point = svgPointerPosition(event, state.drag.svg);
  const viewBox = state.drag.svg.viewBox.baseVal;
  const timeMs = clamp(point.x / Math.max(1, viewBox.width)) * state.sequence.durationMs;
  const value = 1 - (point.y - state.drag.laneY) / state.drag.graphHeight;
  editKeyframe(
    state.drag.segmentId,
    state.drag.laneId,
    state.drag.keyframeId,
    { timeMs, value },
  );
}

function endDrag(event) {
  if (!state.drag || (event.pointerId !== undefined && event.pointerId !== state.drag.pointerId)) return;
  state.drag = null;
  document.querySelectorAll(".ptz-keyframe.is-dragging").forEach((key) => key.classList.remove("is-dragging"));
}

function sequenceSettings() {
  return {
    pronunciations: state.pronunciations,
    personality: selectedVoicePreset().personality,
    speechRate: Number($("speechRate").value),
    sampleCount: 160,
  };
}

async function buildWord(value = $("wordInput").value, { announceBuild = true } = {}) {
  const generation = ++state.buildGeneration;
  const text = String(value ?? "").trim().slice(0, 64) || "hello";
  stopPlayback({ announceStop: false });
  $("wordInput").value = text;
  $("pronunciationStatus").textContent = "Looking up phones in the local dictionary…";
  $("buildWordButton").disabled = true;
  try {
    const pronunciations = await loadSpellingPronunciations(text);
    if (generation !== state.buildGeneration) return;
    state.pronunciations = pronunciations;
    state.sequence = compilePinkTrombonazoid(text, sequenceSettings());
    state.elapsedMs = 0;
    renderAll({ preserveSelection: false });
    $("pronunciationStatus").textContent = "Pronunciation ready.";
    if (announceBuild) {
      announce(`${text}: ${state.sequence.phones.map(({ phone }) => phone).join(" ")}.`);
    }
  } catch (error) {
    if (generation !== state.buildGeneration) return;
    $("pronunciationStatus").textContent = "Dictionary unavailable · using local spelling rules";
    state.sequence = compilePinkTrombonazoid(text, sequenceSettings());
    renderAll({ preserveSelection: false });
    announce(error?.message ?? "Fallback pronunciation built.");
  } finally {
    if (generation === state.buildGeneration) $("buildWordButton").disabled = false;
  }
}

function applyEffects() {
  const bypass = $("effectsBypass").getAttribute("aria-pressed") === "true";
  audio.setEffects({
    drive: bypass ? 0 : Number($("drive").value),
    tone: bypass ? 1 : Number($("tone").value),
    echo: bypass ? 0 : Number($("echo").value),
    delayMs: Number($("echoTime").value),
    feedback: bypass ? 0 : 0.28,
  });
}

function activateSegment(index, elapsedSeconds) {
  const segment = state.sequence?.segments[index];
  state.activeSegmentIndex = index;
  document.querySelectorAll(".ptz-phoneme-cell").forEach((cell) => {
    cell.classList.toggle(
      "is-playing",
      segment?.type === "articulation"
        ? cell.dataset.phoneId === segment.phoneId
        : cell.dataset.segmentId === segment?.id,
    );
  });
  if (!segment || segment.type === "boundary") {
    audio.release({ releaseMs: Math.min(80, segment?.durationMs ?? 55) });
    return;
  }
  let event = pinkTrombonazoidAudioEvent(segment, {
    elapsedSeconds,
    laneValues: automationLaneValuesAt(elapsedSeconds * 1_000),
    voice: voiceSettings(),
  });
  const phone = state.sequence?.phones.find(({ id }) => id === segment.phoneId);
  if (audio.activeEngine !== "tube") {
    if (segment.articulationIndex > 0) return;
    if (phone) {
      event = {
        ...event,
        dynamics: { ...event.dynamics, durationMs: phone.durationMs },
      };
    }
  } else if (segment.articulationIndex > 0) {
    // A diphthong is one phone and one acoustic envelope. Later tract
    // gestures morph the running tube instead of attacking the vowel again.
    audio.modulate({ performance: event.performance });
    return;
  } else {
    // The following timeline phone owns its own onset. Suppressing the
    // spelling engine's anticipatory carrier release prevents a short ghost
    // vowel before that explicit phone begins.
    event = {
      ...event,
      carrierPerformance: null,
      dynamics: {
        ...event.dynamics,
        durationMs: phone?.durationMs ?? event.dynamics.durationMs,
      },
    };
  }
  audio.articulate(event);
}

async function startPlayback() {
  if (!state.sequence?.segments.length) await buildWord();
  if (!(await enableAudio())) return;
  if (state.playing) {
    stopPlayback();
    return;
  }
  state.playing = true;
  state.playStartedAt = performance.now() - clamp(state.elapsedMs, 0, state.sequence.durationMs - 1);
  state.loopRestartAt = 0;
  state.activeSegmentIndex = -1;
  updateAudioUi();
  announce(`Speaking ${state.sequence.source}.`);
}

function stopPlayback({ announceStop = true, reset = true } = {}) {
  if (state.playing || state.activeSegmentIndex >= 0) audio.release({ releaseMs: 68 });
  state.playing = false;
  state.loopRestartAt = 0;
  state.activeSegmentIndex = -1;
  if (reset) state.elapsedMs = 0;
  document.querySelectorAll(".ptz-phoneme-cell.is-playing").forEach((cell) => cell.classList.remove("is-playing"));
  updatePlayhead(state.elapsedMs);
  updateAudioUi();
  if (announceStop) announce("Word stopped.");
}

function followPlayhead(x) {
  if (!state.playing || state.drag || state.draggedPhoneId) return;
  const scroller = $("timelineScroll");
  const ruler = $("phonemeRuler");
  const gutterWidth = $("laneGutter").getBoundingClientRect().width;
  const visibleWidth = Math.max(1, scroller.clientWidth - gutterWidth);
  const margin = Math.min(120, visibleWidth * 0.22);
  const current = scroller.scrollLeft;
  let next = current;
  if (x < current + margin) next = x - margin;
  else if (x > current + visibleWidth - margin) next = x - visibleWidth + margin;
  const maximum = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  next = clamp(next, 0, maximum);
  if (Math.abs(next - current) < 0.5) return;
  scroller.scrollLeft = next;
  ruler.scrollLeft = next;
}

function updatePlayhead(milliseconds) {
  const duration = Math.max(1, state.sequence?.durationMs ?? 1);
  const x = clamp(milliseconds / duration) * timelineWidth();
  const playhead = $("timelinePlayhead");
  const cap = $("timelinePlayheadCap");
  if (playhead) {
    playhead.setAttribute("x1", String(x));
    playhead.setAttribute("x2", String(x));
  }
  cap?.setAttribute("transform", `translate(${x - 4} 0)`);
  followPlayhead(x);
  const selected = selectedSegment();
  updateLaneReadouts(state.playing
    ? milliseconds
    : (selected?.startMs ?? 0) + (selected?.durationMs ?? 0) * 0.5);
}

function automationLaneValuesAt(milliseconds) {
  const sequence = state.sequence;
  if (!sequence?.durationMs) return null;
  const phase = clamp(milliseconds / sequence.durationMs);
  const values = {};
  for (const lane of PINK_TROMBONAZOID_LANES) {
    values[lane.id] = samplePinkTrombonazoidAutomation(sequence, lane.id, phase);
  }
  return values;
}

function updateLaneReadouts(milliseconds) {
  const values = automationLaneValuesAt(milliseconds);
  if (!values) return;
  for (const lane of PINK_TROMBONAZOID_LANES) {
    const value = values[lane.id];
    if (!Number.isFinite(value)) continue;
    const output = document.querySelector(`[data-lane-output="${lane.id}"]`);
    if (output) output.textContent = laneValueText(lane, value);
  }
}

function updateTransport(now) {
  if (!state.playing || !state.sequence) return;
  if (state.loopRestartAt) {
    if (now < state.loopRestartAt) return;
    state.playStartedAt = now;
    state.loopRestartAt = 0;
    state.activeSegmentIndex = -1;
  }
  state.elapsedMs = now - state.playStartedAt;
  if (state.elapsedMs >= state.sequence.durationMs) {
    audio.release({ releaseMs: 72 });
    if (state.loop) {
      state.elapsedMs = state.sequence.durationMs;
      state.loopRestartAt = now + Number($("wordGap").value);
      state.activeSegmentIndex = -1;
      document.querySelectorAll(".ptz-phoneme-cell.is-playing").forEach((cell) => cell.classList.remove("is-playing"));
      updatePlayhead(state.elapsedMs);
      return;
    }
    stopPlayback({ announceStop: false });
    announce(`${state.sequence.source} finished.`);
    return;
  }
  const index = playbackSegmentIndex(state.elapsedMs);
  if (index !== state.activeSegmentIndex) activateSegment(index, state.elapsedMs / 1_000);
  if (audio.activeEngine === "tube" && now - state.lastAudioModulationAt > 26) {
    state.lastAudioModulationAt = now;
    const pitchWave = samplePinkTrombonazoidLfo(
      $("pitchModShape").value,
      state.elapsedMs / 1_000 * Number($("pitchModRate").value),
      17,
    );
    const breathWave = samplePinkTrombonazoidLfo(
      $("breathModShape").value,
      state.elapsedMs / 1_000 * Number($("breathModRate").value),
      31,
    );
    const bypass = $("modulationBypass").getAttribute("aria-pressed") === "true";
    const segment = state.sequence.segments[index];
    if (segment?.type === "articulation") {
      const laneValues = automationLaneValuesAt(state.elapsedMs);
      const event = pinkTrombonazoidAudioEvent(segment, {
        elapsedSeconds: state.elapsedMs / 1_000,
        laneValues,
        voice: voiceSettings(),
      });
      const intensityScale = clamp(
        laneValues.intensity / Math.max(0.001, segment.laneValues.intensity),
        0,
        1.6,
      );
      const flutterDepth = bypass ? 0 : Number($("breathModDepth").value);
      audio.modulate({
        pitchCents: bypass ? 0 : pitchWave * Number($("pitchModDepth").value),
        amplitude: clamp(intensityScale * (1 + breathWave * flutterDepth * 0.5), 0, 1.6),
        breath: clamp(
          (laneValues.breath - segment.laneValues.breath) * 1.5
            + breathWave * flutterDepth,
          -1,
          1,
        ),
        performance: event?.performance,
      });
    }
  }
  updatePlayhead(state.elapsedMs);
}

function animationFrame(now) {
  updateTransport(now);
  state.animationFrame = requestAnimationFrame(animationFrame);
}

function bindRange(id, formatter, handler = null) {
  const input = $(id);
  const output = $(`${id}Out`);
  const update = () => {
    if (output) output.textContent = formatter(Number(input.value));
    handler?.(Number(input.value));
  };
  input.addEventListener("input", update);
  update();
}

function setTimelineZoomY(percent) {
  const scroller = $("timelineScroll");
  const zoom = clamp(percent, 100, 400);
  $("timelineZoomY").closest(".ptz-timeline-zoom")
    ?.style.setProperty("--zoom-progress", String((zoom - 100) / 300));
  const previousHeight = timelineGeometry().height;
  const viewportCenter = (scroller.scrollTop + scroller.clientHeight / 2)
    / Math.max(1, previousHeight);
  state.timelineZoomY = zoom / 100;
  if (!state.sequence) return;
  renderTimeline();
  updatePlayhead(state.elapsedMs);
  const nextHeight = timelineGeometry().height;
  scroller.scrollTop = Math.max(0, viewportCenter * nextHeight - scroller.clientHeight / 2);
}

$("audioButton").addEventListener("click", () => {
  if (state.audioEnabled || state.audioStarting) void disableAudio();
  else void enableAudio();
});
$("playButton").addEventListener("click", () => void startPlayback());
$("stopButton").addEventListener("click", () => stopPlayback());
$("loopButton").addEventListener("click", () => {
  state.loop = !state.loop;
  updateAudioUi();
  announce(`Loop ${state.loop ? "on" : "off"}.`);
});
$("buildWordButton").addEventListener("click", () => void buildWord());
$("wordInput").addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  void buildWord();
});
for (const button of document.querySelectorAll("[data-word-preset]")) {
  button.addEventListener("click", () => void buildWord(button.dataset.wordPreset));
}

$("selectedPhone").addEventListener("change", () => {
  replaceSelectedPhone($("selectedPhone").value);
});

$("segmentDuration").addEventListener("input", () => {
  $("segmentDurationOut").textContent = formatDuration($("segmentDuration").value);
  editSegment(state.selectedSegmentId, { durationMs: Number($("segmentDuration").value) });
});
$("segmentPitch").addEventListener("input", () => {
  const semitones = Number($("segmentPitch").value);
  const pitchBase = state.selectedPitchBaseHz;
  $("segmentPitchOut").textContent = `${semitones > 0 ? "+" : ""}${semitones} st`;
  editSegment(state.selectedSegmentId, {
    lanes: { pitch: normalizedPitch(pitchBase * 2 ** (semitones / 12)) },
  });
  state.selectedPitchBaseHz = pitchBase;
  $("segmentPitch").value = String(semitones);
  $("segmentPitchOut").textContent = `${semitones > 0 ? "+" : ""}${semitones} st`;
});
$("segmentIntensity").addEventListener("input", () => {
  const value = Number($("segmentIntensity").value);
  $("segmentIntensityOut").textContent = `${Math.round(value * 100)}%`;
  editSegment(state.selectedSegmentId, { lanes: { intensity: value } });
});
$("segmentBreath").addEventListener("input", () => {
  const value = Number($("segmentBreath").value);
  $("segmentBreathOut").textContent = `${Math.round(value * 100)}%`;
  editSegment(state.selectedSegmentId, { lanes: { breath: value } });
});

$("personality").addEventListener("change", () => {
  const preset = selectedVoicePreset();
  setVoiceControls(preset.voice);
  if (!state.sequence) return;
  const elapsedMs = state.elapsedMs;
  state.sequence = updatePinkTrombonazoidPersonality(
    state.sequence,
    preset.personality,
  );
  renderAll();
  keepPlaybackAfterEdit(elapsedMs);
  announce(
    `${preset.name}: ${voiceDescription()}. Pronunciation edits preserved.`
      + `${state.playing ? ` ${state.loop ? "Loop" : "Playback"} continues.` : ""}`,
  );
});
let previousSpeechRate = Number($("speechRate").value);
bindRange("speechRate", (value) => `${value.toFixed(2)}×`, (value) => {
  if (!state.sequence || value === previousSpeechRate) {
    previousSpeechRate = value;
    return;
  }
  const elapsedPhase = state.sequence.durationMs > 0
    ? state.elapsedMs / state.sequence.durationMs
    : 0;
  state.sequence = retimePinkTrombonazoidSequence(state.sequence, {
    scale: previousSpeechRate / Math.max(0.01, value),
  });
  previousSpeechRate = value;
  renderAll();
  keepPlaybackAfterEdit(elapsedPhase * state.sequence.durationMs);
});
bindRange("timelineZoomY", (value) => `${Math.round(value)}%`, setTimelineZoomY);
bindRange("wordGap", (value) => `${Math.round(value)} ms`);
bindRange("level", (value) => `${Math.round(value * 100)}%`, (value) => audio.setLevel(value));
bindRange("pitchModRate", (value) => `${value.toFixed(1)} Hz`);
bindRange("pitchModDepth", (value) => `${Math.round(value)} ct`);
bindRange("breathModRate", (value) => `${value.toFixed(1)} Hz`);
bindRange("breathModDepth", (value) => `${Math.round(value * 100)}%`);
bindRange("voiceThroats", (value) => String(Math.round(value)), updateVoiceControlAvailability);
bindRange("voiceRegister", (value) => `${value > 0 ? "+" : ""}${Math.round(value)} st`);
bindRange("voiceDetune", (value) => `${Math.round(value)} ct`);
bindRange("voiceBody", (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`);
bindRange("voiceTension", (value) => `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`);
bindRange("voiceVariation", (value) => `${Math.round(value * 100)}%`);
bindRange("voiceCoupling", (value) => `${Math.round(value * 100)}%`);
bindRange("voiceSpread", (value) => `${Math.round(value * 100)}%`);
bindRange("drive", (value) => `${Math.round(value * 100)}%`, applyEffects);
bindRange("tone", (value) => value > 0.76 ? "open" : value > 0.42 ? "warm" : "dark", applyEffects);
bindRange("echo", (value) => `${Math.round(value * 100)}%`, applyEffects);
bindRange("echoTime", (value) => `${Math.round(value)} ms`, applyEffects);

$("voiceHarmony").addEventListener("change", () => {
  updateVoiceControlAvailability();
  announce(`Voice stack changed: ${voiceDescription()}. Pronunciation unchanged.`);
});
for (const id of VOICE_CONTROL_IDS.filter((controlId) => controlId !== "voiceHarmony")) {
  $(id).addEventListener("change", () => {
    updateVoiceControlAvailability();
    announce(`Voice shaped to ${voiceDescription()}. Pronunciation unchanged.`);
  });
}

for (const id of ["modulationBypass", "effectsBypass"]) {
  $(id).addEventListener("click", () => {
    const pressed = $(id).getAttribute("aria-pressed") !== "true";
    $(id).setAttribute("aria-pressed", String(pressed));
    if (id === "effectsBypass") applyEffects();
    announce(`${id === "effectsBypass" ? "Effects" : "Modulators"} ${pressed ? "bypassed" : "active"}.`);
  });
}

$("resetPinkTrombonazoid").addEventListener("click", () => {
  $("personality").value = DEFAULT_PINK_TROMBONAZOID_VOICE_PRESET;
  setVoiceControls(selectedVoicePreset().voice);
  $("speechRate").value = "1";
  $("timelineZoomY").value = "100";
  $("wordGap").value = "420";
  $("pitchModShape").value = "sine";
  $("pitchModRate").value = "5.2";
  $("pitchModDepth").value = "18";
  $("breathModShape").value = "triangle";
  $("breathModRate").value = "2.1";
  $("breathModDepth").value = "0.09";
  $("drive").value = "0.08";
  $("tone").value = "0.86";
  $("echo").value = "0";
  $("echoTime").value = "185";
  for (const id of ["modulationBypass", "effectsBypass"]) $(id).setAttribute("aria-pressed", "false");
  previousSpeechRate = 1;
  for (const id of [
    "speechRate", "timelineZoomY", "wordGap", "pitchModRate", "pitchModDepth", "breathModRate",
    "breathModDepth", "drive", "tone", "echo", "echoTime",
  ]) $(id).dispatchEvent(new Event("input"));
  void buildWord("hello");
});

document.addEventListener("pointermove", continueDrag);
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);
$("timelineScroll").addEventListener("scroll", () => {
  $("phonemeRuler").scrollLeft = $("timelineScroll").scrollLeft;
});
$("phonemeRuler").addEventListener("scroll", () => {
  $("timelineScroll").scrollLeft = $("phonemeRuler").scrollLeft;
});

function resizeTimeline(width = $("timelineScroll").clientWidth) {
  const roundedWidth = Math.round(width);
  if (!state.sequence || roundedWidth === state.timelineViewportWidth) return;
  state.timelineViewportWidth = roundedWidth;
  cancelAnimationFrame(state.timelineResizeFrame);
  state.timelineResizeFrame = requestAnimationFrame(() => {
    state.timelineResizeFrame = 0;
    renderPhonemeRuler();
    renderTimeline();
    updatePlayhead(state.elapsedMs);
  });
}

const timelineResizeObserver = typeof ResizeObserver === "function"
  ? new ResizeObserver(([entry]) => resizeTimeline(entry?.contentRect?.width))
  : null;
timelineResizeObserver?.observe($("timelineScroll"));
if (!timelineResizeObserver) globalThis.addEventListener?.("resize", () => resizeTimeline());

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  stopPlayback();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback({ announceStop: false });
});
globalThis.addEventListener?.("pagehide", () => {
  cancelAnimationFrame(state.animationFrame);
  cancelAnimationFrame(state.timelineResizeFrame);
  timelineResizeObserver?.disconnect();
  void audio.close();
});

populatePhoneMenu();
populateVoiceMenus();
setVoiceControls(selectedVoicePreset().voice);
updateAudioUi();
applyEffects();
await buildWord("hello", { announceBuild: false });
state.animationFrame = requestAnimationFrame(animationFrame);
