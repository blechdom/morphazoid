import {
  ANIMALS,
  CONTROL_LIMITS,
  clamp,
  interpolateGesture,
  sampleGestureCurve,
  sampleModulationWave,
  sanitizeSyrinxState,
} from "./syrinx.js";
import { sanitizeTongueState } from "./tongue-physics.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const SAMPLE_COUNT = 96;
const LABEL_WIDTH = 132;
const PLOT_LEFT = 142;
const PLOT_END_PADDING = 22;
const BASE_CALL_WIDTH = 220;
const MAX_CALL_WIDTH = 20_000;
const CALL_PIXELS_PER_MS = 0.65;
const MIN_GAP_WIDTH = 120;
const MAX_GAP_WIDTH = 800;
const GAP_PIXELS_PER_MS = 0.35;
const LANE_TOP = 28;
const LANE_HEIGHT = 28;
const LANE_GRAPH_HEIGHT = 19;
const AXIS_HEIGHT = 30;
const KEYFRAME_PHASE_GAP = 0.002;
const DEFAULT_MODULATION_SPEED_HZ = 2;
const DEFAULT_MODULATION_DEPTH = 0.35;
const MODULATION_SPEED_LIMITS = Object.freeze([0.02, 30]);

export const HYBRINX_DURATION_LIMITS = Object.freeze([80, 30_000]);

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

const ADDITIONAL_HYBRINX_TIMELINE_LANES = Object.freeze([
  Object.freeze({ parameter: "sourceScale", label: "Source size", shortLabel: "SIZE", color: "#f5e4a7", composition: "add", family: "host" }),
  Object.freeze({ parameter: "tractLengthM", label: "Tract length", shortLabel: "TRACT", color: "#ffd99b", composition: "add", family: "host" }),
  Object.freeze({ parameter: "level", label: "Output level", shortLabel: "LEVEL", color: "#a8ff82", composition: "add", family: "host" }),
  Object.freeze({ parameter: "tonguePosition", label: "Tongue position", shortLabel: "T POS", color: "#ff927c", composition: "absolute", family: "tongue" }),
  Object.freeze({ parameter: "tongueHeight", label: "Tongue height", shortLabel: "T HIGH", color: "#ff7ba8", composition: "absolute", family: "tongue" }),
  Object.freeze({ parameter: "tongueShape", label: "Tongue focus", shortLabel: "T FOCUS", color: "#f56bd7", composition: "absolute", family: "tongue" }),
  Object.freeze({ parameter: "tongueTip", label: "Tongue tip", shortLabel: "T TIP", color: "#d67cff", composition: "absolute", family: "tongue" }),
  Object.freeze({ parameter: "tongueExtension", label: "Tongue reach", shortLabel: "T REACH", color: "#a58bff", composition: "absolute", family: "tongue" }),
  Object.freeze({ parameter: "tongueCurl", label: "Tongue curl", shortLabel: "T CURL", color: "#7da6ff", composition: "absolute", family: "tongue" }),
  Object.freeze({ parameter: "tongueLateral", label: "Tongue side leak", shortLabel: "T SIDE", color: "#63d9ff", composition: "absolute", family: "tongue" }),
]);

/** All lanes that can be materialized with the Add parameter palette. */
export const HYBRINX_TIMELINE_PARAMETER_CATALOG = Object.freeze([
  ...HYBRINX_TIMELINE_LANES.map((definition) => Object.freeze({
    ...definition,
    family: definition.family ?? "host",
  })),
  ...ADDITIONAL_HYBRINX_TIMELINE_LANES,
]);

export const HYBRINX_MODULATION_SPEED_LIMITS = MODULATION_SPEED_LIMITS;

const PARAMETER_DEFINITIONS = new Map(
  HYBRINX_TIMELINE_PARAMETER_CATALOG.map((definition) => [definition.parameter, definition]),
);

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const normalizedValue = (value) => clamp(finiteNumber(value));

const freezeCurvePoints = (points = []) => Object.freeze(points.map(([phase, value]) => (
  Object.freeze([clamp(phase), finiteNumber(value)])
)));

const freezeModulationPoints = (points = [], contour = "depth") => Object.freeze(
  points.map(([phase, value]) => Object.freeze([
    clamp(phase),
    contour === "speed"
      ? clamp(value, ...MODULATION_SPEED_LIMITS)
      : clamp(value),
  ])),
);

function freezeModulations(modulations = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(modulations)
      .filter(([parameter]) => PARAMETER_DEFINITIONS.has(parameter))
      .map(([parameter, modulation]) => [parameter, Object.freeze({
        enabled: Boolean(modulation?.enabled),
        shape: ["sine", "triangle", "square", "sample-hold"].includes(modulation?.shape)
          ? modulation.shape
          : "sine",
        phase: finiteNumber(modulation?.phase),
        speed: freezeModulationPoints(
          modulation?.speed ?? [[0, DEFAULT_MODULATION_SPEED_HZ], [1, DEFAULT_MODULATION_SPEED_HZ]],
          "speed",
        ),
        depth: freezeModulationPoints(
          modulation?.depth ?? [[0, DEFAULT_MODULATION_DEPTH], [1, DEFAULT_MODULATION_DEPTH]],
          "depth",
        ),
      })]),
  ));
}

function initialLaneParameters(gesture) {
  const requested = Array.isArray(gesture?.laneParameters)
    ? gesture.laneParameters
    : HYBRINX_TIMELINE_PARAMETER_CATALOG.map(({ parameter }) => parameter);
  const available = new Set(Object.keys(gesture?.curves ?? {}));
  return Object.freeze([
    ...new Set(requested.filter((parameter) => (
      PARAMETER_DEFINITIONS.has(parameter) && available.has(parameter)
    ))),
  ]);
}

function freezeEditableGesture(gesture, revision = 0) {
  return Object.freeze({
    id: String(gesture?.id ?? ""),
    label: String(gesture?.label ?? "Call"),
    durationMs: clamp(
      gesture?.durationMs,
      HYBRINX_DURATION_LIMITS[0],
      HYBRINX_DURATION_LIMITS[1],
    ),
    frequencyRatio: clamp(gesture?.frequencyRatio ?? 1, 0.03, 24),
    revision,
    curves: Object.freeze(Object.fromEntries(
      Object.entries(gesture?.curves ?? {}).map(([parameter, points]) => (
        [parameter, freezeCurvePoints(points)]
      )),
    )),
    laneParameters: initialLaneParameters(gesture),
    modulations: freezeModulations(gesture?.modulations),
  });
}

function editableRawValue(parameter, patch, baseState = {}, tongueState = {}) {
  const definition = PARAMETER_DEFINITIONS.get(parameter);
  if (Number.isFinite(Number(patch?.rawValue))) {
    return parameter === "pressure"
      ? clamp(patch.rawValue, 0, 1)
      : definition?.composition === "absolute"
        ? clamp(patch.rawValue)
        : clamp(patch.rawValue, -1, 1);
  }
  const resolved = normalizedValue(patch?.value);
  if (parameter === "pressure") {
    const pressure = clamp(baseState?.pressure);
    return clamp(pressure > 1e-6 ? resolved / pressure : resolved, 0, 1);
  }
  if (definition?.composition === "absolute") return resolved;
  return clamp(resolved - clamp(baseState?.[parameter]), -1, 1);
}

/**
 * Session-local copies of the authored animal calls. Native CALL_GESTURES stay
 * immutable; every edit returns a newly frozen gesture with a revision token.
 */
export function createHybrinxGestureStore(nativeGestures = {}) {
  const originals = new Map(Object.entries(nativeGestures));
  const baselines = new Map([...originals].map(([id, gesture]) => (
    [id, freezeEditableGesture(gesture, 0)]
  )));
  const edits = new Map();
  let revision = 0;

  const originalFor = (id) => originals.get(String(id ?? "")) ?? null;
  const currentFor = (id) => edits.get(String(id ?? ""))
    ?? baselines.get(String(id ?? ""))
    ?? null;
  const commit = (id, candidate) => {
    const key = String(id ?? "");
    if (!originalFor(key) || !candidate) return currentFor(key);
    const next = freezeEditableGesture(candidate, ++revision);
    edits.set(key, next);
    return next;
  };
  const replaceCurve = (gesture, parameter, points) => ({
    ...gesture,
    curves: {
      ...gesture.curves,
      [parameter]: points,
    },
  });
  const replaceModulationCurve = (gesture, parameter, contour, points) => ({
    ...gesture,
    modulations: {
      ...gesture.modulations,
      [parameter]: {
        ...gesture.modulations?.[parameter],
        [contour]: points,
      },
    },
  });
  const modulationRawValue = (contour, patch, fallback) => {
    const value = Number.isFinite(Number(patch?.rawValue))
      ? Number(patch.rawValue)
      : Number.isFinite(Number(patch?.value))
        ? contour === "speed"
          ? MODULATION_SPEED_LIMITS[0]
            + clamp(patch.value) * (MODULATION_SPEED_LIMITS[1] - MODULATION_SPEED_LIMITS[0])
          : clamp(patch.value)
        : fallback;
    return contour === "speed"
      ? clamp(value, ...MODULATION_SPEED_LIMITS)
      : clamp(value);
  };
  const editableSnapshot = (gesture) => JSON.stringify({
    id: gesture?.id,
    label: gesture?.label,
    durationMs: gesture?.durationMs,
    frequencyRatio: gesture?.frequencyRatio,
    curves: gesture?.curves,
    laneParameters: gesture?.laneParameters,
    modulations: gesture?.modulations,
  });

  return Object.freeze({
    get(id) {
      return currentFor(id);
    },
    updateKeyframe(id, parameter, index, patch = {}, baseState = {}) {
      const gesture = currentFor(id);
      const points = gesture?.curves?.[parameter];
      const pointIndex = Math.trunc(Number(index));
      if (!Array.isArray(points) || !points[pointIndex]) return gesture;
      const nextPoints = points.map(([phase, rawValue]) => [phase, rawValue]);
      const lastIndex = nextPoints.length - 1;
      let phase = finiteNumber(patch.phase, nextPoints[pointIndex][0]);
      if (pointIndex === 0) phase = 0;
      else if (pointIndex === lastIndex) phase = 1;
      else {
        phase = clamp(
          phase,
          nextPoints[pointIndex - 1][0] + KEYFRAME_PHASE_GAP,
          nextPoints[pointIndex + 1][0] - KEYFRAME_PHASE_GAP,
        );
      }
      const hasRawValue = Number.isFinite(Number(patch.rawValue));
      const hasResolvedValue = Number.isFinite(Number(patch.value));
      nextPoints[pointIndex] = [
        phase,
        hasRawValue || hasResolvedValue
          ? editableRawValue(parameter, patch, baseState)
          : nextPoints[pointIndex][1],
      ];
      return commit(id, replaceCurve(gesture, parameter, nextPoints));
    },
    addKeyframe(id, parameter, patch = {}, baseState = {}) {
      const gesture = currentFor(id);
      const points = gesture?.curves?.[parameter];
      if (!Array.isArray(points) || points.length < 2) return gesture;
      const phase = clamp(patch.phase, KEYFRAME_PHASE_GAP, 1 - KEYFRAME_PHASE_GAP);
      const existingIndex = points.findIndex(([pointPhase]) => (
        Math.abs(pointPhase - phase) < KEYFRAME_PHASE_GAP
      ));
      if (existingIndex >= 0) {
        const nextPoints = points.map(([pointPhase, value]) => [pointPhase, value]);
        nextPoints[existingIndex][1] = Number.isFinite(Number(patch.rawValue))
          || Number.isFinite(Number(patch.value))
          ? editableRawValue(parameter, patch, baseState)
          : nextPoints[existingIndex][1];
        return commit(id, replaceCurve(gesture, parameter, nextPoints));
      }
      const fallbackRawValue = sampleGestureCurve(points, phase);
      const rawValue = Number.isFinite(Number(patch.rawValue)) || Number.isFinite(Number(patch.value))
        ? editableRawValue(parameter, patch, baseState)
        : fallbackRawValue;
      const nextPoints = [...points.map(([pointPhase, value]) => [pointPhase, value]), [phase, rawValue]]
        .sort(([left], [right]) => left - right);
      return commit(id, replaceCurve(gesture, parameter, nextPoints));
    },
    removeKeyframe(id, parameter, index) {
      const gesture = currentFor(id);
      const points = gesture?.curves?.[parameter];
      const pointIndex = Math.trunc(Number(index));
      if (!Array.isArray(points)
        || points.length <= 2
        || pointIndex <= 0
        || pointIndex >= points.length - 1) return gesture;
      const nextPoints = points
        .filter((_, candidateIndex) => candidateIndex !== pointIndex)
        .map(([phase, value]) => [phase, value]);
      return commit(id, replaceCurve(gesture, parameter, nextPoints));
    },
    setDuration(id, durationMs) {
      const gesture = currentFor(id);
      if (!gesture) return null;
      return commit(id, {
        ...gesture,
        durationMs: clamp(durationMs, ...HYBRINX_DURATION_LIMITS),
      });
    },
    addParameter(id, parameter, baseState = {}, tongueState = {}) {
      const gesture = currentFor(id);
      const definition = PARAMETER_DEFINITIONS.get(parameter);
      if (!gesture || !definition) return gesture;
      if (Array.isArray(gesture.curves?.[parameter])) {
        if (gesture.laneParameters.includes(parameter)) return gesture;
        return commit(id, {
          ...gesture,
          laneParameters: [...gesture.laneParameters, parameter],
        });
      }
      const baseline = definition.composition === "absolute"
        ? clamp(tongueState?.[parameter] ?? baseState?.[parameter] ?? 0.5)
        : parameter === "pressure" ? 1 : 0;
      return commit(id, {
        ...gesture,
        curves: {
          ...gesture.curves,
          [parameter]: [[0, baseline], [1, baseline]],
        },
        laneParameters: [...gesture.laneParameters, parameter],
      });
    },
    toggleModulation(id, parameter, enabled) {
      const gesture = currentFor(id);
      if (!gesture?.laneParameters?.includes(parameter)) return gesture;
      const previous = gesture.modulations?.[parameter];
      const nextEnabled = enabled == null ? !previous?.enabled : Boolean(enabled);
      if (Boolean(previous?.enabled) === nextEnabled && previous) return gesture;
      return commit(id, {
        ...gesture,
        modulations: {
          ...gesture.modulations,
          [parameter]: {
            enabled: nextEnabled,
            shape: previous?.shape ?? "sine",
            phase: previous?.phase ?? 0,
            speed: previous?.speed
              ?? [[0, DEFAULT_MODULATION_SPEED_HZ], [1, DEFAULT_MODULATION_SPEED_HZ]],
            depth: previous?.depth
              ?? [[0, DEFAULT_MODULATION_DEPTH], [1, DEFAULT_MODULATION_DEPTH]],
          },
        },
      });
    },
    updateModulationKeyframe(id, parameter, contour, index, patch = {}) {
      const gesture = currentFor(id);
      if (!['speed', 'depth'].includes(contour)) return gesture;
      const points = gesture?.modulations?.[parameter]?.[contour];
      const pointIndex = Math.trunc(Number(index));
      if (!Array.isArray(points) || !points[pointIndex]) return gesture;
      const nextPoints = points.map(([phase, rawValue]) => [phase, rawValue]);
      const lastIndex = nextPoints.length - 1;
      let phase = finiteNumber(patch.phase, nextPoints[pointIndex][0]);
      if (pointIndex === 0) phase = 0;
      else if (pointIndex === lastIndex) phase = 1;
      else {
        phase = clamp(
          phase,
          nextPoints[pointIndex - 1][0] + KEYFRAME_PHASE_GAP,
          nextPoints[pointIndex + 1][0] - KEYFRAME_PHASE_GAP,
        );
      }
      nextPoints[pointIndex] = [
        phase,
        modulationRawValue(contour, patch, nextPoints[pointIndex][1]),
      ];
      return commit(id, replaceModulationCurve(gesture, parameter, contour, nextPoints));
    },
    addModulationKeyframe(id, parameter, contour, patch = {}) {
      const gesture = currentFor(id);
      if (!["speed", "depth"].includes(contour)) return gesture;
      const points = gesture?.modulations?.[parameter]?.[contour];
      if (!Array.isArray(points) || points.length < 2) return gesture;
      const phase = clamp(patch.phase, KEYFRAME_PHASE_GAP, 1 - KEYFRAME_PHASE_GAP);
      const existingIndex = points.findIndex(([pointPhase]) => (
        Math.abs(pointPhase - phase) < KEYFRAME_PHASE_GAP
      ));
      if (existingIndex >= 0) {
        const nextPoints = points.map(([pointPhase, value]) => [pointPhase, value]);
        nextPoints[existingIndex][1] = modulationRawValue(
          contour,
          patch,
          nextPoints[existingIndex][1],
        );
        return commit(id, replaceModulationCurve(gesture, parameter, contour, nextPoints));
      }
      const fallback = sampleGestureCurve(points, phase);
      const rawValue = modulationRawValue(contour, patch, fallback);
      const nextPoints = [...points.map(([pointPhase, value]) => [pointPhase, value]), [phase, rawValue]]
        .sort(([left], [right]) => left - right);
      return commit(id, replaceModulationCurve(gesture, parameter, contour, nextPoints));
    },
    removeModulationKeyframe(id, parameter, contour, index) {
      const gesture = currentFor(id);
      if (!["speed", "depth"].includes(contour)) return gesture;
      const points = gesture?.modulations?.[parameter]?.[contour];
      const pointIndex = Math.trunc(Number(index));
      if (!Array.isArray(points)
        || points.length <= 2
        || pointIndex <= 0
        || pointIndex >= points.length - 1) return gesture;
      const nextPoints = points
        .filter((_, candidateIndex) => candidateIndex !== pointIndex)
        .map(([phase, value]) => [phase, value]);
      return commit(id, replaceModulationCurve(gesture, parameter, contour, nextPoints));
    },
    resetParameterFamily(id, family) {
      const key = String(id ?? "");
      const gesture = currentFor(key);
      const baseline = baselines.get(key);
      if (!gesture || !baseline) return gesture;
      const familyParameters = new Set(
        HYBRINX_TIMELINE_PARAMETER_CATALOG
          .filter((definition) => definition.family === family)
          .map((definition) => definition.parameter),
      );
      if (!familyParameters.size) return gesture;

      const curves = Object.fromEntries(
        Object.entries(gesture.curves)
          .filter(([parameter]) => !familyParameters.has(parameter)),
      );
      const modulations = Object.fromEntries(
        Object.entries(gesture.modulations)
          .filter(([parameter]) => !familyParameters.has(parameter)),
      );
      for (const parameter of familyParameters) {
        if (baseline.curves[parameter]) curves[parameter] = baseline.curves[parameter];
        if (baseline.modulations[parameter]) {
          modulations[parameter] = baseline.modulations[parameter];
        }
      }
      const retainedLanes = gesture.laneParameters
        .filter((parameter) => !familyParameters.has(parameter));
      const baselineFamilyLanes = baseline.laneParameters
        .filter((parameter) => familyParameters.has(parameter));
      const candidate = {
        ...gesture,
        curves,
        modulations,
        laneParameters: [...retainedLanes, ...baselineFamilyLanes],
      };
      if (editableSnapshot(candidate) === editableSnapshot(gesture)) return gesture;
      if (editableSnapshot(candidate) === editableSnapshot(baseline)) {
        edits.delete(key);
        revision += 1;
        return baseline;
      }
      return commit(key, candidate);
    },
    reset(id) {
      const key = String(id ?? "");
      const baseline = baselines.get(key);
      if (!baseline) return null;
      edits.delete(key);
      revision += 1;
      return baseline;
    },
    resetAll() {
      edits.clear();
      revision += 1;
    },
    isEdited(id) {
      return edits.has(String(id ?? ""));
    },
  });
}

function freezeSamples(samples) {
  return Object.freeze(samples.map((sample) => Object.freeze(sample)));
}

function resolvedValue(gesture, baseState, tongueState, parameter, phase) {
  const definition = PARAMETER_DEFINITIONS.get(parameter);
  if (definition?.composition === "absolute") {
    return normalizedValue(sampleGestureCurve(gesture?.curves?.[parameter], phase));
  }
  return normalizedValue(interpolateGesture(gesture, phase, baseState)[parameter]);
}

function phasesForCurve(points, sampleCount) {
  const samplePhases = new Set();
  for (let index = 0; index <= sampleCount; index += 1) {
    samplePhases.add(index / sampleCount);
  }
  points.forEach(([phaseValue], index) => {
    const phase = clamp(finiteNumber(phaseValue));
    samplePhases.add(phase);
    const previous = index > 0 ? clamp(finiteNumber(points[index - 1][0])) : 0;
    const next = index < points.length - 1
      ? clamp(finiteNumber(points[index + 1][0]))
      : 1;
    const neighborOffset = Math.min(
      0.0015,
      Math.max(0, phase - previous) * 0.24,
      Math.max(0, next - phase) * 0.24,
    );
    if (phase > 0 && neighborOffset > 0) samplePhases.add(phase - neighborOffset);
    if (phase < 1 && neighborOffset > 0) samplePhases.add(phase + neighborOffset);
  });
  return [...samplePhases].sort((left, right) => left - right);
}

function normalizedModulationValue(contour, value) {
  if (contour !== "speed") return clamp(value);
  const [minimum, maximum] = MODULATION_SPEED_LIMITS;
  return clamp((finiteNumber(value, minimum) - minimum) / (maximum - minimum));
}

function buildModulationContour(points, contour, sampleCount, callFraction, gestureId, parameter) {
  const samples = phasesForCurve(points, sampleCount).map((phase) => ({
    phase,
    time: phase * callFraction,
    rawValue: sampleGestureCurve(points, phase),
    value: normalizedModulationValue(contour, sampleGestureCurve(points, phase)),
  }));
  const keyframes = points.map(([phaseValue, rawValue], index) => {
    const phase = clamp(finiteNumber(phaseValue));
    return Object.freeze({
      id: `${gestureId}-${parameter}-mod-${contour}-${index}`,
      phase,
      time: phase * callFraction,
      rawValue: finiteNumber(rawValue),
      value: normalizedModulationValue(contour, rawValue),
    });
  });
  return Object.freeze({
    kind: contour,
    label: contour === "speed" ? "Modulation speed" : "Modulation depth",
    shortLabel: contour === "speed" ? "SPEED" : "DEPTH",
    samples: freezeSamples(samples),
    keyframes: Object.freeze(keyframes),
  });
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
      callPlotWidth: BASE_CALL_WIDTH,
      gapPlotWidth: 0,
      plotWidth: BASE_CALL_WIDTH,
      viewBoxWidth: PLOT_LEFT + BASE_CALL_WIDTH + PLOT_END_PADDING,
      loop: false,
      lanes: Object.freeze([]),
      rowCount: 0,
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
  // Duration owns real horizontal space. Stretching a call therefore makes
  // its contour visibly longer and horizontally scrollable, while a long rest
  // is capped so it cannot crush the sounding gesture into an unreadable sliver.
  const callPlotWidth = clamp(
    BASE_CALL_WIDTH + callDurationMs * CALL_PIXELS_PER_MS,
    BASE_CALL_WIDTH,
    MAX_CALL_WIDTH,
  );
  const gapPlotWidth = gapDurationMs > 0
    ? Math.min(
      clamp(gapDurationMs * GAP_PIXELS_PER_MS, MIN_GAP_WIDTH, MAX_GAP_WIDTH),
      callPlotWidth * 0.72,
    )
    : 0;
  const plotWidth = callPlotWidth + gapPlotWidth;
  const callFraction = callPlotWidth / Math.max(1, plotWidth);
  const viewBoxWidth = PLOT_LEFT + plotWidth + PLOT_END_PADDING;
  const sampleCount = Math.round(clamp(finiteNumber(options.sampleCount, SAMPLE_COUNT), 24, 256));
  let keyframeCount = 0;

  const requestedParameters = Array.isArray(gesture.laneParameters)
    ? gesture.laneParameters
    : HYBRINX_TIMELINE_LANES.map(({ parameter }) => parameter);
  const lanes = requestedParameters
    .map((parameter) => PARAMETER_DEFINITIONS.get(parameter))
    .filter((definition) => definition && Array.isArray(gesture.curves[definition.parameter]))
    .map((definition) => {
      const authoredPoints = gesture.curves[definition.parameter];
      const samples = phasesForCurve(authoredPoints, sampleCount)
        .map((phase) => ({
          phase,
          time: phase * callFraction,
          value: resolvedValue(
            gesture,
            baseState,
            options.tongueState,
            definition.parameter,
            phase,
          ),
        }));
      const keyframes = authoredPoints.map(([phaseValue, rawValue], index) => {
        const phase = clamp(finiteNumber(phaseValue));
        return Object.freeze({
          id: `${gesture.id}-${definition.parameter}-${index}`,
          phase,
          time: phase * callFraction,
          rawValue: finiteNumber(rawValue),
          value: resolvedValue(
            gesture,
            baseState,
            options.tongueState,
            definition.parameter,
            phase,
          ),
        });
      });
      keyframeCount += keyframes.length;
      const authoredModulation = gesture.modulations?.[definition.parameter];
      const modulation = authoredModulation
        ? Object.freeze({
          enabled: Boolean(authoredModulation.enabled),
          shape: authoredModulation.shape ?? "sine",
          phase: finiteNumber(authoredModulation.phase),
          speed: buildModulationContour(
            authoredModulation.speed,
            "speed",
            sampleCount,
            callFraction,
            gesture.id,
            definition.parameter,
          ),
          depth: buildModulationContour(
            authoredModulation.depth,
            "depth",
            sampleCount,
            callFraction,
            gesture.id,
            definition.parameter,
          ),
        })
        : Object.freeze({ enabled: false });
      if (modulation.enabled) {
        keyframeCount += modulation.speed.keyframes.length + modulation.depth.keyframes.length;
      }
      return Object.freeze({
        ...definition,
        kind: "parameter",
        samples: freezeSamples(samples),
        keyframes: Object.freeze(keyframes),
        modulation,
      });
    });
  const rowCount = lanes.reduce((count, lane) => (
    count + 1 + (lane.modulation.enabled ? 2 : 0)
  ), 0);

  return Object.freeze({
    id: gesture.id,
    label: gesture.label,
    callDurationMs,
    gapDurationMs,
    cycleDurationMs,
    callFraction,
    callPlotWidth,
    gapPlotWidth,
    plotWidth,
    viewBoxWidth,
    loop,
    lanes: Object.freeze(lanes),
    rowCount,
    keyframeCount,
  });
}

function integrateGestureCurve(points, endPhase) {
  if (!Array.isArray(points) || points.length === 0) return 0;
  const end = clamp(endPhase);
  if (end <= 0) return 0;
  let area = 0;
  let cursor = 0;
  let cursorValue = finiteNumber(points[0][1]);
  for (let index = 1; index < points.length && cursor < end; index += 1) {
    const left = points[index - 1];
    const right = points[index];
    const start = clamp(finiteNumber(left[0]));
    const finish = clamp(finiteNumber(right[0]));
    if (start > cursor) {
      const flatEnd = Math.min(end, start);
      area += Math.max(0, flatEnd - cursor) * cursorValue;
      cursor = flatEnd;
      if (cursor >= end) break;
    }
    const span = Math.max(1e-9, finish - start);
    const segmentEnd = Math.min(end, finish);
    const amount = clamp((segmentEnd - start) / span);
    const leftValue = finiteNumber(left[1]);
    const delta = finiteNumber(right[1]) - leftValue;
    // sampleGestureCurve uses smoothstep. Its exact antiderivative keeps the
    // oscillator phase continuous when a speed keyframe is dragged.
    const easedArea = amount ** 3 - 0.5 * amount ** 4;
    area += span * (leftValue * amount + delta * easedArea);
    cursor = segmentEnd;
    cursorValue = sampleGestureCurve(points, cursor);
  }
  if (cursor < end) area += (end - cursor) * cursorValue;
  return area;
}

function preservePerformanceFields(sanitized, source) {
  return {
    ...sanitized,
    active: Boolean(source?.active),
    gesturePhase: finiteNumber(source?.gesturePhase),
    sourceFrequencyRatio: clamp(source?.sourceFrequencyRatio ?? 1, 0.03, 24),
  };
}

/**
 * Resolves authored host/tongue curves and the nested modulation envelopes.
 * LFO phase is the exact integral of the Speed contour from the call's start,
 * so rendering, repeated playback and audio all agree at a given call phase.
 */
export function applyHybrinxTimelinePerformance(
  gesture,
  baseState = {},
  baseTongueState = {},
  normalizedPhase = 0,
  options = {},
) {
  const phase = clamp(normalizedPhase);
  const initialHost = options.hostIsResolved
    ? preservePerformanceFields(sanitizeSyrinxState(baseState), baseState)
    : interpolateGesture(gesture, phase, baseState);
  const tongueCandidate = { ...sanitizeTongueState(baseTongueState) };
  for (const parameter of gesture?.laneParameters ?? Object.keys(gesture?.curves ?? {})) {
    const definition = PARAMETER_DEFINITIONS.get(parameter);
    const points = gesture?.curves?.[parameter];
    if (definition?.family !== "tongue" || !Array.isArray(points)) continue;
    tongueCandidate[parameter] = sampleGestureCurve(points, phase);
  }

  const hostCandidate = { ...initialHost };
  const modulationState = [];
  const gestureRate = clamp(
    finiteNumber(options.gestureRate, baseState?.gestureRate ?? 1),
    0.25,
    2.5,
  );
  const durationSeconds = Math.max(1, finiteNumber(gesture?.durationMs, 1))
    / gestureRate
    / 1_000;
  for (const [parameter, modulation] of Object.entries(gesture?.modulations ?? {})) {
    const definition = PARAMETER_DEFINITIONS.get(parameter);
    if (!definition || !modulation?.enabled) continue;
    if (!Array.isArray(modulation.speed) || !Array.isArray(modulation.depth)) continue;
    const rateHz = clamp(sampleGestureCurve(modulation.speed, phase), ...MODULATION_SPEED_LIMITS);
    const depth = clamp(sampleGestureCurve(modulation.depth, phase));
    const oscillatorPhase = finiteNumber(modulation.phase)
      + integrateGestureCurve(modulation.speed, phase) * durationSeconds;
    const wave = sampleModulationWave(modulation.shape, oscillatorPhase, 0);
    if (definition.family === "tongue") {
      tongueCandidate[parameter] = finiteNumber(tongueCandidate[parameter])
        + wave * depth * 0.5;
    } else if (CONTROL_LIMITS[parameter]) {
      const animal = ANIMALS[initialHost.animalId];
      const [minimum, maximum] = initialHost.biologicalLock
        ? animal?.bounds?.[parameter] ?? CONTROL_LIMITS[parameter]
        : CONTROL_LIMITS[parameter];
      hostCandidate[parameter] = finiteNumber(hostCandidate[parameter])
        + wave * depth * (maximum - minimum) * 0.5;
    }
    modulationState.push(Object.freeze({
      parameter,
      family: definition.family,
      rateHz,
      depth,
      wave,
      oscillatorPhase,
    }));
  }

  return Object.freeze({
    host: Object.freeze(preservePerformanceFields(
      sanitizeSyrinxState(hostCandidate, initialHost),
      hostCandidate,
    )),
    tongue: Object.freeze(sanitizeTongueState(tongueCandidate, baseTongueState)),
    modulation: Object.freeze(modulationState),
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

export function resolveHybrinxTimelineGeometry(model = {}, options = {}) {
  const rowCount = Math.max(1, Math.trunc(finiteNumber(options.rowCount, model.rowCount ?? 1)));
  const availableWidth = Math.max(0, finiteNumber(options.availableWidth));
  const availableHeight = Math.max(0, finiteNumber(options.availableHeight));
  const zoomX = clamp(finiteNumber(options.zoomX, 1), 1, 4);
  const zoomY = clamp(finiteNumber(options.zoomY, 1), 1, 4);
  const fittedPlotWidth = Math.max(
    BASE_CALL_WIDTH,
    availableWidth - PLOT_LEFT - PLOT_END_PADDING,
    finiteNumber(model.plotWidth, BASE_CALL_WIDTH),
  );
  const plotWidth = fittedPlotWidth * zoomX;
  const fittedLaneHeight = Math.max(
    LANE_HEIGHT,
    (availableHeight - LANE_TOP - AXIS_HEIGHT) / rowCount,
  );
  const laneHeight = fittedLaneHeight * zoomY;
  const graphHeight = Math.max(13, laneHeight - 9);
  const callFraction = clamp(finiteNumber(model.callFraction, 1));
  return Object.freeze({
    viewBoxWidth: PLOT_LEFT + plotWidth + PLOT_END_PADDING,
    viewBoxHeight: LANE_TOP + rowCount * laneHeight + AXIS_HEIGHT,
    plotWidth,
    callPlotWidth: plotWidth * callFraction,
    gapPlotWidth: plotWidth * (1 - callFraction),
    laneHeight,
    graphHeight,
  });
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

function pathFromSamples(samples, laneY, plotWidth, graphHeight) {
  return samples.map((sample, index) => {
    const x = PLOT_LEFT + sample.time * plotWidth;
    const y = laneY + (1 - sample.value) * graphHeight;
    return `${index ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function timelineSignature(gesture, baseState, options) {
  const baseValues = HYBRINX_TIMELINE_PARAMETER_CATALOG.map(({ parameter, family }) => (
    finiteNumber(
      family === "tongue" ? options.tongueState?.[parameter] : baseState?.[parameter],
    ).toFixed(5)
  ));
  return [
    gesture?.id ?? "",
    finiteNumber(gesture?.durationMs).toFixed(2),
    finiteNumber(gesture?.revision).toFixed(0),
    ...baseValues,
    finiteNumber(options.gestureRate, baseState?.gestureRate ?? 1).toFixed(4),
    Boolean(options.loop ?? baseState?.loop),
    finiteNumber(options.loopGapMs, baseState?.loopGapMs).toFixed(2),
    Boolean(options.edited),
    finiteNumber(options.zoomX, 1).toFixed(3),
    finiteNumber(options.zoomY, 1).toFixed(3),
    finiteNumber(options.availableHeight, 0).toFixed(0),
    finiteNumber(options.availableWidth, 0).toFixed(0),
  ].join("|");
}

function appendText(documentRef, parent, attributes, text) {
  const node = createSvgElement(documentRef, "text", attributes);
  node.textContent = text;
  parent.append(node);
  return node;
}

/**
 * Installs the editable SVG view. The renderer emits small edit operations;
 * Syrinx remains the owner of gesture state and the audio transport clock.
 */
export function createHybrinxTimeline(root, options = {}) {
  if (!root) return null;
  const documentRef = root.ownerDocument;
  const svg = root.querySelector("#hybrinxTimelineSvg");
  const scroll = root.querySelector("#hybrinxTimelineScroll");
  const gutter = root.querySelector("#hybrinxTimelineGutter");
  const callOutput = root.querySelector("#hybrinxTimelineCall");
  const durationOutput = root.querySelector("#hybrinxTimelineDuration");
  const durationInput = root.querySelector("#hybrinxTimelineDurationInput");
  const resetButton = root.querySelector("#hybrinxTimelineReset");
  const editStatus = root.querySelector("#hybrinxTimelineEditStatus");
  const keyframesOutput = root.querySelector("#hybrinxTimelineKeyframes");
  const phaseOutput = root.querySelector("#hybrinxTimelinePhase");
  const description = root.querySelector("#hybrinxTimelineDescription");
  const addParameterButton = root.querySelector("#hybrinxTimelineAddParameter");
  const parameterPalette = root.querySelector("#hybrinxTimelineParameterPalette");
  const zoomXInput = root.querySelector("#hybrinxTimelineZoomX");
  const zoomYInput = root.querySelector("#hybrinxTimelineZoomY");
  const zoomXOutput = root.querySelector("#hybrinxTimelineZoomXOut");
  const zoomYOutput = root.querySelector("#hybrinxTimelineZoomYOut");
  if (!svg) return null;
  zoomXInput?.addEventListener("input", () => applyZoomControl(zoomXInput, zoomXOutput, "x"));
  zoomYInput?.addEventListener("input", () => applyZoomControl(zoomYInput, zoomYOutput, "y"));

  let editHandler = options.onEdit ?? null;
  let signature = "";
  let model = null;
  let currentPayload = {};
  let playhead = null;
  let playheadCap = null;
  let activeEdit = null;
  let pendingFocus = null;
  let renderRows = [];
  let zoomX = clamp(finiteNumber(zoomXInput?.value, 100) / 100, 1, 4);
  let zoomY = clamp(finiteNumber(zoomYInput?.value, 100) / 100, 1, 4);
  let geometry = Object.freeze({
    viewBoxWidth: PLOT_LEFT + BASE_CALL_WIDTH + PLOT_END_PADDING,
    viewBoxHeight: LANE_TOP + LANE_HEIGHT + AXIS_HEIGHT,
    plotWidth: BASE_CALL_WIDTH,
    callPlotWidth: BASE_CALL_WIDTH,
    gapPlotWidth: 0,
    laneHeight: LANE_HEIGHT,
    graphHeight: LANE_GRAPH_HEIGHT,
  });

  const keySelector = ({ parameter, contour, index }) => {
    const contourSelector = contour
      ? `[data-contour="${contour}"]`
      : ":not([data-contour])";
    return `.hybrinx-timeline-keyframe[data-parameter="${parameter}"]${contourSelector}[data-index="${index}"]`;
  };

  function restorePendingFocus() {
    if (!pendingFocus) return;
    const target = pendingFocus.type === "duration"
      ? svg.querySelector("[data-duration-handle]")
      : pendingFocus.type === "modulation-toggle"
        ? root.querySelector(
          `[data-hybrinx-mod-toggle][data-parameter="${pendingFocus.parameter}"]`,
        )
        : svg.querySelector(keySelector(pendingFocus));
    pendingFocus = null;
    target?.focus?.({ preventScroll: true });
  }

  function emitEdit(action, { restoreFocus = false, immediate = true } = {}) {
    if (typeof editHandler !== "function" || !currentPayload.gesture) return null;
    if (restoreFocus) {
      pendingFocus = action.type === "duration"
        ? { type: "duration" }
        : action.type === "toggle-modulation"
          ? { type: "modulation-toggle", parameter: action.parameter }
          : {
            type: "keyframe",
            parameter: action.parameter,
            contour: action.contour,
            index: action.index,
          };
    }
    const nextGesture = editHandler(action);
    if (nextGesture?.curves) {
      currentPayload = {
        ...currentPayload,
        gesture: nextGesture,
        edited: action.type !== "reset",
      };
      signature = "";
      if (immediate) update(currentPayload);
    }
    return nextGesture;
  }

  function rebuild(payload) {
    model = buildHybrinxTimelineModel(payload.gesture, payload.baseState, payload);
    renderRows = [];
    model.lanes.forEach((lane) => {
      renderRows.push({ lane, track: lane, contour: "" });
      if (lane.modulation.enabled) {
        renderRows.push({ lane, track: lane.modulation.speed, contour: "speed" });
        renderRows.push({ lane, track: lane.modulation.depth, contour: "depth" });
      }
    });
    geometry = resolveHybrinxTimelineGeometry(model, {
      rowCount: renderRows.length,
      availableWidth: payload.availableWidth,
      availableHeight: payload.availableHeight,
      zoomX,
      zoomY,
    });
    svg.replaceChildren();
    const svgTitle = createSvgElement(documentRef, "title", { id: "hybrinxTimelineSvgTitle" });
    svgTitle.textContent = `${payload.animalLabel ?? "Animal"} ${model.label} editable call automation`;
    const svgDescription = createSvgElement(documentRef, "desc", { id: "hybrinxTimelineSvgDescription" });
    svgDescription.textContent = `${model.lanes.length} editable parameters across ${renderRows.length} contours with ${model.keyframeCount} keyframes. Drag diamonds to change time and value; double-click a contour to add one.`;
    svg.append(svgTitle, svgDescription);
    svg.setAttribute("aria-labelledby", "hybrinxTimelineSvgTitle hybrinxTimelineSvgDescription");

    const plotRight = PLOT_LEFT + geometry.plotWidth;
    const callRight = PLOT_LEFT + geometry.callPlotWidth;
    const rowsBottom = LANE_TOP + renderRows.length * geometry.laneHeight;
    svg.setAttribute("viewBox", `0 0 ${geometry.viewBoxWidth} ${geometry.viewBoxHeight}`);
    svg.setAttribute("width", String(geometry.viewBoxWidth));
    svg.setAttribute("height", String(geometry.viewBoxHeight));
    svg.setAttribute("preserveAspectRatio", "xMinYMin meet");
    svg.style.setProperty("--hybrinx-svg-width", `${geometry.viewBoxWidth}px`);
    svg.style.setProperty("--hybrinx-svg-height", `${geometry.viewBoxHeight}px`);
    if (gutter) {
      gutter.replaceChildren();
      gutter.style.setProperty("--hybrinx-gutter-height", `${geometry.viewBoxHeight}px`);
    }

    const background = createSvgElement(documentRef, "g", { class: "hybrinx-timeline-grid" });
    const lanesGroup = createSvgElement(documentRef, "g", { class: "hybrinx-timeline-lanes" });
    const axis = createSvgElement(documentRef, "g", { class: "hybrinx-timeline-axis" });

    if (model.gapDurationMs > 0) {
      background.append(createSvgElement(documentRef, "rect", {
        class: "hybrinx-timeline-rest",
        x: callRight,
        y: LANE_TOP - 5,
        width: Math.max(0, geometry.gapPlotWidth),
        height: renderRows.length * geometry.laneHeight + 7,
      }));
      appendText(documentRef, background, {
        class: "hybrinx-timeline-rest-label",
        x: callRight + 10,
        y: LANE_TOP + 10,
      }, `REST ${formatHybrinxDuration(model.gapDurationMs)}`);
    }

    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const x = PLOT_LEFT + fraction * geometry.callPlotWidth;
      background.append(createSvgElement(documentRef, "line", {
        class: "hybrinx-timeline-time-grid",
        x1: x,
        x2: x,
        y1: LANE_TOP - 5,
        y2: rowsBottom,
      }));
      appendText(documentRef, axis, {
        class: "hybrinx-timeline-tick",
        x,
        y: geometry.viewBoxHeight - 8,
        "text-anchor": fraction === 0 ? "start" : fraction === 1 ? "end" : "middle",
      }, formatHybrinxDuration(model.callDurationMs * fraction));
    }

    renderRows.forEach((row, index) => {
      const { lane, track, contour } = row;
      const laneY = LANE_TOP + index * geometry.laneHeight;
      Object.assign(row, { laneY, valueNode: null, currentDot: null });
      if (gutter) {
        const gutterRow = documentRef.createElement("div");
        gutterRow.className = `hybrinx-timeline-gutter-row${contour ? " is-modulation" : ""}`;
        gutterRow.dataset.parameter = lane.parameter;
        if (contour) gutterRow.dataset.contour = contour;
        gutterRow.style.setProperty("--hybrinx-row-top", `${laneY - 2}px`);
        gutterRow.style.setProperty("--hybrinx-row-height", `${geometry.graphHeight + 4}px`);
        gutterRow.style.setProperty("--lane-color", lane.color);

        const label = documentRef.createElement("span");
        label.className = "hybrinx-timeline-gutter-label";
        label.textContent = contour ? `↳ ${track.shortLabel}` : lane.shortLabel;
        gutterRow.append(label);

        if (!contour) {
          const modToggle = documentRef.createElement("button");
          modToggle.type = "button";
          modToggle.className = "hybrinx-timeline-gutter-mod";
          modToggle.dataset.hybrinxModToggle = "";
          modToggle.dataset.parameter = lane.parameter;
          modToggle.setAttribute(
            "aria-label",
            `${lane.modulation.enabled ? "Disable" : "Enable"} ${lane.label} modulation contours`,
          );
          modToggle.setAttribute("aria-pressed", String(lane.modulation.enabled));
          modToggle.textContent = "MOD";
          gutterRow.append(modToggle);
        }

        const valueNode = documentRef.createElement("output");
        valueNode.className = "hybrinx-timeline-gutter-value";
        valueNode.textContent = contour === "speed" ? "2.00 Hz" : "0%";
        gutterRow.append(valueNode);
        row.valueNode = valueNode;
        gutter.append(gutterRow);
      }
      const laneGroup = createSvgElement(documentRef, "g", {
        class: `hybrinx-timeline-lane hybrinx-timeline-lane-${lane.parameter}${contour ? " hybrinx-timeline-modulation-lane" : ""}`,
        "data-parameter": lane.parameter,
        ...(contour ? { "data-contour": contour, "data-modulation-axis": contour } : {}),
        style: `--lane-color:${lane.color}`,
      });
      laneGroup.append(createSvgElement(documentRef, "rect", {
        class: "hybrinx-timeline-lane-bg",
        x: PLOT_LEFT,
        y: laneY - 2,
        width: geometry.plotWidth,
        height: geometry.graphHeight + 4,
      }));
      laneGroup.append(createSvgElement(documentRef, "line", {
        class: "hybrinx-timeline-lane-midline",
        x1: PLOT_LEFT,
        x2: plotRight,
        y1: laneY + geometry.graphHeight / 2,
        y2: laneY + geometry.graphHeight / 2,
      }));
      laneGroup.append(createSvgElement(documentRef, "path", {
        class: contour
          ? "hybrinx-timeline-modulation-curve"
          : `hybrinx-timeline-curve${lane.parameter === "pressure" ? " is-pressure" : ""}`,
        d: pathFromSamples(track.samples, laneY, geometry.plotWidth, geometry.graphHeight),
      }));
      track.keyframes.forEach((keyframe, keyframeIndex) => {
        const x = PLOT_LEFT + keyframe.time * geometry.plotWidth;
        const y = laneY + (1 - keyframe.value) * geometry.graphHeight;
        const keyGroup = createSvgElement(documentRef, "g", {
          class: "hybrinx-timeline-keyframe",
          "data-parameter": lane.parameter,
          ...(contour ? { "data-contour": contour } : {}),
          "data-index": keyframeIndex,
          tabindex: 0,
          role: "slider",
          "aria-label": `${lane.label} ${contour || "value"} keyframe ${keyframeIndex + 1} of ${track.keyframes.length}`,
          "aria-valuemin": 0,
          "aria-valuemax": 1,
          "aria-valuenow": keyframe.value.toFixed(3),
          "aria-valuetext": `${contour === "speed" ? `${keyframe.rawValue.toFixed(2)} hertz` : `${Math.round(keyframe.value * 100)} percent`} at ${Math.round(keyframe.phase * 100)} percent of call`,
        });
        keyGroup.append(
          createSvgElement(documentRef, "circle", {
            class: "hybrinx-timeline-keyframe-hit",
            cx: x,
            cy: y,
            r: 9,
          }),
          createSvgElement(documentRef, "rect", {
            class: "hybrinx-timeline-keyframe-mark",
            x: x - 2.8,
            y: y - 2.8,
            width: 5.6,
            height: 5.6,
            transform: `rotate(45 ${x} ${y})`,
          }),
        );
        laneGroup.append(keyGroup);
      });
      const currentDot = createSvgElement(documentRef, "circle", {
        class: "hybrinx-timeline-current-dot",
        cx: PLOT_LEFT,
        cy: laneY + geometry.graphHeight,
        r: 3.4,
      });
      row.currentDot = currentDot;
      laneGroup.append(currentDot);
      lanesGroup.append(laneGroup);
    });

    const durationHandle = createSvgElement(documentRef, "g", {
      class: "hybrinx-timeline-duration-handle",
      "data-duration-handle": "true",
      tabindex: 0,
      role: "slider",
      "aria-label": "Call duration; drag horizontally to stretch",
      "aria-valuemin": HYBRINX_DURATION_LIMITS[0],
      "aria-valuemax": HYBRINX_DURATION_LIMITS[1],
      "aria-valuenow": Math.round(payload.gesture?.durationMs ?? model.callDurationMs),
      "aria-valuetext": formatHybrinxDuration(payload.gesture?.durationMs ?? model.callDurationMs),
    });
    durationHandle.append(
      createSvgElement(documentRef, "rect", {
        class: "hybrinx-timeline-duration-hit",
        x: callRight - 10,
        y: LANE_TOP - 9,
        width: 20,
        height: renderRows.length * geometry.laneHeight + 16,
      }),
      createSvgElement(documentRef, "line", {
        class: "hybrinx-timeline-duration-line",
        x1: callRight,
        x2: callRight,
        y1: LANE_TOP - 8,
        y2: rowsBottom,
      }),
    );
    appendText(documentRef, durationHandle, {
      class: "hybrinx-timeline-duration-label",
      x: callRight - 5,
      y: LANE_TOP - 11,
      "text-anchor": "end",
    }, "STRETCH");

    playhead = createSvgElement(documentRef, "line", {
      class: "hybrinx-timeline-playhead",
      x1: PLOT_LEFT,
      x2: PLOT_LEFT,
      y1: LANE_TOP - 8,
      y2: rowsBottom,
    });
    playheadCap = createSvgElement(documentRef, "path", {
      class: "hybrinx-timeline-playhead-cap",
      d: "M -5 -7 L 5 -7 L 0 0 Z",
      transform: `translate(${PLOT_LEFT} ${LANE_TOP - 2})`,
    });
    svg.append(background, lanesGroup, axis, durationHandle, playhead, playheadCap);

    if (callOutput) callOutput.textContent = `${payload.animalLabel ?? "Animal"} / ${model.label}`;
    if (durationOutput) {
      durationOutput.textContent = model.gapDurationMs > 0
        ? `${formatHybrinxDuration(model.callDurationMs)} + ${formatHybrinxDuration(model.gapDurationMs)} rest`
        : formatHybrinxDuration(model.callDurationMs);
    }
    if (durationInput && documentRef.activeElement !== durationInput) {
      durationInput.value = String(Math.round(payload.gesture?.durationMs ?? model.callDurationMs));
    }
    if (keyframesOutput) keyframesOutput.textContent = `${model.keyframeCount} keys`;
    if (editStatus) editStatus.textContent = payload.edited ? "edited" : "native";
    root.classList.toggle("is-edited", Boolean(payload.edited));
    resetButton?.toggleAttribute("disabled", !payload.edited);
    parameterPalette?.querySelectorAll("[data-hybrinx-add-parameter]").forEach((button) => {
      const added = payload.gesture?.laneParameters?.includes(button.dataset.hybrinxAddParameter);
      button.toggleAttribute("disabled", Boolean(added));
      button.setAttribute("aria-pressed", String(Boolean(added)));
    });
    if (description) {
      description.textContent = `${payload.animalLabel ?? "Animal"} ${model.label}: ${model.lanes.length} editable automation lanes, ${model.keyframeCount} keyframes, ${formatHybrinxDuration(model.callDurationMs)} sounding duration${model.gapDurationMs ? `, then ${formatHybrinxDuration(model.gapDurationMs)} rest` : ""}. Drag a keyframe to change its time and value, double-click a lane to add one, or drag the Stretch edge to elongate the call.`;
    }
    restorePendingFocus();
  }

  function localPoint(event) {
    const bounds = svg.getBoundingClientRect();
    const width = Math.max(1, bounds.width);
    const height = Math.max(1, bounds.height);
    return {
      x: (event.clientX - bounds.left) * geometry.viewBoxWidth / width,
      y: (event.clientY - bounds.top) * geometry.viewBoxHeight / height,
    };
  }

  function keyframeActionFromPointer(event, edit = activeEdit) {
    if (!model || !edit || edit.type !== "keyframe") return null;
    const row = renderRows.find((candidate) => (
      candidate.lane.parameter === edit.parameter && candidate.contour === (edit.contour ?? "")
    ));
    if (!row) return null;
    const point = localPoint(event);
    return {
      type: edit.contour ? "modulation-keyframe" : "keyframe",
      parameter: edit.parameter,
      ...(edit.contour ? { contour: edit.contour } : {}),
      index: edit.index,
      phase: clamp((point.x - PLOT_LEFT) / Math.max(1, geometry.callPlotWidth)),
      value: clamp(1 - (point.y - row.laneY) / geometry.graphHeight),
    };
  }

  svg.addEventListener("pointerdown", (event) => {
    const keyframe = event.target.closest?.(".hybrinx-timeline-keyframe");
    const durationHandle = event.target.closest?.("[data-duration-handle]");
    if (!keyframe && !durationHandle) return;
    event.preventDefault();
    event.stopPropagation();
    svg.setPointerCapture?.(event.pointerId);
    if (keyframe) {
      activeEdit = {
        type: "keyframe",
        pointerId: event.pointerId,
        parameter: keyframe.dataset.parameter,
        contour: keyframe.dataset.contour ?? "",
        index: Number(keyframe.dataset.index),
      };
      keyframe.focus?.({ preventScroll: true });
    } else {
      activeEdit = {
        type: "duration",
        pointerId: event.pointerId,
        lastClientX: event.clientX,
      };
      durationHandle.focus?.({ preventScroll: true });
    }
    root.classList.add("is-editing");
  });

  svg.addEventListener("pointermove", (event) => {
    if (!activeEdit || activeEdit.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (activeEdit.type === "duration") {
      const bounds = svg.getBoundingClientRect();
      const cssPerViewBoxPixel = bounds.width / Math.max(1, geometry.viewBoxWidth);
      const gestureRate = clamp(
        currentPayload.gestureRate ?? currentPayload.baseState?.gestureRate ?? 1,
        0.25,
        2.5,
      );
      const cssPixelsPerDurationMs = Math.max(
        0.01,
        CALL_PIXELS_PER_MS / gestureRate
          * (geometry.callPlotWidth / Math.max(1, model.callPlotWidth))
          * cssPerViewBoxPixel,
      );
      const deltaX = event.clientX - activeEdit.lastClientX;
      activeEdit.lastClientX = event.clientX;
      emitEdit({
        type: "duration",
        durationMs: (Number(currentPayload.gesture?.durationMs) || model.callDurationMs)
          + deltaX / cssPixelsPerDurationMs,
      }, { immediate: false });
      return;
    }
    const action = keyframeActionFromPointer(event);
    if (action) emitEdit(action, { immediate: false });
  });

  function finishPointerEdit(event) {
    if (!activeEdit || activeEdit.pointerId !== event.pointerId) return;
    const finishedEdit = activeEdit;
    activeEdit = null;
    if (event.type !== "lostpointercapture" && svg.hasPointerCapture?.(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }
    root.classList.remove("is-editing");
    pendingFocus = finishedEdit.type === "duration"
      ? { type: "duration" }
      : {
        type: "keyframe",
        parameter: finishedEdit.parameter,
        contour: finishedEdit.contour,
        index: finishedEdit.index,
      };
    const view = documentRef.defaultView;
    if (typeof view?.requestAnimationFrame === "function") {
      view.requestAnimationFrame(restorePendingFocus);
    } else {
      restorePendingFocus();
    }
  }
  for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
    svg.addEventListener(type, finishPointerEdit);
  }

  svg.addEventListener("dblclick", (event) => {
    if (!model || event.target.closest?.(
      "[data-duration-handle], [data-hybrinx-mod-toggle], .hybrinx-timeline-keyframe",
    )) return;
    const point = localPoint(event);
    const laneIndex = Math.floor((point.y - LANE_TOP) / geometry.laneHeight);
    const row = renderRows[laneIndex];
    if (!row || point.x < PLOT_LEFT || point.x > PLOT_LEFT + geometry.callPlotWidth) return;
    event.preventDefault();
    emitEdit({
      type: row.contour ? "add-modulation-keyframe" : "add-keyframe",
      parameter: row.lane.parameter,
      ...(row.contour ? { contour: row.contour } : {}),
      phase: clamp((point.x - PLOT_LEFT) / Math.max(1, geometry.callPlotWidth)),
      value: clamp(1 - (point.y - row.laneY) / geometry.graphHeight),
    });
  });

  svg.addEventListener("keydown", (event) => {
    const durationHandle = event.target.closest?.("[data-duration-handle]");
    if (durationHandle) {
      const amount = event.shiftKey ? 250 : 50;
      let durationMs = Number(currentPayload.gesture?.durationMs) || model.callDurationMs;
      if (event.key === "ArrowLeft" || event.key === "ArrowDown") durationMs -= amount;
      else if (event.key === "ArrowRight" || event.key === "ArrowUp") durationMs += amount;
      else if (event.key === "Home") durationMs = HYBRINX_DURATION_LIMITS[0];
      else if (event.key === "End") durationMs = HYBRINX_DURATION_LIMITS[1];
      else return;
      event.preventDefault();
      emitEdit({ type: "duration", durationMs }, { restoreFocus: true });
      return;
    }
    const keyframe = event.target.closest?.(".hybrinx-timeline-keyframe");
    if (!keyframe || !model) return;
    const parameter = keyframe.dataset.parameter;
    const contour = keyframe.dataset.contour ?? "";
    const index = Number(keyframe.dataset.index);
    const lane = model.lanes.find((candidate) => candidate.parameter === parameter);
    const track = contour ? lane?.modulation?.[contour] : lane;
    const key = track?.keyframes[index];
    if (!key) return;
    const amount = event.shiftKey ? 0.05 : 0.01;
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      emitEdit(
        {
          type: contour ? "remove-modulation-keyframe" : "remove-keyframe",
          parameter,
          ...(contour ? { contour } : {}),
          index,
        },
        { restoreFocus: true },
      );
      return;
    }
    const action = {
      type: contour ? "modulation-keyframe" : "keyframe",
      parameter,
      ...(contour ? { contour } : {}),
      index,
    };
    if (event.key === "ArrowLeft") action.phase = key.phase - amount;
    else if (event.key === "ArrowRight") action.phase = key.phase + amount;
    else if (event.key === "ArrowUp") action.value = key.value + amount;
    else if (event.key === "ArrowDown") action.value = key.value - amount;
    else if (event.key === "Home") action.value = 0;
    else if (event.key === "End") action.value = 1;
    else return;
    event.preventDefault();
    emitEdit(action, { restoreFocus: true });
  });

  durationInput?.addEventListener("input", () => {
    emitEdit({ type: "duration", durationMs: Number(durationInput.value) });
  });
  durationInput?.addEventListener("change", () => {
    durationInput.value = String(Math.round(currentPayload.gesture?.durationMs ?? model?.callDurationMs ?? 80));
  });
  resetButton?.addEventListener("click", () => emitEdit({ type: "reset" }));

  gutter?.addEventListener("click", (event) => {
    const toggle = event.target.closest?.("[data-hybrinx-mod-toggle]");
    if (!toggle) return;
    event.preventDefault();
    emitEdit({
      type: "toggle-modulation",
      parameter: toggle.dataset.parameter,
      enabled: toggle.getAttribute("aria-pressed") !== "true",
    }, { restoreFocus: true });
  });

  function setParameterPaletteOpen(open, { restoreFocus = false } = {}) {
    if (!parameterPalette || !addParameterButton) return;
    const next = Boolean(open);
    parameterPalette.hidden = !next;
    addParameterButton.setAttribute("aria-expanded", String(next));
    root.classList.toggle("is-parameter-palette-open", next);
    if (next) {
      parameterPalette.querySelector("[data-hybrinx-add-parameter]:not(:disabled)")
        ?.focus?.({ preventScroll: true });
    } else if (restoreFocus) {
      addParameterButton.focus?.({ preventScroll: true });
    }
  }
  addParameterButton?.addEventListener("click", () => {
    setParameterPaletteOpen(addParameterButton.getAttribute("aria-expanded") !== "true");
  });
  parameterPalette?.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-hybrinx-close-parameter-palette]")) {
      setParameterPaletteOpen(false, { restoreFocus: true });
      return;
    }
    const button = event.target.closest?.("[data-hybrinx-add-parameter]");
    if (!button || button.disabled) return;
    emitEdit({ type: "add-parameter", parameter: button.dataset.hybrinxAddParameter });
    setParameterPaletteOpen(false, { restoreFocus: true });
  });
  parameterPalette?.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    setParameterPaletteOpen(false, { restoreFocus: true });
  });

  function applyZoomControl(input, output, axis) {
    if (!input) return;
    const value = clamp(finiteNumber(input.value, 100), 100, 400);
    if (axis === "x") zoomX = value / 100;
    else zoomY = value / 100;
    if (output) output.textContent = `${Math.round(value)}%`;
    signature = "";
    if (currentPayload.gesture) update(currentPayload);
  }
  applyZoomControl(zoomXInput, zoomXOutput, "x");
  applyZoomControl(zoomYInput, zoomYOutput, "y");

  function update(payload = {}) {
    currentPayload = {
      ...payload,
      zoomX,
      zoomY,
      availableWidth: scroll?.clientWidth ?? 0,
      availableHeight: scroll?.clientHeight ?? 0,
    };
    const nextSignature = timelineSignature(
      currentPayload.gesture,
      currentPayload.baseState,
      currentPayload,
    );
    if (nextSignature !== signature) {
      signature = nextSignature;
      rebuild(currentPayload);
    }
    if (!model) return;
    const position = resolveHybrinxPlayhead(model, currentPayload);
    const x = PLOT_LEFT + position * geometry.plotWidth;
    playhead?.setAttribute("x1", String(x));
    playhead?.setAttribute("x2", String(x));
    playheadCap?.setAttribute("transform", `translate(${x} ${LANE_TOP - 2})`);
    const state = currentPayload.performanceState ?? currentPayload.baseState ?? {};
    const tongue = currentPayload.performanceTongueState ?? currentPayload.tongueState ?? {};
    const dotTime = currentPayload.playing ? position : 0;
    const contourPhase = currentPayload.playing ? clamp(finiteNumber(currentPayload.phase)) : 0;
    renderRows.forEach((row) => {
      let value;
      let rawValue;
      if (row.contour) {
        rawValue = sampleGestureCurve(row.track.keyframes.map((keyframe) => (
          [keyframe.phase, keyframe.rawValue]
        )), contourPhase);
        value = normalizedModulationValue(row.contour, rawValue);
        row.valueNode.textContent = row.contour === "speed"
          ? `${rawValue.toFixed(2)} Hz`
          : `${Math.round(value * 100)}%`;
      } else {
        const source = row.lane.family === "tongue" ? tongue : state;
        value = normalizedValue(source[row.lane.parameter]);
        row.valueNode.textContent = `${Math.round(value * 100)}%`;
      }
      row.currentDot?.setAttribute("cx", String(PLOT_LEFT + dotTime * geometry.plotWidth));
      row.currentDot?.setAttribute("cy", String(row.laneY + (1 - value) * geometry.graphHeight));
    });
    if (phaseOutput) {
      phaseOutput.textContent = currentPayload.playing
        ? currentPayload.gapRemainingMs > 0
          ? `rest · ${formatHybrinxDuration(currentPayload.gapRemainingMs)} left`
          : `${Math.round(clamp(finiteNumber(currentPayload.phase)) * 100)}%`
        : "ready";
    }
    root.classList.toggle("is-playing", Boolean(currentPayload.playing));
    root.classList.toggle("is-resting", Boolean(
      currentPayload.playing && currentPayload.gapRemainingMs > 0
    ));
  }

  return Object.freeze({
    update,
    setEditHandler(handler) {
      editHandler = typeof handler === "function" ? handler : null;
    },
  });
}
