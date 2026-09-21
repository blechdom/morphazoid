import { horizontalIntersections, verticalIntersections, rayIntersections, pointAtPath, pingPong01, wrap01 } from "../../geometry.js";
import { sanitizeHeadOffsets } from "../../playheads.js";
// The original Shape readers, including open-line endpoint/radar behavior.
export function createShapeReaderModel(state) {
const TAU = Math.PI * 2;
const effectiveHeadCount = () => state.heads;
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

function directionalHeadTravel(position, headIndex, method = state.playMethod) {
  const adjustment = directionAdjustmentsForMethod(method)[headIndex] ?? 0;
  return headDirection(headIndex, method) * position
    + phaseOffsetForHead(headIndex)
    + adjustment;
}

function phaseForHead(position, headIndex, headCount, method = "trace") {
  const travel = directionalHeadTravel(position, headIndex, method);
  if (state.motionMode === "pingpong") return pingPong01(travel);
  if (headIndex === 0 && Math.abs(travel - 1) < 1e-9) return 1;
  return wrap01(travel);
}

function traceContact(path, phase) {
  return pointAtPath(path, phase);
}

function scanAxisForHead(headIndex) {
  return state.scanLineAxes[headIndex] === "horizontal" ? "horizontal" : "vertical";
}

function scanPhaseOffset(headIndex, headCount) {
  return phaseOffsetForHead(headIndex);
}

function scanPhaseAt(position, headIndex, headCount) {
  const offsetPosition = position + scanPhaseOffset(headIndex, headCount);
  if (state.motionMode === "pingpong") return pingPong01(offsetPosition);
  if (
    headIndex === 0 &&
    state.position === 1 &&
    Math.abs(position - state.continuousPosition) < 1e-9
  ) {
    return 1;
  }
  return wrap01(offsetPosition);
}

function scannerAt(path, position, headIndex, headCount) {
  const headTravel = position + scanPhaseOffset(headIndex, headCount);
  const phase = scanPhaseAt(position, headIndex, headCount);
  const axis = scanAxisForHead(headIndex);
  const minimum = axis === "horizontal" ? path.bounds.minY : path.bounds.minX;
  const maximum = axis === "horizontal" ? path.bounds.maxY : path.bounds.maxX;
  const span = maximum - minimum;
  return {
    headIndex,
    headTravel,
    phase,
    axis,
    coordinate: span <= 1e-9
      ? (minimum + maximum) / 2
      : minimum + phase * span,
  };
}

function radialAt(path, position, headIndex) {
  const headTravel = directionalHeadTravel(position, headIndex, "radial");
  const phase = state.motionMode === "pingpong" ? pingPong01(headTravel) : wrap01(headTravel);
  const angle = phase * TAU - Math.PI * 0.5;
  const rawIntersections = rayIntersections(path, angle).filter((contact) => (
    path.closed || contact.rayDistance > 0.015
  ));
  if (!path.closed) {
    if (rawIntersections.length > 2) {
      const furthest = rawIntersections.reduce((selected, contact) => (
        contact.rayDistance > selected.rayDistance ? contact : selected
      ));
      rawIntersections.splice(0, rawIntersections.length, furthest);
    }
    const beamWidth = 0.11;
    for (const endpointPhase of [0, 1]) {
      const contact = pointAtPath(path, endpointPhase);
      const endpointAngle = Math.atan2(contact.y, contact.x);
      const difference = Math.abs(Math.atan2(
        Math.sin(endpointAngle - angle),
        Math.cos(endpointAngle - angle),
      ));
      if (difference > beamWidth) continue;
      const alignment = 1 - difference / beamWidth;
      if (rawIntersections.some((item) => Math.hypot(item.x - contact.x, item.y - contact.y) < 1e-5)) {
        continue;
      }
      rawIntersections.push({
        ...contact,
        cornerStrength: (contact.cornerStrength ?? contact.strength ?? 1) * alignment,
        strength: (contact.strength ?? contact.cornerStrength ?? 1) * alignment,
        rayDistance: Math.hypot(contact.x, contact.y),
        rayPhase: phase,
        radarAlignment: alignment,
      });
    }
  }
  const intersections = rawIntersections
    .sort((first, second) => first.rayDistance - second.rayDistance)
    .map((contact, contactIndex) => ({
      ...contact,
      headIndex,
      headTravel,
      headPhase: phase,
      scanAxis: "radial",
      voiceKey: `radial:${headIndex}:${contactIndex}`,
    }));
  return { headIndex, headTravel, phase, angle, contacts: intersections };
}

function collectContacts(path, position = state.continuousPosition) {
  const contacts = [];
  const heads = [];
  const headCount = effectiveHeadCount();
  for (let headIndex = 0; headIndex < headCount; headIndex += 1) {
    if (state.playMethod === "scan") {
      const scanner = scannerAt(path, position, headIndex, headCount);
      const intersections = (scanner.axis === "horizontal"
        ? horizontalIntersections(path, scanner.coordinate)
        : verticalIntersections(path, scanner.coordinate)).map((contact, contactIndex) => ({
        ...contact,
        headIndex,
        headTravel: scanner.headTravel,
        headPhase: scanner.phase,
        scanAxis: scanner.axis,
        voiceKey: `scan:${scanner.axis}:${headIndex}:${contactIndex}`,
      }));
      heads.push({ ...scanner, contacts: intersections });
      contacts.push(...intersections);
    } else if (state.playMethod === "radial") {
      const radial = radialAt(path, position, headIndex);
      heads.push(radial);
      contacts.push(...radial.contacts);
    } else {
      const phase = phaseForHead(position, headIndex, headCount);
      const headTravel = directionalHeadTravel(position, headIndex, "trace");
      const contact = {
        ...traceContact(path, phase),
        headIndex,
        headTravel,
        headPhase: phase,
        voiceKey: `trace:${headIndex}`,
      };
      heads.push({ headIndex, phase, contact });
      contacts.push(contact);
    }
  }
  return { contacts, heads };
}

return { directionalHeadTravel, phaseForHead, traceContact, scanAxisForHead, scanPhaseOffset, scanPhaseAt, scannerAt, radialAt, collectContacts };
}
