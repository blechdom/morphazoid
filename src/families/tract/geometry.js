/**
 * Pure geometry shared by the two tract instruments. No DOM, audio, cached
 * selection, smoothing, or state ownership lives here. Page wrappers supply
 * current state/viewport values and their existing articulation callbacks.
 */
import {
  alienTongueDeformations,
  applyTractHeightDeformations,
  clamp,
  mouthOrganRoutes,
  roundedAirwayPath,
  sampleDiameterProfile,
  tongueTractCoordinates,
} from "./throatazoid.js";

export function interpolatePoint(points, progress) {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const segmentProgress = clamp(progress) * (points.length - 1);
  const segment = Math.min(points.length - 2, Math.floor(segmentProgress));
  const local = segmentProgress - segment;
  const from = points[segment];
  const to = points[segment + 1];
  return {
    x: from.x + (to.x - from.x) * local,
    y: from.y + (to.y - from.y) * local,
  };
}

export function tractPoint(geometry, progress, diameter = 0) {
  const normalized = clamp(progress);
  const distance = normalized * geometry.pathLength;
  let segmentIndex = geometry.segments.length - 1;
  for (let index = 0; index < geometry.segments.length; index += 1) {
    if (distance <= geometry.segments[index].end) {
      segmentIndex = index;
      break;
    }
  }
  const segment = geometry.segments[segmentIndex];
  const local = clamp((distance - segment.start) / Math.max(0.0001, segment.length));
  const center = {
    x: segment.from.x + (segment.to.x - segment.from.x) * local,
    y: segment.from.y + (segment.to.y - segment.from.y) * local,
  };
  const angle = Math.atan2(
    segment.to.y - segment.from.y,
    segment.to.x - segment.from.x,
  );
  const normal = {
    x: Math.sin(angle),
    y: -Math.cos(angle),
  };
  const offset = geometry.scale * diameter;
  return {
    x: center.x + normal.x * offset,
    y: center.y + normal.y * offset,
    angle,
    normal,
    progress: normalized,
  };
}

export function buildTractDiameterProfile(performance, {
  selectedThroat,
  currentArticulationIndex,
}) {
  const diameters = new Float32Array(44);
  const classicTopology = Boolean(performance.classicTopology);
  const bodyLength = clamp(performance.bodyLength);
  const tension = clamp(performance.tension);
  const mutation = clamp(performance.mutation);
  const mouth = performance.throats[selectedThroat] ?? performance.throats[0] ?? {
    aperture: 0.5,
    length: 0.5,
  };
  const mouthLength = clamp(mouth.length);
  const mouthAperture = clamp(mouth.aperture);
  const mouthScale = classicTopology
    ? 1 + (bodyLength - 0.55) * 0.13 + (mouthLength - 0.56) * 0.08
    : 0.92 + bodyLength * 0.13 + mouthLength * 0.08;
  for (let index = 0; index < diameters.length; index += 1) {
    if (index < 8) {
      const base = classicTopology
        ? index < 7 ? 0.6 : 1.1
        : index < 6 ? 0.58 : 1.08;
      const geometryScale = classicTopology
        ? 1 + (bodyLength - 0.55) * 0.12
        : 0.92 + bodyLength * 0.12;
      const tensionWarp = classicTopology
        ? (tension - 0.56) * 0.06
        : tension * 0.06;
      diameters[index] = base
        * geometryScale
        * (1 + Math.sin(index / 7 * Math.PI) * tensionWarp);
      continue;
    }
    const base = index < 12
      ? classicTopology ? 1.1 : 1.08
      : 1.5;
    const lipProgress = clamp((index - 35) / 8);
    const individualWarp = 1 + Math.sin(
      (selectedThroat + 1) * 1.93 + index * 0.31,
    ) * mutation * 0.025;
    diameters[index] = base
      * mouthScale
      * individualWarp
      * (1 - lipProgress * (1 - mouthAperture) * 0.68);
  }

  for (
    let tongueNumber = 0;
    tongueNumber < performance.tongueCount;
    tongueNumber += 1
  ) {
    const tongue = performance.tongues[tongueNumber]
      ?? performance.tongues[0]
      ?? { position: 0.38, height: 0.18 };
    const tongueIndex = 12.9 + clamp(tongue.position) * 17.5;
    const tongueDiameter = 3.5 - clamp(tongue.height) * 1.45;
    for (let index = 10; index < 39; index += 1) {
      const interpolation = (tongueIndex - index) / 22;
      const angle = 1.1 * Math.PI * interpolation;
      const normalizedDiameter = 2 + (tongueDiameter - 2) / 1.5;
      let curve = (1.5 - normalizedDiameter + 1.7) * Math.cos(angle);
      if (index === 38) curve *= 0.8;
      if (index === 10 || index === 37) curve *= 0.94;
      const individualWarp = 1 + Math.sin(
        (selectedThroat + 1) * 1.93 + index * 0.31,
      ) * mutation * 0.025;
      const tongueShape = Math.max(
        0.001,
        (1.5 - curve)
          * mouthScale
          * individualWarp
          * (1 - clamp((index - 35) / 8) * (1 - mouthAperture) * 0.68),
      );
      diameters[index] = tongueNumber === 0
        ? tongueShape
        : Math.min(diameters[index], tongueShape);
    }
  }

  diameters.set(applyTractHeightDeformations(
    diameters,
    alienTongueDeformations(performance),
  ));

  const requestedLipDiameter = Number(performance.lipDiameter);
  const lipDiameter = Number.isFinite(requestedLipDiameter)
    ? clamp(requestedLipDiameter, 0.35, 3)
    : 3;
  if (lipDiameter < 2.5) {
    for (let index = 37; index < diameters.length; index += 1) {
      const distance = Math.abs(index - 41);
      const blend = distance >= 4
        ? 0
        : 0.5 * (1 + Math.cos(Math.PI * distance / 4));
      diameters[index] = Math.min(
        diameters[index],
        diameters[index] + (lipDiameter - diameters[index]) * blend,
      );
    }
  }

  const aperture = clamp(performance.articulationAperture);
  if (aperture < 0.92) {
    const center = currentArticulationIndex(performance);
    const target = Math.max(0, aperture * 1.38 - 0.035);
    const radius = center < 25
      ? 10
      : center >= 32
        ? 5
        : 10 - 5 * (center - 25) / 7;
    for (
      let index = Math.max(1, Math.floor(center - radius - 1));
      index <= Math.min(43, Math.ceil(center + radius + 1));
      index += 1
    ) {
      const offset = Math.max(0, Math.abs(index - center) - 0.5);
      const scalar = offset >= radius
        ? 1
        : 0.5 * (1 - Math.cos(Math.PI * offset / radius));
      const difference = diameters[index] - target;
      if (difference > 0) diameters[index] = Math.max(0, target + difference * scalar);
    }
  }
  return diameters;
}

export function buildTractGeometry(performance, diameterProfile, {
  cssWidth,
  cssHeight,
  selectedThroat,
  currentArticulationIndex,
  perceptualNoseOpening,
  tractDiameterProfile,
}) {
  const compact = cssWidth < 680 || cssHeight < 360;
  const count = Math.max(1, performance.throatCount);
  const slots = Array.from(
    { length: count },
    (_, index) => count <= 1 ? 0 : index / (count - 1) * 2 - 1,
  );
  const routes = mouthOrganRoutes(performance);
  const selectedSlot = slots[selectedThroat] ?? 0;
  const centerY = cssHeight * (compact ? 0.55 : 0.53);
  const sourceHub = {
    x: cssWidth * (compact ? 0.16 : 0.145),
    y: centerY,
  };
  const manifold = {
    x: cssWidth * (compact ? 0.34 : 0.32),
    y: centerY,
  };
  const segmentize = (points) => {
    const segments = [];
    let length = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      const segmentLength = Math.max(0.0001, Math.hypot(to.x - from.x, to.y - from.y));
      segments.push({
        from,
        to,
        length: segmentLength,
        start: length,
        end: length + segmentLength,
      });
      length += segmentLength;
    }
    return { segments, length };
  };
  const mouthGeometries = slots.map((slot, index) => {
    const end = {
      x: cssWidth * (0.79 + clamp(performance.throats[index]?.length) * 0.075),
      y: centerY + slot * cssHeight * (compact ? 0.245 : 0.285),
    };
    const bendA = {
      x: cssWidth * (0.445 + (index % 2) * 0.022),
      y: centerY + slot * cssHeight * 0.068,
    };
    const bendB = {
      x: cssWidth * (0.605 + clamp(performance.throats[index]?.length) * 0.042),
      y: centerY + slot * cssHeight * 0.195
        + (index % 2 ? -1 : 1) * cssHeight * 0.016,
    };
    const path = [manifold, bendA, bendB, end];
    const branchSegments = segmentize(path);
    const lastAngle = Math.atan2(end.y - bendB.y, end.x - bendB.x);
    const outward = Math.abs(slot) < 0.01 ? -1 : Math.sign(slot);
    const tongueIndex = routes[index]?.tongueIndex ?? 0;
    const noseIndex = routes[index]?.noseIndex ?? 0;
    const tongue = performance.tongues[tongueIndex] ?? {};
    const nose = performance.noses[noseIndex] ?? {};
    const tongueBase = {
      x: bendB.x + (end.x - bendB.x) * (0.5 + clamp(tongue.position) * 0.18),
      y: bendB.y + (end.y - bendB.y) * (0.5 + clamp(tongue.position) * 0.18),
    };
    const tongueHandle = {
      x: tongueBase.x + Math.sin(lastAngle) * outward * (7 + clamp(tongue.height) * 13),
      y: tongueBase.y - Math.cos(lastAngle) * outward * (7 + clamp(tongue.height) * 13),
    };
    const noseAnchor = {
      x: bendB.x + (end.x - bendB.x) * 0.28,
      y: bendB.y + (end.y - bendB.y) * 0.28,
    };
    const noseHandle = {
      x: noseAnchor.x
        + Math.cos(lastAngle) * (12 + clamp(nose.length) * 19)
        + Math.sin(lastAngle) * outward * (15 + clamp(nose.resonance) * 11),
      y: noseAnchor.y
        + Math.sin(lastAngle) * (12 + clamp(nose.length) * 19)
        - Math.cos(lastAngle) * outward * (15 + clamp(nose.resonance) * 11),
    };
    return {
      index,
      route: routes[index],
      slot,
      path,
      segments: branchSegments.segments,
      pathLength: branchSegments.length,
      handle: bendB,
      grabHandle: end,
      angle: lastAngle,
      gate: {
        x: manifold.x + (bendA.x - manifold.x) * 0.24,
        y: manifold.y + (bendA.y - manifold.y) * 0.24,
      },
      mouth: end,
      tongueIndex,
      tongueHandle,
      noseIndex,
      noseAnchor,
      noseHandle,
      aperture: clamp(performance.throats[index]?.aperture),
      length: clamp(performance.throats[index]?.length),
      muted: Boolean(performance.throats[index]?.muted),
      outerSign: outward,
    };
  });
  const selectedBranch = mouthGeometries[selectedThroat] ?? mouthGeometries[0];
  const rootKnee = {
    x: cssWidth * (compact ? 0.235 : 0.225),
    y: centerY + (selectedThroat % 2 ? -1 : 1) * cssHeight * 0.045,
  };
  const pathAnchors = [
    sourceHub,
    rootKnee,
    manifold,
    ...selectedBranch.path.slice(1),
  ];
  // The exposed network remains angular, but its living lumen uses one
  // continuous local tangent/normal so height gestures never snap at a bend.
  const path = roundedAirwayPath(pathAnchors, 3);
  const selectedSegments = segmentize(path);
  const geometry = {
    path,
    pathAnchors,
    segments: selectedSegments.segments,
    pathLength: selectedSegments.length,
    sourceHub,
    rootKnee,
    manifold,
    mouths: mouthGeometries,
    scale: Math.max(13, Math.min(cssWidth * 0.028, cssHeight * 0.042)),
    diameters: diameterProfile
      ? Float32Array.from(diameterProfile)
      : tractDiameterProfile(performance),
  };
  geometry.baseline = Array.from(
    geometry.diameters,
    (_, index) => tractPoint(geometry, index / 43, 0),
  );
  geometry.wall = Array.from(
    geometry.diameters,
    (diameter, index) => tractPoint(geometry, index / 43, diameter),
  );
  geometry.constrictionProgress = clamp(currentArticulationIndex(performance) / 43);
  const station = geometry.constrictionProgress * 43;
  geometry.constriction = tractPoint(
    geometry,
    geometry.constrictionProgress,
    sampleDiameterProfile(geometry.diameters, station),
  );
  geometry.glottis = tractPoint(geometry, 0.025, geometry.diameters[1] * 0.52);
  geometry.velum = tractPoint(
    geometry,
    17 / 43,
    geometry.diameters[17] + 0.1,
  );
  geometry.lips = tractPoint(geometry, 1, geometry.diameters[43] * 0.48);
  geometry.pressureSources = Array.from({ length: 4 }, (_, index) => {
    const spread = index - 1.5;
    const handle = {
      x: cssWidth * (compact ? 0.06 : 0.065) + Math.abs(spread) * cssWidth * 0.006,
      y: sourceHub.y + spread * cssHeight * (compact ? 0.09 : 0.105),
    };
    return {
      index,
      handle,
      elbow: {
        x: sourceHub.x - cssWidth * (0.03 + index * 0.004),
        y: handle.y,
      },
      open: index < performance.pressureSourceCount
        && performance.pressureSources[index]?.open,
      level: performance.pressureSources[index]?.level ?? 0,
    };
  });
  geometry.tongueHandles = Array.from(
    { length: performance.tongueCount },
    (_, index) => {
      const tongue = performance.tongues[index];
      const control = tongueTractCoordinates(tongue);
      const progress = clamp(control.index / 43);
      const handle = tractPoint(
        geometry,
        progress,
        control.diameter,
      );
      const tangent = {
        x: Math.cos(handle.angle),
        y: Math.sin(handle.angle),
      };
      return {
        index,
        side: 1,
        handle,
        curlHandle: {
          x: handle.x
            + tangent.x * (clamp(tongue.curl) - 0.5) * geometry.scale * 1.25
            + handle.normal.x * geometry.scale * 0.5,
          y: handle.y
            + tangent.y * (clamp(tongue.curl) - 0.5) * geometry.scale * 1.25
            + handle.normal.y * geometry.scale * 0.5,
        },
        control: "shape",
      };
    },
  );
  geometry.noseHandles = Array.from(
    { length: performance.noseCount },
    (_, index) => {
      const nose = performance.noses[index];
      const length = clamp(nose.length);
      const resonance = clamp(nose.resonance);
      const openness = perceptualNoseOpening(nose.openness);
      const base = tractPoint(
        geometry,
        clamp((17 + index * 0.45) / 43),
        geometry.diameters[17] + 0.42 + index * 0.13,
      );
      const tangent = { x: Math.cos(base.angle), y: Math.sin(base.angle) };
      const handle = {
        x: base.x
          + tangent.x * geometry.scale * (0.45 + length * 1.2)
          + base.normal.x * geometry.scale * (
            0.42 + length * 0.72 + openness * 0.52 + index * 0.42
          ),
        y: base.y
          + tangent.y * geometry.scale * (0.45 + length * 1.2)
          + base.normal.y * geometry.scale * (
            0.42 + length * 0.72 + openness * 0.52 + index * 0.42
          ),
      };
      return {
        index,
        side: -1,
        anchor: base,
        chamber: base,
        handle,
        resonanceHandle: {
          x: handle.x + tangent.x * geometry.scale * (0.34 + resonance * 0.58),
          y: handle.y + tangent.y * geometry.scale * (0.34 + resonance * 0.58),
        },
        radius: geometry.scale * (0.2 + resonance * 0.28),
        control: "shape",
      };
    },
  );
  geometry.bodyHandles = [
    {
      control: "membrane",
      handle: {
        x: (sourceHub.x + rootKnee.x) * 0.5,
        y: (sourceHub.y + rootKnee.y) * 0.5,
      },
    },
    {
      control: "closure",
      handle: manifold,
    },
  ];
  return geometry;
}
