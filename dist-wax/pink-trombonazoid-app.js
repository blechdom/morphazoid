import {
  PINK_TROMBONAZOID_LANES,
  compilePinkTrombonazoid,
  pinkTrombonazoidAudioEvent,
  retimePinkTrombonazoidSequence,
  samplePinkTrombonazoidLfo,
  updatePinkTrombonazoidSegment,
} from "./src/pink-trombonazoid.js";
import {
  loadSpellingPronunciations,
} from "./src/spelling-pronunciation.js";
import { SpellingSynthesizerAudio } from "./src/spelling-synthesizer-audio.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const TIMELINE_MIN_WIDTH = 920;
const TIMELINE_PIXELS_PER_MS = 0.72;
const LANE_TOP = 18;
const LANE_HEIGHT = 40;
const LANE_GRAPH_HEIGHT = 27;
const TIMELINE_BOTTOM = 28;
const prefersReducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;

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
  tractDrag: false,
  displayedPerformance: null,
  livePerformance: null,
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

function lipOpeningLabel(value) {
  if (value < 0.12) return "closed";
  if (value < 0.34) return "rounded";
  if (value < 0.7) return "narrow";
  return "open";
}

function updateSummary() {
  const sequence = state.sequence;
  if (!sequence) return;
  $("wordReadout").textContent = sequence.source.trim() || "—";
  $("phoneCountOut").textContent = String(sequence.phones.length);
  $("durationOut").textContent = formatDuration(sequence.durationMs);
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
  const requiredScale = state.sequence?.segments.reduce((scale, segment) => {
    if (!(segment.durationMs > 0)) return scale;
    const targetWidth = segment.type === "boundary" ? 22 : 48;
    return Math.max(scale, targetWidth / segment.durationMs);
  }, TIMELINE_PIXELS_PER_MS) ?? TIMELINE_PIXELS_PER_MS;
  return Math.max(
    TIMELINE_MIN_WIDTH,
    Math.round((state.sequence?.durationMs ?? 1) * Math.min(2.4, requiredScale)),
  );
}

function renderPhonemeRuler() {
  const ruler = $("phonemeRuler");
  const sequence = state.sequence;
  ruler.replaceChildren();
  if (!sequence) return;
  const width = timelineWidth();
  for (const segment of sequence.segments) {
    const cell = document.createElement("div");
    cell.className = [
      "ptz-phoneme-cell",
      segment.type === "boundary" ? "is-boundary" : "",
      segment.vowel ? "is-vowel" : "",
    ].filter(Boolean).join(" ");
    cell.dataset.segmentId = segment.id;
    cell.style.setProperty(
      "--segment-width",
      `${Math.max(segment.type === "boundary" ? 22 : 48, segment.durationMs / sequence.durationMs * width)}px`,
    );
    cell.classList.toggle("is-selected", segment.id === state.selectedSegmentId);
    const select = document.createElement("button");
    select.type = "button";
    select.className = "ptz-phoneme-select";
    select.setAttribute("aria-pressed", String(segment.id === state.selectedSegmentId));
    if (segment.type === "boundary") {
      select.innerHTML = `<b aria-hidden="true">·</b><small>${Math.round(segment.durationMs)} ms pause</small>`;
      select.setAttribute("aria-label", `${Math.round(segment.durationMs)} millisecond pause`);
    } else {
      select.innerHTML = `<b>${segment.phoneLabel}</b><small>${segment.articulationLabel} · ${Math.round(segment.durationMs)} ms</small>`;
      select.setAttribute(
        "aria-label",
        `${segment.phoneLabel}, ${segment.manner}, ${Math.round(segment.durationMs)} milliseconds`,
      );
    }
    select.addEventListener("click", () => selectSegment(segment.id));
    const handle = document.createElement("span");
    handle.className = "ptz-duration-grab";
    handle.dataset.segmentId = segment.id;
    handle.tabIndex = 0;
    handle.setAttribute("role", "slider");
    handle.setAttribute("aria-label", `Duration of ${segment.phoneLabel ?? "pause"}`);
    handle.setAttribute("aria-valuemin", segment.type === "boundary" ? "0" : "24");
    handle.setAttribute("aria-valuemax", "2400");
    handle.setAttribute("aria-valuenow", String(Math.round(segment.durationMs)));
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
    cell.append(select, handle);
    ruler.append(cell);
  }
}

function laneValueText(lane, value) {
  const normalized = clamp(value);
  if (lane.id === "pitch") return `${Math.round(rawPitch(normalized))} Hz`;
  if (lane.id === "lipOpening") return `${(normalized * 4).toFixed(1)} cm`;
  return `${Math.round(normalized * 100)}%`;
}

function lanePath(samples, laneY, plotWidth) {
  if (!samples.length) return "";
  return samples.map((value, index) => {
    const x = index / Math.max(1, samples.length - 1) * plotWidth;
    const y = laneY + (1 - clamp(value)) * LANE_GRAPH_HEIGHT;
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

function renderTimeline() {
  const sequence = state.sequence;
  const svg = $("timelineSvg");
  const gutter = $("laneGutter");
  svg.replaceChildren();
  gutter.replaceChildren();
  if (!sequence) return;

  const plotWidth = timelineWidth();
  const height = LANE_TOP + PINK_TROMBONAZOID_LANES.length * LANE_HEIGHT + TIMELINE_BOTTOM;
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
    const laneY = LANE_TOP + laneIndex * LANE_HEIGHT;
    const label = document.createElement("div");
    label.className = "ptz-lane-label";
    label.style.setProperty("--lane-top", `${laneY - 7}px`);
    label.style.setProperty("--lane-height", `${LANE_HEIGHT}px`);
    label.style.setProperty("--lane-color", lane.color);
    label.innerHTML = `<i aria-hidden="true"></i><b>${lane.shortLabel}</b><output data-lane-output="${lane.id}">—</output>`;
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
        height: LANE_HEIGHT,
      }),
      svgElement("line", {
        class: "ptz-lane-midline",
        x1: 0,
        x2: plotWidth,
        y1: laneY + LANE_GRAPH_HEIGHT / 2,
        y2: laneY + LANE_GRAPH_HEIGHT / 2,
      }),
      svgElement("path", {
        class: "ptz-lane-curve",
        d: lanePath(sequence.automation[lane.id].samples, laneY, plotWidth),
      }),
    );

    sequence.articulationSegments.forEach((segment) => {
      const x = (segment.startMs + segment.durationMs * 0.5) / sequence.durationMs * plotWidth;
      const value = segment.laneValues[lane.id];
      const y = laneY + (1 - value) * LANE_GRAPH_HEIGHT;
      const key = svgElement("g", {
        class: "ptz-keyframe",
        "data-segment-id": segment.id,
        "data-lane": lane.id,
        tabindex: 0,
        role: "slider",
        "aria-label": `${lane.label} for ${segment.phoneLabel}`,
        "aria-valuemin": 0,
        "aria-valuemax": 1,
        "aria-valuenow": value.toFixed(3),
        "aria-valuetext": laneValueText(lane, value),
      });
      key.append(
        svgElement("circle", { class: "ptz-keyframe-hit", cx: x, cy: y, r: 9 }),
        svgElement("rect", {
          class: "ptz-keyframe-mark",
          x: x - 3.4,
          y: y - 3.4,
          width: 6.8,
          height: 6.8,
          transform: `rotate(45 ${x} ${y})`,
        }),
      );
      key.addEventListener("pointerdown", (event) => beginLaneDrag(event, lane, segment, laneY));
      key.addEventListener("click", () => selectSegment(segment.id));
      key.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const amount = event.shiftKey ? 0.1 : 0.02;
        editSegment(segment.id, {
          lanes: { [lane.id]: value + (event.key === "ArrowUp" ? amount : -amount) },
        }, {
          focus: { type: "lane", segmentId: segment.id, laneId: lane.id },
        });
      });
      group.append(key);
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
  updateSummary();
  updateSelectedEditor();
  updatePlayhead(state.elapsedMs);
}

function selectSegment(id) {
  const segment = state.sequence?.segments.find((candidate) => candidate.id === id);
  if (!segment) return;
  state.selectedSegmentId = segment.id;
  state.selectedPitchBaseHz = segment.performance?.exciterPitch ?? 140;
  renderPhonemeRuler();
  updateSelectedEditor();
  document.querySelectorAll(".ptz-keyframe").forEach((key) => {
    key.classList.toggle("is-selected", key.dataset.segmentId === id);
  });
}

function updateSelectedEditor() {
  const segment = selectedSegment();
  if (!segment) return;
  const articulation = segment.type === "articulation";
  $("selectedTitle").textContent = articulation
    ? `${segment.phoneLabel} · ${segment.manner}`
    : "Pause · boundary";
  $("selectedTimeOut").textContent = formatDuration(segment.durationMs);
  $("segmentDuration").min = articulation ? "24" : "0";
  $("segmentDuration").value = String(segment.durationMs);
  $("segmentDurationOut").textContent = formatDuration(segment.durationMs);
  for (const id of ["segmentPitch", "segmentIntensity", "segmentBreath"]) $(id).disabled = !articulation;
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

function editSegment(id, patch, { focus = null } = {}) {
  if (!state.sequence) return;
  const stoppedPlayback = state.playing;
  if (stoppedPlayback) stopPlayback({ announceStop: false });
  state.sequence = updatePinkTrombonazoidSegment(state.sequence, id, patch);
  renderAll();
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
  if (stoppedPlayback) announce("Playback stopped for the timeline edit.");
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

function beginLaneDrag(event, lane, segment, laneY) {
  event.preventDefault();
  selectSegment(segment.id);
  state.drag = {
    type: "lane",
    pointerId: event.pointerId,
    lane,
    laneY,
    segmentId: segment.id,
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
  const rect = state.drag.svg.getBoundingClientRect();
  const viewBox = state.drag.svg.viewBox.baseVal;
  const y = (event.clientY - rect.top) / Math.max(1, rect.height) * viewBox.height;
  const value = 1 - (y - state.drag.laneY) / LANE_GRAPH_HEIGHT;
  editSegment(state.drag.segmentId, { lanes: { [state.drag.lane.id]: value } });
}

function endDrag(event) {
  if (!state.drag || (event.pointerId !== undefined && event.pointerId !== state.drag.pointerId)) return;
  state.drag = null;
  document.querySelectorAll(".ptz-keyframe.is-dragging").forEach((key) => key.classList.remove("is-dragging"));
}

function sequenceSettings() {
  return {
    pronunciations: state.pronunciations,
    personality: $("personality").value,
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
    $("pronunciationStatus").textContent = "Local CMU pronunciation dictionary · no speech service or upload";
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
    cell.classList.toggle("is-playing", cell.dataset.segmentId === segment?.id);
  });
  if (!segment || segment.type === "boundary") {
    state.livePerformance = null;
    audio.release({ releaseMs: Math.min(80, segment?.durationMs ?? 55) });
    return;
  }
  let event = pinkTrombonazoidAudioEvent(segment, { elapsedSeconds });
  state.livePerformance = event?.performance ?? null;
  if (audio.activeEngine !== "tube") {
    if (segment.articulationIndex > 0) return;
    const phone = state.sequence?.phones.find(({ id }) => id === segment.phoneId);
    if (phone) {
      event = {
        ...event,
        dynamics: { ...event.dynamics, durationMs: phone.durationMs },
      };
    }
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
  state.livePerformance = null;
  updateAudioUi();
  announce(`Speaking ${state.sequence.source}.`);
}

function stopPlayback({ announceStop = true, reset = true } = {}) {
  if (state.playing || state.activeSegmentIndex >= 0) audio.release({ releaseMs: 68 });
  state.playing = false;
  state.loopRestartAt = 0;
  state.activeSegmentIndex = -1;
  state.livePerformance = null;
  if (reset) state.elapsedMs = 0;
  document.querySelectorAll(".ptz-phoneme-cell.is-playing").forEach((cell) => cell.classList.remove("is-playing"));
  updatePlayhead(state.elapsedMs);
  updateAudioUi();
  if (announceStop) announce("Word stopped.");
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
  $("playheadOut").textContent = state.playing
    ? `${(milliseconds / 1_000).toFixed(2)} s`
    : "ready";
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
    const samples = sequence.automation[lane.id]?.samples ?? [];
    if (!samples.length) continue;
    const position = phase * (samples.length - 1);
    const left = Math.floor(position);
    const right = Math.min(samples.length - 1, left + 1);
    const mix = position - left;
    const value = samples[left] + (samples[right] - samples[left]) * mix;
    values[lane.id] = value;
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
      state.livePerformance = null;
      document.querySelectorAll(".ptz-phoneme-cell.is-playing").forEach((cell) => cell.classList.remove("is-playing"));
      updatePlayhead(state.elapsedMs);
      $("playheadOut").textContent = "breath";
      return;
    }
    stopPlayback({ announceStop: false });
    announce(`${state.sequence.source} finished.`);
    return;
  }
  const index = state.sequence.segments.findIndex(({ startMs, endMs }) => (
    state.elapsedMs >= startMs && state.elapsedMs < endMs
  ));
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
      });
      state.livePerformance = event?.performance ?? segment.performance;
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

function activePerformance() {
  const active = state.sequence?.segments[state.activeSegmentIndex];
  return (state.playing ? state.livePerformance : null)
    ?? active?.performance
    ?? selectedSegment()?.performance
    ?? state.sequence?.articulationSegments?.[0]?.performance
    ?? null;
}

function interpolatePerformance(from, to, amount = 0.13) {
  if (!to) return from;
  if (!from) return structuredClone(to);
  const mix = prefersReducedMotion ? 1 : clamp(amount);
  const numeric = (key) => from[key] = (Number(from[key]) || 0) + ((Number(to[key]) || 0) - (Number(from[key]) || 0)) * mix;
  for (const key of [
    "articulationAperture", "articulationPlace", "articulationVoicing",
    "glottalClosure", "lipDiameter", "nasalCoupling", "exciterIntensity",
    "exciterPitch", "mutation",
  ]) numeric(key);
  from.phoneme = to.phoneme;
  from.articulationManner = to.articulationManner;
  from.tongues ??= [{ position: 0.3, height: 0.6 }];
  const targetTongue = to.tongues?.[0] ?? {};
  from.tongues[0].position += ((targetTongue.position ?? 0.3) - from.tongues[0].position) * mix;
  from.tongues[0].height += ((targetTongue.height ?? 0.6) - from.tongues[0].height) * mix;
  return from;
}

function resizeCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(2, globalThis.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * ratio));
  const height = Math.max(1, Math.round(rect.height * ratio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return { width: rect.width, height: rect.height, ratio };
}

function roundedPath(context, points, close = false) {
  if (!points.length) return;
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    context.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
  }
  context.lineTo(points.at(-1).x, points.at(-1).y);
  if (close) context.closePath();
}

function drawTract(now) {
  const canvas = $("tractCanvas");
  const { width, height, ratio } = resizeCanvas(canvas);
  const context = canvas.getContext("2d");
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const target = activePerformance();
  state.displayedPerformance = interpolatePerformance(state.displayedPerformance, target);
  const performanceState = state.displayedPerformance;
  if (!performanceState) return;

  const tongue = performanceState.tongues?.[0] ?? { position: 0.3, height: 0.6 };
  const place = clamp(performanceState.articulationPlace);
  const aperture = clamp(performanceState.articulationAperture);
  const nasal = clamp(performanceState.nasalCoupling);
  const lip = clamp((performanceState.lipDiameter ?? 3) / 3);
  const intensity = clamp(performanceState.exciterIntensity);
  const originX = width * 0.12;
  const originY = height * 0.69;
  const oralStartX = width * 0.39;
  const mouthX = width * 0.87;
  const mouthY = height * 0.48;
  const tractHalf = Math.max(18, height * 0.065);

  context.lineCap = "round";
  context.lineJoin = "round";

  // Head and nose silhouette.
  context.strokeStyle = "rgba(192,112,198,0.25)";
  context.lineWidth = 2;
  context.setLineDash([4, 8]);
  roundedPath(context, [
    { x: width * 0.43, y: height * 0.16 },
    { x: width * 0.69, y: height * 0.12 },
    { x: width * 0.82, y: height * 0.25 },
    { x: width * 0.91, y: height * 0.34 },
    { x: width * 0.88, y: height * 0.47 },
    { x: width * 0.92, y: height * 0.61 },
    { x: width * 0.8, y: height * 0.78 },
    { x: width * 0.56, y: height * 0.86 },
  ]);
  context.stroke();
  context.setLineDash([]);

  // Main airway, from larynx around the tongue to the lips.
  const centre = [
    { x: originX, y: originY },
    { x: width * 0.24, y: height * 0.67 },
    { x: width * 0.32, y: height * 0.58 },
    { x: oralStartX, y: mouthY },
    { x: width * 0.57, y: height * 0.42 },
    { x: width * 0.73, y: height * 0.43 },
    { x: mouthX, y: mouthY },
  ];
  const upper = centre.map((point, index) => ({
    x: point.x,
    y: point.y - tractHalf * (index < 3 ? 0.72 : 1),
  }));
  const lower = centre.map((point, index) => ({
    x: point.x,
    y: point.y + tractHalf * (index < 3 ? 0.72 : 1),
  })).reverse();
  roundedPath(context, [...upper, ...lower], true);
  context.fillStyle = "#FFEEF5";
  context.strokeStyle = "#C070C6";
  context.lineWidth = 4;
  context.fill();
  context.stroke();

  // Nasal branch and velum gate.
  const nasalStartX = width * 0.55;
  context.beginPath();
  context.moveTo(nasalStartX, height * 0.41);
  context.bezierCurveTo(width * 0.58, height * 0.27, width * 0.76, height * 0.25, width * 0.86, height * 0.34);
  context.lineWidth = 12 + nasal * 10;
  context.strokeStyle = "#FFEEF5";
  context.stroke();
  context.lineWidth = 3;
  context.strokeStyle = "#C070C6";
  context.stroke();
  context.beginPath();
  context.moveTo(nasalStartX - 7, height * 0.4 + nasal * 10);
  context.lineTo(nasalStartX + 9, height * 0.43 - nasal * 9);
  context.lineWidth = 4;
  context.strokeStyle = "#DA70D6";
  context.stroke();

  // Tongue body. Position is back→front; height raises it toward the palate.
  const tongueX = oralStartX + clamp(tongue.position) * (mouthX - oralStartX - width * 0.07);
  const tongueY = height * (0.57 - clamp(tongue.height) * 0.12);
  const tongueWidth = width * (0.18 - clamp(tongue.height) * 0.045);
  const tongueHeight = height * (0.085 + clamp(tongue.height) * 0.035);
  context.beginPath();
  context.ellipse(tongueX, tongueY, tongueWidth, tongueHeight, -0.08, Math.PI, Math.PI * 2);
  context.quadraticCurveTo(tongueX + tongueWidth * 0.8, tongueY + tongueHeight * 1.2, tongueX - tongueWidth, tongueY);
  context.closePath();
  context.fillStyle = "#FFC0CB";
  context.strokeStyle = "#C070C6";
  context.lineWidth = 3;
  context.fill();
  context.stroke();

  // Discrete consonant constriction: drawn separately so a stop stays a stop.
  const constrictionX = oralStartX + place * (mouthX - oralStartX);
  const gap = 2 + aperture * tractHalf * 1.15;
  context.beginPath();
  context.moveTo(constrictionX, mouthY - tractHalf);
  context.lineTo(constrictionX, mouthY - gap);
  context.moveTo(constrictionX, mouthY + gap);
  context.lineTo(constrictionX, mouthY + tractHalf);
  context.strokeStyle = aperture < 0.15 ? "#633268" : "#DA70D6";
  context.lineWidth = aperture < 0.15 ? 7 : 4;
  context.stroke();

  // Lips and their current rounded/open aperture.
  const lipGap = 2 + lip * 20;
  context.beginPath();
  context.moveTo(mouthX - 4, mouthY - tractHalf * 0.9);
  context.quadraticCurveTo(mouthX + 18, mouthY - lipGap, mouthX + 8, mouthY - 2);
  context.moveTo(mouthX + 8, mouthY + 2);
  context.quadraticCurveTo(mouthX + 18, mouthY + lipGap, mouthX - 4, mouthY + tractHalf * 0.9);
  context.strokeStyle = "#C070C6";
  context.lineWidth = 7;
  context.stroke();

  // Glottis and pitch/intensity source.
  const glottalGap = 2 + (1 - clamp(performanceState.glottalClosure)) * 8;
  context.beginPath();
  context.moveTo(originX - 14, originY - 21);
  context.lineTo(originX - glottalGap, originY);
  context.lineTo(originX - 14, originY + 21);
  context.moveTo(originX + 14, originY - 21);
  context.lineTo(originX + glottalGap, originY);
  context.lineTo(originX + 14, originY + 21);
  context.strokeStyle = "#C070C6";
  context.lineWidth = 5;
  context.stroke();

  if (!prefersReducedMotion && state.playing) {
    const dots = 14;
    for (let index = 0; index < dots; index += 1) {
      const phase = ((now * 0.0007 * (0.6 + intensity) + index / dots) % 1 + 1) % 1;
      const pointIndex = Math.min(centre.length - 2, Math.floor(phase * (centre.length - 1)));
      const local = phase * (centre.length - 1) - pointIndex;
      const from = centre[pointIndex];
      const to = centre[pointIndex + 1];
      const x = from.x + (to.x - from.x) * local;
      const y = from.y + (to.y - from.y) * local;
      context.beginPath();
      context.arc(x, y, 1.5 + intensity * 1.8, 0, Math.PI * 2);
      context.fillStyle = `rgba(218,112,214,${0.18 + intensity * 0.42})`;
      context.fill();
    }
  }

  context.fillStyle = "rgba(192,112,198,0.72)";
  context.font = `${Math.max(34, width * 0.055)}px Arial`;
  context.textAlign = "center";
  context.fillText(
    performanceState.phoneme ? String(performanceState.phoneme).toUpperCase() : "—",
    width * 0.72,
    height * 0.76,
  );
  context.font = `${Math.max(9, width * 0.012)}px Arial`;
  context.fillStyle = "rgba(99,50,104,0.7)";
  context.fillText(`${Math.round(performanceState.exciterPitch || 0)} HZ`, width * 0.72, height * 0.82);

  $("currentPhoneOut").textContent = performanceState.phoneme
    ? String(performanceState.phoneme).toUpperCase()
    : "—";
  $("mouthOut").textContent = lipOpeningLabel(aperture * lip);
  $("tongueOut").textContent = `${tongue.position < 0.34 ? "back" : tongue.position > 0.66 ? "front" : "middle"} · ${tongue.height > 0.7 ? "raised" : tongue.height < 0.3 ? "low" : "mid"}`;
  $("velumOut").textContent = nasal > 0.52 ? "nasal" : nasal > 0.16 ? "coupled" : "oral";
}

function animationFrame(now) {
  updateTransport(now);
  drawTract(now);
  state.animationFrame = requestAnimationFrame(animationFrame);
}

function editTractFromPointer(event) {
  const segment = selectedSegment();
  if (!segment || segment.type !== "articulation") return;
  const rect = $("tractCanvas").getBoundingClientRect();
  const x = clamp((event.clientX - rect.left) / rect.width);
  const y = clamp((event.clientY - rect.top) / rect.height);
  const tonguePosition = clamp((x - 0.38) / 0.48);
  const tongueHeight = clamp((0.68 - y) / 0.34);
  editSegment(segment.id, { lanes: { tonguePosition, tongueHeight } });
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

$("personality").addEventListener("change", () => void buildWord($("wordInput").value));
let previousSpeechRate = Number($("speechRate").value);
bindRange("speechRate", (value) => `${value.toFixed(2)}×`, (value) => {
  if (!state.sequence || value === previousSpeechRate) {
    previousSpeechRate = value;
    return;
  }
  stopPlayback({ announceStop: false });
  state.sequence = retimePinkTrombonazoidSequence(state.sequence, {
    scale: previousSpeechRate / Math.max(0.01, value),
  });
  previousSpeechRate = value;
  renderAll();
});
bindRange("wordGap", (value) => `${Math.round(value)} ms`);
bindRange("level", (value) => `${Math.round(value * 100)}%`, (value) => audio.setLevel(value));
bindRange("pitchModRate", (value) => `${value.toFixed(1)} Hz`);
bindRange("pitchModDepth", (value) => `${Math.round(value)} ct`);
bindRange("breathModRate", (value) => `${value.toFixed(1)} Hz`);
bindRange("breathModDepth", (value) => `${Math.round(value * 100)}%`);
bindRange("drive", (value) => `${Math.round(value * 100)}%`, applyEffects);
bindRange("tone", (value) => value > 0.76 ? "open" : value > 0.42 ? "warm" : "dark", applyEffects);
bindRange("echo", (value) => `${Math.round(value * 100)}%`, applyEffects);
bindRange("echoTime", (value) => `${Math.round(value)} ms`, applyEffects);

for (const id of ["modulationBypass", "effectsBypass"]) {
  $(id).addEventListener("click", () => {
    const pressed = $(id).getAttribute("aria-pressed") !== "true";
    $(id).setAttribute("aria-pressed", String(pressed));
    if (id === "effectsBypass") applyEffects();
    announce(`${id === "effectsBypass" ? "Effects" : "Modulators"} ${pressed ? "bypassed" : "active"}.`);
  });
}

$("resetPinkTrombonazoid").addEventListener("click", () => {
  $("personality").value = "clear";
  $("speechRate").value = "1";
  $("wordGap").value = "420";
  $("pitchModShape").value = "sine";
  $("pitchModRate").value = "5.2";
  $("pitchModDepth").value = "18";
  $("breathModShape").value = "triangle";
  $("breathModRate").value = "2.1";
  $("breathModDepth").value = "0.09";
  $("drive").value = "0.08";
  $("tone").value = "0.86";
  $("echo").value = "0.12";
  $("echoTime").value = "185";
  for (const id of ["modulationBypass", "effectsBypass"]) $(id).setAttribute("aria-pressed", "false");
  previousSpeechRate = 1;
  for (const id of [
    "speechRate", "wordGap", "pitchModRate", "pitchModDepth", "breathModRate",
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

const tractCanvas = $("tractCanvas");
tractCanvas.addEventListener("pointerdown", (event) => {
  state.tractDrag = true;
  tractCanvas.setPointerCapture?.(event.pointerId);
  editTractFromPointer(event);
});
tractCanvas.addEventListener("pointermove", (event) => {
  if (state.tractDrag) editTractFromPointer(event);
});
for (const type of ["pointerup", "pointercancel"]) {
  tractCanvas.addEventListener(type, () => { state.tractDrag = false; });
}
tractCanvas.addEventListener("keydown", (event) => {
  if (![" ", "Enter"].includes(event.key)) return;
  event.preventDefault();
  void startPlayback();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  stopPlayback();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopPlayback({ announceStop: false });
});
globalThis.addEventListener?.("pagehide", () => {
  cancelAnimationFrame(state.animationFrame);
  void audio.close();
});

updateAudioUi();
applyEffects();
await buildWord("hello", { announceBuild: false });
state.animationFrame = requestAnimationFrame(animationFrame);
