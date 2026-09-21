import { createShapeSoundModel } from "../../families/geometry-presets/shape-sound.js";
import { geometryContactVoice, geometryViewPoint } from "../../families/geometry-presets/geometry-sound.js";
import { originalShapeState, captureOriginalParameters } from "./parameter-bridge.js";
import { clamp, cornerStrikePeak, cornerAttackSeconds, cornerDecaySeconds, pitch01ToFrequency, mirroredAmplitudeEnvelopePhase, sampleAmplitudeEnvelope, reduceVoiceContacts } from "../../audio.js";
import { crossesPeriodicTarget, crossesPingPongTarget } from "../../articulation.js";
import { wrap01, pointAtPath } from "../../geometry.js";
import { crossedHyperplaneVertex } from "../../hyper.js";
import { shapes2dHeadTravel, shapesDivisionCount } from "../../shapes-state.js";

export function sampleGeometryEnvelope(envelope, phase, peak) {
  const raw = clamp(phase, 0, 1);
  const amount = envelope.enabled && raw === 0 ? 0.0001 : raw;
  if (!envelope.enabled) return peak * envelope.level;
  return peak * envelope.level * sampleAmplitudeEnvelope(envelope.swell ? mirroredAmplitudeEnvelopePhase(amount, envelope.points[1]?.x ?? 0) : amount, envelope.points);
}

export function originalSynthSpecs(scene, state, baseHz = state.voice.baseHz) {
  if (scene.dimension === "2d") {
    const p = originalShapeState(state);
    p.baseFrequency = baseHz;
    return createShapeSoundModel(p).continuousSynthVoices(scene.contacts, scene.geometry);
  }
  const kind = scene.dimension === "3d" ? "solid" : "hyper";
  const p = captureOriginalParameters(state, kind).parameters;
  p.baseFrequency = baseHz;
  const limit = Math.min(scene.dimension === "4d" ? 20 : 32, state.voice.voiceLimit);
  const contacts = scene.dimension === "4d" && scene.contacts.length > limit
    ? Array.from({ length: limit }, (_, index) => scene.contacts[Math.floor(index * scene.contacts.length / limit)])
    : scene.contacts;
  return reduceVoiceContacts(contacts.map((contact, index) => {
    const voice = geometryContactVoice(kind, contact, index, p, (phase, peak) => sampleGeometryEnvelope(state.synthesis.envelope, phase, peak));
    return { ...voice, pan: voice.pan * state.voice.spread };
  }), limit);
}

function vertexPhase(scene, vertex, axis) {
  if (axis === "path" && Number.isFinite(vertex.pathPhase)) return vertex.pathPhase;
  if (axis === "path") return scene.geometry.closed
    ? scene.geometry.vertexDistances[vertex.index] / Math.max(scene.geometry.totalLength, 1e-9)
    : vertex.index === 0 ? 0 : 1;
  if (axis === "radial") return wrap01(Math.atan2(vertex.y, vertex.x) / (Math.PI * 2) + 0.25);
  const horizontal = axis === "horizontal", bounds = scene.geometry.bounds;
  const span = horizontal ? bounds.height : bounds.width;
  if (span <= 1e-9) return null;
  return clamp(((horizontal ? vertex.y : vertex.x) - (horizontal ? bounds.minY : bounds.minX)) / span, 0, 1);
}

export function originalCornerSample(state, scene) {
  const two = scene.dimension === "2d";
  const divisions = shapesDivisionCount(state);
  let vertices = two ? scene.geometry.vertexIndices.map((pointIndex, index) => ({
    ...scene.geometry.points[pointIndex], index,
    strength: scene.geometry.cornerStrengths[index], turn: scene.geometry.cornerTurns[index],
  })) : [...scene.geometry.vertices];
  if (two && scene.geometry.shapeType === "circle") {
    vertices = Array.from({ length: divisions }, (_, index) => ({
      ...pointAtPath(scene.geometry, index / divisions), index, pathPhase: index / divisions, strength: 0.5, turn: 0,
    }));
  } else if (two && divisions > 1) {
    const path = scene.geometry, sides = path.closed ? vertices.length : vertices.length - 1;
    for (let edge = 0; edge < sides; edge++) {
      const start = path.vertexDistances[edge], end = path.vertexDistances[edge + 1] ?? path.totalLength;
      for (let part = 1; part < divisions; part++) {
        const phase = (start + (end - start) * part / divisions) / path.totalLength;
        vertices.push({
          ...pointAtPath(path, phase, { pingPong: false }), index: vertices.length,
          pathPhase: phase, strength: (path.cornerStrengths[edge] + (path.cornerStrengths[(edge + 1) % path.cornerStrengths.length] ?? 0)) * 0.5,
          turn: 0,
        });
      }
    }
  } else if (!two && divisions > 1) {
    for (const [edgeIndex, edge] of scene.geometry.edges.entries()) {
      const a = scene.geometry.vertices[edge.a], b = scene.geometry.vertices[edge.b];
      for (let part = 1; part < divisions; part++) {
        const t = part / divisions;
        vertices.push({ ...Object.fromEntries(["x", "y", "z", ...(scene.dimension === "4d" ? ["w"] : [])].map(axis => [axis, a[axis] + (b[axis] - a[axis]) * t])), edgeIndex, t });
      }
    }
  }
  return {
    scene,
    phase: state.play.continuousPhase,
    heads: two ? scene.readers.map((reader, index) => ({
      axis: reader.type === "points" ? "path" : reader.type === "radar" ? "radial" : reader.axis,
      travel: shapes2dHeadTravel(state, index),
    })) : [],
    vertices,
  };
}

/** Original corner/vertex crossings, sampled ahead on Shapes' audio clock. */
export function originalCornerIntents(before, after, state) {
  if (!before || before.scene.dimension !== after.scene.dimension || before.vertices.length !== after.vertices.length) return [];
  const scene = after.scene, intents = [];
  if (scene.dimension === "2d") {
    const p = originalShapeState(state), sound = createShapeSoundModel(p);
    after.heads.forEach((head, headIndex) => {
      const oldHead = before.heads[headIndex];
      if (!oldHead || head.axis !== oldHead.axis) return;
      after.vertices.forEach((vertex, index) => {
        const oldTarget = vertexPhase(before.scene, before.vertices[index], head.axis);
        const target = vertexPhase(scene, vertex, head.axis);
        if (target === null || oldTarget === null || (vertex.strength <= 0 && state.voice.engine === "percussion")) return;
        const crosses = state.play.motion === "pingpong" ? crossesPingPongTarget : crossesPeriodicTarget;
        let crossed = crosses(oldHead.travel, head.travel, oldTarget, target);
        if (!crossed && state.play.motion === "pingpong" && (head.axis === "radial" || (head.axis === "path" && scene.geometry.closed))
          && (oldTarget < 1e-6 || oldTarget > 1 - 1e-6 || target < 1e-6 || target > 1 - 1e-6)) {
          crossed = crosses(oldHead.travel, head.travel, oldTarget < 0.5 ? oldTarget + 1 : oldTarget, target < 0.5 ? target + 1 : target);
        }
        if (!crossed) return;
        const contact = { ...vertex, vertexIndex: index, cornerStrength: vertex.strength, cornerTurn: vertex.turn,
          headIndex, headTravel: head.travel, pathPhase: vertexPhase(scene, vertex, "path"),
          scanAxis: head.axis === "path" ? undefined : head.axis };
        const mapping = sound.mappingForContact(contact, scene.geometry, headIndex);
        intents.push({
          contact,
          spec: { key: `corner:${p.playMethod}:${headIndex}:${index}`, frequency: sound.synthFrequencyForMapping(mapping),
            gain: cornerStrikePeak(sound.percussionLevelValue(contact, scene.geometry, headIndex), p.percussionStrikeLevel), pan: mapping.pan, waveform: "sine" },
          envelope: { envelopePoints: p.percussionEnvelopePoints, attackNoise: p.percussionAttackNoise, attackCurve: "smooth", retriggerMode: "crossfade" },
        });
      });
    });
  } else {
    const hyper = scene.dimension === "4d";
    const signAt = (sample, vertex) => hyper ? vertex.w - sample.scene.offset
      : sample.scene.plane.normal.x * vertex.x + sample.scene.plane.normal.y * vertex.y + sample.scene.plane.normal.z * vertex.z - sample.scene.plane.offset;
    // Don't mistake a W scan wrapping to its entry face for every vertex being struck.
    const looped = hyper && Math.floor(before.phase) !== Math.floor(after.phase);
    const entry = looped ? (state.play.direction > 0 ? Math.min : Math.max)(...after.vertices.map(v => v.w)) : null;
    after.vertices.forEach((vertex, index) => {
      const oldSign = looped ? vertex.w - entry : signAt(before, before.vertices[index]), sign = signAt(after, vertex);
      if (hyper ? !crossedHyperplaneVertex(oldSign, sign) : oldSign * sign > 0) return;
      const view = hyper ? geometryViewPoint(vertex) : vertex;
      intents.push({
        contact: vertex,
        spec: { key: `${hyper ? "hyper:corner" : "solid:vertex"}:${index}`,
          frequency: pitch01ToFrequency(clamp(hyper ? (view.y + 1.2) / 2.4 : (vertex.y + 1) * 0.5, 0, 1), state.voice.baseHz, state.voice.rangeOctaves),
          gain: hyper ? 0.34 : 0.42, pan: clamp(view.x, -1, 1), waveform: "sine" },
        envelope: { attackSeconds: cornerAttackSeconds(state.synthesis.percussionAttack), decaySeconds: cornerDecaySeconds(state.synthesis.percussionDecay) },
      });
    });
    if (hyper && intents.length > 16) return Array.from({ length: 16 }, (_, index) => intents[Math.floor(index * intents.length / 16)]);
  }
  return intents;
}

/** A pitched note uses the same geometry/timbre mapping, with a time ADSR. */
export function noteSpecForContact(contact, scene, state, baseHz = state.voice.baseHz) {
  if (scene.dimension === "2d") {
    const p = originalShapeState(state); p.baseFrequency = baseHz;
    const sound = createShapeSoundModel(p), mapping = sound.mappingForContact(contact, scene.geometry);
    return {
      key: `note-contact:${contact.headIndex ?? 0}:${contact.vertexIndex ?? contact.index ?? 0}`,
      frequency: sound.synthFrequencyForMapping(mapping), gain: 0.3, pan: mapping.pan, waveform: "sine",
      ...sound.synthParametersForContact(contact, scene.geometry),
    };
  }
  const kind = scene.dimension === "3d" ? "solid" : "hyper";
  const p = captureOriginalParameters(state, kind).parameters; p.baseFrequency = baseHz;
  return geometryContactVoice(kind, contact, contact.edgeIndex ?? 0, p, () => 0.3);
}
