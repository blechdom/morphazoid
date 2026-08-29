import { buildShapesScene } from "./shapes-scene.js";
import {
  shapes2dHeadCount,
  shapes2dHeadDirection,
  shapes2dHeadOffset,
  shapes2dHeadTravel,
  shapesDivisionCount,
  shapesEventRegionKeys,
} from "./shapes-state.js";

const INTEGER_EPSILON = 1e-10;
const PINGPONG_ENDPOINT_EPSILON = 1e-9;

function finite(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function topologyNumber(value) {
  return finite(value).toFixed(12);
}

function twoDimensionalHeadTopology(state, local) {
  const count = shapes2dHeadCount(state);
  const values = [
    `heads=${count}`,
    `offsets=${Array.from({ length: count }, (_, index) => (
      topologyNumber(shapes2dHeadOffset(state, index))
    )).join(",")}`,
  ];
  if (local.reader === "line") {
    values.push(`axes=${Array.from({ length: count }, (_, index) => (
      local.scanLineAxes?.[index] === "horizontal" ? "h" : "v"
    )).join("")}`);
  } else {
    const directions = local.reader === "radar"
      ? local.radialHeadDirections
      : local.traceHeadDirections;
    const adjustments = local.reader === "radar"
      ? local.radialHeadDirectionAdjustments
      : local.traceHeadDirectionAdjustments;
    values.push(`directions=${Array.from({ length: count }, (_, index) => (
      Number(directions?.[index]) < 0 ? -1 : 1
    )).join(",")}`);
    values.push(`adjustments=${Array.from({ length: count }, (_, index) => (
      topologyNumber(adjustments?.[index])
    )).join(",")}`);
  }
  return values;
}

function topologyKey(state) {
  const dimension = state?.selection?.dimension;
  const local = state?.dimension?.[dimension] ?? {};
  const values = [
    dimension,
    state?.selection?.playingMode,
    state?.play?.motion,
    shapesDivisionCount(state),
    state?.profile?.sides,
    state?.profile?.kind,
    dimension === "2d" ? local.reader : local.representation,
  ];
  if (dimension === "2d") values.push(...twoDimensionalHeadTopology(state, local));
  return values.join(":");
}

function contactRegionKey(contact, index) {
  return contact?.eventKey ?? contact?.voiceKey ?? `contact:${index}`;
}

function sceneWithContacts(scene, keys) {
  const wanted = new Set(keys);
  return {
    ...scene,
    contacts: scene.contacts.filter((contact, index) => (
      wanted.has(contactRegionKey(contact, index))
    )),
  };
}

function twoDimensionalHeadSamples(state, scene) {
  if (state?.selection?.dimension !== "2d" || !Array.isArray(scene?.readers)) return Object.freeze([]);
  const reader = state?.dimension?.["2d"]?.reader;
  return Object.freeze(scene.readers.map((head, fallbackIndex) => {
    const headIndex = Number.isInteger(head?.headIndex) ? head.headIndex : fallbackIndex;
    const contacts = Array.isArray(head?.contacts)
      ? head.contacts
      : scene.contacts.filter((contact) => contact?.headIndex === headIndex);
    return Object.freeze({
      headIndex,
      // The scene may use a one-sided endpoint sample for stable contact
      // identity. Keep the exact unwrapped transport here for root timing.
      travel: shapes2dHeadTravel(state, headIndex, reader),
      regionKeys: Object.freeze(contacts.map(contactRegionKey).sort()),
    });
  }));
}

function stablePingPongEndpointHeads(state) {
  if (
    state?.selection?.dimension !== "2d"
    || state?.play?.motion !== "pingpong"
    || Number(state?.profile?.sides) === 2
  ) return [];
  const reader = state.dimension["2d"].reader;
  return Array.from({ length: shapes2dHeadCount(state) }, (_, headIndex) => {
    const travel = shapes2dHeadTravel(state, headIndex, reader);
    const integer = Math.round(travel);
    if (
      Math.abs(travel - integer) > INTEGER_EPSILON
      || Math.abs(integer % 2) !== 1
    ) return null;
    return {
      headIndex,
      direction: shapes2dHeadDirection(state, headIndex, reader),
    };
  }).filter(Boolean);
}

/**
 * A closed 2D path wraps phase 1 back to phase 0. In ping-pong mode, however,
 * an odd integer is a turnaround, not a loop seam. Replace only heads that are
 * exactly at a turn with their one-sided limit, including offset/reversed
 * heads, so landing on a turn cannot manufacture a duplicate next interval.
 */
function buildStableRhythmScene(state) {
  const scene = buildShapesScene(state);
  const endpointHeads = stablePingPongEndpointHeads(state);
  if (!endpointHeads.length || !Array.isArray(scene.readers)) return scene;

  const alternateScenes = new Map();
  for (const { direction } of endpointHeads) {
    if (alternateScenes.has(direction)) continue;
    alternateScenes.set(direction, buildShapesScene({
      ...state,
      play: {
        ...state.play,
        continuousPhase: finite(state.play.continuousPhase)
          - PINGPONG_ENDPOINT_EPSILON / direction,
      },
    }));
  }
  const endpointDirections = new Map(endpointHeads.map(({ headIndex, direction }) => (
    [headIndex, direction]
  )));
  const readers = scene.readers.map((head, headIndex) => {
    const direction = endpointDirections.get(headIndex);
    return direction === undefined
      ? head
      : alternateScenes.get(direction)?.readers?.[headIndex] ?? head;
  });
  return {
    ...scene,
    contacts: readers.flatMap((head) => head.contacts ?? []),
    reader: readers[0],
    readers,
  };
}

function firstIntegerCrossing(from, to) {
  if (to > from) {
    const integer = Math.floor(from + INTEGER_EPSILON) + 1;
    if (integer <= to + INTEGER_EPSILON) {
      return { integer, time01: Math.min(1, Math.max(0, (integer - from) / (to - from))) };
    }
  } else if (to < from) {
    const integer = Math.ceil(from - INTEGER_EPSILON) - 1;
    if (integer >= to - INTEGER_EPSILON) {
      return { integer, time01: Math.min(1, Math.max(0, (integer - from) / (to - from))) };
    }
  }
  return null;
}

/**
 * Build one bounded rhythm sample for a caller-owned, fixed AudioContext-time
 * grid. A sample owns its region-key array and scalar transport metadata; it
 * never retains mutable state objects from the caller.
 */
export function createShapesRhythmSample(state) {
  const phase = finite(state?.play?.continuousPhase);
  const scene = buildStableRhythmScene(state);
  return {
    topologyKey: topologyKey(state),
    phase,
    motion: state?.play?.motion === "pingpong" ? "pingpong" : "loop",
    regionKeys: Object.freeze(shapesEventRegionKeys(scene)),
    headSamples: twoDimensionalHeadSamples(state, scene),
    scene,
  };
}

/**
 * Compare exactly one pair of adjacent fixed-grid samples. Work is bounded to
 * one new scene build in ordinary samples (plus at most two one-sided builds
 * on an exact multihead ping-pong turn), one comparison, and one grouped event.
 *
 * `time01` is 1 for ordinary endpoint-observed entries. A loop/ping-pong seam
 * has an exact phase root, so its fractional time is returned without search.
 * The fixed grid must be dense enough that at most one distinct entry instant
 * can occur per interval; simultaneous visible contacts are grouped together.
 */
export function advanceShapesRhythmSample(previousSample, currentState) {
  const sample = createShapesRhythmSample(currentState);
  if (
    !previousSample
    || previousSample.topologyKey !== sample.topologyKey
    || !Array.isArray(previousSample.regionKeys)
  ) {
    return { sample, event: null };
  }

  const previousKeys = new Set(previousSample.regionKeys);
  let enteredKeys = sample.regionKeys.filter((key) => !previousKeys.has(key));
  let seam = null;
  const usesHeadSeams = sample.headSamples.length && Array.isArray(previousSample.headSamples);

  if (usesHeadSeams) {
    const previousHeads = new Map(previousSample.headSamples.map((head) => [head.headIndex, head]));
    for (const head of sample.headSamples) {
      const previousHead = previousHeads.get(head.headIndex);
      if (!previousHead) continue;
      const crossing = firstIntegerCrossing(
        finite(previousHead.travel),
        finite(head.travel),
      );
      if (!crossing) continue;
      if (!seam || crossing.time01 < seam.time01) seam = crossing;

      const previousHeadKeys = new Set(previousHead.regionKeys);
      const headEntered = head.regionKeys.some((key) => !previousHeadKeys.has(key));
      if (!headEntered && head.regionKeys.length) enteredKeys.push(...head.regionKeys);
    }
  } else {
    seam = firstIntegerCrossing(
      finite(previousSample.phase),
      sample.phase,
    );
  }

  // A one-region circle and a ping-pong turnaround can leave the exact visible
  // key unchanged. The integer phase crossing is nevertheless one physical
  // re-entry and must be emitted once.
  if (!usesHeadSeams && seam && !enteredKeys.length && sample.regionKeys.length) {
    enteredKeys = [...sample.regionKeys];
  }
  enteredKeys = [...new Set(enteredKeys)].sort();
  if (!enteredKeys.length) return { sample, event: null };

  const scene = sceneWithContacts(sample.scene, enteredKeys);
  if (!scene.contacts.length) return { sample, event: null };
  return {
    sample,
    event: {
      scene,
      time01: seam?.time01 ?? 1,
      enteredKeys,
    },
  };
}
