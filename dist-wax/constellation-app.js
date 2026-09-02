import {
  DEVICE_LIBRARY,
  PATCH_PRESETS,
  PRIMITIVE_LIBRARY,
  SIGNAL_TYPES,
  addConnection,
  addDeviceNode,
  clonePatchPreset,
  currentGraph,
  formatBeat,
  getGraph,
  graphBreadcrumbs,
  moveGraphNode,
  moveProjectedEvent,
  portsForNode,
  projectGraphEvents,
  projectTimeline,
  removeConnection,
  selectGraph,
  updateConnection,
  updateGraphNode,
  validatePatch,
} from "./src/constellation-composer.js";
import {
  ConstellationAudio,
  performanceEventsForWindow,
} from "./src/constellation-audio.js";

const $ = (id) => document.getElementById(id);
const SVG_NS = "http://www.w3.org/2000/svg";
const EPSILON = 1e-7;
const LOOKAHEAD_SECONDS = .3;
const SCHEDULER_INTERVAL_MS = 25;
const TIMELINE_GUTTER = 164;
const MIN_PIXELS_PER_BEAT = 28;
const MAX_PIXELS_PER_BEAT = 62;
const GRAPH_WIDTH = 1_000;
const GRAPH_HEIGHT = 520;
const SIGNAL_COLORS = Object.freeze({
  trigger: "#e8c46b",
  audio: "#70e3e8",
  control: "#b299ff",
});

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
  graphBreadcrumb: $("graphBreadcrumb"),
  graphTitle: $("sectionTitle"),
  transportPosition: $("transportPosition"),
  liveStatus: $("liveStatus"),
};

const audio = new ConstellationAudio(globalThis);
const state = {
  patch: clonePatchPreset(PATCH_PRESETS[0]?.id),
  view: "constellation",
  selection: null,
  connecting: null,
  paletteCategory: "all",
  playing: false,
  loop: true,
  audioOn: false,
  audioStarting: false,
  audioStartPromise: null,
  output: .54,
  tempo: PATCH_PRESETS[0]?.tempo ?? 120,
  absoluteBeat: 0,
  transportStartBeat: 0,
  transportStartTime: 0,
  scheduleBeat: 0,
  scheduler: null,
  animationFrame: null,
  projectionCache: null,
  timelineProjectionCache: null,
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
  return (globalThis.performance?.now?.() ?? Date.now()) / 1_000;
}

function cycleBeats() {
  return Math.max(.25, finite(state.patch.cycleBeats, 16));
}

function syncAudioTransport(beat = state.absoluteBeat) {
  audio.syncTransport({ tempo: state.tempo, beat, contextTime: clockNow() });
}

function wrappedBeat(beat = state.absoluteBeat) {
  const duration = cycleBeats();
  if (!state.loop) return clamp(beat, 0, duration, 0);
  return ((beat % duration) + duration) % duration;
}

function rootProjection() {
  if (state.projectionCache?.patch === state.patch) return state.projectionCache.projection;
  const projection = projectGraphEvents(state.patch, { durationBeats: cycleBeats() });
  state.projectionCache = { patch: state.patch, projection };
  return projection;
}

function selectedProjection() {
  if (state.timelineProjectionCache?.patch === state.patch
    && state.timelineProjectionCache.graphId === state.patch.selectedGraphId) {
    return state.timelineProjectionCache.projection;
  }
  const projection = projectTimeline(state.patch, state.patch.selectedGraphId, { durationBeats: cycleBeats() });
  state.timelineProjectionCache = { patch: state.patch, graphId: state.patch.selectedGraphId, projection };
  return projection;
}

function controlStateAtBeat(absoluteBeat) {
  const localBeat = wrappedBeat(absoluteBeat);
  const latest = new Map();
  const cycleTail = new Map();
  for (const event of rootProjection().events) {
    if (event.signal !== "control") continue;
    cycleTail.set(event.address, event);
    if (event.beat <= localBeat + EPSILON) latest.set(event.address, event);
  }
  if (state.loop) {
    for (const [address, event] of cycleTail) {
      if (!latest.has(address)) latest.set(address, event);
    }
  }
  return [...latest.values()];
}

function primeControlState(absoluteBeat) {
  if (!state.audioOn) return;
  const beatSeconds = secondsPerBeat();
  for (const event of controlStateAtBeat(absoluteBeat)) {
    audio.trigger(event, { delaySeconds: 0, secondsPerBeat: beatSeconds }).catch(() => {
      state.audioOn = false;
      updateTransportUi();
    });
  }
}

function resetScheduledControl({ beat = state.absoluteBeat, prime = false, toBase = true } = {}) {
  audio.resetControls?.({ toBase });
  if (prime) primeControlState(beat);
}

function commitPatch(next, { rebuildAudio = true, reschedule = true } = {}) {
  const validation = validatePatch(next);
  if (!validation.valid) {
    state.selection = null;
    state.connecting = null;
    renderWorkspace();
    announce(`Patch unchanged: ${validation.errors[0] ?? "that edit would create an invalid graph."}`);
    return false;
  }
  const nowBeat = absoluteBeatNow();
  state.patch = next;
  state.projectionCache = null;
  state.timelineProjectionCache = null;
  if (rebuildAudio) audio.setPatch(state.patch);
  if (reschedule && state.audioOn) {
    if (state.playing) {
      state.absoluteBeat = nowBeat;
      state.transportStartBeat = nowBeat;
      state.transportStartTime = clockNow();
      state.scheduleBeat = nowBeat;
    }
    audio.silence();
    resetScheduledControl({ beat: nowBeat, prime: true });
    if (state.playing) schedulerTick();
  }
  renderWorkspace();
  return true;
}

function graphNode(graphId, nodeId) {
  return getGraph(state.patch, graphId)?.nodes?.find(({ id }) => id === nodeId) ?? null;
}

function graphEdge(graphId, edgeId) {
  return getGraph(state.patch, graphId)?.edges?.find(({ id }) => id === edgeId) ?? null;
}

function selectedNode() {
  return state.selection?.kind === "node"
    ? graphNode(state.selection.graphId, state.selection.nodeId)
    : null;
}

function selectedEdge() {
  return state.selection?.kind === "edge"
    ? graphEdge(state.selection.graphId, state.selection.edgeId)
    : null;
}

function deviceForNode(node) {
  return DEVICE_LIBRARY.find(({ id }) => id === node?.deviceId) ?? null;
}

function nodeColor(node) {
  if (node?.type === "subgraph") return deviceForNode(node)?.color ?? "#8de7ff";
  if (node?.type === "primitive") return PRIMITIVE_LIBRARY[node.primitiveId]?.color ?? "#8de7ff";
  return SIGNAL_COLORS[node?.signal] ?? "#82939a";
}

function nodeCategory(node) {
  if (node?.type === "subgraph") return getGraph(state.patch, node.graphId)?.kind ?? "graph";
  if (node?.type === "primitive") return PRIMITIVE_LIBRARY[node.primitiveId]?.category ?? "primitive";
  return node?.type === "port" ? `${node.signal} ${node.direction}` : "node";
}

function graphPoint(node) {
  return {
    x: 72 + clamp(node?.x, 0, 1, .5) * 856,
    y: 54 + clamp(node?.y, 0, 1, .5) * 412,
  };
}

function nodePortPosition(graph, node, portDefinition) {
  const at = graphPoint(node);
  const ports = portsForNode(state.patch, graph, node).filter(({ direction }) => direction === portDefinition.direction);
  const index = Math.max(0, ports.findIndex(({ id }) => id === portDefinition.id));
  const spacing = Math.min(20, 58 / Math.max(1, ports.length));
  const y = at.y + (index - (ports.length - 1) / 2) * spacing;
  return { x: at.x + (portDefinition.direction === "in" ? -64 : 64), y };
}

function edgeDescription(edge) {
  if (edge.signal === "trigger") {
    const delay = finite(edge.timing?.delayBeats, 0);
    const chance = Math.round(clamp(edge.timing?.probability, 0, 1, 1) * 100);
    return `${delay > 0 ? `+${formatBeat(delay)}b` : "now"}${chance < 100 ? ` · ${chance}%` : ""}`;
  }
  if (edge.signal === "control") return `${Math.round(clamp(edge.gain, 0, 2, 1) * 100)}% mod`;
  return `${Math.round(clamp(edge.gain, 0, 2, 1) * 100)}% signal${edge.feedback ? " · feedback" : ""}`;
}

function populatePresets() {
  if (!dom.presetSelect) return;
  dom.presetSelect.replaceChildren();
  for (const preset of PATCH_PRESETS) {
    const option = element("option", "", preset.label);
    option.value = preset.id;
    dom.presetSelect.append(option);
  }
  dom.presetSelect.value = state.patch.id;
}

function renderBreadcrumb() {
  if (!dom.graphBreadcrumb) return;
  dom.graphBreadcrumb.replaceChildren();
  const crumbs = graphBreadcrumbs(state.patch, state.patch.selectedGraphId);
  crumbs.forEach((crumb, index) => {
    if (index > 0) dom.graphBreadcrumb.append(element("span", "graph-breadcrumb-separator", "/"));
    const button = element("button", "graph-breadcrumb-item", crumb.label);
    button.type = "button";
    button.dataset.graphId = crumb.graphId;
    button.disabled = crumb.graphId === state.patch.selectedGraphId;
    button.addEventListener("click", () => openGraph(crumb.graphId));
    dom.graphBreadcrumb.append(button);
  });
}

function updatePatchReadouts() {
  const graph = currentGraph(state.patch);
  setText(dom.presetDescription, state.patch.description);
  setText(dom.graphTitle, graph?.label ?? "Patch");
  setText(dom.tempoOut, `${Math.round(state.tempo)} BPM`);
  if (dom.tempo) dom.tempo.value = String(state.tempo);
  if (dom.presetSelect) dom.presetSelect.value = state.patch.id;
  renderBreadcrumb();
}

function updateTransportUi() {
  const local = wrappedBeat(absoluteBeatNow());
  const meter = state.patch.meter?.[0] ?? 4;
  const bar = Math.floor(local / meter) + 1;
  const beat = (local % meter) + 1;
  setText(dom.transportPosition, `CYCLE ${bar} · BEAT ${beat.toFixed(2)}`);
  setPressed(dom.playButton, state.playing);
  setPressed(dom.loopButton, state.loop);
  setPressed(dom.audioButton, state.audioOn);
  setText(dom.audioState, state.audioStarting ? "starting" : state.audioOn ? "on" : "off");
  if (dom.audioButton) dom.audioButton.disabled = state.audioStarting;
  if (dom.playButton) dom.playButton.disabled = state.audioStarting;
  const copy = dom.playButton?.querySelector("b");
  if (copy) copy.textContent = state.playing ? "Pause" : "Run";
}

function setView(view, { focus = false } = {}) {
  if (!["constellation", "flow", "timeline"].includes(view)) return;
  state.view = view;
  for (const button of document.querySelectorAll("[data-view]")) {
    const active = button.dataset.view === view;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  }
  for (const panel of document.querySelectorAll("[data-projection]")) {
    const active = panel.dataset.projection === view;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  }
  renderWorkspace();
}

function openGraph(graphId, { selectNodeId = null } = {}) {
  if (!getGraph(state.patch, graphId)) return;
  state.patch = selectGraph(state.patch, graphId);
  state.timelineProjectionCache = null;
  state.selection = selectNodeId ? { kind: "node", graphId, nodeId: selectNodeId } : null;
  state.connecting = null;
  renderWorkspace();
  announce(`${currentGraph(state.patch)?.label ?? "Graph"} opened.`);
}

function enterNodeGraph(node) {
  if (node?.type !== "subgraph" || !getGraph(state.patch, node.graphId)) return;
  openGraph(node.graphId);
}

function leaveGraph() {
  const crumbs = graphBreadcrumbs(state.patch, state.patch.selectedGraphId);
  if (crumbs.length < 2) return;
  openGraph(crumbs.at(-2).graphId);
}

function selectNode(graphId, nodeId) {
  if (state.connecting) return;
  state.selection = { kind: "node", graphId, nodeId };
  renderWorkspace();
  announce(`${graphNode(graphId, nodeId)?.label ?? "Graph node"} selected.`);
}

function selectEdge(graphId, edgeId) {
  state.selection = { kind: "edge", graphId, edgeId };
  state.connecting = null;
  renderWorkspace();
  const edge = graphEdge(graphId, edgeId);
  announce(`${edge?.signal ?? "Signal"} connection selected.`);
}

function selectPort(graphId, nodeId, portDefinition) {
  if (portDefinition.direction === "out") {
    state.connecting = {
      graphId,
      nodeId,
      portId: portDefinition.id,
      signal: portDefinition.signal,
    };
    state.selection = { kind: "port", graphId, nodeId, portId: portDefinition.id };
    renderWorkspace();
    announce(`Connect ${portDefinition.signal}: choose a matching input port.`);
    return;
  }
  if (state.connecting) {
    if (state.connecting.graphId !== graphId || state.connecting.signal !== portDefinition.signal) {
      announce(`That port cannot receive the ${state.connecting.signal} connection.`);
      return;
    }
    const before = getGraph(state.patch, graphId)?.edges?.length ?? 0;
    const next = addConnection(
      state.patch,
      graphId,
      state.connecting.nodeId,
      nodeId,
      state.connecting.signal,
      { fromPortId: state.connecting.portId, toPortId: portDefinition.id },
    );
    const afterGraph = getGraph(next, graphId);
    const edge = afterGraph?.edges?.at(-1);
    state.connecting = null;
    if ((afterGraph?.edges?.length ?? 0) <= before || !edge) {
      announce("Those ports are not compatible.");
      renderWorkspace();
      return;
    }
    state.selection = { kind: "edge", graphId, edgeId: edge.id };
    if (!commitPatch(next, { rebuildAudio: edge.signal === "audio" })) return;
    announce(`${edge.signal} connection created.`);
    return;
  }
  state.selection = { kind: "port", graphId, nodeId, portId: portDefinition.id };
  renderWorkspace();
}

function cancelConnection() {
  if (!state.connecting) return;
  state.connecting = null;
  renderWorkspace();
  announce("Connection cancelled.");
}

function insertDevice(deviceId, position = {}) {
  const graph = currentGraph(state.patch);
  if (!graph) return;
  const before = new Set(graph.nodes.map(({ id }) => id));
  const next = addDeviceNode(state.patch, graph.id, deviceId, position);
  const nextGraph = getGraph(next, graph.id);
  const node = nextGraph?.nodes?.find(({ id }) => !before.has(id));
  if (!node) return;
  state.selection = { kind: "node", graphId: graph.id, nodeId: node.id };
  commitPatch(next);
  announce(`${node.label} graph inserted. Select one of its output ports to connect it.`);
}

function renderDeviceBrowser() {
  const host = dom.instrumentBrowser;
  if (!host) return;
  host.replaceChildren();
  const filters = element("div", "constellation-palette-filters");
  for (const category of ["all", "sound", "effect", "trigger", "control", "routing", "graphs"]) {
    const button = element("button", "", category);
    button.type = "button";
    button.dataset.paletteCategory = category;
    button.setAttribute("aria-pressed", String(state.paletteCategory === category));
    button.addEventListener("click", () => {
      state.paletteCategory = category;
      renderDeviceBrowser();
    });
    filters.append(button);
  }
  host.append(filters);
  for (const device of DEVICE_LIBRARY) {
    if (state.paletteCategory !== "all" && state.paletteCategory !== device.category) continue;
    const card = element("article", "constellation-instrument-card");
    card.draggable = true;
    card.dataset.deviceId = device.id;
    card.dataset.deviceKind = device.category;
    card.style.setProperty("--instrument-color", device.color);
    const image = element("img", "constellation-instrument-image");
    image.src = device.imageHref;
    image.alt = "";
    image.width = 80;
    image.height = 80;
    image.loading = "lazy";
    const copy = element("div", "constellation-instrument-copy");
    const type = element("span", "constellation-device-kind", device.category);
    copy.append(type, element("b", "", device.label), element("small", "", device.description));
    const actions = element("div", "constellation-instrument-actions");
    const add = element("button", "", "Insert graph");
    add.type = "button";
    add.addEventListener("click", () => insertDevice(device.id));
    actions.append(add);
    if (device.href) {
      const open = element("a", "", "Open instrument");
      open.href = device.href;
      actions.append(open);
    }
    card.append(image, copy, actions);
    card.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/x-morphazoid-device", device.id);
      event.dataTransfer?.setData("text/plain", device.label);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    });
    host.append(card);
  }
}

function signalLegend() {
  const legend = element("div", "constellation-signal-legend");
  for (const signal of SIGNAL_TYPES) {
    const item = element("span", `is-${signal}`);
    item.append(element("i"), document.createTextNode(signal));
    legend.append(item);
  }
  return legend;
}

function graphActivity() {
  const beat = wrappedBeat(absoluteBeatNow());
  const projection = selectedProjection();
  const activeNodeIds = new Set();
  const activeEdgeIds = new Set();
  for (const event of projection.events) {
    const distance = Math.abs(event.beat - beat);
    const wrappedDistance = Math.min(distance, Math.abs(distance - cycleBeats()));
    if (wrappedDistance > .09) continue;
    activeNodeIds.add(event.displayNodeId);
    if (event.sourceGraphId === projection.graph.id && event.sourceEdgeId) activeEdgeIds.add(event.sourceEdgeId);
  }
  return { activeNodeIds, activeEdgeIds };
}

function updateFlowLedger(beat = wrappedBeat(absoluteBeatNow()), ledger = dom.flowCanvas?.querySelector?.(".constellation-flow-ledger")) {
  if (!ledger) return;
  const projection = selectedProjection();
  const duration = cycleBeats();
  const upcoming = projection.events
    .map((event) => ({ event, orderBeat: event.beat >= beat - EPSILON ? event.beat : event.beat + duration }))
    .sort((first, second) => first.orderBeat - second.orderBeat || String(first.event.id).localeCompare(String(second.event.id)))
    .slice(0, 8);
  const signature = upcoming.map(({ event, orderBeat }) => `${event.id}@${orderBeat}`).join("|");
  if (ledger.dataset.signature === signature) return;
  ledger.dataset.signature = signature;
  ledger.replaceChildren(element("b", "", "NEXT SIGNALS"));
  for (const { event } of upcoming) {
    const row = element("span", `is-${event.signal}`);
    row.textContent = `${formatBeat(event.beat)} · ${event.signal.toUpperCase()} · ${event.label}`;
    ledger.append(row);
  }
}

function graphSvgPoint(event, svg) {
  const bounds = svg.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * GRAPH_WIDTH / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * GRAPH_HEIGHT / Math.max(1, bounds.height),
  };
}

function beginNodeDrag(event, graph, node, group, svg) {
  if (event.button !== 0 || event.target.closest?.("[data-port-id]")) return;
  event.preventDefault();
  event.stopPropagation();
  let moved = false;
  group.setPointerCapture?.(event.pointerId);
  const move = (moveEvent) => {
    const point = graphSvgPoint(moveEvent, svg);
    const x = clamp((point.x - 72) / 856, 0, 1, node.x);
    const y = clamp((point.y - 54) / 412, 0, 1, node.y);
    moved ||= Math.abs(x - node.x) > .002 || Math.abs(y - node.y) > .002;
    group.setAttribute("transform", `translate(${72 + x * 856} ${54 + y * 412})`);
    group.dataset.previewX = String(x);
    group.dataset.previewY = String(y);
  };
  const finish = () => {
    group.removeEventListener("pointermove", move);
    group.removeEventListener("pointerup", finish);
    group.removeEventListener("pointercancel", finish);
    const x = finite(group.dataset.previewX, node.x);
    const y = finite(group.dataset.previewY, node.y);
    delete group.dataset.previewX;
    delete group.dataset.previewY;
    if (!moved) return;
    state.selection = { kind: "node", graphId: graph.id, nodeId: node.id };
    // Layout is deliberately independent from musical time and audio topology.
    commitPatch(moveGraphNode(state.patch, graph.id, node.id, x, y), { rebuildAudio: false, reschedule: false });
  };
  group.addEventListener("pointermove", move);
  group.addEventListener("pointerup", finish);
  group.addEventListener("pointercancel", finish);
}

function renderDeviceGraph(host, { live = false } = {}) {
  if (!host) return;
  host.replaceChildren();
  const graph = currentGraph(state.patch);
  if (!graph) return;
  const toolbar = element("div", "constellation-graph-toolbar");
  toolbar.append(signalLegend());
  const prompt = element(
    "span",
    `constellation-connect-prompt${state.connecting ? " is-connecting" : ""}`,
    state.connecting
      ? `CONNECT ${state.connecting.signal.toUpperCase()} · SELECT AN INPUT`
      : live ? "LIVE OVERLAY · SAME TOPOLOGY" : "SELECT AN OUTPUT PORT, THEN AN INPUT",
  );
  toolbar.append(prompt);
  if (state.connecting) {
    const cancel = element("button", "constellation-cancel-connect", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", cancelConnection);
    toolbar.append(cancel);
  }
  host.append(toolbar);

  const svg = svgElement("svg", {
    viewBox: `0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`,
    class: `constellation-flow-svg constellation-device-graph${live ? " is-live" : ""}`,
    role: "group",
    "aria-label": `${graph.label} ${live ? "live signal flow" : "patch graph"}`,
    "data-graph-path": graph.id,
  });
  const markerPrefix = live ? "flow" : "patch";
  const defs = svgElement("defs");
  for (const signal of SIGNAL_TYPES) {
    const marker = svgElement("marker", {
      id: `${markerPrefix}-${signal}-arrow`,
      viewBox: "0 0 10 10",
      refX: 9,
      refY: 5,
      markerWidth: 6,
      markerHeight: 6,
      orient: "auto-start-reverse",
    });
    marker.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: SIGNAL_COLORS[signal] }));
    defs.append(marker);
  }
  svg.append(defs);
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const activity = graphActivity();

  for (const edge of graph.edges) {
    const fromNode = nodeById.get(edge.from?.nodeId);
    const toNode = nodeById.get(edge.to?.nodeId);
    if (!fromNode || !toNode) continue;
    const fromPorts = portsForNode(state.patch, graph, fromNode);
    const toPorts = portsForNode(state.patch, graph, toNode);
    const fromPort = fromPorts.find(({ id }) => id === edge.from.portId)
      ?? fromPorts.find(({ direction, signal }) => direction === "out" && signal === edge.signal);
    const toPort = toPorts.find(({ id }) => id === edge.to.portId)
      ?? toPorts.find(({ direction, signal }) => direction === "in" && signal === edge.signal);
    if (!fromPort || !toPort) continue;
    const from = nodePortPosition(graph, fromNode, fromPort);
    const to = nodePortPosition(graph, toNode, toPort);
    const bend = Math.max(48, Math.abs(to.x - from.x) * .42);
    const pathData = `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`;
    const group = svgElement("g", {
      class: `constellation-typed-edge is-${edge.signal}${state.selection?.kind === "edge" && state.selection.edgeId === edge.id ? " is-selected" : ""}${activity.activeEdgeIds.has(edge.id) ? " is-active" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-label": `${edge.signal} connection from ${fromNode.label} to ${toNode.label}, ${edgeDescription(edge)}`,
      "data-edge-id": edge.id,
      "data-signal-type": edge.signal,
    });
    const visible = svgElement("path", {
      d: pathData,
      class: "constellation-flow-edge",
      "marker-end": `url(#${markerPrefix}-${edge.signal}-arrow)`,
    });
    const hit = svgElement("path", { d: pathData, class: "constellation-edge-hit" });
    group.append(visible, hit);
    const label = svgElement("text", {
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2 - 9,
      class: "constellation-edge-label",
      "text-anchor": "middle",
    });
    label.textContent = edgeDescription(edge);
    group.append(label);
    group.addEventListener("click", (event) => {
      event.stopPropagation();
      selectEdge(graph.id, edge.id);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectEdge(graph.id, edge.id);
      }
    });
    svg.append(group);
  }

  for (const node of graph.nodes) {
    const at = graphPoint(node);
    const selected = state.selection?.kind === "node"
      && state.selection.graphId === graph.id
      && state.selection.nodeId === node.id;
    const group = svgElement("g", {
      transform: `translate(${at.x} ${at.y})`,
      class: `constellation-flow-node is-${node.type}${node.type === "subgraph" ? " is-subgraph" : ""}${selected ? " is-selected" : ""}${activity.activeNodeIds.has(node.id) ? " is-active" : ""}`,
      tabindex: 0,
      role: "button",
      "aria-label": `${node.label}, ${nodeCategory(node)}${node.type === "subgraph" ? ", double-click to enter graph" : ""}`,
      "data-device-node-id": node.id,
      "data-node-kind": node.type,
      "data-graph-id": graph.id,
    });
    group.style.setProperty("--node-color", nodeColor(node));
    const body = svgElement("rect", { x: -64, y: -36, width: 128, height: 72, rx: node.type === "subgraph" ? 18 : 9 });
    group.append(body);
    if (node.type === "subgraph") {
      group.append(svgElement("rect", { x: -57, y: -29, width: 114, height: 58, rx: 13, class: "constellation-subgraph-inner" }));
      const graphMark = svgElement("text", { x: 49, y: -20, class: "constellation-subgraph-mark", "text-anchor": "end" });
      graphMark.textContent = "↳";
      group.append(graphMark);
    }
    const title = svgElement("text", { y: -4, "text-anchor": "middle", class: "constellation-flow-node-title" });
    title.textContent = node.label;
    const detail = svgElement("text", { y: 15, "text-anchor": "middle", class: "constellation-flow-node-detail" });
    detail.textContent = nodeCategory(node).toUpperCase();
    group.append(title, detail);

    for (const portDefinition of portsForNode(state.patch, graph, node)) {
      const portAt = nodePortPosition(graph, node, portDefinition);
      const localX = portAt.x - at.x;
      const localY = portAt.y - at.y;
      const compatible = !state.connecting
        || (portDefinition.direction === "in" && state.connecting.signal === portDefinition.signal && state.connecting.graphId === graph.id)
        || (portDefinition.direction === "out" && state.connecting.nodeId === node.id && state.connecting.portId === portDefinition.id);
      const portGroup = svgElement("g", {
        class: `constellation-port is-${portDefinition.signal} is-${portDefinition.direction}${compatible ? " is-compatible" : " is-incompatible"}`,
        transform: `translate(${localX} ${localY})`,
        tabindex: compatible ? 0 : -1,
        role: "button",
        "aria-label": `${node.label} ${portDefinition.label} ${portDefinition.direction} ${portDefinition.signal} port`,
        "data-port-id": portDefinition.id,
        "data-port-kind": portDefinition.signal,
        "data-port-direction": portDefinition.direction,
        "data-node-id": node.id,
      });
      portGroup.append(svgElement("circle", { r: 6 }));
      const portLabel = svgElement("text", {
        x: portDefinition.direction === "in" ? 11 : -11,
        y: 3,
        "text-anchor": portDefinition.direction === "in" ? "start" : "end",
      });
      portLabel.textContent = portDefinition.label;
      portGroup.append(portLabel);
      portGroup.addEventListener("pointerdown", (event) => event.stopPropagation());
      portGroup.addEventListener("click", (event) => {
        event.stopPropagation();
        if (compatible) selectPort(graph.id, node.id, portDefinition);
      });
      portGroup.addEventListener("keydown", (event) => {
        if ((event.key === "Enter" || event.key === " ") && compatible) {
          event.preventDefault();
          event.stopPropagation();
          selectPort(graph.id, node.id, portDefinition);
        }
      });
      group.append(portGroup);
    }

    group.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-port-id]")) return;
      event.stopPropagation();
      if (!state.connecting) selectNode(graph.id, node.id);
    });
    group.addEventListener("dblclick", (event) => {
      event.stopPropagation();
      enterNodeGraph(node);
    });
    group.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (node.type === "subgraph") enterNodeGraph(node);
      else selectNode(graph.id, node.id);
    });
    group.addEventListener("pointerdown", (event) => beginNodeDrag(event, graph, node, group, svg));
    svg.append(group);
  }

  svg.addEventListener("click", () => {
    if (state.connecting) cancelConnection();
    else {
      state.selection = null;
      renderWorkspace();
    }
  });
  svg.addEventListener("dragover", (event) => {
    if (!event.dataTransfer?.types?.includes("text/x-morphazoid-device")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  });
  svg.addEventListener("drop", (event) => {
    const deviceId = event.dataTransfer?.getData("text/x-morphazoid-device");
    if (!deviceId) return;
    event.preventDefault();
    const point = graphSvgPoint(event, svg);
    insertDevice(deviceId, {
      x: clamp((point.x - 72) / 856, 0, 1, .5),
      y: clamp((point.y - 54) / 412, 0, 1, .5),
    });
  });
  host.append(svg);

  if (live) {
    const ledger = element("div", "constellation-flow-ledger");
    host.append(ledger);
    updateFlowLedger(wrappedBeat(absoluteBeatNow()), ledger);
  }
}

function renderConstellation() {
  renderDeviceGraph(dom.constellationCanvas, { live: false });
}

function renderFlow() {
  renderDeviceGraph(dom.flowCanvas, { live: true });
}

function timelinePixelsPerBeat() {
  const available = Math.max(320, (dom.timelineCanvas?.clientWidth ?? 860) - TIMELINE_GUTTER - 24);
  return clamp(available / cycleBeats(), MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT, 42);
}

function beginTimelineEventDrag(pointerEvent, projectedEvent, marker, pixelsPerBeat) {
  if (pointerEvent.button !== 0) return;
  pointerEvent.preventDefault();
  pointerEvent.stopPropagation();
  const originX = pointerEvent.clientX;
  let deltaX = 0;
  marker.setPointerCapture?.(pointerEvent.pointerId);
  const move = (event) => {
    deltaX = event.clientX - originX;
    marker.style.transform = `translateX(${deltaX}px)`;
    marker.classList.toggle("is-dragging", Math.abs(deltaX) > 2);
  };
  const finish = () => {
    marker.removeEventListener("pointermove", move);
    marker.removeEventListener("pointerup", finish);
    marker.removeEventListener("pointercancel", finish);
    marker.dataset.dragged = String(Math.abs(deltaX) > 2);
    if (Math.abs(deltaX) <= 2) return;
    const requestedBeat = clamp(projectedEvent.beat + deltaX / pixelsPerBeat, 0, cycleBeats() - .25, projectedEvent.beat);
    const next = moveProjectedEvent(state.patch, projectedEvent, requestedBeat);
    state.selection = { kind: "event", event: { ...projectedEvent, beat: requestedBeat } };
    commitPatch(next, { rebuildAudio: false });
    announce(`Generating rule moved to beat ${formatBeat(requestedBeat)}.`);
  };
  marker.addEventListener("pointermove", move);
  marker.addEventListener("pointerup", finish);
  marker.addEventListener("pointercancel", finish);
}

function nodeSignalSummary(graph, node) {
  const signals = new Set(portsForNode(state.patch, graph, node).map(({ signal }) => signal));
  return SIGNAL_TYPES.filter((signal) => signals.has(signal));
}

function renderTimeline() {
  const host = dom.timelineCanvas;
  if (!host) return;
  host.replaceChildren();
  const projection = selectedProjection();
  if (!projection.graph) return;
  const pixelsPerBeat = timelinePixelsPerBeat();
  const width = TIMELINE_GUTTER + projection.durationBeats * pixelsPerBeat;
  const toolbar = element("div", "constellation-timeline-toolbar");
  toolbar.append(signalLegend(), element("span", "constellation-timeline-hint", "DRAG AN EVENT → EDIT ITS GENERATING RULE"));
  if (projection.truncated) toolbar.append(element("strong", "constellation-projection-warning", "Projection bounded for safety"));
  host.append(toolbar);

  const viewport = element("div", "constellation-timeline-viewport");
  const surface = element("div", "constellation-timeline-surface");
  surface.style.width = `${Math.max(width, host.clientWidth || width)}px`;
  surface.dataset.graphPath = projection.graph.id;
  const ruler = element("div", "constellation-timeline-ruler");
  ruler.append(element("span", "constellation-timeline-corner", "DEVICE GRAPH"));
  const rulerTrack = element("div", "constellation-ruler-track");
  rulerTrack.style.width = `${projection.durationBeats * pixelsPerBeat}px`;
  for (let beat = 0; beat <= projection.durationBeats + EPSILON; beat += 1) {
    const tick = element("span", `constellation-ruler-tick${beat % (state.patch.meter?.[0] ?? 4) === 0 ? " is-bar" : ""}`);
    tick.style.left = `${beat * pixelsPerBeat}px`;
    tick.textContent = String(beat + 1);
    rulerTrack.append(tick);
  }
  ruler.append(rulerTrack);
  surface.append(ruler);

  const graph = projection.graph;
  const directNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const lane of projection.lanes) {
    const row = element("div", "constellation-timeline-row");
    row.dataset.laneId = lane.id;
    const label = element("button", "constellation-lane-label");
    label.type = "button";
    label.style.setProperty("--lane-color", lane.color);
    label.append(element("b", "", lane.label), element("small", "", lane.category));
    label.addEventListener("click", () => selectNode(graph.id, lane.nodeId));
    const track = element("div", "constellation-lane-track");
    track.style.width = `${projection.durationBeats * pixelsPerBeat}px`;
    const node = directNodes.get(lane.nodeId);
    const signals = node ? nodeSignalSummary(graph, node) : [];
    const laneSignals = element("span", "constellation-lane-signals");
    for (const signal of signals) {
      const chip = element("i", `is-${signal}`, signal);
      chip.dataset.signalType = signal;
      laneSignals.append(chip);
      if (signal === "audio") {
        const continuous = element("span", "constellation-signal-span is-audio");
        continuous.dataset.signalType = "audio";
        continuous.style.left = "0";
        continuous.style.width = `${projection.durationBeats * pixelsPerBeat}px`;
        track.append(continuous);
      }
    }
    label.append(laneSignals);
    for (let beat = 0; beat <= projection.durationBeats + EPSILON; beat += 1) {
      const line = element("i", `constellation-grid-line${beat % (state.patch.meter?.[0] ?? 4) === 0 ? " is-bar" : ""}`);
      line.style.left = `${beat * pixelsPerBeat}px`;
      track.append(line);
    }
    const laneEvents = projection.events.filter((event) => event.laneId === lane.id);
    for (const projectedEvent of laneEvents) {
      const marker = element("button", `constellation-projected-event is-${projectedEvent.signal}${projectedEvent.playable ? " is-playable" : ""}`);
      marker.type = "button";
      marker.dataset.projectedEventId = projectedEvent.id;
      marker.dataset.signalType = projectedEvent.signal;
      marker.dataset.beat = String(projectedEvent.beat);
      marker.dataset.nodeId = projectedEvent.displayNodeId;
      marker.style.left = `${projectedEvent.beat * pixelsPerBeat}px`;
      marker.style.width = `${Math.max(7, Math.min(projectedEvent.durationBeats * pixelsPerBeat, pixelsPerBeat * 1.5))}px`;
      marker.title = `${projectedEvent.label} · ${projectedEvent.signal} · beat ${formatBeat(projectedEvent.beat)}`;
      marker.setAttribute("aria-label", marker.title);
      marker.addEventListener("pointerdown", (event) => beginTimelineEventDrag(event, projectedEvent, marker, pixelsPerBeat));
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        if (marker.dataset.dragged === "true") {
          marker.dataset.dragged = "false";
          return;
        }
        state.selection = { kind: "event", event: projectedEvent };
        renderWorkspace();
      });
      marker.addEventListener("dblclick", (event) => {
        event.stopPropagation();
        revealEventSource(projectedEvent);
      });
      track.append(marker);
    }
    row.append(label, track);
    surface.append(row);
  }

  const playhead = element("div", "constellation-timeline-playhead");
  playhead.dataset.timelinePlayhead = "";
  playhead.style.left = `${TIMELINE_GUTTER + wrappedBeat(absoluteBeatNow()) * pixelsPerBeat}px`;
  surface.append(playhead);
  surface.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("button")) return;
    const bounds = surface.getBoundingClientRect();
    const beat = clamp((event.clientX - bounds.left - TIMELINE_GUTTER) / pixelsPerBeat, 0, cycleBeats(), 0);
    seekToBeat(beat);
  });
  viewport.append(surface);
  host.append(viewport);
}

function inspectorHeading(eyebrow, title, description) {
  const header = element("header", "constellation-inspector-heading");
  header.append(element("span", "", eyebrow), element("h3", "", title));
  if (description) header.append(element("p", "", description));
  return header;
}

function inspectorReadout(label, value) {
  const row = element("div", "constellation-inspector-readout");
  row.append(element("span", "", label), element("b", "", value));
  return row;
}

function inspectorControl(label, options = {}) {
  const wrapper = element("label", "constellation-inspector-field");
  const heading = element("span", "", label);
  const input = element("input");
  input.type = options.type ?? "text";
  if (options.min !== undefined) input.min = String(options.min);
  if (options.max !== undefined) input.max = String(options.max);
  if (options.step !== undefined) input.step = String(options.step);
  if (options.checked !== undefined) input.checked = Boolean(options.checked);
  if (options.value !== undefined) input.value = String(options.value);
  if (options.ariaLabel) input.setAttribute("aria-label", options.ariaLabel);
  input.addEventListener(options.event ?? "change", () => options.onChange?.(input));
  wrapper.append(heading, input);
  return wrapper;
}

function actionButton(label, onClick, className = "") {
  const button = element("button", className, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function revealEventSource(projectedEvent) {
  const graphId = projectedEvent?.graphId ?? projectedEvent?.sourceGraphId;
  if (!graphId || !getGraph(state.patch, graphId)) return;
  openGraph(graphId, { selectNodeId: projectedEvent.nodeId });
  setView("constellation");
  announce(`${projectedEvent.label} source revealed inside ${currentGraph(state.patch)?.label}.`);
}

function renderNodeInspector(host, node, graph) {
  const definition = node.type === "primitive" ? PRIMITIVE_LIBRARY[node.primitiveId] : deviceForNode(node);
  host.append(inspectorHeading(node.type === "subgraph" ? "SUBGRAPH INSTANCE" : node.type.toUpperCase(), node.label, definition?.description ?? definition?.label ?? nodeCategory(node)));
  host.append(inspectorControl("Label", {
    value: node.label,
    onChange: (input) => commitPatch(updateGraphNode(state.patch, graph.id, node.id, { label: input.value }), { rebuildAudio: false, reschedule: false }),
  }));
  const signals = nodeSignalSummary(graph, node);
  const portList = element("div", "constellation-inspector-ports");
  portList.append(element("span", "", "TYPED PORTS"));
  for (const portDefinition of portsForNode(state.patch, graph, node)) {
    const button = actionButton(`${portDefinition.direction === "in" ? "←" : "→"} ${portDefinition.label}`, () => selectPort(graph.id, node.id, portDefinition), `is-${portDefinition.signal}`);
    button.dataset.signalType = portDefinition.signal;
    portList.append(button);
  }
  host.append(portList);
  if (!signals.length) host.append(inspectorReadout("Signals", "none yet"));

  if (node.type === "subgraph") {
    const child = getGraph(state.patch, node.graphId);
    host.append(inspectorReadout("Contains", `${child?.nodes?.length ?? 0} nodes · ${child?.edges?.length ?? 0} connections`));
    host.append(actionButton("Enter signal-flow graph ↳", () => enterNodeGraph(node), "constellation-primary-action"));
    return;
  }

  const primitive = PRIMITIVE_LIBRARY[node.primitiveId];
  if (primitive?.playable) {
    host.append(inspectorControl("Root MIDI note", {
      type: "number", min: 0, max: 127, step: 1, value: node.rootNote ?? 48,
      onChange: (input) => commitPatch(updateGraphNode(state.patch, graph.id, node.id, { rootNote: input.value }), { rebuildAudio: false }),
    }));
    host.append(inspectorControl("Gate (beats)", {
      type: "number", min: .0625, max: 8, step: .0625, value: node.gateBeats ?? .35,
      onChange: (input) => commitPatch(updateGraphNode(state.patch, graph.id, node.id, { gateBeats: input.value }), { rebuildAudio: false }),
    }));
  }
  const generator = node.generator ?? primitive?.generator;
  if (generator) {
    host.append(inspectorControl("Step length (beats)", {
      type: "number", min: .0625, max: 8, step: .0625, value: generator.stepBeats ?? 1,
      onChange: (input) => commitPatch(updateGraphNode(state.patch, graph.id, node.id, { generator: { stepBeats: finite(input.value, 1) } }), { rebuildAudio: false }),
    }));
    host.append(inspectorControl("Phase (beats)", {
      type: "number", min: 0, max: cycleBeats(), step: .25, value: node.generator?.phaseBeats ?? 0,
      onChange: (input) => commitPatch(updateGraphNode(state.patch, graph.id, node.id, { generator: { phaseBeats: finite(input.value, 0) } }), { rebuildAudio: false }),
    }));
  }
  const parameterSpecs = {
    chance: [["Probability", "probability", 0, 1, .01, .5]],
    filter: [["Cutoff (Hz)", "cutoff", 80, 18000, 10, 2200], ["Resonance", "resonance", .1, 24, .1, 2.2]],
    delay: [["Delay (seconds)", "delaySeconds", .01, 3.8, .01, .22], ["Feedback", "feedback", 0, .78, .01, .36], ["Wet mix", "mix", 0, .9, .01, .45]],
    reverb: [["Wet mix", "mix", 0, .9, .01, .42]],
    gain: [["Gain", "gain", 0, 1.5, .01, .76]],
    mixer: [["Gain", "gain", 0, 1.5, .01, .76]],
    output: [["Gain", "gain", 0, 1.5, .01, .88]],
  };
  for (const [label, key, minimum, maximum, step, fallback] of parameterSpecs[node.primitiveId] ?? []) {
    host.append(inspectorControl(label, {
      type: "number", min: minimum, max: maximum, step, value: node.params?.[key] ?? fallback,
      onChange: (input) => commitPatch(updateGraphNode(state.patch, graph.id, node.id, { params: { [key]: finite(input.value, fallback) } })),
    }));
  }
}

function renderEdgeInspector(host, edge, graph) {
  const from = graph.nodes.find(({ id }) => id === edge.from.nodeId);
  const to = graph.nodes.find(({ id }) => id === edge.to.nodeId);
  host.append(inspectorHeading(`${edge.signal.toUpperCase()} CONNECTION`, `${from?.label ?? "Source"} → ${to?.label ?? "Target"}`, edge.signal === "audio" ? "A continuous signal path. It does not place events in time." : "A control-flow path whose delay and probability participate in event projection."));
  host.append(inspectorReadout("Ports", `${edge.from.portId} → ${edge.to.portId}`));
  if (edge.signal === "trigger" || edge.signal === "control") {
    host.append(inspectorControl("Delay (beats)", {
      type: "number", min: 0, max: cycleBeats(), step: .0625, value: edge.timing?.delayBeats ?? 0,
      onChange: (input) => commitPatch(updateConnection(state.patch, graph.id, edge.id, { delayBeats: input.value }), { rebuildAudio: false }),
    }));
    host.append(inspectorControl("Probability", {
      type: "number", min: 0, max: 1, step: .01, value: edge.timing?.probability ?? 1,
      onChange: (input) => commitPatch(updateConnection(state.patch, graph.id, edge.id, { probability: input.value }), { rebuildAudio: false }),
    }));
  }
  host.append(inspectorControl(edge.signal === "control" ? "Modulation depth" : "Signal gain", {
    type: "number", min: 0, max: 2, step: .01, value: edge.gain ?? 1,
    onChange: (input) => commitPatch(updateConnection(state.patch, graph.id, edge.id, { gain: input.value }), { rebuildAudio: edge.signal === "audio" }),
  }));
  if (edge.signal === "audio") {
    host.append(inspectorControl("Feedback-safe route", {
      type: "checkbox", checked: edge.feedback,
      onChange: (input) => commitPatch(updateConnection(state.patch, graph.id, edge.id, { feedback: input.checked })),
    }));
  }
  host.append(actionButton("Delete connection", () => {
    state.selection = null;
    commitPatch(removeConnection(state.patch, graph.id, edge.id));
    announce(`${edge.signal} connection removed.`);
  }, "constellation-danger-action"));
}

function renderEventInspector(host, projectedEvent) {
  host.append(inspectorHeading(`${projectedEvent.signal.toUpperCase()} EVENT`, projectedEvent.label, "This is a projected consequence of the graph, not a free-floating clip."));
  host.append(inspectorReadout("Beat", formatBeat(projectedEvent.beat)));
  host.append(inspectorReadout("Source", projectedEvent.graphPath?.join?.(" / ") ?? projectedEvent.address));
  host.append(inspectorReadout("Rule", projectedEvent.rule?.kind === "edge" ? projectedEvent.rule.edgeId : `${projectedEvent.rule?.nodeId ?? "generator"} step ${projectedEvent.occurrence ?? 0}`));
  if (projectedEvent.playable) host.append(inspectorReadout("Sound", `${projectedEvent.soundId} · MIDI ${projectedEvent.note}`));
  host.append(inspectorControl("Move event to beat", {
    type: "number", min: 0, max: cycleBeats(), step: .25, value: projectedEvent.beat,
    onChange: (input) => {
      const nextBeat = finite(input.value, projectedEvent.beat);
      commitPatch(moveProjectedEvent(state.patch, projectedEvent, nextBeat), { rebuildAudio: false });
    },
  }));
  host.append(actionButton("Reveal generating node ↳", () => revealEventSource(projectedEvent), "constellation-primary-action"));
}

function renderInspector() {
  const host = dom.inspector;
  if (!host) return;
  host.replaceChildren();
  const graph = currentGraph(state.patch);
  if (state.connecting) {
    host.append(inspectorHeading("PATCHING", `Choose a ${state.connecting.signal} input`, "Only a compatible typed input can complete this connection."));
    host.append(actionButton("Cancel connection", cancelConnection));
    return;
  }
  if (state.selection?.kind === "event") {
    renderEventInspector(host, state.selection.event);
    return;
  }
  if (!graph || !state.selection) {
    const placeholder = element("div", "inspector-placeholder");
    placeholder.append(element("span", "", "◇"), element("p", "", "Select a graph, primitive, port, connection, or projected event. Constellation edits topology; Live Flow shows it running; Projected Timeline shows what its rules cause in time."));
    host.append(placeholder);
    return;
  }
  if (state.selection.kind === "node") {
    const node = selectedNode();
    if (node) renderNodeInspector(host, node, graph);
    return;
  }
  if (state.selection.kind === "edge") {
    const edge = selectedEdge();
    if (edge) renderEdgeInspector(host, edge, graph);
    return;
  }
  if (state.selection.kind === "port") {
    const node = graphNode(state.selection.graphId, state.selection.nodeId);
    const portDefinition = portsForNode(state.patch, graph, node).find(({ id }) => id === state.selection.portId);
    if (node && portDefinition) {
      host.append(inspectorHeading(`${portDefinition.signal.toUpperCase()} ${portDefinition.direction.toUpperCase()} PORT`, `${node.label} · ${portDefinition.label}`, `This port carries ${portDefinition.signal} ${portDefinition.direction === "in" ? "into" : "out of"} the graph.`));
      if (portDefinition.direction === "out") host.append(actionButton("Start connection", () => selectPort(graph.id, node.id, portDefinition), "constellation-primary-action"));
    }
  }
}

function renderWorkspace() {
  updatePatchReadouts();
  updateTransportUi();
  if (state.view === "constellation") renderConstellation();
  else if (state.view === "flow") renderFlow();
  else if (state.view === "timeline") renderTimeline();
  renderInspector();
}

function absoluteBeatNow() {
  if (!state.playing) return state.absoluteBeat;
  return state.transportStartBeat + Math.max(0, clockNow() - state.transportStartTime) / secondsPerBeat();
}

function scheduleProjectionWindow(fromBeat, toBeat) {
  if (!state.audioOn || toBeat - fromBeat <= EPSILON) return;
  const projection = rootProjection();
  const duration = cycleBeats();
  const lastCycle = state.loop ? Math.floor((toBeat - EPSILON) / duration) : 0;
  const firstCycle = state.loop ? Math.max(0, Math.floor(fromBeat / duration)) : 0;
  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    const cycleStart = cycle * duration;
    const localFrom = Math.max(0, fromBeat - cycleStart);
    const localTo = Math.min(duration, toBeat - cycleStart);
    if (localTo - localFrom <= EPSILON) continue;
    for (const projectedEvent of performanceEventsForWindow(projection, localFrom, localTo, { includeControl: true })) {
      const eventBeat = cycleStart + projectedEvent.beat;
      const delaySeconds = Math.max(0, (eventBeat - absoluteBeatNow()) * secondsPerBeat());
      audio.trigger(projectedEvent, { delaySeconds, secondsPerBeat: secondsPerBeat() }).catch(() => {
        state.audioOn = false;
        updateTransportUi();
      });
    }
  }
}

function clearScheduler() {
  if (state.scheduler !== null) globalThis.clearInterval(state.scheduler);
  state.scheduler = null;
}

function schedulerTick() {
  if (!state.playing) return;
  const nowBeat = absoluteBeatNow();
  if (!state.loop && nowBeat >= cycleBeats() - EPSILON) {
    state.absoluteBeat = cycleBeats();
    state.playing = false;
    clearScheduler();
    stopAnimation();
    audio.silence();
    resetScheduledControl({ beat: state.absoluteBeat, toBase: true });
    syncAudioTransport(state.absoluteBeat);
    updateRuntimeVisuals();
    return;
  }
  const horizon = nowBeat + LOOKAHEAD_SECONDS / secondsPerBeat();
  const end = state.loop ? horizon : Math.min(cycleBeats(), horizon);
  const start = Math.max(state.scheduleBeat, nowBeat - .02 / secondsPerBeat());
  scheduleProjectionWindow(start, end);
  state.scheduleBeat = end;
}

async function setAudioOn(enabled) {
  if (!enabled) {
    const beat = absoluteBeatNow();
    state.absoluteBeat = beat;
    state.transportStartBeat = beat;
    state.scheduleBeat = beat;
    state.playing = false;
    state.audioOn = false;
    state.audioStarting = false;
    clearScheduler();
    stopAnimation();
    audio.silence();
    resetScheduledControl({ beat, toBase: true });
    syncAudioTransport(beat);
    updateRuntimeVisuals();
    await audio.close();
    announce("Audio off. The graph and projected timing remain editable.");
    return false;
  }
  if (state.audioOn) return true;
  if (state.audioStartPromise) return state.audioStartPromise;
  state.audioStarting = true;
  updateTransportUi();
  const request = (async () => {
    try {
      audio.setPatch(state.patch);
      audio.setOutput(state.output);
      await audio.start();
      const beat = absoluteBeatNow();
      state.audioOn = true;
      state.audioStarting = false;
      state.scheduleBeat = beat;
      syncAudioTransport(beat);
      resetScheduledControl({ beat, prime: true, toBase: true });
      schedulerTick();
      updateTransportUi();
      announce("Audio graph compiled and running.");
      return true;
    } catch (error) {
      state.audioOn = false;
      state.audioStarting = false;
      updateTransportUi();
      announce(error?.message ?? "Audio could not start.");
      return false;
    }
  })();
  state.audioStartPromise = request;
  try {
    return await request;
  } finally {
    if (state.audioStartPromise === request) state.audioStartPromise = null;
  }
}

async function togglePlay() {
  if (state.playing) {
    state.absoluteBeat = absoluteBeatNow();
    state.playing = false;
    syncAudioTransport(state.absoluteBeat);
    clearScheduler();
    stopAnimation();
    audio.silence();
    resetScheduledControl({ beat: state.absoluteBeat, toBase: false });
    updateRuntimeVisuals();
    announce("Patch paused.");
    return;
  }
  if (!state.loop && state.absoluteBeat >= cycleBeats() - EPSILON) state.absoluteBeat = 0;
  const audioReady = await setAudioOn(true);
  if (!audioReady) {
    announce("The patch could not run because its audio graph did not start.");
    return;
  }
  state.transportStartBeat = state.absoluteBeat;
  state.transportStartTime = clockNow();
  state.scheduleBeat = state.absoluteBeat;
  syncAudioTransport(state.absoluteBeat);
  audio.silence();
  resetScheduledControl({ beat: state.absoluteBeat, prime: true, toBase: true });
  state.playing = true;
  clearScheduler();
  state.scheduler = globalThis.setInterval(schedulerTick, SCHEDULER_INTERVAL_MS);
  schedulerTick();
  requestAnimation();
  updateTransportUi();
  announce("Patch running. Trigger events are being projected into the compiled audio graph.");
}

function stopTransport() {
  state.playing = false;
  state.absoluteBeat = 0;
  state.transportStartBeat = 0;
  state.scheduleBeat = 0;
  syncAudioTransport(0);
  clearScheduler();
  stopAnimation();
  audio.silence();
  resetScheduledControl({ beat: 0, toBase: true });
  updateRuntimeVisuals();
  announce("Patch stopped at the start of its projection window.");
}

function seekToBeat(beat) {
  const target = clamp(beat, 0, cycleBeats(), 0);
  state.absoluteBeat = target;
  if (state.playing) {
    state.transportStartBeat = target;
    state.transportStartTime = clockNow();
  }
  state.scheduleBeat = target;
  syncAudioTransport(target);
  if (state.audioOn) {
    audio.silence();
    resetScheduledControl({ beat: target, prime: true, toBase: true });
  }
  if (state.playing) schedulerTick();
  updateRuntimeVisuals();
  announce(`Projection cursor moved to beat ${formatBeat(target)}.`);
}

function changeTempo(value) {
  const beat = absoluteBeatNow();
  state.absoluteBeat = beat;
  state.tempo = clamp(value, 35, 220, 120);
  state.patch = { ...state.patch, tempo: state.tempo };
  state.projectionCache = null;
  state.timelineProjectionCache = null;
  audio.setTempo(state.tempo, { beat, contextTime: clockNow() });
  if (state.playing) {
    state.transportStartBeat = beat;
    state.transportStartTime = clockNow();
    state.scheduleBeat = beat;
  }
  if (state.audioOn) {
    audio.silence();
    resetScheduledControl({ beat, prime: true, toBase: true });
  }
  if (state.playing) schedulerTick();
  updatePatchReadouts();
  updateRuntimeVisuals();
}

function loadPreset(id) {
  const wasPlaying = state.playing;
  state.playing = false;
  clearScheduler();
  stopAnimation();
  audio.silence();
  resetScheduledControl({ toBase: true });
  state.patch = clonePatchPreset(id);
  state.tempo = state.patch.tempo;
  state.absoluteBeat = 0;
  state.transportStartBeat = 0;
  state.scheduleBeat = 0;
  state.selection = null;
  state.connecting = null;
  state.projectionCache = null;
  state.timelineProjectionCache = null;
  audio.setPatch(state.patch);
  syncAudioTransport(0);
  resetScheduledControl({ beat: 0, prime: state.audioOn, toBase: true });
  renderWorkspace();
  if (wasPlaying) void togglePlay();
  announce(`${state.patch.label} loaded: ${state.patch.description}`);
}

function updateRuntimeVisuals() {
  const beat = wrappedBeat(absoluteBeatNow());
  updateTransportUi();
  const activePanel = state.view === "constellation"
    ? dom.constellationView
    : state.view === "flow"
      ? dom.flowView
      : dom.timelineView;
  if (!activePanel) return;
  const projection = selectedProjection();
  const activeNodes = new Set();
  const activeEdges = new Set();
  for (const projectedEvent of projection.events) {
    const distance = Math.abs(projectedEvent.beat - beat);
    const wrappedDistance = Math.min(distance, Math.abs(distance - cycleBeats()));
    if (wrappedDistance > .08) continue;
    activeNodes.add(projectedEvent.displayNodeId);
    if (projectedEvent.sourceGraphId === projection.graph.id && projectedEvent.sourceEdgeId) activeEdges.add(projectedEvent.sourceEdgeId);
  }
  for (const node of activePanel.querySelectorAll("[data-device-node-id]")) {
    node.classList.toggle("is-active", state.playing && activeNodes.has(node.dataset.deviceNodeId));
  }
  for (const edge of activePanel.querySelectorAll("[data-edge-id]")) {
    edge.classList.toggle("is-active", state.playing && activeEdges.has(edge.dataset.edgeId));
  }
  for (const marker of activePanel.querySelectorAll("[data-projected-event-id]")) {
    const markerBeat = finite(marker.dataset.beat, -100);
    const distance = Math.abs(markerBeat - beat);
    marker.classList.toggle("is-current", state.playing && Math.min(distance, Math.abs(distance - cycleBeats())) <= .08);
  }
  if (state.view === "flow") updateFlowLedger(beat);
  if (state.view === "timeline") {
    const left = TIMELINE_GUTTER + beat * timelinePixelsPerBeat();
    for (const playhead of activePanel.querySelectorAll("[data-timeline-playhead]")) playhead.style.left = `${left}px`;
  }
}

function animationLoop() {
  state.animationFrame = null;
  if (state.disposed || !state.playing) return;
  updateRuntimeVisuals();
  requestAnimation();
}

function requestAnimation() {
  if (state.disposed || !state.playing || state.animationFrame !== null) return;
  state.animationFrame = globalThis.requestAnimationFrame?.(animationLoop) ?? null;
}

function stopAnimation() {
  if (state.animationFrame !== null) globalThis.cancelAnimationFrame?.(state.animationFrame);
  state.animationFrame = null;
}

function bindInteractions() {
  dom.audioButton?.addEventListener("click", () => setAudioOn(!state.audioOn));
  dom.playButton?.addEventListener("click", togglePlay);
  dom.stopButton?.addEventListener("click", stopTransport);
  dom.loopButton?.addEventListener("click", () => {
    state.loop = !state.loop;
    if (!state.loop && absoluteBeatNow() > cycleBeats()) seekToBeat(cycleBeats());
    updateTransportUi();
    announce(state.loop ? "Projection loop on." : "Projection loop off.");
  });
  dom.tempo?.addEventListener("input", () => changeTempo(dom.tempo.value));
  dom.output?.addEventListener("input", () => {
    state.output = clamp(dom.output.value, 0, .9, .54);
    audio.setOutput(state.output);
    setText(dom.outputOut, `${Math.round(state.output * 100)}%`);
  });
  dom.presetSelect?.addEventListener("change", () => loadPreset(dom.presetSelect.value));
  const viewButtons = [...document.querySelectorAll("[data-view]")];
  viewButtons.forEach((button, index) => {
    button.addEventListener("click", () => setView(button.dataset.view));
    button.addEventListener("keydown", (event) => {
      if (!event.key.startsWith("Arrow")) return;
      event.preventDefault();
      const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
      const next = viewButtons[(index + direction + viewButtons.length) % viewButtons.length];
      setView(next.dataset.view, { focus: true });
    });
  });
  globalThis.addEventListener?.("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.connecting) cancelConnection();
    else leaveGraph();
  });
  globalThis.addEventListener?.("resize", () => {
    if (state.view === "timeline") renderTimeline();
  });
  globalThis.addEventListener?.("pagehide", dispose, { once: true });
}

function dispose() {
  if (state.disposed) return;
  state.disposed = true;
  clearScheduler();
  stopAnimation();
  audio.close();
}

function initialize() {
  populatePresets();
  renderDeviceBrowser();
  audio.setPatch(state.patch);
  audio.setOutput(state.output);
  if (dom.output) dom.output.value = String(state.output);
  setText(dom.outputOut, `${Math.round(state.output * 100)}%`);
  bindInteractions();
  setView("constellation");
  updateRuntimeVisuals();
}

initialize();
