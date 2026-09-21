import { cumulativeSignedTurn, mirroredCornerPhase, pingPong01, wrap01 } from "../../geometry.js";
import { clamp, mapCurve01, mirroredAmplitudeEnvelopePhase, pitch01ToFrequency, sampleAmplitudeEnvelope, scaleShapeVoiceGains, synthParametersForMode } from "../../audio.js";
import { sanitizeHeadOffsets } from "../../playheads.js";
import { evaluateMappingCurve } from "../../mapping.js";

// Moved from Shape, without changing its mapping/envelope/Shepard formulas.
// Both the individual instrument and Shapes use these same musical mappings.
export function createShapeSoundModel(state, { getMidiSnapshot = () => ({ pitchRatio: 1, gain: 1 }) } = {}) {
const TAU = Math.PI * 2;
function directionsForMethod(method = state.playMethod) {
  return method === "radial" ? state.radialHeadDirections : state.traceHeadDirections;
}

function directionAdjustmentsForMethod(method = state.playMethod) {
  return method === "radial"
    ? state.radialHeadDirectionAdjustments
    : state.traceHeadDirectionAdjustments;
}

function headDirection(headIndex, method = state.playMethod) {
  if (method === "scan") return 1;
  return directionsForMethod(method)[headIndex] < 0 ? -1 : 1;
}

function phaseOffsetForHead(headIndex) {
  const offsets = sanitizeHeadOffsets(state.headOffsets, state.heads, "parallel");
  return offsets[headIndex] ?? 0;
}


function shepardTurnMappingAvailable(path = null) {
  const closed = path ? path.closed : state.sides !== 2;
  return state.playMethod === "trace" && closed;
}

function usesShepardTurnMapping(path = null) {
  return state.shepardMapping === "turn" && shepardTurnMappingAvailable(path);
}


function directionalHeadTravel(position, headIndex, method = state.playMethod) {
  const adjustment = directionAdjustmentsForMethod(method)[headIndex] ?? 0;
  return headDirection(headIndex, method) * position
    + phaseOffsetForHead(headIndex)
    + adjustment;
}


function scanAxisForHead(headIndex) {
  return state.scanLineAxes[headIndex] === "horizontal" ? "horizontal" : "vertical";
}


function activeTimbreSourceKey() {
  return state.soundMode === "pm" ? "pmDepthSource" : "fmIndexSource";
}

function activeTimbreSource() {
  return state[activeTimbreSourceKey()];
}


function normalizedContactCoordinates(contact, path) {
  return {
    x: clamp((contact.x + 1) * 0.5, 0, 1),
    y: clamp((contact.y + 1) * 0.5, 0, 1),
  };
}

function tangentForContact(contact, path) {
  if (contact.tangent && Number.isFinite(contact.tangent.x) && Number.isFinite(contact.tangent.y)) {
    return contact.tangent;
  }
  const vertexIndex = contact.vertexIndex ?? contact.cornerIndex ?? 0;
  const pointIndex = path.vertexIndices[vertexIndex] ?? 0;
  const previous = path.points[(pointIndex - 1 + path.points.length) % path.points.length];
  const next = path.points[(pointIndex + 1) % path.points.length];
  const length = Math.hypot(next.x - previous.x, next.y - previous.y);
  if (length <= 1e-9) return { x: 1, y: 0 };
  return { x: (next.x - previous.x) / length, y: (next.y - previous.y) / length };
}

function contactMotionVelocity(contact, headIndex = contact.headIndex ?? 0, useIntent = false) {
  const axis = contact.scanAxis ?? scanAxisForHead(headIndex);
  const relativeDirection = state.playMethod === "scan" ? 1 : headDirection(headIndex);
  const headTravel = Number.isFinite(contact.headTravel)
    ? contact.headTravel
    : state.playMethod === "scan"
      ? state.continuousPosition + phaseOffsetForHead(headIndex)
      : directionalHeadTravel(state.continuousPosition, headIndex);
  const motionDirection = state.motionMode === "pingpong"
    ? pingPongMotionDirection(headTravel, 1, relativeDirection)
    : state.traversalDirection * relativeDirection;
  let scanSpeed = state.playing ? motionDirection * state.speed : useIntent ? motionDirection : 0;
  const rotationSpeed = state.autoRotate
    ? currentRotationDirection() * state.rotationSpeed * TAU
    : 0;
  if (useIntent && Math.abs(scanSpeed) <= 1e-9 && Math.abs(rotationSpeed) <= 1e-9) {
    scanSpeed = motionDirection;
  }
  let velocity = axis === "radial"
    ? {
      x: -contact.y * scanSpeed * TAU,
      y: contact.x * scanSpeed * TAU,
    }
    : axis === "horizontal"
    ? { x: 0, y: scanSpeed }
    : { x: scanSpeed, y: 0 };
  velocity = {
    x: velocity.x + rotationSpeed * contact.y,
    y: velocity.y - rotationSpeed * contact.x,
  };
  return { velocity, axis };
}

function incidenceForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  // A Point playhead travels along the contour, so it never crosses it.
  if (state.playMethod === "trace") return 0;
  const tangent = tangentForContact(contact, path);
  const { velocity: initialVelocity, axis } = contactMotionVelocity(contact, headIndex);
  let velocity = initialVelocity;
  let length = Math.hypot(velocity.x, velocity.y);
  if (length <= 1e-9) {
    velocity = axis === "radial"
      ? { x: -contact.y, y: contact.x }
      : axis === "horizontal" ? { x: 0, y: 1 } : { x: 1, y: 0 };
    length = 1;
  }
  const normal = { x: -tangent.y, y: tangent.x };
  return clamp(Math.abs((velocity.x * normal.x + velocity.y * normal.y) / length), 0, 1);
}

function sourceValueForContact(source, contact, path, headIndex = contact.headIndex ?? 0) {
  if (source === "fixed") return 1;
  if (source === "corner") return clamp(contact.cornerStrength ?? contact.strength ?? 0, 0, 1);
  if (source === "incidence") return incidenceForContact(contact, path, headIndex);
  if (source === "center") return centerDistanceForContact(contact);
  if (source === "horizontal") return normalizedContactCoordinates(contact, path).x;
  if (source === "phase") {
    return wrap01(contact.u ?? contact.pathPhase ?? 0);
  }
  const normalized = normalizedContactCoordinates(contact, path);
  return clamp(normalized.y, 0, 1);
}

function centerDistanceForContact(contact) {
  const distance = Number.isFinite(contact.rayDistance)
    ? contact.rayDistance
    : Math.hypot(contact.x, contact.y);
  return clamp(distance, 0, 1);
}

function percussionLevelValue(contact, path, headIndex = contact.headIndex ?? 0) {
  let raw;
  if (state.percussionLevelSource === "fixed") raw = 1;
  else if (state.percussionLevelSource === "signed") {
    raw = clamp(((contact.turn ?? contact.cornerTurn ?? 0) + 1) * 0.5, 0, 1);
  } else {
    raw = sourceValueForContact(state.percussionLevelSource, contact, path, headIndex);
  }
  return mapCurve01(raw, state.percussionLevelCurve);
}

function mappingForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  const normalized = normalizedContactCoordinates(contact, path);
  const sourcePitch = sourceValueForContact(state.pitchSource, contact, path, headIndex);
  const pitchRaw = state.pitchSource === "vertical" ? 1 - sourcePitch : sourcePitch;
  const panSource = state.stereoSource === "vertical"
    ? normalized.y
    : state.stereoSource === "center" ? centerDistanceForContact(contact) : normalized.x;
  const panDirection = state.stereoInverted ? -1 : 1;
  return {
    pitchRaw,
    pitch: evaluateMappingCurve(pitchRaw, state.pitchCurveNodes),
    pan: clamp((panSource * 2 - 1) * panDirection * state.stereoWidth, -1, 1),
    normalized,
    incidence: incidenceForContact(contact, path, headIndex),
  };
}

function synthFrequencyForMapping(mapping) {
  const geometricFrequency = state.soundMode === "shepard"
    ? state.baseFrequency
    : pitch01ToFrequency(mapping.pitch, state.baseFrequency, state.pitchRange);
  return clamp(geometricFrequency * getMidiSnapshot().pitchRatio, 10, 20_000);
}

function pingPongMotionDirection(travelPosition, multiplier = 1, relativeDirection = 1) {
  const step = state.traversalDirection * relativeDirection * 1e-5;
  const before = pingPong01(travelPosition * multiplier);
  const after = pingPong01((travelPosition + step) * multiplier);
  const delta = after - before;
  return Math.abs(delta) > 1e-9
    ? Math.sign(delta)
    : state.traversalDirection * relativeDirection;
}

function currentRotationDirection() {
  if (state.rotationMotionMode !== "pingpong") return state.rotationDirection;
  const step = state.rotationDirection * 1e-5;
  const delta = pingPong01(state.continuousRotation + step) - pingPong01(state.continuousRotation);
  return Math.abs(delta) > 1e-9 ? Math.sign(delta) : -state.rotationDirection;
}

function pointContourDirection(contact, path) {
  const relativeDirection = headDirection(contact.headIndex ?? 0, "trace");
  if (state.motionMode === "pingpong") {
    return pingPongMotionDirection(contact.headTravel, 1, relativeDirection);
  }
  return state.traversalDirection * relativeDirection;
}

function contactContourDirection(contact, path) {
  if (state.playMethod === "trace") return pointContourDirection(contact, path);
  const tangent = tangentForContact(contact, path);
  const { velocity } = contactMotionVelocity(contact, contact.headIndex ?? 0, true);
  const alongContour = velocity.x * tangent.x + velocity.y * tangent.y;
  return Math.abs(alongContour) <= 1e-9 ? 1 : Math.sign(alongContour);
}

function cornerEnvelopeProfile(contact, path) {
  if (state.cornerSwell) {
    return {
      strength: contact.cornerStrength ?? 0,
      distance: mirroredCornerPhase(path, contact),
      edgeFraction: 1 / Math.max(1, path.vertexCount),
    };
  }

  // Every reader follows a directed corner interval. Line and Radar therefore
  // rise only after crossing a corner unless the explicit swell mirror is on.
  const distances = path.vertexDistances;
  if (!distances.length || path.totalLength <= 1e-9) {
    return { strength: contact.cornerStrength ?? 0, distance: 0, edgeFraction: 1 };
  }

  const distance = clamp(contact.distance, 0, path.totalLength);
  const direction = contactContourDirection(contact, path);
  const epsilon = 1e-9;

  if (direction >= 0) {
    let cornerIndex = 0;
    for (let index = 1; index < distances.length; index += 1) {
      if (distances[index] <= distance + epsilon) cornerIndex = index;
      else break;
    }
    const start = distances[cornerIndex];
    const end = cornerIndex + 1 < distances.length
      ? distances[cornerIndex + 1]
      : path.totalLength;
    return {
      strength: path.cornerStrengths[cornerIndex] ?? 0,
      distance: end - start <= epsilon ? 0 : clamp((distance - start) / (end - start), 0, 1),
      edgeFraction: (end - start) / path.totalLength,
    };
  }

  let cornerIndex = distances.findIndex((value) => value >= distance - epsilon);
  let target;
  let start;
  if (cornerIndex < 0) {
    cornerIndex = 0;
    target = path.totalLength;
    start = distances[distances.length - 1];
  } else if (cornerIndex === 0) {
    target = 0;
    start = path.closed ? distances[distances.length - 1] - path.totalLength : 0;
  } else {
    target = distances[cornerIndex];
    start = distances[cornerIndex - 1];
  }
  return {
    strength: path.cornerStrengths[cornerIndex] ?? 0,
    distance: target - start <= epsilon
      ? 0
      : clamp((target - distance) / (target - start), 0, 1),
    edgeFraction: (target - start) / path.totalLength,
  };
}

function shepardContourProgress(contact, path) {
  if (!usesShepardTurnMapping(path)) return null;
  if (state.motionMode === "pingpong") {
    return contact.headPhase ?? pingPong01(contact.headTravel ?? state.continuousPosition);
  }
  return Number.isFinite(contact.headTravel)
    ? contact.headTravel
    : contact.headPhase ?? contact.u ?? state.continuousPosition;
}

function shepardTravelForContact(contact, path) {
  const contourProgress = shepardContourProgress(contact, path);
  if (contourProgress !== null) {
    return -cumulativeSignedTurn(path, contourProgress, {
      glide: state.shepardTurnGlide,
    }) / TAU * state.shepardCycles * state.shepardDirection;
  }
  const circuitTravel = state.motionMode === "pingpong"
    ? (contact.headPhase ?? pingPong01(contact.headTravel ?? state.continuousPosition))
    : Number.isFinite(contact.headTravel)
      ? contact.headTravel
      : contact.headPhase ?? contact.u ?? state.continuousPosition;
  return circuitTravel * state.shepardCycles * state.shepardDirection;
}

function shepardRate(contact, path, headIndex = contact.headIndex ?? 0) {
  if (!state.playing) return 0;
  if (usesShepardTurnMapping(path)) {
    const deltaSeconds = 0.001;
    const relativeDirection = headDirection(headIndex, "trace");
    const currentHeadTravel = Number.isFinite(contact.headTravel)
      ? contact.headTravel
      : directionalHeadTravel(state.continuousPosition, headIndex, "trace");
    const nextHeadTravel = currentHeadTravel
      + state.traversalDirection * relativeDirection * state.speed * deltaSeconds;
    const nextContact = {
      ...contact,
      headTravel: nextHeadTravel,
      headPhase: state.motionMode === "pingpong" ? pingPong01(nextHeadTravel) : wrap01(nextHeadTravel),
    };
    return (shepardTravelForContact(nextContact, path) - shepardTravelForContact(contact, path))
      / deltaSeconds;
  }
  const visualLoopRate = state.motionMode === "pingpong"
    ? state.speed * 0.5
    : state.speed;
  const relativeDirection = state.playMethod === "scan" ? 1 : headDirection(headIndex);
  const travel = Number.isFinite(contact.headTravel)
    ? contact.headTravel
    : state.playMethod === "scan"
      ? state.continuousPosition + phaseOffsetForHead(headIndex)
      : directionalHeadTravel(state.continuousPosition, headIndex);
  const motionDirection = state.motionMode === "pingpong"
    ? pingPongMotionDirection(travel, 1, relativeDirection)
    : state.traversalDirection * relativeDirection;
  return visualLoopRate
    * state.shepardCycles
    * state.shepardDirection
    * motionDirection;
}

function shepardPositionForContact(contact, path) {
  return wrap01(shepardTravelForContact(contact, path));
}

function synthParametersForContact(contact, path, headIndex = contact.headIndex ?? 0) {
  const drive = state.soundMode === "shepard"
    ? 1
    : sourceValueForContact(activeTimbreSource(), contact, path, headIndex);
  const parameters = synthParametersForMode(state.soundMode, drive, {
    fmIndex: state.fmIndex,
    fmRatio: state.fmRatio,
    pmIndex: state.pmIndex,
    pmRatio: state.pmRatio,
    shepardRate: shepardRate(contact, path, headIndex),
    shepardWidth: state.shepardWidth,
    shepardPosition: state.soundMode === "shepard"
      ? shepardPositionForContact(contact, path)
      : null,
  });
  return state.soundMode === "shepard"
    ? { ...parameters, shepardTravel: shepardTravelForContact(contact, path) }
    : parameters;
}

function amplitudeGainForContact(contact, path) {
  if (path.shapeType === "circle") return 0.12;
  let envelopeGain = 0.18;
  if (state.amplitudeEnvelopeEnabled) {
    const profile = cornerEnvelopeProfile(contact, path);
    const attackPhase = state.amplitudeEnvelopePoints[1]?.x ?? 0;
    const envelopePhase = state.cornerSwell
      ? mirroredAmplitudeEnvelopePhase(profile.distance, attackPhase)
      : profile.distance;
    const envelope = state.amplitudePreset === "segment"
      ? 1 - clamp(profile.distance, 0, 1)
      : sampleAmplitudeEnvelope(envelopePhase, state.amplitudeEnvelopePoints);
    const cornerPeak = 0.18 + 0.5 * clamp(profile.strength, 0, 1);
    envelopeGain = cornerPeak * envelope;
  }
  const mappedLevel = sourceValueForContact(state.cornerAmplitudeSource, contact, path);
  return clamp(envelopeGain * mappedLevel, 0, 1);
}

function continuousSynthVoices(contacts, path) {
  return scaleShapeVoiceGains(contacts.map((contact) => {
    const mapping = mappingForContact(contact, path);
    const synth = synthParametersForContact(contact, path);
    return {
      key: `shape:${contact.voiceKey}`,
      frequency: synthFrequencyForMapping(mapping),
      gain: amplitudeGainForContact(contact, path) * getMidiSnapshot().gain,
      pan: mapping.pan,
      waveform: "sine",
      ...synth,
    };
  }));
}

return { normalizedContactCoordinates, tangentForContact, contactMotionVelocity, incidenceForContact, sourceValueForContact, centerDistanceForContact, percussionLevelValue, mappingForContact, synthFrequencyForMapping, pingPongMotionDirection, currentRotationDirection, pointContourDirection, contactContourDirection, cornerEnvelopeProfile, shepardContourProgress, shepardTravelForContact, shepardRate, shepardPositionForContact, synthParametersForContact, amplitudeGainForContact, continuousSynthVoices };
}
