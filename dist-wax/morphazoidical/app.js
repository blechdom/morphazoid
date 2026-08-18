/**
 * Morphazoidical Shape Workbench runtime.
 *
 * This module is intentionally isolated from the legacy application. Geometry,
 * overlays, feature mappings, the inspector, and audio all consume the same
 * timestamped frame. Unavailable analysis values remain null all the way to the
 * UI; they are never displayed or mapped as zero.
 */

import {
  buildShape,
  horizontalIntersections,
  pingPong01,
  pointAtPath,
  rayIntersections,
  verticalIntersections,
  wrap01,
} from "../src/geometry.js";
import {
  VoicePool,
  clamp,
  pitch01ToFrequency,
  scaleShapeVoiceGains,
  synthParametersForMode,
} from "../src/audio.js";
import * as Analysis from "./analysis.js";
import {
  FEATURE_REGISTRY,
  getFeatureDescriptor,
  normalizeFeatureValue,
} from "./feature-registry.js";

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;
const LOOKAHEAD_SECONDS = 0.075;
const AUDIO_REFRESH_MS = 24;
const UI_REFRESH_MS = 80;
const MAX_VOICES = 32;
const NEUTRAL_TIMBRE = 0;
const SAMPLE_PRESETS = Object.freeze({ draft: 16, balanced: 48, precise: 96 });
const CONTACT_COLORS = ["#66e6c4", "#79b9ff", "#c89eff", "#ffba72", "#ff7e9c"];
const EVENT_FEATURE_IDS = Object.freeze([
  "events.births",
  "events.deaths",
  "events.splits",
  "events.merges",
  "events.entries",
  "events.exits",
]);

export const DEFAULT_STATE = Object.freeze({
  playing: false,
  audio: false,
  position: 0.5,
  continuousPosition: 0.5,
  speed: 0.12,
  direction: 1,
  autoRotate: false,
  rotation: 0,
  continuousRotation: 0,
  rotationSpeed: 28.8,
  shapeType: "polygon",
  sides: 5,
  curvature: 0.12,
  starDepth: 0.48,
  aspect: 0,
  skew: 0,
  samplesPerEdge: SAMPLE_PRESETS.balanced,
  qualityPreset: "balanced",
  readerMode: "vertical",
  pitchSource: "contact.bounds.y",
  gainSource: "contact.corner.strength",
  panSource: "contact.position.x",
  timbreSource: "contact.curvature",
  baseFrequency: 82.41,
  pitchRange: 4,
  masterLevel: 0.55,
  soundMode: "sine",
  overlays: Object.freeze({
    tangent: true,
    normal: true,
    radius: true,
    hull: false,
    intersections: true,
    bounds: false,
    intervals: true,
    labels: false,
  }),
});

/**
 * Stable feature IDs keep their registry taxonomy; this UI taxonomy answers
 * the smaller set of questions a performer scans for in real time.
 */
export function metricSectionForDescriptor(descriptor) {
  const id = descriptor?.id ?? "";
  if (descriptor?.scope === "contact") {
    if (id.startsWith("contact.motion.")) return "Motion & identity";
    if (id.startsWith("contact.reader.")) return "Reader relationship";
    if (
      id === "contact.turn"
      || id === "contact.curvature"
      || id.startsWith("contact.corner.")
      || id === "contact.hull.class"
    ) return "Local shape";
    if (
      descriptor.group === "Direction"
      || id === "contact.polarAngle"
      || id === "contact.radialAlignment"
      || id === "contact.tangentRadiusAngle"
      || id === "contact.centerFacing"
    ) return "Direction & stage origin";
    return "Location on form";
  }
  if (descriptor?.scope === "reader") {
    if (id === "reader.contactDelta") return "Change";
    if (id.startsWith("reader.transversality.")) return "Tangency risk";
    if (id.startsWith("reader.spacing.")) return "Contact distribution";
    return "Occupancy";
  }
  if (descriptor?.scope === "geometry") {
    if (descriptor.group === "Topology") return "Contour topology";
    if (id === "geometry.samples" || id === "geometry.segments") return "Sampling diagnostics";
    if (id.startsWith("geometry.radius.") || id.startsWith("geometry.center.")) {
      return "Stage-origin profile";
    }
    if (
      id === "geometry.compactness"
      || id === "geometry.solidity"
      || id === "geometry.convexity"
      || id === "geometry.eccentricity"
      || id.startsWith("geometry.hull.")
    ) return "Shape character";
    if (
      id === "geometry.closed"
      || id === "geometry.orientation"
      || id === "geometry.logicalEdges"
    ) return "Identity";
    return "Size & pose";
  }
  if (descriptor?.scope === "event") {
    if (id === "events.births" || id === "events.deaths") return "Contact lifecycle";
    if (id === "events.entries" || id === "events.exits") return "Reader boundary";
    return "Structural · planned";
  }
  return descriptor?.group ?? "Other";
}

function eventCount(events, directTypes, groupedType) {
  const direct = events.filter((event) => directTypes.includes(event?.type));
  if (direct.length) return direct.length;
  return events
    .filter((event) => event?.type === groupedType)
    .reduce((sum, event) => sum + (finite(event?.count) ? event.count : 2), 0);
}

/**
 * Preserve planned outputs as unavailable and derive fallback counters from
 * the same event records shown in the log when the analysis layer fails.
 */
export function eventFeaturesFromAnalysis(analysis, events = []) {
  const records = Array.isArray(events) ? events : [];
  const fallback = {
    births: eventCount(records, ["contact_birth", "birth"], "contact_pair_birth"),
    deaths: eventCount(records, ["contact_death", "death"], "contact_pair_death"),
    entries: records.filter((event) => ["entry", "reader_entry"].includes(event?.type)).length,
    exits: records.filter((event) => ["exit", "reader_exit"].includes(event?.type)).length,
  };
  return {
    "events.births": analysis?.eventCounts?.births ?? fallback.births,
    "events.deaths": analysis?.eventCounts?.deaths ?? fallback.deaths,
    "events.splits": analysis?.eventCounts?.splits ?? null,
    "events.merges": analysis?.eventCounts?.merges ?? null,
    "events.entries": analysis?.eventCounts?.entries ?? fallback.entries,
    "events.exits": analysis?.eventCounts?.exits ?? fallback.exits,
  };
}

/** A categorical `unavailable` sentinel is absence, never category zero. */
export function isFeatureValueUnavailable(value) {
  return value === null
    || value === undefined
    || value === "unavailable"
    || (typeof value === "number" && !Number.isFinite(value));
}

/** Apply registry normalization only to values that actually exist. */
export function mappingSignalForValue(featureOrId, value) {
  if (isFeatureValueUnavailable(value)) {
    return { raw: null, normalized: null, available: false };
  }
  const normalized = normalizeFeatureValue(featureOrId, value);
  return {
    raw: value,
    normalized,
    available: normalized !== null && Number.isFinite(normalized),
  };
}

/** Fold event edges between slower UI paints so short pulses remain visible. */
export function accumulateEventPulse(pulse, frame) {
  const previous = pulse ?? {
    features: {
      "events.births": 0,
      "events.deaths": 0,
      "events.splits": null,
      "events.merges": null,
      "events.entries": 0,
      "events.exits": 0,
    },
    eventCount: 0,
    frameCount: 0,
  };
  if (!frame) return previous;
  const features = { ...previous.features };
  for (const id of EVENT_FEATURE_IDS) {
    const value = frame?.features?.[id];
    if (!finite(value)) continue;
    features[id] = (finite(features[id]) ? features[id] : 0) + value;
  }
  return {
    features,
    eventCount: previous.eventCount + (Array.isArray(frame?.events) ? frame.events.length : 0),
    frameCount: previous.frameCount + 1,
  };
}

/** Native controls keep their own keyboard contract; shortcuts are page-level only. */
export function shouldHandleGlobalShortcut(event) {
  if (!event || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const interactive = event.target?.closest?.(
    "button, summary, a[href], input, select, textarea, [role='tab'], [role='button'], [role='link'], [contenteditable]:not([contenteditable='false'])",
  );
  return !interactive;
}

/** Presentation metadata is shared by the timeline and focused tests. */
export function eventPresentation(event) {
  const type = String(event?.type ?? "");
  const count = finite(event?.count) ? event.count : null;
  if (type.includes("pair") || type === "split" || type === "merge") {
    return {
      className: "event-structural",
      marker: count === null ? "2×" : `${formatNumber(count, 0)}×`,
      subject: count === null ? event?.contactId ?? "Contact set" : `${formatNumber(count, 0)} contacts`,
    };
  }
  if (type.includes("death") || type.includes("exit")) {
    return {
      className: type.includes("exit") ? "event-boundary event-death" : "event-death",
      marker: type.includes("exit") ? "OUT" : "−",
      subject: event?.contactId ?? "Contact set",
    };
  }
  if (type.includes("entry")) {
    return { className: "event-boundary", marker: "IN", subject: event?.contactId ?? "Contact set" };
  }
  if (type.includes("birth")) {
    return { className: "event-birth", marker: "+", subject: event?.contactId ?? "Contact set" };
  }
  return { className: "", marker: "•", subject: event?.contactId ?? "Contact set" };
}

/** Label topology only when the analysis supplied a classification. */
export function topologyPresentation(closed, topology) {
  if (!closed) return "Open contour";
  if (topology?.simpleClosed === true) return "Simple closed contour";
  if (topology?.simpleClosed === false) return "Complex or degenerate contour";
  return "Topology unavailable";
}

/** Separate geometric demand from voices actually submitted to a live engine. */
export function audioVoiceCounts({
  audioEnabled,
  engineRunning,
  geometricContacts = 0,
  mappableVoices = 0,
  submittedVoices = 0,
  maximumVoices = MAX_VOICES,
} = {}) {
  const contacts = Math.max(0, Math.floor(Number(geometricContacts) || 0));
  const mappable = Math.max(0, Math.floor(Number(mappableVoices) || 0));
  const scheduled = audioEnabled
    ? Math.max(0, Math.min(maximumVoices, Math.floor(Number(submittedVoices) || 0)))
    : 0;
  return {
    contacts,
    mappable,
    scheduled,
    rendered: audioEnabled && engineRunning ? scheduled : 0,
    overCapacity: Math.max(0, mappable - maximumVoices),
  };
}

/** Join current/future voice sets without dropping a birth or death abruptly. */
export function unionVoiceTrajectories(currentVoices, futureVoices) {
  const current = new Map(currentVoices.map((voice) => [voice.key, { ...voice }]));
  const future = new Map(futureVoices.map((voice) => [voice.key, { ...voice }]));
  const keys = [...new Set([...current.keys(), ...future.keys()])];
  return {
    current: keys.map((key) => current.get(key) ?? { ...future.get(key), gain: 0 }),
    future: keys.map((key) => future.get(key) ?? { ...current.get(key), gain: 0 }),
  };
}

/** A reader phase in model space. Exported for deterministic smoke tests. */
export function readerGeometry(path, mode, phase) {
  const pathMode = mode === "trace" || mode === "path";
  const amount = pathMode && !path.closed ? pingPong01(phase) : wrap01(phase);
  if (mode === "vertical") {
    const x = path.bounds.minX + path.bounds.width * amount;
    return { id: "reader:vertical", mode, type: "vertical", phase: amount, axis: "x", x, coordinate: x };
  }
  if (mode === "horizontal") {
    const y = path.bounds.minY + path.bounds.height * amount;
    return { id: "reader:horizontal", mode, type: "horizontal", phase: amount, axis: "y", y, coordinate: y };
  }
  if (mode === "ray") {
    return {
      id: "reader:ray",
      mode,
      type: "ray",
      phase: amount,
      origin: { x: 0, y: 0 },
      angle: amount * TAU - Math.PI / 2,
    };
  }
  return { id: "reader:path", mode: "path", type: "path", phase: amount, axis: "path" };
}

/** Compute the exact sampled-polyline contacts used by every runtime consumer. */
export function contactsForReader(path, reader) {
  let contacts;
  if (reader.mode === "vertical") contacts = verticalIntersections(path, reader.coordinate);
  else if (reader.mode === "horizontal") contacts = horizontalIntersections(path, reader.coordinate);
  else if (reader.mode === "ray") contacts = rayIntersections(path, reader.angle, reader.origin);
  else contacts = [pointAtPath(path, reader.phase, { pingPong: !path.closed })];
  return contacts.map((contact, index) => ({
    ...contact,
    readerId: reader.id,
    readerMode: reader.mode,
    readerPhase: reader.phase,
    readerOrder: index,
  }));
}

function nearestPathProgress(path, point) {
  const segmentCount = path.closed ? path.points.length : path.points.length - 1;
  let bestDistance = Infinity;
  let bestProgress = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = path.points[index];
    const end = path.points[(index + 1) % path.points.length];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const amount = lengthSquared > 1e-12
      ? clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared, 0, 1)
      : 0;
    const x = start.x + dx * amount;
    const y = start.y + dy * amount;
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    const segmentLength = Math.sqrt(lengthSquared);
    bestProgress = path.totalLength > 1e-12
      ? (path.cumulativeLengths[index] + segmentLength * amount) / path.totalLength : 0;
  }
  return clamp(bestProgress, 0, 1);
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function deepGet(object, path) {
  if (!object) return undefined;
  if (Object.prototype.hasOwnProperty.call(object, path)) return object[path];
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function byId(...ids) {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (element) return element;
  }
  return null;
}

function clear(element) {
  if (element) element.replaceChildren();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatNumber(value, digits = 3) {
  if (!finite(value)) return "Unavailable";
  if (Math.abs(value) >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
  if (Math.abs(value) < 0.5 * 10 ** -digits) return "0";
  const fixed = value.toFixed(digits);
  return digits === 0 ? fixed : fixed.replace(/\.?0+$/, "");
}

function formatFeature(descriptor, value) {
  if (isFeatureValueUnavailable(value)) return "Unavailable";
  if (descriptor?.type === "boolean") return value ? "Yes" : "No";
  if (descriptor?.type === "category") return String(value).replaceAll("-", " ");
  if (descriptor?.unit === "radian") return `${formatNumber(value * DEG, 1)}°`;
  if (descriptor?.unit === "second") return `${formatNumber(value, 2)} s`;
  if (descriptor?.unit === "cycle/second") return `${formatNumber(value, 2)} cyc/s`;
  if (descriptor?.unit === "model-unit/second") return `${formatNumber(value, 2)} u/s`;
  const suffix = descriptor?.unit === "model-unit" ? " u"
    : descriptor?.unit === "model-unit²" ? " u²" : "";
  return `${formatNumber(value)}${suffix}`;
}

function meterKind(descriptor) {
  if (descriptor?.type === "circular" || descriptor?.type === "cyclic") return "cyclic";
  const normalization = descriptor?.normalization;
  if (
    normalization?.kind === "signed-positive"
    || (
      normalization?.kind === "linear"
      && normalization.minimum < 0
      && normalization.maximum > 0
    )
  ) return "signed";
  return "linear";
}

function updateMeter(meter, descriptor, normalized) {
  if (!meter) return;
  const fill = meter.querySelector("i");
  const available = finite(normalized);
  const kind = meterKind(descriptor);
  meter.dataset.kind = kind;
  meter.hidden = !available || descriptor?.type === "boolean" || descriptor?.type === "category";
  if (!fill || !available) return;
  const value = clamp(normalized, 0, 1);
  if (kind === "signed") {
    fill.style.left = `${Math.min(0.5, value) * 100}%`;
    fill.style.width = `${Math.abs(value - 0.5) * 100}%`;
  } else if (kind === "cyclic") {
    fill.style.left = `calc(${value * 100}% - 1px)`;
    fill.style.width = "2px";
  } else {
    fill.style.left = "0";
    fill.style.width = `${value * 100}%`;
  }
}

class ContactIdentityTracker {
  constructor() {
    this.records = new Map();
    this.nextId = 1;
  }

  reset() {
    this.records.clear();
  }

  assign(contacts, timestamp, readerId) {
    const candidates = [...this.records.values()].filter((record) => record.readerId === readerId);
    const claimed = new Set();
    const assigned = contacts.map((contact) => {
      let best = null;
      let bestCost = Infinity;
      for (const record of candidates) {
        if (claimed.has(record.id)) continue;
        const spatial = Math.hypot(contact.x - record.x, contact.y - record.y);
        const contour = Math.min(Math.abs(contact.u - record.u), 1 - Math.abs(contact.u - record.u));
        const tangent = Math.abs(angleDelta(contact.tangentAngle, record.tangentAngle)) / Math.PI;
        const segmentPenalty = contact.segmentIndex === record.segmentIndex ? 0 : 0.08;
        const cost = spatial + contour * 0.28 + tangent * 0.08 + segmentPenalty;
        if (cost < bestCost) {
          best = record;
          bestCost = cost;
        }
      }
      if (bestCost > 0.38) best = null;
      const id = best?.id ?? `contact-${this.nextId++}`;
      claimed.add(id);
      const age = best ? Math.max(0, (timestamp - best.bornAt) / 1000) : 0;
      const dt = best ? Math.max(1e-3, (timestamp - best.updatedAt) / 1000) : 0;
      const velocity = best && dt > 0 ? {
        x: (contact.x - best.x) / dt,
        y: (contact.y - best.y) / dt,
      } : { x: 0, y: 0 };
      return { ...contact, id, stableId: id, age, velocity, isBirth: !best };
    });

    const next = new Map();
    for (const contact of assigned) {
      const previous = this.records.get(contact.id);
      next.set(contact.id, {
        id: contact.id,
        readerId,
        x: contact.x,
        y: contact.y,
        u: contact.u,
        tangentAngle: contact.tangentAngle,
        segmentIndex: contact.segmentIndex,
        bornAt: previous?.bornAt ?? timestamp,
        updatedAt: timestamp,
      });
    }
    const deaths = [...this.records.values()].filter(
      (record) => record.readerId === readerId && !next.has(record.id),
    );
    this.records = next;
    return { contacts: assigned, deaths };
  }
}

function futureContactIds(futureContacts, currentContacts) {
  const available = new Set(currentContacts.map((contact) => contact.id));
  const preserved = futureContacts.map((contact) => {
    if (!contact.id || !available.has(contact.id)) return null;
    available.delete(contact.id);
    return contact.id;
  });
  return futureContacts.map((contact, index) => {
    if (preserved[index]) return { ...contact, id: preserved[index], stableId: preserved[index] };
    let match = null;
    let cost = Infinity;
    for (const candidate of currentContacts) {
      if (!available.has(candidate.id)) continue;
      const spatial = Math.hypot(contact.x - candidate.x, contact.y - candidate.y);
      const segmentPenalty = contact.segmentIndex === candidate.segmentIndex ? 0 : 0.06;
      if (spatial + segmentPenalty < cost) {
        match = candidate;
        cost = spatial + segmentPenalty;
      }
    }
    if (match && cost < 0.5) available.delete(match.id);
    else match = null;
    return {
      ...contact,
      id: match?.id ?? `future:${contact.segmentIndex}:${index}`,
      stableId: match?.id ?? `future:${contact.segmentIndex}:${index}`,
    };
  });
}

function fallbackContactFeatures(path, contact) {
  const boundsX = path.bounds.width > 1e-12
    ? (contact.x - path.bounds.minX) / path.bounds.width : 0.5;
  const boundsY = path.bounds.height > 1e-12
    ? (contact.y - path.bounds.minY) / path.bounds.height : 0.5;
  const radius = Math.hypot(contact.x, contact.y);
  const radial = radius > 1e-12 ? { x: contact.x / radius, y: contact.y / radius } : { x: 0, y: 0 };
  const tangentAngle = contact.tangentAngle ?? Math.atan2(contact.tangent.y, contact.tangent.x);
  const radialAlignment = contact.tangent.x * radial.x + contact.tangent.y * radial.y;
  return {
    "contact.position.x": contact.x,
    "contact.position.y": contact.y,
    "contact.bounds.x": boundsX,
    "contact.bounds.y": boundsY,
    "contact.contourPhase": contact.u,
    "contact.contourDistance": contact.distance,
    "contact.radius": radius,
    "contact.polarAngle": Math.atan2(contact.y, contact.x),
    "contact.tangentAngle": tangentAngle,
    "contact.incomingAngle": tangentAngle,
    "contact.outgoingAngle": tangentAngle,
    "contact.normalAngle": path.closed ? tangentAngle + (pathOrientation(path) >= 0 ? -Math.PI / 2 : Math.PI / 2) : null,
    "contact.turn": finite(contact.cornerTurn) ? contact.cornerTurn * Math.PI : null,
    "contact.curvature": null,
    "contact.radialAlignment": radialAlignment,
    "contact.centerFacing": null,
    "contact.tangentRadiusAngle": angleDelta(tangentAngle, Math.atan2(contact.y, contact.x)),
    "contact.corner.distance": contact.cornerDistance,
    "contact.corner.strength": contact.cornerStrength,
    "contact.corner.class": !path.closed ? "unavailable"
      : Math.abs(contact.cornerTurn ?? 0) < 1e-5 ? "smooth"
        : contact.cornerTurn > 0 ? "convex" : "reflex",
    "contact.hull.class": null,
    "contact.reader.boundaryRole": null,
    "contact.motion.speed": Math.hypot(contact.velocity?.x ?? 0, contact.velocity?.y ?? 0),
    "contact.motion.contourVelocity": null,
    "contact.motion.age": contact.age ?? 0,
  };
}

function pathOrientation(path) {
  if (!path.closed) return 0;
  let twiceArea = 0;
  for (let index = 0; index < path.points.length; index += 1) {
    const a = path.points[index];
    const b = path.points[(index + 1) % path.points.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return Math.sign(twiceArea);
}

function fallbackFrameFeatures(path, contacts, previousCount = contacts.length) {
  let twiceArea = 0;
  if (path.closed) {
    for (let index = 0; index < path.points.length; index += 1) {
      const a = path.points[index];
      const b = path.points[(index + 1) % path.points.length];
      twiceArea += a.x * b.y - b.x * a.y;
    }
  }
  const area = path.closed ? Math.abs(twiceArea) / 2 : null;
  const radii = path.points.map((point) => Math.hypot(point.x, point.y));
  const radiusMean = radii.reduce((sum, radius) => sum + radius, 0) / Math.max(1, radii.length);
  const radiusDeviation = Math.sqrt(
    radii.reduce((sum, radius) => sum + (radius - radiusMean) ** 2, 0) / Math.max(1, radii.length),
  );
  return {
    "geometry.closed": path.closed,
    "geometry.perimeter": path.totalLength,
    "geometry.area": area,
    "geometry.signedArea": path.closed ? twiceArea / 2 : null,
    "geometry.orientation": !path.closed ? "open" : Math.abs(twiceArea) < 1e-10
      ? "degenerate" : twiceArea > 0 ? "clockwise" : "counterclockwise",
    "geometry.centroid.x": null,
    "geometry.centroid.y": null,
    "geometry.bounds.width": path.bounds.width,
    "geometry.bounds.height": path.bounds.height,
    "geometry.compactness": area && path.totalLength > 0 ? 4 * Math.PI * area / path.totalLength ** 2 : null,
    "geometry.solidity": null,
    "geometry.convexity": null,
    "geometry.principalAxis": null,
    "geometry.eccentricity": null,
    "geometry.radius.minimum": Math.min(...radii),
    "geometry.radius.maximum": Math.max(...radii),
    "geometry.radius.mean": radiusMean,
    "geometry.radius.deviation": radiusDeviation,
    "geometry.center.inside": null,
    "geometry.center.winding": null,
    "geometry.selfIntersections": null,
    "geometry.crossings": null,
    "geometry.touches": null,
    "geometry.overlaps": null,
    "reader.contactCount": contacts.length,
    "reader.insideIntervalCount": null,
    "reader.insideSpan": null,
    "reader.insideFraction": null,
    "reader.spacing.minimum": null,
    "reader.spacing.mean": null,
    "reader.contactDelta": contacts.length - previousCount,
  };
}

function analysisCall(input) {
  if (typeof Analysis.analyzeFrame !== "function") return null;
  return Analysis.analyzeFrame(input);
}

function valuesFromAnalysis(snapshot, scope, contact) {
  const candidates = scope === "contact"
    ? [contact?.features, contact?.values, snapshot?.contactFeatures?.[contact?.id]]
    : scope === "reader"
      ? [snapshot?.reader?.features, snapshot?.readerFeatures, snapshot?.features?.reader]
      : [snapshot?.geometry?.features, snapshot?.geometryFeatures, snapshot?.features?.geometry];
  return candidates.find((candidate) => candidate && typeof candidate === "object") ?? null;
}

function featureValue(frame, id, contact = frame.selectedContact) {
  const descriptor = getFeatureDescriptor(id);
  if (!descriptor) return null;
  if (typeof Analysis.getFrameFeatureValue === "function") {
    const value = Analysis.getFrameFeatureValue(frame.analysis, id, contact?.id);
    if (value !== undefined) return value;
  }
  const bag = valuesFromAnalysis(frame.analysis, descriptor.scope, contact);
  const analyzed = deepGet(bag, id);
  if (analyzed !== undefined) return analyzed;
  if (descriptor.scope === "contact") return frame.contactFeatures.get(contact?.id)?.[id] ?? null;
  return frame.features[id] ?? null;
}

function mappingValue(frame, featureId, contact) {
  const raw = featureValue(frame, featureId, contact);
  return mappingSignalForValue(featureId, raw);
}

function stateShape(state, positionSeconds = 0) {
  const rotation = state.rotation + state.continuousRotation
    + (state.autoRotate ? state.rotationSpeed * positionSeconds : 0);
  const openLine = state.shapeType === "line";
  return buildShape({
    sides: state.shapeType === "circle" ? 1 : openLine ? 2 : state.sides,
    shapeType: openLine ? "polygon" : state.shapeType,
    curvature: state.curvature,
    starDepth: state.starDepth,
    aspect: state.aspect,
    skew: state.skew,
    rotationDeg: rotation,
    samplesPerEdge: state.samplesPerEdge,
  });
}

function phaseAtOffset(state, seconds) {
  if (!state.playing) return state.position;
  return state.continuousPosition + state.direction * state.speed * seconds;
}

function makeEvent(type, timestamp, payload = {}) {
  return { id: `${type}:${timestamp}:${payload.contactId ?? "set"}`, type, timestamp, quality: "frame", ...payload };
}

function eventLabel(event) {
  const labels = {
    contact_birth: "Contact born",
    birth: "Contact born",
    contact_death: "Contact ended",
    death: "Contact ended",
    contact_pair_birth: "Contact pair born",
    contact_pair_death: "Contact pair ended",
    split: "Contact split",
    merge: "Contacts merged",
    tangent_touch: "Tangent touch",
    vertex_touch: "Vertex touch",
    overlap_begin: "Overlap began",
    overlap_end: "Overlap ended",
    entry: "Reader entry",
    exit: "Reader exit",
    reader_entry: "Reader entry",
    reader_exit: "Reader exit",
  };
  return labels[event.type] ?? String(event.type ?? "Geometry event").replaceAll("_", " ");
}

export function startWorkbench(root = document) {
  const canvas = byId("geometryStage", "geometryCanvas", "stageCanvas", "workbenchCanvas");
  if (!(canvas instanceof HTMLCanvasElement)) return null;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const state = {
    ...DEFAULT_STATE,
    overlays: { ...DEFAULT_STATE.overlays },
  };
  const pool = new VoicePool(MAX_VOICES);
  const tracker = new ContactIdentityTracker();
  const eventHistory = [];
  let previousFrame = null;
  let latestFrame = null;
  let pinnedContactId = null;
  let lastTime = performance.now();
  let lastAudioUpdate = -Infinity;
  let invalidated = true;
  let pixelRatio = 1;
  let cssWidth = 1;
  let cssHeight = 1;
  let audioBusy = false;
  let analysisRateHz = 0;
  let lastAnalysisTime = null;
  let lastUiUpdate = -Infinity;
  let renderedTimelineSignature = "";
  let latestTrajectory = null;
  let pendingEventPulse = accumulateEventPulse(null, null);
  const metricViews = new WeakMap();
  const heroViews = new WeakMap();
  const telemetryViews = new WeakMap();
  const contactListViews = new WeakMap();

  const stageWrap = byId("stageShell", "stageWrap", "stagePanel") ?? canvas.parentElement;
  const announce = (message) => setText(byId("liveStatus", "announcer"), message);

  function invalidate() {
    invalidated = true;
  }

  function resize() {
    const bounds = stageWrap?.getBoundingClientRect() ?? canvas.getBoundingClientRect();
    cssWidth = Math.max(1, Math.round(bounds.width || canvas.clientWidth || 800));
    cssHeight = Math.max(1, Math.round(bounds.height || canvas.clientHeight || 600));
    const budgetRatio = Math.sqrt(3_000_000 / Math.max(1, cssWidth * cssHeight));
    pixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2, budgetRatio));
    canvas.width = Math.round(cssWidth * pixelRatio);
    canvas.height = Math.round(cssHeight * pixelRatio);
    invalidate();
  }

  function displayTransform() {
    const margin = Math.max(34, Math.min(cssWidth, cssHeight) * 0.1);
    const scale = Math.max(1, Math.min(cssWidth - margin * 2, cssHeight - margin * 2) / 2);
    return {
      scale,
      x: (modelX) => cssWidth / 2 + modelX * scale,
      y: (modelY) => cssHeight / 2 + modelY * scale,
      model: (screenX, screenY) => ({
        x: (screenX - cssWidth / 2) / scale,
        y: (screenY - cssHeight / 2) / scale,
      }),
    };
  }

  function readerAt(path, seconds = 0) {
    return readerGeometry(path, state.readerMode, phaseAtOffset(state, seconds));
  }

  function buildFrame(timestampMilliseconds) {
    const timestamp = timestampMilliseconds / 1000;
    const path = stateShape(state);
    const reader = readerAt(path);
    const analysisSignature = `${reader.id}|${state.shapeType}|${state.sides}`;
    const rawContacts = contactsForReader(path, reader);
    const tracked = tracker.assign(rawContacts, timestampMilliseconds, reader.id);
    let analysis = null;
    let analysisError = null;
    try {
      analysis = analysisCall({
        path,
        contacts: tracked.contacts,
        reader,
        timestamp,
        previousFrame: previousFrame?.analysisSignature === analysisSignature
          ? previousFrame.analysis : null,
      });
    } catch (error) {
      analysisError = error;
      console.error("Morphazoidical analysis frame failed", error);
    }

    const analyzedContacts = Array.isArray(analysis?.contacts)
      ? analysis.contacts.map((contact, index) => ({
        ...tracked.contacts[index],
        ...contact,
        id: contact.id ?? contact.stableId ?? tracked.contacts[index]?.id,
      }))
      : tracked.contacts;
    const contacts = analyzedContacts.filter(Boolean);
    const contactFeatures = new Map(contacts.map((contact) => [
      contact.id,
      { ...fallbackContactFeatures(path, contact), ...(contact.features ?? contact.values ?? {}) },
    ]));
    const fallbackEvents = [
      ...contacts.filter((contact) => contact.isBirth).map((contact) => (
        makeEvent("contact_birth", timestamp, { contactId: contact.id })
      )),
      ...tracked.deaths.map((contact) => (
        makeEvent("contact_death", timestamp, { contactId: contact.id })
      )),
    ];
    const events = Array.isArray(analysis?.events) ? analysis.events : fallbackEvents;
    const features = {
      ...fallbackFrameFeatures(path, contacts, previousFrame?.contacts.length),
      ...(analysis?.geometry?.features ?? {}),
      ...(analysis?.reader?.features ?? {}),
      ...(analysis?.features ?? analysis?.values ?? {}),
      ...eventFeaturesFromAnalysis(analysis, events),
    };
    const selectedContact = pinnedContactId
      ? contacts.find((contact) => contact.id === pinnedContactId) ?? null
      : contacts[0] ?? null;
    if (pinnedContactId && !contacts.some((contact) => contact.id === pinnedContactId)) {
      // Keep the pin latched so it can reconnect, but be explicit that it is inactive.
    }

    return Object.freeze({
      timestamp,
      path,
      reader,
      contacts,
      selectedContact,
      analysis,
      contactFeatures,
      features,
      events,
      analysisError,
      analysisSignature,
    });
  }

  function ephemeralFrame(seconds) {
    const path = stateShape(state, seconds);
    const reader = readerAt(path, seconds);
    const raw = contactsForReader(path, reader);
    const timestamp = (latestFrame?.timestamp ?? performance.now() / 1000) + seconds;
    let analysis = null;
    try {
      analysis = analysisCall({
        path,
        reader,
        contacts: raw,
        previousFrame: latestFrame?.analysis ?? null,
        timestamp,
      });
    } catch {
      // The sampled fallback below still preserves a click-safe trajectory.
    }
    const contacts = Array.isArray(analysis?.contacts)
      ? futureContactIds(analysis.contacts, latestFrame?.contacts ?? [])
      : futureContactIds(raw, latestFrame?.contacts ?? []).map((contact) => ({
        ...contact,
        age: (latestFrame?.contacts.find((current) => current.id === contact.id)?.age ?? 0) + seconds,
        velocity: latestFrame?.contacts.find((current) => current.id === contact.id)?.velocity ?? { x: 0, y: 0 },
      }));
    const features = {
      ...fallbackFrameFeatures(path, contacts, latestFrame?.contacts.length),
      ...(analysis?.geometry?.features ?? {}),
      ...(analysis?.reader?.features ?? {}),
    };
    const contactFeatures = new Map(contacts.map((contact) => [
      contact.id,
      { ...fallbackContactFeatures(path, contact), ...(contact.features ?? {}) },
    ]));
    return { timestamp, path, reader, contacts, contactFeatures, features, analysis };
  }

  function voiceForContact(frame, contact) {
    const pitch = mappingValue(frame, state.pitchSource, contact);
    const gain = mappingValue(frame, state.gainSource, contact);
    const pan = mappingValue(frame, state.panSource, contact);
    const timbre = mappingValue(frame, state.timbreSource, contact);
    if (pitch.normalized === null || gain.normalized === null || pan.normalized === null) return null;
    const synth = synthParametersForMode(state.soundMode, timbre.normalized ?? NEUTRAL_TIMBRE, {
      fmIndex: 8,
      fmRatio: 2,
      pmIndex: 5,
      pmRatio: 1,
      shepardWidth: 5,
      shepardRate: state.speed * state.direction * state.pitchRange,
      shepardPosition: pitch.normalized,
    });
    return {
      key: contact.id,
      frequency: pitch01ToFrequency(pitch.normalized, state.baseFrequency, state.pitchRange),
      gain: clamp(gain.normalized * 0.62, 0, 0.62),
      pan: clamp(pan.normalized * 2 - 1, -1, 1),
      waveform: "sine",
      mode: state.soundMode,
      ...synth,
    };
  }

  function voicesForFrame(frame) {
    return scaleShapeVoiceGains(frame.contacts.map((contact) => voiceForContact(frame, contact)).filter(Boolean));
  }

  function updateAudio(frame, now) {
    if (!state.audio || now - lastAudioUpdate < AUDIO_REFRESH_MS) return;
    lastAudioUpdate = now;
    const currentVoices = voicesForFrame(frame);
    const futureFrame = ephemeralFrame(LOOKAHEAD_SECONDS);
    const futureVoices = voicesForFrame(futureFrame);
    const trajectory = unionVoiceTrajectories(currentVoices, futureVoices);
    latestTrajectory = trajectory;
    pool.setVoiceTrajectory(trajectory.current, trajectory.future, LOOKAHEAD_SECONDS);
  }

  function drawGuide(transform) {
    context.save();
    context.lineWidth = 1;
    context.strokeStyle = "rgba(157, 177, 196, 0.13)";
    context.setLineDash([3, 7]);
    context.beginPath();
    context.moveTo(transform.x(-1.15), transform.y(0));
    context.lineTo(transform.x(1.15), transform.y(0));
    context.moveTo(transform.x(0), transform.y(-1.15));
    context.lineTo(transform.x(0), transform.y(1.15));
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(166, 196, 214, 0.7)";
    context.beginPath();
    context.arc(transform.x(0), transform.y(0), 2.5, 0, TAU);
    context.fill();
    context.restore();
  }

  function drawPath(frame, transform) {
    const { path } = frame;
    context.save();
    context.lineJoin = "round";
    context.lineCap = "round";
    context.lineWidth = Math.max(2.2, Math.min(cssWidth, cssHeight) * 0.0045);
    context.strokeStyle = "#d9f3ef";
    context.shadowColor = "rgba(74, 229, 196, 0.22)";
    context.shadowBlur = 16;
    context.beginPath();
    path.points.forEach((point, index) => {
      const x = transform.x(point.x);
      const y = transform.y(point.y);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    if (path.closed) context.closePath();
    context.stroke();
    context.shadowBlur = 0;

    if (state.overlays.bounds) {
      context.strokeStyle = "rgba(121, 185, 255, 0.45)";
      context.lineWidth = 1;
      context.setLineDash([5, 5]);
      context.strokeRect(
        transform.x(path.bounds.minX),
        transform.y(path.bounds.minY),
        path.bounds.width * transform.scale,
        path.bounds.height * transform.scale,
      );
    }
    context.restore();
  }

  function drawReader(frame, transform) {
    const reader = frame.reader;
    context.save();
    context.lineWidth = 1.5;
    context.strokeStyle = "rgba(113, 183, 255, 0.78)";
    context.setLineDash([6, 5]);
    context.beginPath();
    if (reader.mode === "vertical") {
      context.moveTo(transform.x(reader.coordinate), transform.y(-1.22));
      context.lineTo(transform.x(reader.coordinate), transform.y(1.22));
    } else if (reader.mode === "horizontal") {
      context.moveTo(transform.x(-1.22), transform.y(reader.coordinate));
      context.lineTo(transform.x(1.22), transform.y(reader.coordinate));
    } else if (reader.mode === "ray") {
      context.moveTo(transform.x(reader.origin.x), transform.y(reader.origin.y));
      context.lineTo(
        transform.x(reader.origin.x + Math.cos(reader.angle) * 1.35),
        transform.y(reader.origin.y + Math.sin(reader.angle) * 1.35),
      );
    }
    context.stroke();
    context.restore();
  }

  function drawContact(frame, contact, index, transform) {
    const x = transform.x(contact.x);
    const y = transform.y(contact.y);
    const selected = frame.selectedContact?.id === contact.id;
    const color = CONTACT_COLORS[index % CONTACT_COLORS.length];
    context.save();
    if (state.overlays.radius && selected) {
      context.strokeStyle = "rgba(102, 230, 196, 0.45)";
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(transform.x(0), transform.y(0));
      context.lineTo(x, y);
      context.stroke();
    }
    const tangent = contact.tangent ?? { x: Math.cos(contact.tangentAngle), y: Math.sin(contact.tangentAngle) };
    if (state.overlays.tangent && selected) {
      const length = 0.22 * transform.scale;
      context.strokeStyle = color;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x - tangent.x * length, y - tangent.y * length);
      context.lineTo(x + tangent.x * length, y + tangent.y * length);
      context.stroke();
    }
    if (state.overlays.normal && selected && frame.path.closed) {
      const orientation = pathOrientation(frame.path) || 1;
      const normal = orientation > 0 ? { x: tangent.y, y: -tangent.x } : { x: -tangent.y, y: tangent.x };
      const length = 0.19 * transform.scale;
      context.strokeStyle = "#ffba72";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + normal.x * length, y + normal.y * length);
      context.stroke();
    }
    context.fillStyle = color;
    context.strokeStyle = selected ? "#ffffff" : "rgba(5, 18, 27, 0.88)";
    context.lineWidth = selected ? 3 : 2;
    context.beginPath();
    context.arc(x, y, selected ? 8 : 6, 0, TAU);
    context.fill();
    context.stroke();
    context.restore();
  }

  function drawIntersections(frame, transform) {
    if (!state.overlays.intersections) return;
    const intersections = frame.analysis?.geometry?.selfIntersections
      ?? frame.analysis?.geometry?.intersections
      ?? frame.analysis?.intersections ?? [];
    context.save();
    context.strokeStyle = "#ff7e9c";
    context.lineWidth = 2;
    for (const crossing of intersections) {
      const point = crossing.point ?? crossing;
      if (!finite(point?.x) || !finite(point?.y)) continue;
      const x = transform.x(point.x);
      const y = transform.y(point.y);
      context.beginPath();
      context.moveTo(x - 5, y - 5);
      context.lineTo(x + 5, y + 5);
      context.moveTo(x + 5, y - 5);
      context.lineTo(x - 5, y + 5);
      context.stroke();
    }
    context.restore();
  }

  function drawInsideIntervals(frame, transform) {
    if (!state.overlays.intervals) return;
    const intervals = frame.analysis?.reader?.insideIntervals ?? [];
    if (!intervals.length) return;
    context.save();
    context.lineCap = "round";
    context.lineWidth = 7;
    context.strokeStyle = "rgba(97, 236, 193, 0.2)";
    for (const interval of intervals) {
      if (!interval.start || !interval.end) continue;
      context.beginPath();
      context.moveTo(transform.x(interval.start.x), transform.y(interval.start.y));
      context.lineTo(transform.x(interval.end.x), transform.y(interval.end.y));
      context.stroke();
    }
    context.restore();
  }

  function drawHull(frame, transform) {
    if (!state.overlays.hull) return;
    const points = frame.analysis?.geometry?.hull ?? frame.analysis?.hull;
    if (!Array.isArray(points) || points.length < 2) return;
    context.save();
    context.strokeStyle = "rgba(200, 158, 255, 0.72)";
    context.lineWidth = 1.5;
    context.setLineDash([4, 4]);
    context.beginPath();
    points.forEach((point, index) => {
      if (index) context.lineTo(transform.x(point.x), transform.y(point.y));
      else context.moveTo(transform.x(point.x), transform.y(point.y));
    });
    context.closePath();
    context.stroke();
    context.restore();
  }

  function paint(frame) {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, cssWidth, cssHeight);
    const transform = displayTransform();
    drawGuide(transform);
    drawHull(frame, transform);
    drawPath(frame, transform);
    drawReader(frame, transform);
    drawInsideIntervals(frame, transform);
    drawIntersections(frame, transform);
    frame.contacts.forEach((contact, index) => drawContact(frame, contact, index, transform));
    if (state.overlays.labels) {
      context.save();
      context.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textBaseline = "bottom";
      frame.contacts.forEach((contact, index) => {
        context.fillStyle = CONTACT_COLORS[index % CONTACT_COLORS.length];
        context.fillText(contact.id, transform.x(contact.x) + 10, transform.y(contact.y) - 8);
      });
      context.restore();
    }
  }

  function populateMappingSelect(select, selected, target) {
    if (!select) return;
    const prior = select.value || selected;
    clear(select);
    const groups = new Map();
    for (const descriptor of FEATURE_REGISTRY) {
      if (descriptor.type === "event" || !["contact", "reader", "geometry"].includes(descriptor.scope)) continue;
      const scopeLabel = descriptor.scope === "geometry"
        ? "Form"
        : descriptor.scope[0].toUpperCase() + descriptor.scope.slice(1);
      const groupLabel = `${scopeLabel} · ${metricSectionForDescriptor(descriptor)}`;
      if (!groups.has(groupLabel)) groups.set(groupLabel, []);
      groups.get(groupLabel).push(descriptor);
    }
    for (const [label, descriptors] of groups) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = label;
      for (const descriptor of descriptors) {
        const option = document.createElement("option");
        option.value = descriptor.id;
        option.textContent = `${descriptor.label}${descriptor.type === "circular" || descriptor.type === "cyclic" ? " ↻" : ""}`;
        option.dataset.scope = descriptor.scope;
        optgroup.append(option);
      }
      select.append(optgroup);
    }
    select.value = [...select.options].some((option) => option.value === prior) ? prior : selected;
    select.dataset.target = target;
  }

  function mappedTargetsForFeature(featureId) {
    return [
      state.pitchSource === featureId ? "Pitch" : null,
      state.panSource === featureId ? "Pan" : null,
      state.gainSource === featureId ? "Level" : null,
      state.timbreSource === featureId ? "Timbre" : null,
    ].filter(Boolean);
  }

  function ensureMetricView(host, descriptors) {
    const signature = descriptors.map((descriptor) => descriptor.id).join("|");
    const existing = metricViews.get(host);
    if (existing?.signature === signature) return existing;

    clear(host);
    const grouped = new Map();
    for (const descriptor of descriptors) {
      const section = metricSectionForDescriptor(descriptor);
      if (!grouped.has(section)) grouped.set(section, []);
      grouped.get(section).push(descriptor);
    }

    const descriptions = {
      "Location on form": "Position, phase, and edge identity",
      "Direction & stage origin": "Angles and relation to the fixed origin",
      "Local shape": "Turn, curvature, corner, and hull class",
      "Reader relationship": "Ordering, crossing role, and incidence",
      "Motion & identity": "Velocity and tracked contact lifetime",
      Occupancy: "Contacts and contained reader spans",
      "Contact distribution": "Spacing along the active reader",
      "Tangency risk": "Low transversality flags a grazing candidate",
      Change: "Current-frame contact-set change",
      Identity: "Closure, orientation, and logical structure",
      "Size & pose": "Dimensions, area, centroid, and principal direction",
      "Shape character": "Compactness, hull relation, and eccentricity",
      "Stage-origin profile": "Radii and containment at the fixed origin",
      "Sampling diagnostics": "Polyline resolution used by this snapshot",
      "Contour topology": "Crossings, touches, and overlaps",
      "Contact lifecycle": "Birth and death edges in this frame",
      "Reader boundary": "Entry and exit edges in this frame",
      "Structural · planned": "Split and merge semantics are not implemented",
    };
    const rows = new Map();
    const groups = [];
    let groupIndex = 0;

    for (const [section, sectionDescriptors] of grouped) {
      const disclosure = element("details", "metric-group");
      disclosure.open = host.id === "topologyMetrics" || groupIndex === 0;
      const summary = element("summary");
      const heading = element("span");
      heading.append(element("b", "", section));
      heading.append(element("small", "", descriptions[section] ?? "Raw and normalized live outputs"));
      const count = element("span", "metric-group-count", `${sectionDescriptors.length} signals`);
      summary.append(heading, count);
      const list = element("dl", "metric-list");

      for (const descriptor of sectionDescriptors) {
        const row = element("div", "metric-row");
        row.dataset.featureId = descriptor.id;
        const term = element("dt");
        term.append(element("span", "", descriptor.label));
        term.append(element(
          "small",
          "",
          `${descriptor.type}${descriptor.unit ? ` · ${descriptor.unit}` : ""}`,
        ));
        const badges = element("span", "metric-route-badges");
        term.append(badges);

        const definition = element("dd");
        const value = element("strong", "metric-value", "Unavailable");
        const normalized = element("span", "metric-normalized", "Not available");
        const meter = element("span", "metric-meter");
        meter.setAttribute("aria-hidden", "true");
        meter.append(element("i"));
        definition.append(value, normalized, meter);
        row.append(term, definition);
        row.title = [descriptor.id, descriptor.description, descriptor.availability]
          .filter(Boolean)
          .join(" · ");
        list.append(row);
        rows.set(descriptor.id, { row, value, normalized, meter, badges });
      }

      disclosure.append(summary, list);
      host.append(disclosure);
      groups.push({ count, descriptors: sectionDescriptors });
      groupIndex += 1;
    }

    const view = { signature, rows, groups };
    metricViews.set(host, view);
    return view;
  }

  function renderMetricRows(host, descriptors, frame, contact = frame.selectedContact) {
    if (!host) return;
    const view = ensureMetricView(host, descriptors);
    for (const descriptor of descriptors) {
      const parts = view.rows.get(descriptor.id);
      if (!parts) continue;
      const value = featureValue(frame, descriptor.id, contact);
      const signal = mappingSignalForValue(descriptor, value);
      const normalized = signal.normalized;
      const unavailable = isFeatureValueUnavailable(value);
      const targets = mappedTargetsForFeature(descriptor.id);
      parts.row.classList.toggle("invalid", unavailable);
      parts.row.classList.toggle("is-mapped", targets.length > 0);
      parts.row.dataset.status = unavailable ? "unavailable" : "live";
      setText(parts.value, formatFeature(descriptor, value));
      setText(
        parts.normalized,
        normalized === null ? "Not available for mapping" : `Norm ${formatNumber(normalized)}`,
      );
      updateMeter(parts.meter, descriptor, normalized);
      const routeSignature = targets.join("|");
      if (parts.badges.dataset.routes !== routeSignature) {
        clear(parts.badges);
        for (const target of targets) {
          parts.badges.append(element("span", "metric-route-badge", target));
        }
        parts.badges.dataset.routes = routeSignature;
      }
    }
    for (const group of view.groups) {
      const live = group.descriptors.filter((descriptor) => {
        const value = featureValue(frame, descriptor.id, contact);
        return !isFeatureValueUnavailable(value);
      }).length;
      setText(group.count, `${live} live · ${group.descriptors.length - live} unavailable`);
    }
  }

  function renderHero(host, frame, featureIds, contact = frame.selectedContact) {
    if (!host) return;
    const signature = featureIds.join("|");
    let view = heroViews.get(host);
    if (view?.signature !== signature) {
      clear(host);
      const cards = new Map();
      for (const id of featureIds) {
        const descriptor = getFeatureDescriptor(id);
        if (!descriptor) continue;
        const card = element("div");
        const label = element("small", "", descriptor.label);
        const value = element("strong", "", "Unavailable");
        const meta = element("span", "", descriptor.availability ?? "Waiting for analysis");
        card.append(label, value, meta);
        host.append(card);
        cards.set(id, { value, meta });
      }
      view = { signature, cards };
      heroViews.set(host, view);
    }
    for (const id of featureIds) {
      const descriptor = getFeatureDescriptor(id);
      const card = view.cards.get(id);
      if (!descriptor || !card) continue;
      const value = featureValue(frame, id, contact);
      setText(card.value, formatFeature(descriptor, value));
      setText(
        card.meta,
        isFeatureValueUnavailable(value)
          ? descriptor.availability ?? "Unavailable"
          : descriptor.unit ?? "Mapping-ready",
      );
    }
  }

  function renderInspector(frame) {
    const contactDescriptors = FEATURE_REGISTRY.filter((descriptor) => descriptor.scope === "contact");
    const readerDescriptors = FEATURE_REGISTRY.filter((descriptor) => descriptor.scope === "reader");
    const geometryDescriptors = FEATURE_REGISTRY.filter((descriptor) => descriptor.scope === "geometry");
    const topologyDescriptors = FEATURE_REGISTRY.filter((descriptor) => descriptor.group === "Topology" || descriptor.group === "Events");
    const activeScope = root.querySelector('[data-inspector-tab][aria-selected="true"]')
      ?.dataset.inspectorTab ?? "contact";
    if (activeScope === "contact") {
      renderMetricRows(byId("contactMetrics"), contactDescriptors, frame);
      renderHero(
        byId("contactHero"),
        frame,
        ["contact.contourPhase", "contact.turn", "contact.motion.speed"],
      );
    } else if (activeScope === "reader") {
      renderMetricRows(byId("readerMetrics"), readerDescriptors, frame);
      renderHero(
        byId("readerHero"),
        frame,
        ["reader.contactCount", "reader.insideFraction", "reader.transversality.minimum"],
      );
      renderContactList(frame);
    } else if (activeScope === "form") {
      renderMetricRows(
        byId("formMetrics"),
        geometryDescriptors.filter((item) => item.group !== "Topology"),
        frame,
      );
      renderHero(
        byId("formHero"),
        frame,
        ["geometry.perimeter", "geometry.area", "geometry.compactness"],
      );
    } else if (activeScope === "topology") {
      renderMetricRows(byId("topologyMetrics"), topologyDescriptors, frame);
    }

    const label = byId("selectedContactLabel");
    if (label) {
      const index = frame.contacts.findIndex((contact) => contact.id === frame.selectedContact?.id);
      const contactLabel = frame.selectedContact
        ? `Contact ${index + 1} · ${pinnedContactId ? "pinned" : "automatic"}`
        : pinnedContactId ? "Pinned contact · inactive" : "No active contact";
      const headings = {
        contact: contactLabel,
        reader: `Reader · ${frame.reader.mode}`,
        form: `${state.shapeType === "circle" ? "Circle" : state.shapeType === "line" ? "Open line" : state.shapeType} · form snapshot`,
        topology: frame.path.closed ? "Contour topology · closed" : "Contour topology · open",
        audio: `Audio output · ${state.audio ? "live" : "muted"}`,
      };
      label.textContent = headings[activeScope] ?? contactLabel;
    }
    const clearPin = byId("clearContactPin");
    if (clearPin) clearPin.hidden = activeScope !== "contact" || !pinnedContactId;

    const topology = frame.analysis?.geometry?.topology;
    const topologySummary = byId("topologySummary");
    if (topologySummary && activeScope === "topology") {
      const count = frame.analysis?.geometry?.selfIntersections?.length ?? null;
      const orb = topologySummary.querySelector(".topology-orb");
      orb?.classList.toggle("complex", finite(count) && count > 0);
      orb?.classList.toggle("simple", count === 0 && topology?.simpleClosed === true);
      setText(
        topologySummary.querySelector("strong"),
        topologyPresentation(frame.path.closed, topology),
      );
      setText(topologySummary.querySelector("small"), count === null ? "Self-intersection status unavailable"
        : `${count} sampled self-intersection${count === 1 ? "" : "s"}`);
    }
  }

  function renderContactList(frame) {
    const host = byId("contactList", "activeContacts");
    if (!host) return;
    let view = contactListViews.get(host);
    if (!view) {
      clear(host);
      view = { items: new Map(), empty: null };
      contactListViews.set(host, view);
    }

    const liveIds = new Set(frame.contacts.map((contact) => contact.id));
    for (const [id, parts] of view.items) {
      if (liveIds.has(id)) continue;
      parts.item.remove();
      view.items.delete(id);
    }

    if (!frame.contacts.length) {
      if (!view.empty) view.empty = element("li", "empty-state", "No reader contacts in this frame.");
      if (view.empty.parentElement !== host) host.append(view.empty);
    } else {
      view.empty?.remove();
    }

    frame.contacts.forEach((contact, index) => {
      let parts = view.items.get(contact.id);
      if (!parts) {
        const item = element("li");
        const button = element("button", "contact-select");
        const swatch = element("i");
        const label = element("span");
        const detail = element("small");
        button.type = "button";
        swatch.setAttribute("aria-hidden", "true");
        button.append(swatch, label, detail);
        button.addEventListener("click", () => {
          const id = button.dataset.contactId;
          pinnedContactId = pinnedContactId === id ? null : id;
          const currentIndex = latestFrame?.contacts.findIndex((entry) => entry.id === id) ?? -1;
          announce(pinnedContactId
            ? `Pinned contact ${currentIndex >= 0 ? currentIndex + 1 : ""}.`
            : "Contact pin cleared.");
          invalidate();
        });
        item.append(button);
        parts = { item, button, swatch, label, detail };
        view.items.set(contact.id, parts);
      }
      const { item, button, swatch, label, detail } = parts;
      item.dataset.contactId = contact.id;
      button.dataset.contactId = contact.id;
      button.setAttribute("aria-pressed", String(pinnedContactId === contact.id));
      button.setAttribute("aria-label", `Contact ${index + 1}, contour phase ${formatNumber(contact.u)}`);
      swatch.style.background = CONTACT_COLORS[index % CONTACT_COLORS.length];
      setText(label, `Contact ${index + 1}`);
      setText(
        detail,
        `${formatNumber(contact.u)} · edge ${Math.floor(contact.segmentIndex / Math.max(1, frame.path.samplesPerEdge)) + 1}`,
      );
      const childAtIndex = host.children[index];
      if (childAtIndex !== item) host.insertBefore(item, childAtIndex ?? null);
    });
    setText(byId("pinStatus", "contactPinStatus"), pinnedContactId
      ? frame.contacts.some((contact) => contact.id === pinnedContactId) ? "Pinned · live" : "Pinned · inactive"
      : "Following first contact");
  }

  function pushEvents(events) {
    const additions = [];
    const known = new Set(eventHistory.map((entry) => entry.key));
    for (const event of events) {
      const key = event.id ?? `${event.type}:${event.timestamp}:${event.contactId ?? ""}`;
      if (known.has(key)) continue;
      known.add(key);
      additions.push({ ...event, key });
    }
    if (!additions.length) return;
    eventHistory.unshift(...additions);
    eventHistory.splice(40);
    renderedTimelineSignature = "";
    const first = additions[0];
    setText(
      byId("eventAnnouncement"),
      additions.length === 1
        ? `${eventLabel(first)}${first.contactId ? `, ${first.contactId}` : ""}.`
        : `${additions.length} geometry events. First: ${eventLabel(first)}.`,
    );
  }

  function renderEventSummary(frame, pulse) {
    for (const counter of root.querySelectorAll("[data-event-feature]")) {
      const id = counter.dataset.eventFeature;
      const value = Object.prototype.hasOwnProperty.call(pulse?.features ?? {}, id)
        ? pulse.features[id]
        : featureValue(frame, id, frame.selectedContact);
      const unavailable = isFeatureValueUnavailable(value);
      counter.dataset.status = unavailable ? "unavailable" : "live";
      counter.dataset.active = String(!unavailable && value > 0);
      counter.title = unavailable
        ? getFeatureDescriptor(id)?.availability ?? "Unavailable"
        : `${formatNumber(value, 0)} event edge${value === 1 ? "" : "s"} in this display update`;
      setText(counter.querySelector("strong"), unavailable ? "—" : formatNumber(value, 0));
    }
    const currentEvents = pulse?.eventCount
      ?? (Array.isArray(frame.events) ? frame.events.length : 0);
    const activity = byId("eventActivity");
    setText(
      activity,
      currentEvents
        ? `${currentEvents} change${currentEvents === 1 ? "" : "s"} this update`
        : "Stable snapshot",
    );
    activity?.parentElement?.setAttribute("data-active", String(currentEvents > 0));
    setText(byId("eventHistoryCount"), `${eventHistory.length} latched`);
  }

  function renderTimeline() {
    const host = byId("eventStream", "eventTimeline", "timelineEvents");
    if (!host) return;
    const visible = eventHistory.slice(0, 6);
    const signature = visible.map((event) => event.key).join("|");
    if (signature === renderedTimelineSignature) return;
    renderedTimelineSignature = signature;
    clear(host);
    if (!visible.length) {
      const empty = element("li", "event-empty");
      empty.append(element("span", "", "No topology changes yet"));
      empty.append(element("small", "", "Contact and reader-boundary events will appear here."));
      host.append(empty);
      return;
    }
    const newestTimestamp = visible[0]?.timestamp ?? 0;
    visible.forEach((event, index) => {
      const visual = eventPresentation(event);
      const item = element("li", visual.className);
      item.classList.toggle("is-latest", index === 0);
      item.append(element("span", "event-marker", visual.marker));
      const body = element("div");
      body.append(element("b", "", eventLabel(event)));
      body.append(element(
        "span",
        "",
        visual.subject,
      ));
      const age = Math.max(0, newestTimestamp - (event.timestamp ?? newestTimestamp));
      item.append(body);
      item.append(element(
        "small",
        "",
        `${index === 0 ? "Latest" : `${age.toFixed(2)} s earlier`} · ${event.quality ?? "frame"}`,
      ));
      host.append(item);
    });
  }

  function renderLiveDashboard(frame, voices = []) {
    for (const card of root.querySelectorAll("[data-live-feature]")) {
      const id = card.dataset.liveFeature;
      const descriptor = getFeatureDescriptor(id);
      if (!descriptor) continue;
      const value = featureValue(frame, id, frame.selectedContact);
      const normalized = mappingSignalForValue(descriptor, value).normalized;
      const unavailable = isFeatureValueUnavailable(value);
      card.dataset.status = unavailable ? "unavailable" : "live";
      card.dataset.alert = String(
        id === "reader.transversality.minimum"
        && finite(value)
        && value < 0.08,
      );
      setText(card.querySelector(".live-value"), formatFeature(descriptor, value));
      let meta = normalized === null
        ? descriptor.availability ?? "Not available in this frame"
        : `Norm ${formatNumber(normalized)}`;
      if (id === "reader.transversality.minimum" && finite(value)) {
        meta = value < 0.08 ? "Tangency candidate" : value < 0.25 ? "Near grazing" : "Transverse";
      }
      setText(card.querySelector(".live-value-meta"), meta);
      updateMeter(card.querySelector(".live-meter"), descriptor, normalized);
      card.setAttribute(
        "aria-label",
        `${descriptor.label}: ${formatFeature(descriptor, value)}. ${meta}.`,
      );
    }

    const intersectionCount = featureValue(frame, "geometry.selfIntersections", frame.selectedContact);
    const topologyState = !frame.path.closed
      ? "Topology · open contour"
      : finite(intersectionCount) && intersectionCount > 0
        ? `Topology · ${formatNumber(intersectionCount, 0)} intersection${intersectionCount === 1 ? "" : "s"}`
        : finite(intersectionCount) ? "Topology · simple closed" : "Topology · unavailable";
    const topologyLabel = byId("liveTopologyState");
    setText(topologyLabel, topologyState);
    topologyLabel?.classList.toggle("complex", finite(intersectionCount) && intersectionCount > 0);
    const contactIndex = frame.contacts.findIndex((contact) => contact.id === frame.selectedContact?.id);
    const subject = contactIndex >= 0 ? `contact ${contactIndex + 1}` : "no contact";
    const voiceState = state.audio
      ? `${pool.running ? pool.lastSubmittedVoiceCount : 0} rendered voices`
      : `audio off · ${voices.length} mapping-ready`;
    setText(
      byId("liveFrameState"),
      `${frame.contacts.length} contacts · ${voiceState} · ${subject}`,
    );
  }

  function renderMapping(frame) {
    const contact = frame.selectedContact;
    const routes = [
      ["pitch", state.pitchSource, byId("pitchRouteValue", "pitchPreview", "pitchMappingPreview")],
      ["gain", state.gainSource, byId("levelRouteValue", "gainPreview", "gainMappingPreview")],
      ["pan", state.panSource, byId("panRouteValue", "panPreview", "panMappingPreview")],
      ["timbre", state.timbreSource, byId("timbreRouteValue", "timbrePreview")],
    ];
    for (const [target, source, output] of routes) {
      const descriptor = getFeatureDescriptor(source);
      const mapped = mappingValue(frame, source, contact);
      const monitor = root.querySelector(`[data-route-monitor="${target}"]`);
      if (mapped.normalized === null) {
        const neutralTimbre = target === "timbre";
        const unavailableOutput = neutralTimbre
          ? `${formatNumber(NEUTRAL_TIMBRE)} neutral fallback`
          : "Silent";
        if (output) {
          output.textContent = neutralTimbre
            ? `${descriptor?.label ?? source} · unavailable · ${unavailableOutput}`
            : `${descriptor?.label ?? source} · unavailable · voice held silent`;
          output.dataset.status = neutralTimbre ? "fallback" : "unavailable";
        }
        if (monitor) {
          monitor.dataset.status = neutralTimbre ? "fallback" : "unavailable";
          setText(monitor.querySelector(".route-status"), neutralTimbre ? "neutral" : "silent");
          setText(monitor.querySelector(".route-source"), descriptor?.label ?? source);
          setText(monitor.querySelector(".route-raw"), "—");
          setText(monitor.querySelector(".route-normalized"), "—");
          setText(monitor.querySelector(".route-output"), unavailableOutput);
        }
        continue;
      }
      const targetValue = target === "pitch"
        ? `${Math.round(pitch01ToFrequency(mapped.normalized, state.baseFrequency, state.pitchRange))} Hz`
        : target === "pan" ? formatNumber(mapped.normalized * 2 - 1)
          : target === "timbre" ? `${formatNumber(mapped.normalized)} drive`
            : `${formatNumber(mapped.normalized * 0.62)} gain`;
      const rawValue = formatFeature(descriptor, mapped.raw);
      if (output) {
        output.textContent = `${descriptor?.label ?? source} · raw ${rawValue} · norm ${formatNumber(mapped.normalized)} · ${targetValue}`;
        output.dataset.status = "live";
      }
      if (monitor) {
        monitor.dataset.status = "live";
        setText(monitor.querySelector(".route-status"), "live");
        setText(monitor.querySelector(".route-source"), descriptor?.label ?? source);
        setText(monitor.querySelector(".route-raw"), rawValue);
        setText(monitor.querySelector(".route-normalized"), formatNumber(mapped.normalized));
        setText(monitor.querySelector(".route-output"), targetValue);
      }
    }
  }

  function renderAudioTelemetry(frame, voices = [], trajectory = null) {
    const counts = audioVoiceCounts({
      audioEnabled: state.audio,
      engineRunning: pool.running,
      geometricContacts: frame.contacts.length,
      mappableVoices: voices.length,
      submittedVoices: pool.lastSubmittedVoiceCount,
      maximumVoices: MAX_VOICES,
    });
    const audioOff = "0 · audio off";
    const host = byId("audioTelemetry", "audioMetrics");
    if (host) {
      const selected = frame.selectedContact;
      const pitch = mappingValue(frame, state.pitchSource, selected);
      const gain = mappingValue(frame, state.gainSource, selected);
      const selectedVoice = selected ? voices.find((voice) => voice.key === selected.id) : null;
      const rows = [
        ["Voice allocation", "Geometric contacts", counts.contacts],
        ["Voice allocation", "Mapping-ready voices", counts.mappable],
        ["Voice allocation", "Scheduled voices", state.audio ? counts.scheduled : audioOff],
        ["Voice allocation", "Rendering now", state.audio
          ? pool.running ? counts.rendered : "0 · engine not running"
          : audioOff],
        ["Voice allocation", "Over pool capacity", counts.overCapacity],
        ["Selected mapping", "Voice patch", state.soundMode.toUpperCase()],
        ["Selected mapping", "Pitch source", !pitch.available ? "Unavailable" : `${formatNumber(pitch.raw)} raw · ${formatNumber(pitch.normalized)} norm`],
        ["Selected mapping", "Level source", !gain.available ? "Unavailable" : `${formatNumber(gain.raw)} raw · ${formatNumber(gain.normalized)} norm`],
        ["Selected mapping", "Mapped target", selectedVoice
          ? `${Math.round(selectedVoice.frequency)} Hz · gain ${formatNumber(selectedVoice.gain)}${state.audio ? "" : " · preview only"}`
          : "Silent / unavailable"],
        ["Engine & output", "Renderer", !state.audio ? "Audio off"
          : !pool.running ? "Starting / suspended"
            : pool.synthNode ? "AudioWorklet" : pool.workletUnavailable ? "Native fallback" : "Native renderer"],
        ["Engine & output", "Lookahead", `${Math.round(LOOKAHEAD_SECONDS * 1000)} ms`],
        ["Engine & output", "Output level", state.audio && pool.running ? "Estimated" : "Unavailable while audio is off"],
      ];

      const signature = rows.map(([group, label]) => `${group}:${label}`).join("|");
      let view = telemetryViews.get(host);
      if (view?.signature !== signature) {
        clear(host);
        const groups = new Map();
        for (const [group, label] of rows) {
          if (!groups.has(group)) groups.set(group, []);
          groups.get(group).push(label);
        }
        const values = new Map();
        for (const [group, labels] of groups) {
          const section = element("section", "telemetry-group");
          const header = element("header");
          header.append(element("h3", "", group));
          const list = element("dl");
          for (const label of labels) {
            const row = element("div", "telemetry-row");
            const value = element("dd");
            row.append(element("dt", "", label), value);
            list.append(row);
            values.set(label, value);
          }
          section.append(header, list);
          host.append(section);
        }
        view = { signature, values };
        telemetryViews.set(host, view);
      }
      for (const [, label, value] of rows) {
        setText(view.values.get(label), String(value));
      }
    }
    setText(byId("voiceCount", "activeVoiceCount"), String(counts.rendered));
    setText(byId("audioEngine", "audioRenderer"), !state.audio ? "Muted"
      : !pool.running ? "Starting"
        : pool.synthNode ? "Worklet · live" : "Fallback · estimated");
  }

  function renderQuality(frame) {
    const preset = state.qualityPreset[0].toUpperCase() + state.qualityPreset.slice(1);
    const label = `${preset} · sampled polyline · ${state.samplesPerEdge} samples/edge`;
    const analysisAvailable = Boolean(frame.analysis);
    setText(byId("fidelityBadge", "geometryQuality", "qualityLabel"), `Sampled · ${state.samplesPerEdge}/edge`);
    setText(byId("qualityDetail", "geometryQualityDetail"),
      analysisAvailable
        ? "Live values are exact for the sampled polyline. Smooth-curve and sub-frame event error bounds are not yet available."
        : `${label}. Core geometry and event counts are using the sampled fallback; advanced analysis is unavailable.`);
    const badge = byId("qualityStatus", "analysisStatus");
    if (badge) {
      badge.textContent = analysisAvailable ? "Live · sampled" : "Fallback · analysis unavailable";
      badge.dataset.status = analysisAvailable ? "estimated" : "unavailable";
    }
    setText(byId("contactCount", "readerContactCount"), String(frame.contacts.length));
    setText(byId("readerPhaseOut"), `${(frame.reader.phase * 100).toFixed(1)}%`);
    setText(
      byId("analysisRate"),
      state.playing || state.autoRotate
        ? `snapshots ${analysisRateHz ? analysisRateHz.toFixed(0) : "—"} Hz`
        : "snapshots on change",
    );
    const shapeName = state.shapeType === "circle" ? "CIRCLE"
      : state.shapeType === "line" ? "OPEN LINE"
        : `${state.sides}-${state.shapeType === "star" ? "POINT STAR" : "SIDED POLYGON"}`;
    const topology = frame.analysis?.geometry?.topology;
    const topologyName = topologyPresentation(frame.path.closed, topology).toUpperCase();
    setText(byId("geometryStatus"), `${shapeName} · ${topologyName}`);
    const readerNames = { vertical: "VERTICAL SCAN", horizontal: "HORIZONTAL SCAN", ray: "RADAR RAY", path: "CONTOUR TRACE" };
    setText(byId("readerStatus"), `${readerNames[frame.reader.mode] ?? "READER"} · ${frame.contacts.length} CONTACT${frame.contacts.length === 1 ? "" : "S"}`);
  }

  function renderControls(frame) {
    setText(byId("transportSummary"), `${state.playing ? "playing" : "paused"} · ${state.speed >= 0 ? "forward" : "reverse"}`);
    setText(byId("readerSpeedOut"), `${state.speed.toFixed(2)} cyc/s`);
    setText(byId("rotationOut"), `${formatNumber(state.rotation + state.continuousRotation, 1)}°`);
    setText(byId("rotationSpeedOut"), `${formatNumber(state.rotationSpeed / 360, 2)} rev/s`);
    setText(byId("sidesOut"), String(state.sides));
    setText(byId("starDepthOut"), `${Math.round(state.starDepth * 100)}%`);
    setText(byId("curvatureOut"), `${state.curvature >= 0 ? "+" : ""}${Math.round(state.curvature * 100)}%`);
    setText(byId("aspectOut"), `${state.aspect >= 0 ? "+" : ""}${Math.round(state.aspect * 100)}%`);
    setText(byId("skewOut"), `${state.skew >= 0 ? "+" : ""}${Math.round(state.skew * 100)}%`);
    setText(byId("baseFrequencyOut"), `${Math.round(state.baseFrequency)} Hz`);
    setText(byId("pitchRangeOut"), `${state.pitchRange.toFixed(1)} oct`);
    setText(byId("masterLevelOut"), `${Math.round(state.masterLevel * 100)}%`);
    setText(byId("formSummary"), state.shapeType === "circle" ? "circle"
      : state.shapeType === "line" ? "open line" : `${state.sides}-${state.shapeType === "star" ? "point star" : "sided polygon"}`);
    const readerCopy = {
      vertical: ["Bounds-relative vertical scan", "Phase maps between the form’s current left and right bounds."],
      horizontal: ["Bounds-relative horizontal scan", "Phase maps between the form’s current top and bottom bounds."],
      ray: ["Center radar ray", "Phase is a clockwise angle around the stage origin."],
      path: ["Contour tracer", frame.path.closed ? "Phase wraps by sampled arc length." : "Open contours ping-pong by sampled arc length."],
    };
    const [title, description] = readerCopy[frame.reader.mode] ?? readerCopy.path;
    setText(byId("readerDefinitionTitle"), title);
    setText(byId("readerDefinitionText"), description);
    const starDepth = byId("starDepth");
    if (starDepth) starDepth.disabled = state.shapeType !== "star";
    const sides = byId("sides");
    if (sides) sides.disabled = state.shapeType === "circle" || state.shapeType === "line";
  }

  function updateUi(frame, eventPulse) {
    const voices = voicesForFrame(frame);
    renderLiveDashboard(frame, voices);
    renderEventSummary(frame, eventPulse);
    renderMapping(frame);
    renderTimeline();
    renderQuality(frame);
    renderControls(frame);
    renderInspector(frame);
    renderAudioTelemetry(frame, voices, latestTrajectory);
    setText(byId("positionValue", "positionOut"), formatNumber(state.position));
    setText(byId("rotationValue", "rotationOut"), `${formatNumber(state.rotation + state.continuousRotation, 1)}°`);
  }

  function applyMotion(dt) {
    let moved = false;
    if (state.autoRotate) {
      state.continuousRotation = (state.continuousRotation + state.rotationSpeed * dt) % 360;
      moved = true;
    }
    if (state.playing) {
      state.continuousPosition += state.direction * state.speed * dt;
      state.position = (state.readerMode === "trace" || state.readerMode === "path") && latestFrame && !latestFrame.path.closed
        ? pingPong01(state.continuousPosition) : wrap01(state.continuousPosition);
      moved = true;
    }
    if (moved) {
      const input = byId("readerPhase", "position", "readerPosition");
      if (input) input.value = String(state.position);
    }
  }

  function frameLoop(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    applyMotion(dt);
    if (invalidated || state.playing || state.autoRotate) {
      const forceUi = invalidated || lastUiUpdate < 0;
      if (lastAnalysisTime !== null) {
        const analysisDelta = Math.max(1e-3, (now - lastAnalysisTime) / 1000);
        analysisRateHz = analysisRateHz
          ? analysisRateHz * 0.9 + (1 / analysisDelta) * 0.1
          : 1 / analysisDelta;
      }
      lastAnalysisTime = now;
      const frame = buildFrame(now);
      latestFrame = frame;
      pushEvents(frame.events);
      pendingEventPulse = accumulateEventPulse(pendingEventPulse, frame);
      paint(frame);
      if (forceUi || now - lastUiUpdate >= UI_REFRESH_MS) {
        updateUi(frame, pendingEventPulse);
        pendingEventPulse = accumulateEventPulse(null, null);
        lastUiUpdate = now;
      }
      updateAudio(frame, now);
      previousFrame = frame;
      invalidated = false;
    }
    requestAnimationFrame(frameLoop);
  }

  function bindRange(ids, key, options = {}) {
    const input = byId(...ids);
    if (!input) return;
    input.value = String(options.toInput?.(state[key]) ?? state[key]);
    const update = () => {
      const numeric = Number(input.value);
      if (!finite(numeric)) return;
      state[key] = options.fromInput ? options.fromInput(numeric) : numeric;
      options.after?.(state[key]);
      invalidate();
    };
    input.addEventListener("input", update);
    input.addEventListener("change", () => announce(`${options.label ?? key} ${input.value}.`));
  }

  function bindSelect(ids, key, after) {
    const select = byId(...ids);
    if (!select) return;
    if ([...select.options].some((option) => option.value === state[key])) select.value = state[key];
    select.addEventListener("change", () => {
      state[key] = select.value;
      after?.(select.value);
      announce(`${select.selectedOptions[0]?.textContent ?? key} selected.`);
      invalidate();
    });
  }

  function bindToggle(ids, getter, setter, label) {
    const button = byId(...ids);
    if (!button) return;
    const paintToggle = () => {
      const pressed = Boolean(getter());
      button.setAttribute("aria-pressed", String(pressed));
      button.classList.toggle("is-active", pressed);
    };
    button.addEventListener("click", () => {
      setter(!getter());
      paintToggle();
      announce(`${label} ${getter() ? "on" : "off"}.`);
      invalidate();
    });
    paintToggle();
  }

  function bindUi() {
    const play = byId("playToggle", "playButton", "transportPlay");
    play?.addEventListener("click", () => {
      state.playing = !state.playing;
      play.setAttribute("aria-pressed", String(state.playing));
      play.classList.toggle("is-active", state.playing);
      setText(play.querySelector("[data-label]"), state.playing ? "Pause" : "Play");
      if (!state.playing && !state.autoRotate) pool.silence();
      lastTime = performance.now();
      announce(state.playing ? "Playback started." : "Playback paused.");
      invalidate();
    });

    const audio = byId("audioButton", "audioToggle");
    audio?.addEventListener("click", async () => {
      if (audioBusy) return;
      audioBusy = true;
      audio.disabled = true;
      try {
        if (state.audio) {
          state.audio = false;
          latestTrajectory = null;
          pool.disable();
          announce("Audio muted.");
        } else {
          await pool.enable();
          pool.setLevel(state.masterLevel);
          state.audio = true;
          lastAudioUpdate = -Infinity;
          announce("Audio live.");
        }
        audio.setAttribute("aria-pressed", String(state.audio));
        audio.classList.toggle("is-active", state.audio);
        setText(byId("audioState"), state.audio ? "on" : "off");
      } catch (error) {
        state.audio = false;
        announce(error instanceof Error ? error.message : "Audio is unavailable.");
        setText(byId("audioError"), error instanceof Error ? error.message : "Web Audio is unavailable.");
      } finally {
        audioBusy = false;
        audio.disabled = false;
        invalidate();
      }
    });

    bindRange(["readerPhase", "position", "readerPosition"], "position", {
      label: "Reader position",
      after(value) { state.continuousPosition = value; },
    });
    bindRange(["speed", "readerSpeed"], "speed", { label: "Reader speed" });
    bindRange(["rotation", "formRotation"], "rotation", { label: "Rotation" });
    bindRange(["rotationSpeed"], "rotationSpeed", {
      label: "Rotation speed",
      toInput: (degreesPerSecond) => degreesPerSecond / 360,
      fromInput: (revolutionsPerSecond) => revolutionsPerSecond * 360,
    });
    bindRange(["sides", "sideCount"], "sides", {
      label: "Sides",
      fromInput: (value) => Math.round(clamp(value, 2, 32)),
      after: () => tracker.reset(),
    });
    bindRange(["curvature"], "curvature", { label: "Curvature" });
    bindRange(["starDepth"], "starDepth", { label: "Star depth" });
    bindRange(["aspect"], "aspect", { label: "Aspect" });
    bindRange(["skew"], "skew", { label: "Skew" });
    bindRange(["baseFrequency", "baseHz"], "baseFrequency", { label: "Base frequency" });
    bindRange(["pitchRange", "octaveRange"], "pitchRange", { label: "Pitch range" });
    bindRange(["masterLevel", "level"], "masterLevel", {
      label: "Master level",
      after: (value) => pool.setLevel(value),
    });

    bindSelect(["shapeType"], "shapeType", () => tracker.reset());
    bindSelect(["readerMode", "playMethod"], "readerMode", () => tracker.reset());
    bindSelect(["qualityMode", "qualityPreset", "samplingQuality"], "qualityPreset", (preset) => {
      state.samplesPerEdge = preset === "precision" ? SAMPLE_PRESETS.precise
        : preset === "performance" ? SAMPLE_PRESETS.draft : SAMPLE_PRESETS.balanced;
      tracker.reset();
    });

    const pitchSelect = byId("pitchSource", "pitchFeature");
    const gainSelect = byId("gainSource", "gainFeature", "levelSource");
    const panSelect = byId("panSource", "panFeature");
    const timbreSelect = byId("timbreSource", "timbreFeature");
    populateMappingSelect(pitchSelect, state.pitchSource, "pitch");
    populateMappingSelect(gainSelect, state.gainSource, "gain");
    populateMappingSelect(panSelect, state.panSource, "pan");
    populateMappingSelect(timbreSelect, state.timbreSource, "timbre");
    bindSelect([pitchSelect?.id].filter(Boolean), "pitchSource");
    bindSelect([gainSelect?.id].filter(Boolean), "gainSource");
    bindSelect([panSelect?.id].filter(Boolean), "panSource");
    bindSelect([timbreSelect?.id].filter(Boolean), "timbreSource");
    bindSelect(["soundMode"], "soundMode");
    const mappingDisclosure = root.querySelector(".mapping-disclosure");
    if (mappingDisclosure) {
      clear(mappingDisclosure);
      mappingDisclosure.append(element("b", "", "Mapping contract:"));
      mappingDisclosure.append(" raw → registry normalization → destination range. Circular sources wrap; unavailable pitch, level, or pan sources hold the voice silent, while unavailable timbre uses a visible neutral fallback.");
    }

    bindToggle(["autoRotate", "rotationToggle"], () => state.autoRotate, (value) => {
      state.autoRotate = value;
      if (!value && !state.playing) pool.silence();
    }, "Automatic rotation");
    for (const name of Object.keys(state.overlays)) {
      bindToggle([`overlay${name[0].toUpperCase()}${name.slice(1)}`, `${name}Overlay`],
        () => state.overlays[name], (value) => { state.overlays[name] = value; }, `${name} overlay`);
    }
    bindToggle(["showHull"], () => state.overlays.hull, (value) => { state.overlays.hull = value; }, "Hull overlay");
    bindToggle(["showIntervals"], () => state.overlays.intervals, (value) => { state.overlays.intervals = value; }, "Inside interval overlay");
    bindToggle(["showLabels"], () => state.overlays.labels, (value) => { state.overlays.labels = value; }, "Contact labels");
    bindToggle(["showNormals"], () => state.overlays.normal, (value) => {
      state.overlays.normal = value;
      state.overlays.tangent = value;
      state.overlays.radius = value;
    }, "Contact vectors");

    byId("clearContactPin")?.addEventListener("click", () => {
      pinnedContactId = null;
      announce("Returning to automatic contact selection.");
      invalidate();
    });

    const reverse = byId("directionButton", "reverseDirection");
    reverse?.addEventListener("click", () => {
      state.direction *= -1;
      reverse.dataset.direction = state.direction > 0 ? "forward" : "reverse";
      reverse.setAttribute("aria-label", `Reader direction: ${state.direction > 0 ? "forward" : "reverse"}`);
      announce(`Reader direction ${state.direction > 0 ? "forward" : "reverse"}.`);
      invalidate();
    });

    for (const tab of root.querySelectorAll('[role="tab"], [data-inspector-tab]')) {
      tab.addEventListener("click", () => {
        const group = tab.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]')
          ?? root.querySelectorAll("[data-inspector-tab]");
        group.forEach((item) => {
          const selected = item === tab;
          item.setAttribute("aria-selected", String(selected));
          item.classList.toggle("is-active", selected);
          item.tabIndex = selected ? 0 : -1;
        });
        for (const panel of root.querySelectorAll('[role="tabpanel"]')) {
          panel.hidden = panel.id !== tab.getAttribute("aria-controls");
        }
        invalidate();
      });
      tab.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        const tabs = [...(tab.closest('[role="tablist"]')?.querySelectorAll('[role="tab"]') ?? [])];
        if (!tabs.length) return;
        event.preventDefault();
        const current = tabs.indexOf(tab);
        const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1
          : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
        tabs[index].focus();
        tabs[index].click();
      });
    }

    canvas.tabIndex = canvas.tabIndex >= 0 ? canvas.tabIndex : 0;
    let stagePointerId = null;
    const stagePoint = (event) => {
      if (!latestFrame) return;
      const bounds = canvas.getBoundingClientRect();
      const x = (event.clientX - bounds.left) * cssWidth / Math.max(1, bounds.width);
      const y = (event.clientY - bounds.top) * cssHeight / Math.max(1, bounds.height);
      return { x, y, model: displayTransform().model(x, y) };
    };
    const scrubStage = (event) => {
      const pointer = stagePoint(event);
      if (!pointer || !latestFrame) return;
      const point = pointer.model;
      if (state.readerMode === "vertical") state.position = latestFrame.path.bounds.width > 0
        ? clamp((point.x - latestFrame.path.bounds.minX) / latestFrame.path.bounds.width, 0, 1) : 0.5;
      else if (state.readerMode === "horizontal") state.position = latestFrame.path.bounds.height > 0
        ? clamp((point.y - latestFrame.path.bounds.minY) / latestFrame.path.bounds.height, 0, 1) : 0.5;
      else if (state.readerMode === "ray") state.position = wrap01((Math.atan2(point.y, point.x) + Math.PI / 2) / TAU);
      else state.position = nearestPathProgress(latestFrame.path, point);
      state.continuousPosition = state.position;
      const position = byId("readerPhase", "position", "readerPosition");
      if (position) position.value = String(state.position);
      invalidate();
    };
    canvas.addEventListener("pointerdown", (event) => {
      if (!latestFrame) return;
      const pointer = stagePoint(event);
      if (!pointer) return;
      const { x, y } = pointer;
      const transform = displayTransform();
      const hit = latestFrame.contacts
        .map((contact) => ({ contact, distance: Math.hypot(x - transform.x(contact.x), y - transform.y(contact.y)) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (hit?.distance <= 18) {
        pinnedContactId = pinnedContactId === hit.contact.id ? null : hit.contact.id;
        announce(pinnedContactId ? "Contact pinned." : "Contact pin cleared.");
      } else {
        stagePointerId = event.pointerId;
        canvas.setPointerCapture?.(event.pointerId);
        scrubStage(event);
      }
      invalidate();
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerId === stagePointerId) scrubStage(event);
    });
    const endStageDrag = (event) => {
      if (event.pointerId !== stagePointerId) return;
      stagePointerId = null;
      announce(`Reader phase ${Math.round(state.position * 100)} percent.`);
    };
    canvas.addEventListener("pointerup", endStageDrag);
    canvas.addEventListener("pointercancel", endStageDrag);

    root.addEventListener("keydown", (event) => {
      if (!shouldHandleGlobalShortcut(event)) return;
      if (event.code === "Space") {
        event.preventDefault();
        play?.click();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.shiftKey ? 0.05 : 0.01;
        state.position = clamp(state.position + (event.key === "ArrowRight" ? step : -step), 0, 1);
        state.continuousPosition = state.position;
        invalidate();
      } else if (event.key.toLowerCase() === "r") {
        byId("autoRotate", "rotationToggle")?.click();
      } else if (event.key.toLowerCase() === "m") {
        audio?.click();
      }
    });
  }

  bindUi();
  if (typeof ResizeObserver === "function" && stageWrap) new ResizeObserver(resize).observe(stageWrap);
  else window.addEventListener("resize", resize);
  resize();
  requestAnimationFrame(frameLoop);

  return Object.freeze({
    get state() { return { ...state, overlays: { ...state.overlays } }; },
    get frame() { return latestFrame; },
    invalidate,
    destroy() { pool.close(); },
  });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => startWorkbench(), { once: true });
  } else {
    startWorkbench();
  }
}
