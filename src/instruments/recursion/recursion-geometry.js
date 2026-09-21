import { MOTION_CAPS } from "./recursion-motion.js";

const TAU = Math.PI * 2;
const DEFAULT_MAX_POINTS = 512;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function finite(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function logPosition(value, minimum, maximum) {
  const bounded = clamp(value, minimum, maximum);
  return clamp(
    Math.log(bounded / minimum) / Math.log(maximum / minimum),
  );
}

function perspectivePoint(x, y, z, {
  rotation = 0,
  tilt = -0.34,
  perspective = 3.2,
  alpha = 1,
} = {}) {
  const cosine = Math.cos(rotation);
  const sine = Math.sin(rotation);
  const rotatedX = x * cosine - z * sine;
  const rotatedZ = x * sine + z * cosine;
  const tiltCosine = Math.cos(tilt);
  const tiltSine = Math.sin(tilt);
  const rotatedY = y * tiltCosine - rotatedZ * tiltSine;
  const depth = y * tiltSine + rotatedZ * tiltCosine;
  const scale = perspective / Math.max(0.7, perspective - depth);
  return {
    x: rotatedX * scale,
    y: rotatedY * scale,
    z: depth,
    scale,
    alpha: clamp(alpha),
  };
}

/**
 * Convert the actual sounding pulse score into normalized audio coordinates.
 *
 * u: source/phrase time
 * v: logarithmic spectrum
 * w: output/rhythm time
 */
export function motionCoordinates(moment, {
  momentIndex = 0,
  maxDepth = Math.max(1, finite(moment?.depth, 1)),
} = {}) {
  const pulses = Array.isArray(moment?.motion?.pulses)
    ? moment.motion.pulses
    : [];
  const duration = Math.max(0.001, finite(moment?.duration, 1));
  const generation = Math.max(0, Math.round(finite(moment?.depth, 0)));
  const maximumPhrase = pulses.reduce(
    (maximum, pulse) => Math.max(maximum, Math.round(finite(pulse.phraseIndex, 0))),
    0,
  );
  const pitchExtent = Math.max(
    Math.abs(Math.log2(MOTION_CAPS.minPlaybackRate)),
    Math.abs(Math.log2(MOTION_CAPS.maxPlaybackRate)),
  );
  const events = Array.isArray(moment?.events) ? moment.events : [];
  const coupling = moment?.motion?.coupling ?? {};

  return pulses.map((pulse, pulseIndex) => {
    const u = clamp(pulse.sourcePosition);
    const v = logPosition(
      pulse.filterHz,
      MOTION_CAPS.minFilterHz,
      MOTION_CAPS.maxFilterHz,
    );
    const scoreTime = clamp(finite(pulse.offset) / duration);
    const w = clamp((finite(pulse.offset) + finite(pulse.delay)) / duration);
    const releaseTime = clamp(w + finite(pulse.duration) / duration);
    const startRate = clamp(
      pulse.playbackRate,
      MOTION_CAPS.minPlaybackRate,
      MOTION_CAPS.maxPlaybackRate,
    );
    const endRate = clamp(
      startRate * 2 ** (
        clamp(
          pulse.pitchEnd,
          -MOTION_CAPS.maxAbsPitchSemitones,
          MOTION_CAPS.maxAbsPitchSemitones,
        ) / 12
      ),
      MOTION_CAPS.minPlaybackRate,
      MOTION_CAPS.maxPlaybackRate,
    );
    const pitchAttack = clamp(
      Math.log2(startRate) / pitchExtent,
      -1,
      1,
    );
    const pitchRelease = clamp(
      Math.log2(endRate) / pitchExtent,
      -1,
      1,
    );
    const pitch = (pitchAttack + pitchRelease) * 0.5;
    const phrase = maximumPhrase
      ? clamp(finite(pulse.phraseIndex) / maximumPhrase)
      : u;
    const filterReleaseHz = clamp(
      pulse.filterHz * 2 ** (finite(pulse.pitchEnd) / 18),
      MOTION_CAPS.minFilterHz,
      MOTION_CAPS.maxFilterHz,
    );
    const spectrumRelease = logPosition(
      filterReleaseHz,
      MOTION_CAPS.minFilterHz,
      MOTION_CAPS.maxFilterHz,
    );
    const panRelease = clamp(
      -finite(pulse.pan) * 0.72
      + Math.sin((finite(pulse.phraseIndex) + 1) * 1.7) * 0.28,
      -1,
      1,
    );
    const routeIndex = Math.max(
      0,
      Math.round(finite(pulse.routeIndex, pulse.phraseIndex)),
    );
    const routedEvent = events.length ? events[routeIndex % events.length] : null;
    const path = Array.isArray(routedEvent?.path) ? routedEvent.path : [];
    let route = phrase;
    if (path.length) {
      let binary = 0;
      for (const branch of path) binary = binary * 2 + (Number(branch) ? 1 : 0);
      route = (binary + 0.5) / 2 ** path.length;
    }
    const occupancy = clamp(
      Math.sqrt(clamp(finite(pulse.duration) / duration)) * 3.1,
    );

    return {
      pulseIndex,
      generation,
      momentIndex,
      depth: clamp(generation / Math.max(1, maxDepth)),
      u,
      v,
      w,
      time: w,
      scoreTime,
      releaseTime,
      spectrum: v,
      spectrumRelease,
      pitch,
      pitchAttack,
      pitchRelease,
      rhythm: w,
      phrase,
      route: clamp(route),
      routeKind: path.length ? "branch" : "phrase",
      routePath: path.slice(),
      energy: occupancy,
      occupancy,
      pan: clamp(pulse.pan, -1, 1),
      panRelease,
      delay: clamp(finite(pulse.delay) / MOTION_CAPS.maxDelaySeconds),
      orientation: pulse.timeDirection < 0 ? -1 : 1,
      polarity: pulse.polarity < 0 ? -1 : 1,
      timeDirection: pulse.timeDirection < 0 ? -1 : 1,
      channelSwap: Boolean(pulse.channelSwap),
      filterHz: clamp(
        pulse.filterHz,
        MOTION_CAPS.minFilterHz,
        MOTION_CAPS.maxFilterHz,
      ),
      playbackRate: startRate,
      pitchEnd: clamp(
        pulse.pitchEnd,
        -MOTION_CAPS.maxAbsPitchSemitones,
        MOTION_CAPS.maxAbsPitchSemitones,
      ),
      duration: clamp(finite(pulse.duration) / duration),
      coupling: {
        timbreToPitch: clamp(coupling.timbreToPitch, -1, 1),
        pitchToRhythm: clamp(coupling.pitchToRhythm, -1, 1),
        rhythmToPhrase: clamp(coupling.rhythmToPhrase, -1, 1),
        phraseToTimbre: clamp(coupling.phraseToTimbre, -1, 1),
      },
      active: false,
      sounding: false,
    };
  });
}

export function torusPoint(coordinate, {
  rotation = 0,
  tilt = -0.34,
  twist = 0.5,
  perspective = 3.2,
} = {}) {
  const orientation = coordinate.orientation < 0 ? -1 : 1;
  const polarity = coordinate.polarity < 0 ? -1 : 1;
  const majorAngle = TAU * (coordinate.w + coordinate.depth * 0.035);
  const minorAngle = TAU * (
    coordinate.u * orientation
    + coordinate.v * 0.18
    + coordinate.pitch * 0.12
  );
  const majorRadius = 0.57 + coordinate.depth * 0.1
    + Math.sin(coordinate.pitch * Math.PI) * 0.035;
  const minorRadius = 0.1 + coordinate.energy * 0.11;
  const halfTurn = majorAngle * 0.5 * twist;
  const radial = majorRadius + minorRadius * (
    Math.cos(halfTurn) * Math.sin(minorAngle)
    - Math.sin(halfTurn) * Math.sin(2 * minorAngle)
  );
  const x = radial * Math.cos(majorAngle);
  const y = radial * Math.sin(majorAngle);
  const z = polarity * minorRadius * (
    Math.sin(halfTurn) * Math.sin(minorAngle)
    + Math.cos(halfTurn) * Math.sin(2 * minorAngle)
  ) + coordinate.pan * 0.07;
  return perspectivePoint(x, y, z, {
    rotation,
    tilt,
    perspective,
    alpha: 0.22 + coordinate.energy * 0.78,
  });
}

export function stackPoint(coordinate, {
  rotation = -0.12,
  tilt = -0.2,
  perspective = 4.2,
} = {}) {
  const layerPosition = Number.isFinite(coordinate.metaTime)
    ? coordinate.metaTime
    : coordinate.depth;
  const layer = layerPosition * 2 - 1;
  const x = (coordinate.w * 2 - 1) * 0.82
    + coordinate.depth * 0.12
    + coordinate.delay * 0.12;
  const y = (0.5 - coordinate.v) * 1.45
    + coordinate.pitch * 0.11;
  const z = layer * 0.52
    + (coordinate.phrase - 0.5) * 0.22
    + coordinate.pan * 0.06;
  return perspectivePoint(x, y, z, {
    rotation,
    tilt,
    perspective,
    alpha: 0.2 + coordinate.energy * 0.8,
  });
}

export function causalCurve(input, {
  segments = 14,
} = {}) {
  const coordinates = Array.isArray(input) ? input : [input];
  const count = Math.max(4, Math.min(15, Math.round(finite(segments, 14))));
  const points = [];
  for (const coordinate of coordinates) {
    const startY = 0.82 - coordinate.u * 1.64;
    const endY = 0.82 - coordinate.w * 1.64;
    const routeY = 0.82 - finite(coordinate.route, coordinate.phrase) * 1.64;
    const pitchBend = (
      coordinate.pitch * 0.46
      + coordinate.pan * 0.12
    ) * coordinate.orientation;
    const spectrumBend = (coordinate.v - 0.5) * 0.42
      + (finite(coordinate.spectrumRelease, coordinate.v) - coordinate.v) * 0.35;
    for (let index = 0; index <= count; index += 1) {
      const progress = index / count;
      const x = -0.92 + progress * 1.84;
      const firstHalf = progress <= 0.5;
      const local = firstHalf ? progress * 2 : (progress - 0.5) * 2;
      const fromY = firstHalf ? startY : routeY;
      const toY = firstHalf ? routeY : endY;
      const linearY = fromY + (toY - fromY) * local;
      const y = linearY
        + Math.sin(local * Math.PI) * (firstHalf ? pitchBend : spectrumBend)
        + Math.sin(progress * TAU + coordinate.phrase * TAU)
          * coordinate.delay * 0.05;
      const layerPosition = Number.isFinite(coordinate.metaTime)
        ? coordinate.metaTime
        : coordinate.depth;
      const z = (layerPosition - 0.5) * 0.72
        + Math.sin(progress * Math.PI) * (coordinate.phrase - 0.5) * 0.22;
      points.push({
        x,
        y,
        z,
        scale: 0.78 + coordinate.depth * 0.22,
        alpha: clamp((0.16 + coordinate.energy * 0.84) * (
          0.62 + Math.sin(progress * Math.PI) * 0.38
        )),
      });
    }
  }
  return points;
}

export function geometryTrace(moments, {
  maxPoints = DEFAULT_MAX_POINTS,
  activeMomentIndex = -1,
  progress = 0,
} = {}) {
  const entries = Array.isArray(moments) ? moments.filter(Boolean) : [];
  const maximumDepth = Math.max(
    1,
    ...entries.map((moment) => Math.max(0, Math.round(finite(moment.depth)))),
  );
  const selectedActiveIndex = activeMomentIndex >= 0
    ? Math.min(entries.length - 1, Math.round(activeMomentIndex))
    : entries.length - 1;
  const allPoints = entries.flatMap((moment, momentIndex) => (
    motionCoordinates(moment, {
      momentIndex,
      maxDepth: maximumDepth,
    }).map((coordinate) => ({
      ...coordinate,
      metaTime: entries.length > 1 ? momentIndex / (entries.length - 1) : 0,
      active: progress > 0
        && momentIndex === selectedActiveIndex
        && coordinate.w <= clamp(progress) + 1e-9,
      sounding: progress > 0
        && momentIndex === selectedActiveIndex
        && coordinate.w <= clamp(progress) + 1e-9
        && coordinate.releaseTime >= clamp(progress) - 1e-9,
    }))
  ));
  const totalPoints = allPoints.length;
  const pointLimit = Math.max(1, Math.min(1_024, Math.round(finite(
    maxPoints,
    DEFAULT_MAX_POINTS,
  ))));
  const points = totalPoints <= pointLimit
    ? allPoints
    : Array.from(
      { length: pointLimit },
      (_, index) => allPoints[Math.floor(index * totalPoints / pointLimit)],
    );
  const edges = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (previous.momentIndex === current.momentIndex) {
      edges.push({
        from: index - 1,
        to: index,
        orientation: current.orientation,
        active: previous.active || current.active,
      });
    }
  }

  return {
    points,
    edges,
    totalPoints,
    truncated: totalPoints > points.length,
    maxDepth: maximumDepth,
  };
}
