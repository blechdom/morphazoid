import { clamp, interpolateGesture } from "./syrinx.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAMPLE_COUNT = 96;
const VIEWBOX_WIDTH = 1_040;
const LABEL_WIDTH = 132;
const PLOT_LEFT = 142;
const PLOT_RIGHT = 1_018;
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT;
const LANE_TOP = 28;
const LANE_HEIGHT = 28;
const LANE_GRAPH_HEIGHT = 19;
const AXIS_HEIGHT = 30;

export const HYBRINX_TIMELINE_LANES = Object.freeze([
  Object.freeze({ parameter: "pressure", label: "Pressure / air", shortLabel: "AIR", color: "#ff7b6f", composition: "multiply" }),
  Object.freeze({ parameter: "tension", label: "Tension / pitch", shortLabel: "PITCH", color: "#ffab72", composition: "add" }),
  Object.freeze({ parameter: "adduction", label: "Closure", shortLabel: "CLOSE", color: "#ffcf68", composition: "add" }),
  Object.freeze({ parameter: "mouthOpening", label: "Mouth / beak", shortLabel: "MOUTH", color: "#bf9cff", composition: "add" }),
  Object.freeze({ parameter: "cavityCoupling", label: "Side cavity", shortLabel: "CAVITY", color: "#72e7dc", composition: "add" }),
  Object.freeze({ parameter: "roughness", label: "Roughness", shortLabel: "ROUGH", color: "#ff72b6", composition: "add" }),
  Object.freeze({ parameter: "asymmetry", label: "Source split", shortLabel: "SPLIT", color: "#d08cff", composition: "add" }),
  Object.freeze({ parameter: "sourceBalance", label: "Left / right", shortLabel: "L / R", color: "#64cfff", composition: "add" }),
]);

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizedValue = (value) => clamp(finiteNumber(value));

function freezeSamples(samples) {
  return Object.freeze(samples.map((sample) => Object.freeze(sample)));
}

function resolvedValue(gesture, baseState, parameter, phase) {
  return normalizedValue(interpolateGesture(gesture, phase, baseState)[parameter]);
}

/**
 * Converts the immutable native call gesture into a rendering document.
 * Curves are resolved through the same interpolator as audio playback: pressure
 * multiplies its base value, while the remaining native lanes add offsets and
 * clamp to the host's available control range.
 */
export function buildHybrinxTimelineModel(gesture, baseState = {}, options = {}) {
  if (!gesture?.curves || !gesture?.id) {
    return Object.freeze({
      id: "",
      label: "No call",
      callDurationMs: 0,
      gapDurationMs: 0,
      cycleDurationMs: 0,
      callFraction: 1,
      loop: false,
      lanes: Object.freeze([]),
      keyframeCount: 0,
    });
  }

  const gestureRate = clamp(
    finiteNumber(options.gestureRate, baseState.gestureRate ?? 1),
    0.25,
    2.5,
  );
  const loop = Boolean(options.loop ?? baseState.loop);
  const callDurationMs = Math.max(1, finiteNumber(gesture.durationMs, 1) / gestureRate);
  const gapDurationMs = loop
    ? clamp(finiteNumber(options.loopGapMs, baseState.loopGapMs), 0, 8_000)
    : 0;
  const cycleDurationMs = callDurationMs + gapDurationMs;
  // A very long silence should remain visible without flattening the call into
  // an unreadable sliver. The exact rest duration stays explicit in the label.
  const durationFraction = callDurationMs / Math.max(1, cycleDurationMs);
  const callFraction = gapDurationMs > 0
    ? clamp(durationFraction, 0.58, 0.88)
    : 1;
  const sampleCount = Math.round(clamp(finiteNumber(options.sampleCount, SAMPLE_COUNT), 24, 256));
  let keyframeCount = 0;

  const lanes = HYBRINX_TIMELINE_LANES
    .filter(({ parameter }) => Array.isArray(gesture.curves[parameter]))
    .map((definition) => {
      const authoredPoints = gesture.curves[definition.parameter];
      const samples = [];
      for (let index = 0; index <= sampleCount; index += 1) {
        const phase = index / sampleCount;
        samples.push({
          phase,
          time: phase * callFraction,
          value: resolvedValue(gesture, baseState, definition.parameter, phase),
        });
      }
      const keyframes = authoredPoints.map(([phaseValue, rawValue], index) => {
        const phase = clamp(finiteNumber(phaseValue));
        return Object.freeze({
          id: `${gesture.id}-${definition.parameter}-${index}`,
          phase,
          time: phase * callFraction,
          rawValue: finiteNumber(rawValue),
          value: resolvedValue(gesture, baseState, definition.parameter, phase),
        });
      });
      keyframeCount += keyframes.length;
      return Object.freeze({
        ...definition,
        samples: freezeSamples(samples),
        keyframes: Object.freeze(keyframes),
      });
    });

  return Object.freeze({
    id: gesture.id,
    label: gesture.label,
    callDurationMs,
    gapDurationMs,
    cycleDurationMs,
    callFraction,
    loop,
    lanes: Object.freeze(lanes),
    keyframeCount,
  });
}

export function resolveHybrinxPlayhead(model, transport = {}) {
  if (!model?.id || !transport.playing) return 0;
  const callEdge = clamp(model.callFraction ?? 1);
  const remainingGapMs = Math.max(0, finiteNumber(transport.gapRemainingMs));
  if (model.loop && model.gapDurationMs > 0 && remainingGapMs > 0) {
    const gapProgress = clamp(1 - remainingGapMs / model.gapDurationMs);
    return callEdge + gapProgress * (1 - callEdge);
  }
  return clamp(finiteNumber(transport.phase)) * callEdge;
}

export function formatHybrinxDuration(milliseconds) {
  const value = Math.max(0, finiteNumber(milliseconds));
  if (value < 1_000) return `${Math.round(value)} ms`;
  return `${(value / 1_000).toFixed(value >= 10_000 ? 1 : 2)} s`;
}

function createSvgElement(documentRef, name, attributes = {}) {
  const element = documentRef.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, String(value));
  }
  return element;
}

function pathFromSamples(samples, laneY, callFraction) {
  return samples.map((sample, index) => {
    const x = PLOT_LEFT + sample.time * PLOT_WIDTH;
    const y = laneY + (1 - sample.value) * LANE_GRAPH_HEIGHT;
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function timelineSignature(gesture, baseState, options) {
  const baseValues = HYBRINX_TIMELINE_LANES.map(({ parameter }) => (
    finiteNumber(baseState?.[parameter]).toFixed(5)
  ));
  return [
    gesture?.id ?? "",
    ...baseValues,
    finiteNumber(options.gestureRate, baseState?.gestureRate ?? 1).toFixed(4),
    Boolean(options.loop ?? baseState?.loop),
    finiteNumber(options.loopGapMs, baseState?.loopGapMs).toFixed(2),
  ].join("|");
}

function appendText(documentRef, parent, attributes, text) {
  const node = createSvgElement(documentRef, "text", attributes);
  node.textContent = text;
  parent.append(node);
  return node;
}

/**
 * Installs the read-only SVG view. Its public update method is deliberately
 * transport-shaped so future editing can replace the renderer without owning
 * or duplicating Syrinx's audio clock.
 */
export function createHybrinxTimeline(root) {
  if (!root) return null;
  const documentRef = root.ownerDocument;
  const svg = root.querySelector("#hybrinxTimelineSvg");
  const callOutput = root.querySelector("#hybrinxTimelineCall");
  const durationOutput = root.querySelector("#hybrinxTimelineDuration");
  const keyframesOutput = root.querySelector("#hybrinxTimelineKeyframes");
  const phaseOutput = root.querySelector("#hybrinxTimelinePhase");
  const description = root.querySelector("#hybrinxTimelineDescription");
  if (!svg) return null;

  let signature = "";
  let model = null;
  let playhead = null;
  let playheadCap = null;
  const currentValueNodes = new Map();
  const currentDots = new Map();

  function rebuild(payload) {
    model = buildHybrinxTimelineModel(payload.gesture, payload.baseState, payload);
    currentValueNodes.clear();
    currentDots.clear();
    svg.replaceChildren();
    const svgTitle = createSvgElement(documentRef, "title", { id: "hybrinxTimelineSvgTitle" });
    svgTitle.textContent = `${payload.animalLabel ?? "Animal"} ${model.label} native call automation`;
    const svgDescription = createSvgElement(documentRef, "desc", { id: "hybrinxTimelineSvgDescription" });
    svgDescription.textContent = `${model.lanes.length} resolved parameter contours with ${model.keyframeCount} authored keyframes.`;
    svg.append(svgTitle, svgDescription);
    svg.setAttribute("aria-labelledby", "hybrinxTimelineSvgTitle hybrinxTimelineSvgDescription");

    const height = LANE_TOP + model.lanes.length * LANE_HEIGHT + AXIS_HEIGHT;
    svg.setAttribute("viewBox", `0 0 ${VIEWBOX_WIDTH} ${height}`);
    svg.setAttribute("height", String(height));

    const background = createSvgElement(documentRef, "g", { class: "hybrinx-timeline-grid" });
    const lanesGroup = createSvgElement(documentRef, "g", { class: "hybrinx-timeline-lanes" });
    const axis = createSvgElement(documentRef, "g", { class: "hybrinx-timeline-axis" });
    const callRight = PLOT_LEFT + model.callFraction * PLOT_WIDTH;

    if (model.gapDurationMs > 0) {
      background.append(createSvgElement(documentRef, "rect", {
        class: "hybrinx-timeline-rest",
        x: callRight,
        y: LANE_TOP - 5,
        width: Math.max(0, PLOT_RIGHT - callRight),
        height: model.lanes.length * LANE_HEIGHT + 7,
      }));
      appendText(documentRef, background, {
        class: "hybrinx-timeline-rest-label",
        x: callRight + 10,
        y: LANE_TOP + 10,
      }, `REST ${formatHybrinxDuration(model.gapDurationMs)}`);
    }

    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const x = PLOT_LEFT + fraction * model.callFraction * PLOT_WIDTH;
      background.append(createSvgElement(documentRef, "line", {
        class: "hybrinx-timeline-time-grid",
        x1: x,
        x2: x,
        y1: LANE_TOP - 5,
        y2: LANE_TOP + model.lanes.length * LANE_HEIGHT,
      }));
      appendText(documentRef, axis, {
        class: "hybrinx-timeline-tick",
        x,
        y: height - 8,
        "text-anchor": fraction === 0 ? "start" : fraction === 1 ? "end" : "middle",
      }, formatHybrinxDuration(model.callDurationMs * fraction));
    }

    model.lanes.forEach((lane, index) => {
      const laneY = LANE_TOP + index * LANE_HEIGHT;
      const laneGroup = createSvgElement(documentRef, "g", {
        class: `hybrinx-timeline-lane hybrinx-timeline-lane-${lane.parameter}`,
        "data-parameter": lane.parameter,
        style: `--lane-color:${lane.color}`,
      });
      laneGroup.append(createSvgElement(documentRef, "rect", {
        class: "hybrinx-timeline-lane-bg",
        x: PLOT_LEFT,
        y: laneY - 2,
        width: PLOT_WIDTH,
        height: LANE_GRAPH_HEIGHT + 4,
      }));
      laneGroup.append(createSvgElement(documentRef, "line", {
        class: "hybrinx-timeline-lane-midline",
        x1: PLOT_LEFT,
        x2: PLOT_RIGHT,
        y1: laneY + LANE_GRAPH_HEIGHT / 2,
        y2: laneY + LANE_GRAPH_HEIGHT / 2,
      }));
      appendText(documentRef, laneGroup, {
        class: "hybrinx-timeline-lane-label",
        x: 10,
        y: laneY + 8,
      }, lane.shortLabel);
      const valueNode = appendText(documentRef, laneGroup, {
        class: "hybrinx-timeline-lane-value",
        x: LABEL_WIDTH - 10,
        y: laneY + 8,
        "text-anchor": "end",
      }, "0%");
      currentValueNodes.set(lane.parameter, valueNode);
      laneGroup.append(createSvgElement(documentRef, "path", {
        class: `hybrinx-timeline-curve${lane.parameter === "pressure" ? " is-pressure" : ""}`,
        d: pathFromSamples(lane.samples, laneY, model.callFraction),
      }));
      lane.keyframes.forEach((keyframe) => {
        const x = PLOT_LEFT + keyframe.time * PLOT_WIDTH;
        const y = laneY + (1 - keyframe.value) * LANE_GRAPH_HEIGHT;
        laneGroup.append(createSvgElement(documentRef, "rect", {
          class: "hybrinx-timeline-keyframe",
          x: x - 2.8,
          y: y - 2.8,
          width: 5.6,
          height: 5.6,
          transform: `rotate(45 ${x} ${y})`,
        }));
      });
      const currentDot = createSvgElement(documentRef, "circle", {
        class: "hybrinx-timeline-current-dot",
        cx: PLOT_LEFT,
        cy: laneY + LANE_GRAPH_HEIGHT,
        r: 3.4,
      });
      currentDots.set(lane.parameter, { node: currentDot, laneY });
      laneGroup.append(currentDot);
      lanesGroup.append(laneGroup);
    });

    playhead = createSvgElement(documentRef, "line", {
      class: "hybrinx-timeline-playhead",
      x1: PLOT_LEFT,
      x2: PLOT_LEFT,
      y1: LANE_TOP - 8,
      y2: LANE_TOP + model.lanes.length * LANE_HEIGHT,
    });
    playheadCap = createSvgElement(documentRef, "path", {
      class: "hybrinx-timeline-playhead-cap",
      d: "M -5 -7 L 5 -7 L 0 0 Z",
      transform: `translate(${PLOT_LEFT} ${LANE_TOP - 2})`,
    });
    svg.append(background, lanesGroup, axis, playhead, playheadCap);

    if (callOutput) callOutput.textContent = `${payload.animalLabel ?? "Animal"} / ${model.label}`;
    if (durationOutput) {
      durationOutput.textContent = model.gapDurationMs > 0
        ? `${formatHybrinxDuration(model.callDurationMs)} + ${formatHybrinxDuration(model.gapDurationMs)} rest`
        : formatHybrinxDuration(model.callDurationMs);
    }
    if (keyframesOutput) keyframesOutput.textContent = `${model.keyframeCount} keys`;
    if (description) {
      description.textContent = `${payload.animalLabel ?? "Animal"} ${model.label}: ${model.lanes.length} native automation lanes, ${model.keyframeCount} keyframes, ${formatHybrinxDuration(model.callDurationMs)} sounding duration${model.gapDurationMs ? `, then ${formatHybrinxDuration(model.gapDurationMs)} rest` : ""}.`;
    }
  }

  function update(payload = {}) {
    const nextSignature = timelineSignature(payload.gesture, payload.baseState, payload);
    if (nextSignature !== signature) {
      signature = nextSignature;
      rebuild(payload);
    }
    if (!model) return;
    const position = resolveHybrinxPlayhead(model, payload);
    const x = PLOT_LEFT + position * PLOT_WIDTH;
    playhead?.setAttribute("x1", String(x));
    playhead?.setAttribute("x2", String(x));
    playheadCap?.setAttribute("transform", `translate(${x} ${LANE_TOP - 2})`);
    const state = payload.performanceState ?? payload.baseState ?? {};
    const dotTime = payload.playing ? position : 0;
    currentValueNodes.forEach((node, parameter) => {
      const value = normalizedValue(state[parameter]);
      node.textContent = `${Math.round(value * 100)}%`;
      const current = currentDots.get(parameter);
      current?.node.setAttribute("cx", String(PLOT_LEFT + dotTime * PLOT_WIDTH));
      current?.node.setAttribute("cy", String(current.laneY + (1 - value) * LANE_GRAPH_HEIGHT));
    });
    if (phaseOutput) {
      phaseOutput.textContent = payload.playing
        ? payload.gapRemainingMs > 0
          ? `rest · ${formatHybrinxDuration(payload.gapRemainingMs)} left`
          : `${Math.round(clamp(finiteNumber(payload.phase)) * 100)}%`
        : "ready";
    }
    root.classList.toggle("is-playing", Boolean(payload.playing));
    root.classList.toggle("is-resting", Boolean(payload.playing && payload.gapRemainingMs > 0));
  }

  return Object.freeze({ update });
}
