import { traceLSystem, allocateIterationVoiceHeads } from "../l-system/l-system.js";
import { generationTopology, generationVoiceSpecs } from "../micmic/micmic.js";

function unit(key) {
  let hash = 2166136261;
  for (const character of String(key)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function branchDecayGain(depth, decay = 1) {
  return Math.max(0, Math.min(1, decay)) ** Math.max(0, Number(depth) || 0);
}

export function generationOptions(state) {
  return {
    lSystemType: state.presetId,
    generations: state.iterations,
    branching: 1,
    mutation: state.mutation,
    timeRatio: state.childTimeRatio,
    angle: state.angle,
    asymmetry: state.turnAsymmetry,
    depth: state.branchDecay,
    pruningBias: state.pruningBias,
    interval: state.mic.intervalMs,
    pitchScale: state.mic.pitchScale,
    spread: state.mic.spread,
  };
}

export function micGenerationVoices(state, limit = 128) {
  return generationVoiceSpecs({ ...generationOptions(state), maximumVoices: limit });
}

/** Recompute the original traversal contract after inherited timing/geometry
 * changes: connected branches, subtree durations, power shares and voice keys. */
function finishTrace(segments, instructions = "", iteration = 1) {
  const rootIndices = [], generations = [];
  const bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  for (const segment of segments) {
    if (segment.parentIndex === null) rootIndices.push(segment.index);
    (generations[segment.generation] ??= []).push(segment);
    for (const point of [segment.start, segment.end]) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
    segment.subtreeEndDistance = segment.endDistance;
  }
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    for (const child of segment.children) {
      segment.subtreeEndDistance = Math.max(segment.subtreeEndDistance, segments[child].subtreeEndDistance);
    }
  }
  for (const index of rootIndices) {
    segments[index].powerShare = 1 / rootIndices.length;
    segments[index].voiceKey = `root:${index}`;
  }
  for (const segment of segments) {
    for (const [ordinal, index] of segment.children.entries()) {
      const child = segments[index];
      child.powerShare = segment.powerShare / segment.children.length;
      child.forkDepth = segment.forkDepth + (segment.children.length > 1 ? 1 : 0);
      child.voiceKey = ordinal ? `${segment.voiceKey}/branch:${index}` : segment.voiceKey;
    }
  }
  return {
    segments, instructions, rootIndices, generations, bounds, iteration,
    maxGeneration: generations.length - 1,
    maxForkDepth: segments.reduce((maximum, segment) => Math.max(maximum, segment.forkDepth), 0),
    duration: rootIndices.reduce((maximum, index) => Math.max(maximum, segments[index].subtreeEndDistance), 1e-9),
  };
}

export function lSystemsTrace(grammar, iteration, state) {
  if (state.geometryModel === "generations") {
    const nodes = generationTopology({ ...generationOptions(state), generations: Math.max(1, iteration) });
    const indices = new Map(nodes.map((node, index) => [node.id, index]));
    const segments = nodes.map((node, index) => ({
      start: { x: node.startX, y: node.startY }, end: { x: node.x, y: node.y },
      index, instructionIndex: index, parentIndex: indices.get(node.parentId) ?? null,
      children: [], generation: node.generation, depth: node.generation,
      forkDepth: 0, powerShare: 1,
      heading: node.headingDegrees * Math.PI / 180,
      turn: node.turnDegrees * Math.PI / 180,
      turnTotal: node.headingDegrees * Math.PI / 180,
      cumulativeTurn: node.headingDegrees * Math.PI / 180,
      startDistance: 0, endDistance: 0,
    }));
    for (const segment of segments) {
      const parent = segments[segment.parentIndex];
      if (parent) parent.children.push(segment.index);
      segment.startDistance = parent?.endDistance ?? 0;
      const node = nodes[segment.index];
      segment.endDistance = segment.startDistance + Math.max(1e-6, node.timeScale ?? node.length);
    }
    return finishTrace(segments, "", iteration);
  }

  const trace = traceLSystem({ ...grammar, angle: state.angle, lengthScale: state.lengthScale, turnAsymmetry: state.turnAsymmetry, iterations: iteration });
  if (!state.mutation && state.childTimeRatio === 1) return { ...trace, iteration };
  const segments = trace.segments.map(segment => ({ ...segment, children: [...segment.children], start: { ...segment.start }, end: { ...segment.end } }));
  for (const segment of segments) {
    const original = trace.segments[segment.index];
    const parent = segments[segment.parentIndex], oldParent = trace.segments[segment.parentIndex];
    const inherited = parent ? parent.heading - oldParent.heading : 0;
    const perturbation = (unit(`${grammar.id}:${segment.instructionIndex}`) - .5) * state.mutation * Math.PI * .65;
    const turn = inherited + perturbation, cos = Math.cos(turn), sin = Math.sin(turn);
    const dx = original.end.x - original.start.x, dy = original.end.y - original.start.y;
    if (parent) {
      segment.start.x = parent.end.x + original.start.x - oldParent.end.x;
      segment.start.y = parent.end.y + original.start.y - oldParent.end.y;
    }
    segment.end = { x: segment.start.x + dx * cos - dy * sin, y: segment.start.y + dx * sin + dy * cos };
    segment.heading += turn;
    segment.cumulativeTurn += turn;
    segment.turnTotal += turn;
    const depth = trace.maxForkDepth ? segment.forkDepth : 4 * segment.generation / Math.max(1, trace.maxGeneration);
    const weight = state.childTimeRatio ** depth;
    segment.startDistance = (parent?.endDistance ?? 0) + (original.startDistance - (oldParent?.endDistance ?? 0)) * weight;
    segment.endDistance = segment.startDistance + (original.endDistance - original.startDistance) * weight;
  }
  return finishTrace(segments, trace.instructions, iteration);
}

export function allocateLSystemsHeads(heads, limit, pruningBias = 0) {
  if (!pruningBias || heads.length <= limit) return allocateIterationVoiceHeads(heads, limit);
  return [...heads]
    .sort((a, b) => -pruningBias * (a.depth - b.depth) || unit(a.voiceKey) - unit(b.voiceKey))
    .slice(0, limit);
}
