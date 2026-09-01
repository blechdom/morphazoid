import {
  COMPOSITION_PRESETS,
  INSTRUMENT_LIBRARY,
  addInstrumentClip,
  cloneCompositionPreset,
  currentSection,
  formatBeat,
  moveFlowNode,
  moveSectionNode,
  moveTimelineClip,
  projectTimeline,
  quantizeBeat,
  resizeTimelineClip,
  selectSection,
} from "./src/constellation-composer.js";
import {
  ConstellationAudio,
  performanceEventsForWindow,
} from "./src/constellation-audio.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;
const TIMELINE_GUTTER = 158;
const MIN_PIXELS_PER_BEAT = 22;
const MAX_PIXELS_PER_BEAT = 58;

const clamp = (value, minimum = 0, maximum = 1, fallback = minimum) => {
  const number = Number(value);
  return Math.min(maximum, Math.max(minimum, Number.isFinite(number) ? number : fallback));
};

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgElement(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

const dom = {
  audioButton: $("audioButton"),
  audioState: $("audioState"),
  playButton: $("playButton"),
  stopButton: $("stopButton"),
  loopButton: $("loopButton"),
  tempo: $("tempo"),
  tempoOut: $("tempoOut"),
  output: $("output"),
  outputOut: $("outputOut"),
  presetSelect: $("presetSelect"),
  presetDescription: $("presetDescription"),
  timelineView: $("timelineView"),
  timelineCanvas: $("timelineCanvas"),
  flowView: $("flowView"),
  flowCanvas: $("flowCanvas"),
  constellationView: $("constellationView"),
  constellationCanvas: $("constellationCanvas"),
  instrumentBrowser: $("instrumentBrowser"),
  inspector: $("inspector"),
  sectionTitle: $("sectionTitle"),
  transportPosition: $("transportPosition"),
  liveStatus: $("liveStatus"),
  viewDescription: $("viewDescription"),
  workDuration: $("workDuration"),
  sectionCount: $("sectionCount"),
  branchCount: $("branchCount"),
};

const audio = new ConstellationAudio(globalThis);
const state = {
  composition: cloneCompositionPreset(COMPOSITION_PRESETS[0]?.id),
  view: "timeline",
  selectedNodeId: null,
  playing: false,
  loop: true,
  audioOn: false,
  audioStarting: false,
  output: .54,
  tempo: COMPOSITION_PRESETS[0]?.tempo ?? 120,
  absoluteBeat: 0,
  transportStartBeat: 0,
  transportStartTime: 0,
  scheduleBeat: 0,
  scheduler: null,
  animationFrame: null,
  drag: null,
  disposed: false,
};

function setText(target, value) {
  if (target) target.textContent = String(value);
}

function setPressed(target, pressed) {
  target?.setAttribute("aria-pressed", String(Boolean(pressed)));
}

function announce(message) {
  setText(dom.liveStatus, message);
}

function secondsPerBeat() {
  return 60 / clamp(state.tempo, 30, 240, 120);
}

function clockNow() {
  const context = audio.synth?.context ?? audio.drums?.context;
  if (context && context.state !== "closed") return finite(context.currentTime, 0);
  return (globalThis.performance?.now?.() ?? Date.now()) / 1_000;
}

function sectionRoute() {
  const sections = state.composition.sections ?? [];
  if (!sections.length) return [];
  const byId = new Map(sections.map((section) => [section.id, section]));
  const route = [];
  const seen = new Set();
  let section = sections[0];
  while (section && !seen.has(section.id) && route.length < sections.length) {
    seen.add(section.id);
    route.push(section);
    const outgoing = (state.composition.transitions ?? []).filter(({ from }) => from === section.id);
    const edge = outgoing.find(({ mode }) => mode === "default")
      ?? outgoing.find(({ mode }) => mode !== "choice")
      ?? outgoing[0];
    section = edge ? byId.get(edge.to) : null;
  }
  return route;
}

function routeEntries() {
  let startBeat = 0;
  return sectionRoute().map((section) => {
    const projection = projectTimeline(state.composition, section.id);
    const entry = {
      section,
      projection,
      startBeat,
      endBeat: startBeat + projection.durationBeats,
    };
    startBeat = entry.endBeat;
    return entry;
  });
}

function totalRouteBeats() {
  return routeEntries().at(-1)?.endBeat ?? 1;
}

function wrappedBeat(absoluteBeat = state.absoluteBeat) {
  const total = Math.max(1, totalRouteBeats());
  if (!state.loop) return clamp(absoluteBeat, 0, total, 0);
  return ((absoluteBeat % total) + total) % total;
}

function entryAtWorkBeat(beat) {
  const entries = routeEntries();
  return entries.find((entry, index) => (
    beat >= entry.startBeat
    && (beat < entry.endBeat || (index === entries.length - 1 && beat <= entry.endBeat))
  )) ?? entries.at(-1) ?? null;
}

function selectedProjection() {
  return projectTimeline(state.composition, currentSection(state.composition)?.id);
}

function currentPerformancePosition() {
  const workBeat = wrappedBeat();
  const entry = entryAtWorkBeat(workBeat);
  return {
    workBeat,
    entry,
    localBeat: entry ? workBeat - entry.startBeat : 0,
  };
}

function updateCompositionReadouts() {
  const entries = routeEntries();
  const bars = totalRouteBeats() / Math.max(1, state.composition.meter?.[0] ?? 4);
  setText(dom.workDuration, `${formatBeat(totalRouteBeats())} beats · ${bars.toFixed(1).replace(/\.0$/, "")} bars`);
  setText(dom.sectionCount, `${state.composition.sections.length} sections`);
  setText(dom.branchCount, `${state.composition.transitions.filter(({ mode }) => mode === "choice").length} alternate routes`);
  if (dom.presetDescription) dom.presetDescription.textContent = state.composition.description;
  if (dom.presetSelect) dom.presetSelect.value = state.composition.id;
  if (dom.tempo) dom.tempo.value = String(state.tempo);
  setText(dom.tempoOut, `${Math.round(state.tempo)} BPM`);
  if (dom.output) dom.output.value = String(state.output);
  setText(dom.outputOut, `${Math.round(state.output * 100)}%`);
  const section = currentSection(state.composition);
  setText(dom.sectionTitle, section?.label ?? "No section");
  if (!entries.some(({ section: routed }) => routed.id === section?.id) && section) {
    setText(dom.viewDescription, "Alternate section · select a transition in Constellation to make it part of the performed route.");
  }
}

function updateTransportUi() {
  setPressed(dom.playButton, state.playing);
  setPressed(dom.loopButton, state.loop);
  setPressed(dom.audioButton, state.audioOn);
  if (dom.playButton) {
    dom.playButton.setAttribute("aria-label", state.playing ? "Pause Constellation" : "Play Constellation");
  }
  setText(dom.audioState, state.audioStarting ? "starting" : state.audioOn ? "on" : "off");
  if (dom.audioButton) dom.audioButton.disabled = state.audioStarting;
  const { workBeat, entry, localBeat } = currentPerformancePosition();
  const beatsPerBar = Math.max(1, state.composition.meter?.[0] ?? 4);
  const bar = Math.floor(workBeat / beatsPerBar) + 1;
  const beat = (workBeat % beatsPerBar) + 1;
  setText(dom.transportPosition, `${bar}.${beat.toFixed(2).replace(/\.00$/, "")} · ${entry?.section.label ?? "ready"}`);
  document.body?.toggleAttribute?.("data-playing", state.playing);
  document.body?.style?.setProperty?.("--section-progress", String(entry ? localBeat / Math.max(1, entry.projection.durationBeats) : 0));
}

function populatePresets() {
  if (!dom.presetSelect) return;
  dom.presetSelect.replaceChildren();
  for (const preset of COMPOSITION_PRESETS) {
    const option = element("option", "", `${preset.label} · ${preset.tempo} BPM`);
    option.value = preset.id;
    dom.presetSelect.append(option);
  }
}

function viewLabel(view) {
  return {
    timeline: "Projected Timeline — exact chronological editing generated by timing edges.",
    flow: "Flow Graph — forks create layers, edge weights carry beats, and joins synchronize them.",
    constellation: "Constellation — movements and sections connected as the large form of the work.",
  }[view] ?? "";
}

function setView(view, { focus = false } = {}) {
  if (!["timeline", "flow", "constellation"].includes(view)) return;
  state.view = view;
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === view;
    button.setAttribute("aria-selected", String(active));
    button.setAttribute("aria-pressed", String(active));
    button.tabIndex = active ? 0 : -1;
    if (focus && active) button.focus();
  }
  for (const [name, panel] of [["timeline", dom.timelineView], ["flow", dom.flowView], ["constellation", dom.constellationView]]) {
    if (panel) panel.hidden = name !== view;
  }
  setText(dom.viewDescription, viewLabel(view));
  if (view === "timeline") renderTimeline();
  if (view === "flow") renderFlow();
  if (view === "constellation") renderConstellation();
}

function renderSectionStrip(container, activeId) {
  const strip = element("nav", "constellation-section-strip");
  strip.setAttribute("aria-label", "Composition sections");
  for (const section of state.composition.sections) {
    const button = element("button", "constellation-section-chip", section.label);
    button.type = "button";
    button.dataset.sectionId = section.id;
    button.setAttribute("aria-pressed", String(section.id === activeId));
    button.style.setProperty("--section-color", section.color);
    button.addEventListener("click", () => chooseSection(section.id));
    strip.append(button);
  }
  container.append(strip);
}

function timelinePixelsPerBeat(projection) {
  const available = Math.max(560, (dom.timelineCanvas?.clientWidth ?? 900) - TIMELINE_GUTTER - 36);
  return clamp(available / Math.max(8, projection.durationBeats), MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT, 34);
}

function clipPatternGraphic(clip) {
  const graphic = element("span", "constellation-clip-pattern");
  graphic.setAttribute("aria-hidden", "true");
  const steps = clip.pattern?.steps ?? [1];
  for (let index = 0; index < Math.min(32, steps.length); index += 1) {
    const bar = element("i", steps[index] ? "is-on" : "");
    bar.style.setProperty("--step-level", String(clamp(steps[index], 0, 1, 0)));
    graphic.append(bar);
  }
  return graphic;
}

function clipAt(id) {
  return selectedProjection().clips.find(({ nodeId }) => nodeId === id) ?? null;
}

function beginTimelineDrag(event, clip, clipNode, pixelsPerBeat) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = clipNode.getBoundingClientRect();
  const resize = event.clientX >= bounds.right - 14;
  const startX = event.clientX;
  const originalStart = clip.startBeat;
  const originalDuration = clip.durationBeats;
  clipNode.setPointerCapture?.(event.pointerId);
  clipNode.classList.add("is-dragging");

  const move = (moveEvent) => {
    const deltaBeats = quantizeBeat((moveEvent.clientX - startX) / pixelsPerBeat, .25);
    if (resize) {
      const duration = Math.max(.25, originalDuration + deltaBeats);
      clipNode.style.width = `${Math.max(26, duration * pixelsPerBeat - 6)}px`;
      clipNode.dataset.preview = `${formatBeat(duration)} beats`;
    } else {
      const start = Math.max(0, originalStart + deltaBeats);
      clipNode.style.left = `${TIMELINE_GUTTER + start * pixelsPerBeat}px`;
      clipNode.dataset.preview = `+${formatBeat(start)} beats`;
    }
  };
  const finish = (upEvent) => {
    const deltaBeats = quantizeBeat((upEvent.clientX - startX) / pixelsPerBeat, .25);
    if (resize) {
      state.composition = resizeTimelineClip(state.composition, clip.sectionId, clip.nodeId, Math.max(.25, originalDuration + deltaBeats));
      announce(`${clip.label} duration is now ${formatBeat(Math.max(.25, originalDuration + deltaBeats))} beats.`);
    } else {
      state.composition = moveTimelineClip(state.composition, clip.sectionId, clip.nodeId, Math.max(0, originalStart + deltaBeats));
      announce(`${clip.label} now starts at beat ${formatBeat(Math.max(0, originalStart + deltaBeats))}.`);
    }
    clipNode.releasePointerCapture?.(event.pointerId);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    renderWorkspace();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
}

function renderTimeline() {
  const host = dom.timelineCanvas;
  if (!host) return;
  const projection = selectedProjection();
  const section = projection.section;
  host.replaceChildren();
  renderSectionStrip(host, section?.id);
  if (!section) return;
  const pixelsPerBeat = timelinePixelsPerBeat(projection);
  const width = Math.max(host.clientWidth || 800, TIMELINE_GUTTER + projection.durationBeats * pixelsPerBeat + 64);
  const rowHeight = 76;
  const rulerHeight = 42;
  const lanes = [...new Set(projection.clips.map(({ lane }) => lane))];
  const surface = element("div", "constellation-timeline-surface");
  surface.style.width = `${width}px`;
  surface.style.height = `${rulerHeight + Math.max(1, lanes.length) * rowHeight}px`;
  surface.style.setProperty("--beat-size", `${pixelsPerBeat}px`);
  surface.style.setProperty("--bar-size", `${pixelsPerBeat * (state.composition.meter?.[0] ?? 4)}px`);

  const ruler = element("div", "constellation-ruler");
  ruler.style.left = `${TIMELINE_GUTTER}px`;
  for (let beat = 0; beat <= projection.durationBeats + .001; beat += state.composition.meter?.[0] ?? 4) {
    const mark = element("span", "", String(Math.floor(beat / (state.composition.meter?.[0] ?? 4)) + 1));
    mark.style.left = `${beat * pixelsPerBeat}px`;
    ruler.append(mark);
  }
  surface.append(ruler);

  projection.clips.forEach((clip, index) => {
    const rowTop = rulerHeight + index * rowHeight;
    const row = element("div", "constellation-lane-row");
    row.style.top = `${rowTop}px`;
    row.style.height = `${rowHeight}px`;
    const label = element("button", "constellation-lane-label");
    label.type = "button";
    label.style.setProperty("--instrument-color", clip.instrumentColor);
    label.append(element("b", "", clip.label), element("small", "", clip.instrumentLabel));
    label.addEventListener("click", () => selectClip(clip.nodeId));
    row.append(label);
    surface.append(row);

    const block = element("button", `constellation-clip${state.selectedNodeId === clip.nodeId ? " is-selected" : ""}`);
    block.type = "button";
    block.dataset.nodeId = clip.nodeId;
    block.style.left = `${TIMELINE_GUTTER + clip.startBeat * pixelsPerBeat}px`;
    block.style.top = `${rowTop + 8}px`;
    block.style.width = `${Math.max(34, clip.durationBeats * pixelsPerBeat - 6)}px`;
    block.style.height = `${rowHeight - 16}px`;
    block.style.setProperty("--instrument-color", clip.instrumentColor);
    block.setAttribute("aria-label", `${clip.label}, starts at beat ${formatBeat(clip.startBeat)}, duration ${formatBeat(clip.durationBeats)} beats. Drag to move; drag the right edge to resize.`);
    const copy = element("span", "constellation-clip-copy");
    copy.append(element("b", "", clip.label), element("small", "", `${clip.patternId} · ${formatBeat(clip.durationBeats)} beats`));
    block.append(copy, clipPatternGraphic(clip), element("i", "constellation-resize-handle"));
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      selectClip(clip.nodeId);
    });
    block.addEventListener("pointerdown", (event) => beginTimelineDrag(event, clip, block, pixelsPerBeat));
    block.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowRight" ? 1 : -1;
      if (event.shiftKey) state.composition = resizeTimelineClip(state.composition, clip.sectionId, clip.nodeId, clip.durationBeats + direction * .25);
      else state.composition = moveTimelineClip(state.composition, clip.sectionId, clip.nodeId, clip.startBeat + direction * .25);
      renderWorkspace();
      requestAnimationFrame(() => dom.timelineCanvas?.querySelector?.(`[data-node-id="${CSS.escape(clip.nodeId)}"]`)?.focus?.());
    });
    surface.append(block);
  });

  const playhead = element("div", "constellation-playhead");
  playhead.dataset.timelinePlayhead = "";
  playhead.style.left = `${TIMELINE_GUTTER}px`;
  playhead.style.top = `${rulerHeight}px`;
  playhead.style.height = `${Math.max(1, lanes.length) * rowHeight}px`;
  surface.append(playhead);
  surface.addEventListener("click", (event) => {
    if (event.target.closest?.("button")) return;
    const bounds = surface.getBoundingClientRect();
    const beat = clamp((event.clientX - bounds.left - TIMELINE_GUTTER) / pixelsPerBeat, 0, projection.durationBeats, 0);
    seekToSectionBeat(section.id, beat);
  });
  surface.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("text/x-morphazoid-instrument")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  surface.addEventListener("drop", (event) => {
    const instrumentId = event.dataTransfer?.getData("text/x-morphazoid-instrument");
    if (!instrumentId) return;
    event.preventDefault();
    const bounds = surface.getBoundingClientRect();
    const startBeat = clamp((event.clientX - bounds.left - TIMELINE_GUTTER) / pixelsPerBeat, 0, projection.durationBeats + 32, 0);
    insertInstrument(instrumentId, startBeat);
  });
  host.append(surface);
  updatePlayheadVisuals();
}

function flowNodeClass(node) {
  return `constellation-flow-node is-${node.type}${state.selectedNodeId === node.id ? " is-selected" : ""}`;
}

function beginGraphNodeDrag(event, kind, id, svg) {
  if (event.button !== 0) return;
  event.preventDefault();
  const point = svg.createSVGPoint?.();
  const position = (clientX, clientY) => {
    if (!point || !svg.getScreenCTM?.()) return { x: .5, y: .5 };
    point.x = clientX;
    point.y = clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: clamp((local.x - 55) / 890, 0, 1, .5), y: clamp((local.y - 48) / 424, 0, 1, .5) };
  };
  const move = (moveEvent) => {
    const next = position(moveEvent.clientX, moveEvent.clientY);
    const target = svg.querySelector(`[data-${kind}-id="${CSS.escape(id)}"]`);
    target?.setAttribute("transform", `translate(${55 + next.x * 890} ${48 + next.y * 424})`);
  };
  const finish = (upEvent) => {
    const next = position(upEvent.clientX, upEvent.clientY);
    if (kind === "flow-node") {
      state.composition = moveFlowNode(state.composition, currentSection(state.composition)?.id, id, next.x, next.y);
      const clip = clipAt(id);
      if (clip) {
        const projection = selectedProjection();
        state.composition = moveTimelineClip(state.composition, clip.sectionId, clip.nodeId, next.x * projection.durationBeats * .78);
      }
    } else {
      state.composition = moveSectionNode(state.composition, id, next.x, next.y);
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    renderWorkspace();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", finish, { once: true });
}

function renderFlow() {
  const host = dom.flowCanvas;
  if (!host) return;
  host.replaceChildren();
  const section = currentSection(state.composition);
  renderSectionStrip(host, section?.id);
  if (!section) return;
  const projection = projectTimeline(state.composition, section.id);
  const projectedByNode = new Map(projection.clips.map((clip) => [clip.nodeId, clip]));
  const svg = svgElement("svg", { viewBox: "0 0 1000 520", role: "application", "aria-label": `${section.label} timing flow graph` });
  svg.classList.add("constellation-flow-svg");
  const defs = svgElement("defs");
  const marker = svgElement("marker", { id: "constellationArrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" }));
  defs.append(marker);
  svg.append(defs);
  const nodeById = new Map(section.flow.nodes.map((node) => [node.id, node]));
  const position = (node) => ({ x: 55 + clamp(node.x, 0, 1, .5) * 890, y: 48 + clamp(node.y, 0, 1, .5) * 424 });
  for (const edge of section.flow.edges) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    if (!fromNode || !toNode) continue;
    const from = position(fromNode);
    const to = position(toNode);
    const bend = Math.max(32, Math.abs(to.x - from.x) * .38);
    const path = svgElement("path", {
      d: `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`,
      class: `constellation-flow-edge${edge.mode === "choice" ? " is-choice" : ""}`,
      "data-edge-id": edge.id,
      "marker-end": "url(#constellationArrow)",
    });
    svg.append(path);
    if (edge.delayBeats > 0) {
      const label = svgElement("text", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 8, class: "constellation-edge-label", "text-anchor": "middle" });
      label.textContent = `+${formatBeat(edge.delayBeats)} beats`;
      svg.append(label);
    }
  }
  for (const node of section.flow.nodes) {
    const at = position(node);
    const group = svgElement("g", { transform: `translate(${at.x} ${at.y})`, class: flowNodeClass(node), tabindex: 0, role: "button", "data-flow-node-id": node.id });
    const clip = projectedByNode.get(node.id);
    if (["fork", "join"].includes(node.type)) group.append(svgElement("path", { d: "M 0 -27 L 34 0 L 0 27 L -34 0 Z" }));
    else if (["entry", "exit"].includes(node.type)) group.append(svgElement("circle", { r: 23 }));
    else group.append(svgElement("rect", { x: -68, y: -31, width: 136, height: 62, rx: 12 }));
    const title = svgElement("text", { y: clip ? -5 : 4, "text-anchor": "middle", class: "constellation-flow-node-title" });
    title.textContent = node.label;
    group.append(title);
    if (clip) {
      const detail = svgElement("text", { y: 14, "text-anchor": "middle", class: "constellation-flow-node-detail" });
      detail.textContent = `+${formatBeat(clip.startBeat)} · ${formatBeat(clip.durationBeats)}b`;
      group.append(detail);
      group.style.setProperty("--node-color", clip.instrumentColor);
    }
    group.addEventListener("click", () => {
      if (clip) selectClip(node.id);
    });
    group.addEventListener("dblclick", () => {
      if (clip) setView("timeline", { focus: true });
    });
    group.addEventListener("pointerdown", (event) => beginGraphNodeDrag(event, "flow-node", node.id, svg));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && clip) selectClip(node.id);
    });
    svg.append(group);
  }
  const legend = svgElement("text", { x: 26, y: 500, class: "constellation-svg-note" });
  legend.textContent = "DRAG A MUSICAL NODE HORIZONTALLY TO CHANGE ITS INCOMING EDGE TIME";
  svg.append(legend);
  host.append(svg);
  updatePlayheadVisuals();
}

function renderConstellation() {
  const host = dom.constellationCanvas;
  if (!host) return;
  host.replaceChildren();
  const svg = svgElement("svg", { viewBox: "0 0 1000 520", role: "application", "aria-label": `${state.composition.label} section constellation` });
  svg.classList.add("constellation-form-svg");
  const defs = svgElement("defs");
  const marker = svgElement("marker", { id: "constellationSectionArrow", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto-start-reverse" });
  marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "currentColor" }));
  defs.append(marker);
  svg.append(defs);
  const byId = new Map(state.composition.sections.map((section) => [section.id, section]));
  const position = (section) => ({ x: 55 + clamp(section.x, 0, 1, .5) * 890, y: 48 + clamp(section.y, 0, 1, .5) * 424 });
  for (const transition of state.composition.transitions) {
    const fromSection = byId.get(transition.from);
    const toSection = byId.get(transition.to);
    if (!fromSection || !toSection) continue;
    const from = position(fromSection);
    const to = position(toSection);
    const edge = svgElement("path", {
      d: `M ${from.x} ${from.y} C ${(from.x + to.x) / 2} ${from.y}, ${(from.x + to.x) / 2} ${to.y}, ${to.x} ${to.y}`,
      class: `constellation-section-edge${transition.mode === "choice" ? " is-choice" : ""}`,
      "marker-end": "url(#constellationSectionArrow)",
    });
    svg.append(edge);
    const label = svgElement("text", { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 9, "text-anchor": "middle", class: "constellation-edge-label" });
    label.textContent = transition.label ?? transition.mode;
    svg.append(label);
  }
  for (const section of state.composition.sections) {
    const at = position(section);
    const projection = projectTimeline(state.composition, section.id);
    const selected = currentSection(state.composition)?.id === section.id;
    const group = svgElement("g", {
      transform: `translate(${at.x} ${at.y})`,
      class: `constellation-section-node${selected ? " is-selected" : ""}`,
      tabindex: 0,
      role: "button",
      "data-section-id": section.id,
      "aria-label": `${section.label}, ${projection.clips.length} layers, ${formatBeat(projection.durationBeats)} beats`,
    });
    group.style.setProperty("--section-color", section.color);
    group.append(svgElement("circle", { r: 56, class: "constellation-section-halo" }), svgElement("circle", { r: 40, class: "constellation-section-core" }));
    const title = svgElement("text", { y: -4, "text-anchor": "middle", class: "constellation-section-title" });
    title.textContent = section.label.replace(/^\d+\s*·\s*/, "");
    const detail = svgElement("text", { y: 15, "text-anchor": "middle", class: "constellation-section-detail" });
    detail.textContent = `${projection.clips.length} layers · ${formatBeat(projection.durationBeats)}b`;
    group.append(title, detail);
    for (let index = 0; index < Math.min(8, projection.clips.length); index += 1) {
      const angle = (index / projection.clips.length) * Math.PI * 2 - Math.PI / 2;
      group.append(svgElement("circle", { cx: Math.cos(angle) * 48, cy: Math.sin(angle) * 48, r: 3.5, class: "constellation-section-satellite" }));
    }
    group.addEventListener("click", () => chooseSection(section.id));
    group.addEventListener("dblclick", () => {
      chooseSection(section.id);
      setView("flow", { focus: true });
    });
    group.addEventListener("pointerdown", (event) => beginGraphNodeDrag(event, "section", section.id, svg));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter") chooseSection(section.id);
    });
    svg.append(group);
  }
  const note = svgElement("text", { x: 26, y: 500, class: "constellation-svg-note" });
  note.textContent = "DOUBLE-CLICK A SECTION TO ENTER ITS FLOW GRAPH · DASHED ROUTES ARE ALTERNATES";
  svg.append(note);
  host.append(svg);
  updatePlayheadVisuals();
}

function renderInstrumentBrowser() {
  const host = dom.instrumentBrowser;
  if (!host) return;
  host.replaceChildren();
  for (const instrument of INSTRUMENT_LIBRARY) {
    const card = element("article", "constellation-instrument-card");
    card.draggable = true;
    card.dataset.instrumentId = instrument.id;
    card.style.setProperty("--instrument-color", instrument.color);
    const image = element("img", "constellation-instrument-image");
    image.src = instrument.imageHref;
    image.alt = "";
    image.width = 80;
    image.height = 80;
    image.loading = "lazy";
    const copy = element("div", "constellation-instrument-copy");
    copy.append(element("b", "", instrument.label), element("small", "", instrument.description));
    const actions = element("div", "constellation-instrument-actions");
    const add = element("button", "", "Insert");
    add.type = "button";
    add.addEventListener("click", () => insertInstrument(instrument.id));
    const open = element("a", "", "Open");
    open.href = instrument.href;
    open.title = `Open ${instrument.label} in its full instrument page`;
    actions.append(add, open);
    card.append(image, copy, actions);
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/x-morphazoid-instrument", instrument.id);
      event.dataTransfer?.setData("text/plain", instrument.label);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    host.append(card);
  }
}

function selectedNode() {
  return currentSection(state.composition)?.flow?.nodes?.find(({ id }) => id === state.selectedNodeId) ?? null;
}

function updateSelectedNode(patch) {
  const next = typeof structuredClone === "function"
    ? structuredClone(state.composition)
    : JSON.parse(JSON.stringify(state.composition));
  const node = next.sections.find(({ id }) => id === next.selectedSectionId)?.flow?.nodes?.find(({ id }) => id === state.selectedNodeId);
  if (!node) return;
  Object.assign(node, patch);
  state.composition = next;
  renderWorkspace();
}

function inspectorField(labelText, input) {
  const label = element("label", "constellation-inspector-field");
  label.append(element("span", "", labelText), input);
  return label;
}

function renderInspector() {
  const host = dom.inspector;
  if (!host) return;
  host.replaceChildren();
  const section = currentSection(state.composition);
  const node = selectedNode();
  if (!node || node.type !== "clip") {
    const empty = element("div", "constellation-inspector-empty");
    empty.append(element("b", "", section?.label ?? "Constellation"), element("p", "", section?.description ?? "Select a musical node to edit its graph timing and sound."));
    host.append(empty);
    return;
  }
  const clip = clipAt(node.id);
  const instrument = INSTRUMENT_LIBRARY.find(({ id }) => id === node.instrumentId);
  const heading = element("header", "constellation-inspector-heading");
  heading.style.setProperty("--instrument-color", instrument?.color ?? "#8de7ff");
  heading.append(element("small", "", instrument?.label ?? "Instrument"), element("h3", "", node.label));
  host.append(heading);

  const start = element("input");
  start.type = "range";
  start.min = "0";
  start.max = String(Math.max(32, selectedProjection().durationBeats));
  start.step = ".25";
  start.value = String(clip?.startBeat ?? 0);
  const startField = inspectorField(`Incoming edge · +${formatBeat(clip?.startBeat ?? 0)} beats`, start);
  start.addEventListener("input", () => {
    startField.firstElementChild.textContent = `Incoming edge · +${formatBeat(start.value)} beats`;
  });
  start.addEventListener("change", () => {
    state.composition = moveTimelineClip(state.composition, section.id, node.id, start.value);
    renderWorkspace();
  });

  const duration = element("input");
  duration.type = "range";
  duration.min = ".25";
  duration.max = "64";
  duration.step = ".25";
  duration.value = String(node.durationBeats);
  const durationField = inspectorField(`Duration · ${formatBeat(node.durationBeats)} beats`, duration);
  duration.addEventListener("input", () => {
    durationField.firstElementChild.textContent = `Duration · ${formatBeat(duration.value)} beats`;
  });
  duration.addEventListener("change", () => {
    state.composition = resizeTimelineClip(state.composition, section.id, node.id, duration.value);
    renderWorkspace();
  });

  const rootNote = element("input");
  rootNote.type = "range";
  rootNote.min = "24";
  rootNote.max = "96";
  rootNote.step = "1";
  rootNote.value = String(node.rootNote);
  const rootField = inspectorField(`Root note · MIDI ${node.rootNote}`, rootNote);
  rootNote.addEventListener("input", () => {
    rootField.firstElementChild.textContent = `Root note · MIDI ${rootNote.value}`;
  });
  rootNote.addEventListener("change", () => updateSelectedNode({ rootNote: Number(rootNote.value) }));

  const sound = element("input");
  sound.type = "text";
  sound.value = node.soundId;
  sound.addEventListener("change", () => updateSelectedNode({ soundId: sound.value.trim() || node.instrumentId }));
  host.append(startField, durationField, rootField, inspectorField("Sound character", sound));

  const graphReadout = element("dl", "constellation-inspector-readout");
  for (const [term, detail] of [["Node", node.id], ["Pattern", node.patternId], ["Lane", String(node.lane + 1)], ["Graph timing", `arrival ${formatBeat(clip?.startBeat ?? 0)} → exit ${formatBeat(clip?.endBeat ?? 0)}`]]) {
    const row = element("div");
    row.append(element("dt", "", term), element("dd", "", detail));
    graphReadout.append(row);
  }
  host.append(graphReadout);
  if (instrument?.href) {
    const open = element("a", "constellation-open-instrument", `Open full ${instrument.label} editor ↗`);
    open.href = instrument.href;
    host.append(open);
  }
}

function renderWorkspace() {
  updateCompositionReadouts();
  if (state.view === "timeline") renderTimeline();
  if (state.view === "flow") renderFlow();
  if (state.view === "constellation") renderConstellation();
  renderInspector();
  updateTransportUi();
}

function selectClip(nodeId) {
  state.selectedNodeId = nodeId;
  renderWorkspace();
  announce(`${selectedNode()?.label ?? "Musical node"} selected.`);
}

function chooseSection(sectionId) {
  state.composition = selectSection(state.composition, sectionId);
  state.selectedNodeId = projectTimeline(state.composition, sectionId).clips[0]?.nodeId ?? null;
  renderWorkspace();
  announce(`${currentSection(state.composition)?.label ?? "Section"} selected.`);
}

function insertInstrument(instrumentId, requestedStartBeat) {
  const section = currentSection(state.composition);
  if (!section) return;
  const projection = projectTimeline(state.composition, section.id);
  const position = currentPerformancePosition();
  const startBeat = requestedStartBeat ?? (
    position.entry?.section.id === section.id ? position.localBeat : Math.min(4, projection.durationBeats)
  );
  state.composition = addInstrumentClip(state.composition, section.id, instrumentId, {
    startBeat: quantizeBeat(startBeat, .25),
    durationBeats: 16,
  });
  const clips = projectTimeline(state.composition, section.id).clips;
  state.selectedNodeId = clips.at(-1)?.nodeId ?? state.selectedNodeId;
  const instrument = INSTRUMENT_LIBRARY.find(({ id }) => id === instrumentId);
  renderWorkspace();
  announce(`${instrument?.label ?? "Instrument"} inserted at beat ${formatBeat(startBeat)}.`);
}

async function setAudioOn(enabled) {
  if (enabled === state.audioOn && !state.audioStarting) return;
  if (!enabled) {
    if (state.playing) pauseTransport();
    state.audioOn = false;
    audio.silence();
    updateTransportUi();
    announce("Audio off. Scheduled voices cleared.");
    return;
  }
  state.audioStarting = true;
  updateTransportUi();
  try {
    await audio.start();
    if (state.disposed) return;
    audio.setOutput(state.output);
    state.audioOn = true;
    announce("Audio on. Constellation presets are ready to play.");
  } catch (error) {
    state.audioOn = false;
    announce(`Audio unavailable: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    state.audioStarting = false;
    updateTransportUi();
  }
}

function absoluteBeatNow() {
  if (!state.playing) return state.absoluteBeat;
  return state.transportStartBeat + (clockNow() - state.transportStartTime) / secondsPerBeat();
}

function scheduleWindow(fromAbsoluteBeat, toAbsoluteBeat, nowAbsoluteBeat) {
  const total = Math.max(1, totalRouteBeats());
  let cursor = fromAbsoluteBeat;
  let safety = 0;
  while (cursor < toAbsoluteBeat - 1e-7 && safety < 8) {
    safety += 1;
    const cycle = Math.floor(cursor / total);
    const cycleStart = cycle * total;
    const localFrom = cursor - cycleStart;
    const localTo = Math.min(total, toAbsoluteBeat - cycleStart);
    for (const entry of routeEntries()) {
      const overlapStart = Math.max(localFrom, entry.startBeat);
      const overlapEnd = Math.min(localTo, entry.endBeat);
      if (overlapEnd <= overlapStart + 1e-7) continue;
      const events = performanceEventsForWindow(
        entry.projection.clips,
        overlapStart - entry.startBeat,
        overlapEnd - entry.startBeat,
      );
      for (const event of events) {
        const absoluteEventBeat = cycleStart + entry.startBeat + event.beat;
        const delaySeconds = Math.max(0, (absoluteEventBeat - nowAbsoluteBeat) * secondsPerBeat());
        void audio.trigger(event, { delaySeconds, secondsPerBeat: secondsPerBeat() }).catch(() => {});
      }
    }
    cursor = cycleStart + localTo;
    if (localTo >= total - 1e-7) cursor = cycleStart + total;
  }
}

function schedulerTick() {
  if (!state.playing || !state.audioOn) return;
  const nowBeat = absoluteBeatNow();
  const total = totalRouteBeats();
  if (!state.loop && nowBeat >= total) {
    stopTransport({ reset: false });
    state.absoluteBeat = total;
    updateTransportUi();
    return;
  }
  const target = state.loop
    ? nowBeat + LOOKAHEAD_SECONDS / secondsPerBeat()
    : Math.min(total, nowBeat + LOOKAHEAD_SECONDS / secondsPerBeat());
  scheduleWindow(state.scheduleBeat, target, nowBeat);
  state.scheduleBeat = target;
}

async function playTransport() {
  if (state.playing) {
    pauseTransport();
    return;
  }
  if (!state.audioOn) await setAudioOn(true);
  if (!state.audioOn || state.disposed) return;
  const total = totalRouteBeats();
  if (!state.loop && state.absoluteBeat >= total) state.absoluteBeat = 0;
  state.transportStartBeat = state.absoluteBeat;
  state.transportStartTime = clockNow();
  state.scheduleBeat = state.absoluteBeat;
  state.playing = true;
  if (state.scheduler) clearInterval(state.scheduler);
  state.scheduler = setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
  schedulerTick();
  updateTransportUi();
  requestAnimation();
  announce(`Playing ${state.composition.label}.`);
}

function pauseTransport() {
  if (!state.playing) return;
  state.absoluteBeat = absoluteBeatNow();
  state.playing = false;
  if (state.scheduler) clearInterval(state.scheduler);
  state.scheduler = null;
  audio.silence();
  updateTransportUi();
  announce("Constellation paused.");
}

function stopTransport({ reset = true } = {}) {
  state.playing = false;
  if (state.scheduler) clearInterval(state.scheduler);
  state.scheduler = null;
  audio.silence();
  if (reset) state.absoluteBeat = 0;
  updateTransportUi();
  updatePlayheadVisuals();
  announce(reset ? "Transport returned to the beginning." : "Constellation reached its final section.");
}

function seekToSectionBeat(sectionId, localBeat) {
  const entry = routeEntries().find(({ section }) => section.id === sectionId);
  if (!entry) {
    chooseSection(sectionId);
    state.absoluteBeat = clamp(localBeat, 0, projectTimeline(state.composition, sectionId).durationBeats, 0);
  } else {
    const currentCycle = Math.floor(state.absoluteBeat / Math.max(1, totalRouteBeats()));
    state.absoluteBeat = currentCycle * totalRouteBeats() + entry.startBeat + clamp(localBeat, 0, entry.projection.durationBeats, 0);
  }
  if (state.playing) {
    audio.silence();
    state.transportStartBeat = state.absoluteBeat;
    state.transportStartTime = clockNow();
    state.scheduleBeat = state.absoluteBeat;
    schedulerTick();
  }
  updateTransportUi();
  updatePlayheadVisuals();
}

function updatePlayheadVisuals() {
  const position = currentPerformancePosition();
  const selected = currentSection(state.composition);
  if (position.entry && state.playing && selected?.id !== position.entry.section.id) {
    state.composition = selectSection(state.composition, position.entry.section.id);
    state.selectedNodeId = projectTimeline(state.composition, position.entry.section.id).clips[0]?.nodeId ?? null;
    renderWorkspace();
    return;
  }
  const projection = selectedProjection();
  const localBeat = position.entry?.section.id === selected?.id ? position.localBeat : 0;
  const pixelsPerBeat = timelinePixelsPerBeat(projection);
  for (const playhead of document.querySelectorAll("[data-timeline-playhead]")) {
    playhead.style.left = `${TIMELINE_GUTTER + clamp(localBeat, 0, projection.durationBeats, 0) * pixelsPerBeat}px`;
  }
  for (const clipNode of document.querySelectorAll(".constellation-clip")) {
    const clip = projection.clips.find(({ nodeId }) => nodeId === clipNode.dataset.nodeId);
    clipNode.classList.toggle("is-sounding", Boolean(clip && localBeat >= clip.startBeat && localBeat < clip.endBeat));
  }
  for (const flowNode of document.querySelectorAll("[data-flow-node-id]")) {
    const clip = projection.clips.find(({ nodeId }) => nodeId === flowNode.dataset.flowNodeId);
    flowNode.classList.toggle("is-active", Boolean(clip && localBeat >= clip.startBeat && localBeat < clip.endBeat));
  }
  for (const sectionNode of document.querySelectorAll("[data-section-id]")) {
    sectionNode.classList.toggle("is-active", sectionNode.dataset.sectionId === position.entry?.section.id && state.playing);
  }
  updateTransportUi();
}

function animationLoop() {
  state.animationFrame = null;
  if (state.playing) {
    state.absoluteBeat = absoluteBeatNow();
    updatePlayheadVisuals();
    if (!state.loop && state.absoluteBeat >= totalRouteBeats()) stopTransport({ reset: false });
  }
  if (state.playing) requestAnimation();
}

function requestAnimation() {
  if (state.animationFrame === null) state.animationFrame = requestAnimationFrame(animationLoop);
}

function loadPreset(id) {
  stopTransport();
  state.composition = cloneCompositionPreset(id);
  state.tempo = state.composition.tempo;
  state.selectedNodeId = selectedProjection().clips[0]?.nodeId ?? null;
  state.absoluteBeat = 0;
  renderWorkspace();
  announce(`${state.composition.label} loaded: ${state.composition.sections.length} sections at ${state.tempo} BPM.`);
}

function bindUi() {
  dom.audioButton?.addEventListener("click", () => void setAudioOn(!state.audioOn));
  dom.playButton?.addEventListener("click", () => void playTransport());
  dom.stopButton?.addEventListener("click", () => stopTransport());
  dom.loopButton?.addEventListener("click", () => {
    state.loop = !state.loop;
    updateTransportUi();
    announce(`Work loop ${state.loop ? "on" : "off"}.`);
  });
  dom.presetSelect?.addEventListener("change", () => loadPreset(dom.presetSelect.value));
  dom.tempo?.addEventListener("input", () => {
    const before = absoluteBeatNow();
    state.tempo = clamp(dom.tempo.value, 30, 240, state.tempo);
    if (state.playing) {
      state.absoluteBeat = before;
      state.transportStartBeat = before;
      state.transportStartTime = clockNow();
      state.scheduleBeat = before;
      audio.silence();
      schedulerTick();
    }
    setText(dom.tempoOut, `${Math.round(state.tempo)} BPM`);
  });
  dom.output?.addEventListener("input", () => {
    state.output = clamp(dom.output.value, 0, .85, .54);
    audio.setOutput(state.output);
    setText(dom.outputOut, `${Math.round(state.output * 100)}%`);
  });
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.dataset.view));
    button.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const views = ["timeline", "flow", "constellation"];
      const direction = event.key === "ArrowRight" ? 1 : -1;
      setView(views[(views.indexOf(state.view) + direction + views.length) % views.length], { focus: true });
    });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.playing) pauseTransport();
  });
  window.addEventListener("pagehide", dispose, { once: true });
}

async function dispose() {
  state.disposed = true;
  if (state.scheduler) clearInterval(state.scheduler);
  if (state.animationFrame !== null) cancelAnimationFrame(state.animationFrame);
  state.scheduler = null;
  state.animationFrame = null;
  await audio.close();
}

function initialize() {
  populatePresets();
  renderInstrumentBrowser();
  state.selectedNodeId = selectedProjection().clips[0]?.nodeId ?? null;
  bindUi();
  setView("timeline");
  renderWorkspace();
  announce(`${state.composition.label} ready. Choose Audio, then Play.`);
}

initialize();
