import {
  analyzeBirdsong,
  encodeMonoWav,
  renderBirdsongModel,
} from "./src/birdsong-analysis.js";
import { createNightingaleManifoldRenderer } from "./src/nightingale-manifold-3d.js";
import {
  NIGHTINGALE_MANIFOLD_LIMITS,
  analyzeNightingaleSequence,
  assembleAudioSegments,
  assembleStropheRoute,
  buildStropheTraversal,
  createDemoNightingaleSequence,
  nightingaleManifoldExport,
} from "./src/nightingale-manifold.js";

const $ = (id) => document.getElementById(id);
const MAX_FILE_BYTES = 96 * 1024 * 1024;
const ROUTE_GAP_SECONDS = 0.09;
const PHYSICAL_MODEL_ID = "effective-bilateral-syrinx-v0";

const routeAudio = new Audio();
routeAudio.preload = "auto";

let sourceSamples = null;
let sourceSampleRate = 48_000;
let sourceName = "Synthetic compressed 18-strophe thrush-nightingale sketch";
let analysis = null;
let selectedIndex = null;
let route = [];
let manualRoute = [];
let routeRender = null;
let routeRenderKey = "";
let routeUrl = "";
let audioEnabled = false;
let busy = false;
let pendingPlayback = false;
let taskVersion = 0;
let playbackFrame = 0;
let playbackRestoreIndex = null;
const physicalCache = new Map();

const renderer = createNightingaleManifoldRenderer($("manifold-canvas"), {
  onSelect(index) {
    selectStrophe(index, true);
  },
});

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function waitForPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function setStatus(message, state = "working") {
  $("status").textContent = message;
  $("status").dataset.state = state;
}

function revokeUrl(url) {
  if (url) URL.revokeObjectURL(url);
}

function setAudioEnabled(enabled) {
  const cancelledRender = pendingPlayback;
  const stoppedPlayback = !routeAudio.paused;
  audioEnabled = Boolean(enabled);
  $("audioButton").setAttribute("aria-pressed", String(audioEnabled));
  $("audioState").textContent = audioEnabled ? "on" : "off";
  routeAudio.muted = !audioEnabled;
  if (!audioEnabled && (!routeAudio.paused || pendingPlayback)) stopPlayback(false, true);
  if (!audioEnabled && cancelledRender) {
    setStatus("Audio off; the pending physical render was cancelled.", "ready");
  } else if (!audioEnabled && stoppedPlayback) {
    setStatus("Audio off; playback stopped.", "ready");
  }
}

function updateLevel() {
  const level = clamp($("level").value, 0, 0.85);
  $("levelOut").textContent = `${Math.round(level * 100)}%`;
  routeAudio.volume = level;
}

function updateRangeOutputs() {
  $("route-length-out").textContent = `${$("route-length").value} strophes`;
  $("surprise-out").textContent = `${Math.round(Number($("surprise").value) * 100)}% surprising`;
}

function setBusy(nextBusy) {
  busy = Boolean(nextBusy);
  const hasAnalysis = Boolean(analysis?.strophes?.length);
  const hasRoute = route.length > 0;
  $("reanalyze").disabled = busy || !sourceSamples;
  $("build-route").disabled = busy || !hasAnalysis;
  $("play-route").disabled = busy || !hasRoute;
  $("stop-route").disabled = routeAudio.paused && !pendingPlayback;
  $("audition-selected").disabled = busy || selectedIndex === null;
  $("add-selected").disabled = busy || selectedIndex === null;
  $("clear-route").disabled = busy || !hasRoute;
  $("export-physical").disabled = busy || !hasRoute;
  $("export-json").disabled = busy || !hasAnalysis;
  $("audio-file").disabled = busy;
  $("load-demo").disabled = busy;
  $("nightingale-manifold-root").setAttribute("aria-busy", String(busy));
}

function safeStem(filename) {
  return String(filename)
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "nightingale-route";
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function routeKey(indices, mode) {
  return `${mode}:${indices.join(",")}`;
}

function invalidateRouteRender() {
  routeRender = null;
  routeRenderKey = "";
  revokeUrl(routeUrl);
  routeUrl = "";
  routeAudio.removeAttribute("src");
  routeAudio.load();
}

function formatSeconds(value) {
  return `${finite(value).toFixed(2)} s`;
}

function updateStats() {
  if (!analysis) return;
  const activeFrames = analysis.frames.filter((frame) => frame.active).length;
  $("strophe-stat").textContent = String(analysis.strophes.length);
  $("frame-stat").textContent = `${activeFrames} / ${analysis.frames.length}`;
  $("duration-stat").textContent = `${analysis.durationSeconds.toFixed(1)} s`;
  $("variance-stat").textContent = `${Math.round(analysis.embedding.explainedVarianceTotal * 100)}%`;
}

function updateNodeList() {
  const list = $("node-list");
  list.replaceChildren();
  if (!analysis?.strophes.length) {
    const empty = document.createElement("li");
    empty.className = "node-empty";
    empty.textContent = "No pause-bounded strophes were found.";
    list.append(empty);
    return;
  }
  for (const strophe of analysis.strophes) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.stropheIndex = String(strophe.index);
    button.setAttribute("aria-pressed", String(strophe.index === selectedIndex));
    button.innerHTML = `<b>${strophe.id}</b><span>${formatSeconds(strophe.startSeconds)} · cluster ${strophe.family}</span>`;
    button.addEventListener("click", () => selectStrophe(strophe.index, true));
    item.append(button);
    list.append(item);
  }
}

function updateSelected() {
  const strophe = selectedIndex === null ? null : analysis?.strophes[selectedIndex];
  if (!strophe) {
    $("selected-title").textContent = "No strophe selected";
    $("selected-meta").textContent = "Choose a node in the map or the accessible list below.";
  } else {
    const scaleText = strophe.envelopeScales
      .map((scale) => scale.modulation.toFixed(2))
      .join(" / ");
    const energyReference = Math.max(1e-9, ...analysis.strophes.map((event) => event.energy));
    const relativeLevel = clamp((20 * Math.log10(strophe.energy / energyReference) + 36) / 36);
    $("selected-title").textContent = `${strophe.id} · acoustic cluster ${strophe.family}`;
    $("selected-meta").textContent = [
      `${formatSeconds(strophe.startSeconds)}–${formatSeconds(strophe.endSeconds)}`,
      `${strophe.onsetCount} onset${strophe.onsetCount === 1 ? "" : "s"}`,
      `${strophe.tones?.length ?? 0} active-run candidate${strophe.tones?.length === 1 ? "" : "s"}`,
      `${Math.round(relativeLevel * 100)}% relative RMS level`,
      `${Math.round(strophe.medianPeakHz)} Hz median spectral peak`,
      `${strophe.trajectorySpan.toFixed(2)} trajectory span`,
      `envelope Δ fine / mid / broad ${scaleText}`,
    ].join(" · ");
  }
  $("audition-selected").disabled = busy || !strophe;
  $("add-selected").disabled = busy || !strophe;
  for (const button of $("node-list").querySelectorAll("button[data-strophe-index]")) {
    button.setAttribute("aria-pressed", String(Number(button.dataset.stropheIndex) === selectedIndex));
  }
}

function selectStrophe(index, focusList = false) {
  const next = Number(index);
  selectedIndex = analysis?.strophes[next] ? next : null;
  if (!routeAudio.paused) playbackRestoreIndex = selectedIndex;
  renderer.setSelected(selectedIndex);
  updateSelected();
  if (focusList && selectedIndex !== null) {
    const button = $("node-list").querySelector(`[data-strophe-index="${selectedIndex}"]`);
    button?.scrollIntoView?.({ block: "nearest" });
  }
}

function updateRouteRibbon() {
  const ribbon = $("route-ribbon");
  ribbon.replaceChildren();
  if (!route.length || !analysis) {
    const empty = document.createElement("li");
    empty.className = "route-empty";
    empty.textContent = "Build a route from the graph";
    ribbon.append(empty);
  } else {
    route.forEach((index, routeIndex) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.routeIndex = String(routeIndex);
      button.dataset.stropheIndex = String(index);
      button.textContent = analysis.strophes[index]?.id ?? `S${index + 1}`;
      button.setAttribute("aria-label", `Select route step ${routeIndex + 1}, ${button.textContent}`);
      button.addEventListener("click", () => selectStrophe(index, true));
      item.append(button);
      ribbon.append(item);
    });
  }
  renderer.setRoute(route);
  setBusy(busy);
}

function setRoute(indices, { manual = false } = {}) {
  if (!routeAudio.paused || pendingPlayback) stopPlayback(false, true);
  route = indices.filter((index) => analysis?.strophes[index]);
  if (manual) manualRoute = [...route];
  invalidateRouteRender();
  updateRouteRibbon();
}

function buildRoute() {
  if (!analysis?.strophes.length) return;
  const rule = $("walk-rule").value;
  if (rule === "manual") {
    if (!manualRoute.length) {
      const start = selectedIndex ?? 0;
      manualRoute = [start];
    }
    setRoute(manualRoute, { manual: true });
  } else {
    const nextRoute = buildStropheTraversal(analysis, {
      rule,
      length: Number($("route-length").value),
      surprise: Number($("surprise").value),
      startIndex: selectedIndex ?? 0,
      seed: 0x5354524f + Math.round(Number($("surprise").value) * 1_000),
    });
    setRoute([...nextRoute]);
  }
  setStatus(`Built a ${route.length}-strophe ${rule} route.`, "ready");
}

function normalizeForPlayback(samples, targetPeak = 0.78) {
  const output = Float32Array.from(samples, (value) => finite(value));
  let peak = 0;
  for (const value of output) peak = Math.max(peak, Math.abs(value));
  const gain = peak > 1e-8 ? Math.min(12, targetPeak / peak) : 0;
  for (let index = 0; index < output.length; index += 1) output[index] *= gain;
  return output;
}

function physicalOptions(strophe) {
  return {
    drive: clamp(0.7 + strophe.energy * 1.7, 0.55, 1.8),
    roughness: clamp(0.018 + strophe.meanFlatness * 0.16, 0.01, 0.22),
    resonanceHz: clamp(strophe.meanCentroidHz * 0.88, 1_000, 7_800),
    resonanceQ: clamp(6.8 - strophe.meanFlux * 20, 2.2, 7.5),
    resonanceMix: clamp(0.34 + strophe.meanFlatness * 0.34, 0.3, 0.62),
    seed: 0x4e474c00 + strophe.index,
  };
}

async function physicalSegment(strophe, version) {
  if (version !== taskVersion) throw new Error("Render superseded");
  if (physicalCache.has(strophe.index)) return physicalCache.get(strophe.index);
  const samples = sourceSamples.slice(strophe.startSample, strophe.endSample);
  const gesture = analyzeBirdsong(samples, sourceSampleRate, {
    minimumF0Hz: 250,
    maximumF0Hz: Math.min(9_000, sourceSampleRate * 0.4),
    maxDurationSeconds: Math.max(0.5, strophe.durationSeconds + 0.1),
    frameSize: 1_024,
    hopSize: 256,
    yinThreshold: 0.22,
  });
  if (version !== taskVersion) throw new Error("Render superseded");
  const rendered = renderBirdsongModel(gesture, physicalOptions(strophe));
  const result = Object.freeze({
    stropheIndex: strophe.index,
    samples: rendered.samples,
    gesture,
    model: rendered.model,
  });
  physicalCache.set(strophe.index, result);
  return result;
}

async function renderIndices(indices, mode, { announce = true } = {}) {
  if (!analysis || !indices.length) return null;
  const key = routeKey(indices, mode);
  if (indices === route && routeRenderKey === key && routeRender) return routeRender;
  if (mode === "recording") {
    const assembled = assembleStropheRoute(sourceSamples, analysis, indices, {
      gapSeconds: ROUTE_GAP_SECONDS,
    });
    return { ...assembled, mode, modelSegments: [] };
  }

  const version = taskVersion;
  const segments = [];
  for (let position = 0; position < indices.length; position += 1) {
    if (version !== taskVersion) throw new Error("Render superseded");
    const strophe = analysis.strophes[indices[position]];
    if (!strophe) continue;
    if (announce) {
      setStatus(`Rendering physical strophe ${position + 1} of ${indices.length}…`);
      await waitForPaint();
      if (version !== taskVersion) throw new Error("Render superseded");
    }
    const rendered = await physicalSegment(strophe, version);
    segments.push(rendered);
  }
  const assembled = assembleAudioSegments(segments, sourceSampleRate, {
    gapSeconds: ROUTE_GAP_SECONDS,
  });
  return {
    ...assembled,
    samples: normalizeForPlayback(assembled.samples),
    mode,
    modelSegments: segments.map((segment) => ({
      stropheIndex: segment.stropheIndex,
      voicedFraction: segment.gesture.voicedFraction,
      medianF0Hz: segment.gesture.medianF0Hz,
      model: segment.model,
    })),
  };
}

function stopPlayback(announce = true, cancelPending = false) {
  const cancelledRender = pendingPlayback;
  if (cancelPending) taskVersion += 1;
  pendingPlayback = false;
  routeAudio.pause();
  try {
    routeAudio.currentTime = 0;
  } catch {
    // An unloaded audio element has no seekable timeline.
  }
  cancelAnimationFrame(playbackFrame);
  playbackFrame = 0;
  $("play-route").setAttribute("aria-pressed", "false");
  $("stop-route").disabled = true;
  for (const button of $("route-ribbon").querySelectorAll("button")) {
    button.removeAttribute("data-playing");
  }
  renderer.setSelected(playbackRestoreIndex ?? selectedIndex);
  playbackRestoreIndex = null;
  if (cancelledRender) setBusy(false);
  if (announce) setStatus("Playback stopped.", "ready");
}

function animatePlayback(timeline, highlightRoute = true) {
  cancelAnimationFrame(playbackFrame);
  let lastTimelineIndex = -1;
  const tick = () => {
    if (routeAudio.paused) return;
    const time = routeAudio.currentTime;
    const timelineIndex = timeline.findIndex((entry) => (
      time >= entry.startSeconds && time < entry.endSeconds
    ));
    if (timelineIndex !== lastTimelineIndex) {
      lastTimelineIndex = timelineIndex;
      if (highlightRoute) {
        for (const button of $("route-ribbon").querySelectorAll("button")) {
          button.toggleAttribute("data-playing", Number(button.dataset.routeIndex) === timelineIndex);
        }
      }
      if (timelineIndex >= 0) renderer.setSelected(timeline[timelineIndex].stropheIndex);
    }
    playbackFrame = requestAnimationFrame(tick);
  };
  playbackFrame = requestAnimationFrame(tick);
}

async function playIndices(indices, purpose = "route") {
  if (!indices.length || busy) return;
  const mode = $("listen-mode").value;
  const key = routeKey(indices, mode);
  stopPlayback(false);
  const version = ++taskVersion;
  pendingPlayback = true;
  setBusy(true);
  if (!audioEnabled) setAudioEnabled(true);
  try {
    let rendered;
    if (purpose === "route" && routeRenderKey === key && routeRender) {
      rendered = routeRender;
    } else {
      rendered = await renderIndices(indices, mode);
    }
    if (version !== taskVersion || !rendered) return;
    if (purpose === "route") {
      routeRender = rendered;
      routeRenderKey = key;
    }
    revokeUrl(routeUrl);
    routeUrl = URL.createObjectURL(new Blob(
      [encodeMonoWav(rendered.samples, rendered.sampleRate)],
      { type: "audio/wav" },
    ));
    routeAudio.src = routeUrl;
    routeAudio.loop = purpose === "route" && $("loop-route").checked;
    routeAudio.muted = !audioEnabled;
    updateLevel();
    routeAudio.currentTime = 0;
    playbackRestoreIndex = selectedIndex;
    await routeAudio.play();
    if (version !== taskVersion) {
      routeAudio.pause();
      return;
    }
    pendingPlayback = false;
    $("play-route").setAttribute("aria-pressed", purpose === "route" ? "true" : "false");
    $("stop-route").disabled = false;
    setBusy(false);
    setStatus(
      mode === "physical"
        ? `Playing ${indices.length} strophe${indices.length === 1 ? "" : "s"} through the sample-free physical model.`
        : `Playing ${indices.length} source strophe sample${indices.length === 1 ? "" : "s"}.`,
      "ready",
    );
    animatePlayback(rendered.timeline, purpose === "route");
  } catch (error) {
    pendingPlayback = false;
    setBusy(false);
    stopPlayback(false);
    if (error?.message === "Render superseded") return;
    setStatus(`Playback could not start: ${error?.message || "unknown audio error"}`, "error");
  }
}

async function analyzeSource() {
  if (!sourceSamples) return;
  const version = ++taskVersion;
  document.documentElement.removeAttribute("data-nightingale-manifold-ready");
  stopPlayback(false);
  invalidateRouteRender();
  physicalCache.clear();
  setBusy(true);
  setStatus("Finding silence-bounded strophes and extracting multiscale descriptors…");
  await waitForPaint();
  try {
    const next = analyzeNightingaleSequence(sourceSamples, sourceSampleRate, {
      maxDurationSeconds: NIGHTINGALE_MANIFOLD_LIMITS.maximumDurationSeconds,
      stropheGapSeconds: 0.8,
      minimumStropheSeconds: 0.5,
      neighborCount: 3,
    });
    if (version !== taskVersion) return;
    analysis = next;
    selectedIndex = analysis.strophes.length ? 0 : null;
    manualRoute = selectedIndex === null ? [] : [selectedIndex];
    renderer.setAnalysis(analysis);
    renderer.setSelected(selectedIndex);
    updateStats();
    updateNodeList();
    updateSelected();
    if (analysis.strophes.length) {
      route = [...buildStropheTraversal(analysis, {
        rule: $("walk-rule").value,
        length: Number($("route-length").value),
        surprise: Number($("surprise").value),
        seed: 0x5354524f,
      })];
    } else {
      route = [];
    }
    updateRouteRibbon();
    setBusy(false);
    const cropped = sourceSamples.length > analysis.sampleCount ? " The map uses the first 45 seconds." : "";
    if (!analysis.strophes.length) {
      setStatus(`${analysis.warning} Try a cleaner recording with pauses near one second.`, "error");
    } else {
      setStatus(
        `Ready: ${analysis.strophes.length} strophe occurrences, ${analysis.similarityEdges.length} similarity links.${cropped}`,
        "ready",
      );
    }
    document.documentElement.dataset.nightingaleManifoldReady = "true";
  } catch (error) {
    if (version !== taskVersion) return;
    setBusy(false);
    setStatus(error?.message || "The sequence could not be analyzed.", "error");
  }
}

async function loadDemo() {
  const demo = createDemoNightingaleSequence(48_000);
  sourceSamples = demo.samples;
  sourceSampleRate = demo.sampleRate;
  sourceName = demo.label;
  $("source-label").textContent = sourceName;
  $("audio-file").value = "";
  await analyzeSource();
}

function strongestChannel(decoded) {
  let strongest = null;
  let strongestEnergy = -1;
  for (let channelIndex = 0; channelIndex < decoded.numberOfChannels; channelIndex += 1) {
    const channel = decoded.getChannelData(channelIndex);
    let energy = 0;
    const stride = Math.max(1, Math.floor(channel.length / 50_000));
    for (let index = 0; index < channel.length; index += stride) energy += channel[index] ** 2;
    if (energy > strongestEnergy) {
      strongestEnergy = energy;
      strongest = channel;
    }
  }
  return Float32Array.from(strongest ?? []);
}

async function decodeFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    setStatus("That file is over 96 MB. Choose a shorter recording.", "error");
    return;
  }
  const version = ++taskVersion;
  stopPlayback(false);
  setBusy(true);
  setStatus(`Decoding ${file.name} locally…`);
  await waitForPaint();
  let context;
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("This browser does not expose Web Audio decoding.");
    try {
      context = new AudioContextClass({ sampleRate: 48_000 });
    } catch {
      context = new AudioContextClass();
    }
    const bytes = await file.arrayBuffer();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (version !== taskVersion) return;
    sourceSamples = strongestChannel(decoded);
    sourceSampleRate = decoded.sampleRate;
    sourceName = file.name;
    $("source-label").textContent = sourceName;
    await context.close();
    context = null;
    await analyzeSource();
  } catch (error) {
    if (context) await context.close().catch(() => {});
    setBusy(false);
    setStatus(`Could not decode ${file.name}: ${error?.message || "unsupported audio"}`, "error");
  }
}

async function exportPhysicalWav() {
  if (!route.length || busy) return;
  const version = ++taskVersion;
  setBusy(true);
  try {
    const rendered = await renderIndices(route, "physical");
    if (version !== taskVersion || !rendered) return;
    routeRender = rendered;
    routeRenderKey = routeKey(route, "physical");
    downloadBlob(
      new Blob([encodeMonoWav(rendered.samples, rendered.sampleRate)], { type: "audio/wav" }),
      `${safeStem(sourceName)}-strophe-route-physical.wav`,
    );
    setBusy(false);
    setStatus("Exported the sample-free physical route WAV.", "ready");
  } catch (error) {
    setBusy(false);
    setStatus(`Physical export failed: ${error?.message || "unknown error"}`, "error");
  }
}

function exportRouteJson() {
  if (!analysis) return;
  const exported = nightingaleManifoldExport(analysis, route, {
    source: sourceName,
    rule: $("walk-rule").value,
    seed: 0x5354524f,
    listenMode: $("listen-mode").value,
  });
  const payload = {
    ...exported,
    physicalModel: {
      id: PHYSICAL_MODEL_ID,
      boundary: "effective acoustic gesture resynthesis; not inferred syrinx anatomy",
      mapping: {
        pressureAndTension: "YIN pitch, confidence, and amplitude trajectories extracted independently for each routed strophe",
        drive: "mean strophe energy",
        roughness: "mean spectral flatness",
        resonanceFrequency: "mean spectral centroid",
        resonanceQuality: "mean spectral flux",
      },
      routeStrophes: route.map((index) => {
        const strophe = analysis.strophes[index];
        const cached = physicalCache.get(index);
        return {
          stropheIndex: index,
          id: strophe.id,
          controls: physicalOptions(strophe),
          gesture: cached ? {
            frameSize: cached.gesture.frameSize,
            hopSize: cached.gesture.hopSize,
            voicedFraction: cached.gesture.voicedFraction,
            medianF0Hz: cached.gesture.medianF0Hz,
            frames: cached.gesture.frames.map((frame) => ({
              timeSeconds: frame.timeSeconds,
              voiced: frame.voiced,
              f0Hz: frame.f0Hz,
              confidence: frame.confidence,
              amplitudeEnvelope: frame.envelope,
              pressureProxy: frame.pressureProxy,
              tensionProxy: frame.tensionProxy,
            })),
          } : null,
        };
      }),
      gestureNote: "A null gesture means that strophe had not yet been physically rendered in this session; its deterministic controls remain included.",
    },
  };
  downloadBlob(
    new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" }),
    `${safeStem(sourceName)}-strophe-manifold.json`,
  );
  setStatus("Exported the route, descriptors, projection, and edge semantics.", "ready");
}

routeAudio.addEventListener("ended", () => {
  if (routeAudio.loop) return;
  stopPlayback(false);
  setStatus("Route playback complete.", "ready");
});

$("audioButton").addEventListener("click", () => setAudioEnabled(!audioEnabled));
$("level").addEventListener("input", updateLevel);
$("audio-file").addEventListener("change", (event) => decodeFile(event.target.files?.[0]));
$("load-demo").addEventListener("click", loadDemo);
$("reanalyze").addEventListener("click", analyzeSource);
$("build-route").addEventListener("click", buildRoute);
$("clear-route").addEventListener("click", () => {
  manualRoute = [];
  setRoute([], { manual: true });
  setStatus("Route cleared. Select a node and add it manually, or build another walk.", "ready");
});
$("play-route").addEventListener("click", () => playIndices(route));
$("stop-route").addEventListener("click", () => stopPlayback(true, true));
$("loop-route").addEventListener("change", () => {
  routeAudio.loop = $("loop-route").checked;
});
$("listen-mode").addEventListener("change", () => {
  stopPlayback(false, true);
  invalidateRouteRender();
  $("play-route").querySelector("small").textContent = $("listen-mode").value === "physical"
    ? "physical model"
    : "source slices";
  setStatus(
    $("listen-mode").value === "physical"
      ? "Physical mode follows extracted gestures without copying source samples."
      : "Recording mode plays the original local strophe slices.",
    "ready",
  );
  setBusy(false);
});
$("audition-selected").addEventListener("click", () => {
  if (selectedIndex !== null) playIndices([selectedIndex], "audition");
});
$("add-selected").addEventListener("click", () => {
  if (selectedIndex === null) return;
  $("walk-rule").value = "manual";
  manualRoute.push(selectedIndex);
  setRoute(manualRoute, { manual: true });
  setStatus(`Added ${analysis.strophes[selectedIndex].id} to the manual route.`, "ready");
});
$("export-physical").addEventListener("click", exportPhysicalWav);
$("export-json").addEventListener("click", exportRouteJson);
$("reset-view").addEventListener("click", () => renderer.resetView());

for (const id of ["show-similarity", "show-sequence", "show-trajectories", "auto-rotate"]) {
  $(id).addEventListener("change", () => renderer.setOptions({
    showSimilarity: $("show-similarity").checked,
    showSequence: $("show-sequence").checked,
    showTrajectories: $("show-trajectories").checked,
    autoRotate: $("auto-rotate").checked,
  }));
}
for (const id of ["route-length", "surprise"]) {
  $(id).addEventListener("input", updateRangeOutputs);
}
$("walk-rule").addEventListener("change", () => {
  if ($("walk-rule").value === "manual" && manualRoute.length) setRoute(manualRoute, { manual: true });
});

window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    stopPlayback(false, true);
    return;
  }
  ++taskVersion;
  stopPlayback(false);
  revokeUrl(routeUrl);
  renderer.dispose();
});

updateLevel();
updateRangeOutputs();
setAudioEnabled(false);
setBusy(false);
requestAnimationFrame(loadDemo);
