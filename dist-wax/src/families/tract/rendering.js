/**
 * The two tract pages' existing Canvas renderer, with explicit frame inputs.
 * No audio, animation scheduling, gesture handlers, or cached state lives here.
 * Keep drawing order/constants intact; see the frozen command-trace tests.
 */
import { clamp } from "./throatazoid.js";
import { tractPoint } from "./geometry.js";

function drawTractText(drawing, geometry, progress, diameter, label, alpha = 0.54) {
  if (!drawing.fillText) return;
  const point = tractPoint(geometry, progress, diameter);
  drawing.save();
  drawing.translate(point.x, point.y);
  drawing.rotate(point.angle - Math.PI * 0.5);
  drawing.fillStyle = `rgba(232,237,223,${alpha})`;
  drawing.font = "7px monospace";
  drawing.textAlign = "center";
  drawing.fillText(label, 0, 0);
  drawing.restore();
}

function tracePolyline(drawing, points) {
  drawing.beginPath();
  points.forEach((point, index) => {
    if (index === 0) drawing.moveTo(point.x, point.y);
    else drawing.lineTo(point.x, point.y);
  });
}

function traceSmoothPolyline(drawing, points, { begin = true } = {}) {
  if (!points.length) return;
  if (begin) drawing.beginPath();
  if (begin) drawing.moveTo(points[0].x, points[0].y);
  else drawing.lineTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const next = points[index + 1];
    drawing.quadraticCurveTo(
      point.x,
      point.y,
      (point.x + next.x) * 0.5,
      (point.y + next.y) * 0.5,
    );
  }
  drawing.lineTo(points.at(-1).x, points.at(-1).y);
}

function segmentedPathPoint(pathGeometry, progress) {
  const distance = clamp(progress) * pathGeometry.pathLength;
  let segment = pathGeometry.segments.at(-1);
  for (const candidate of pathGeometry.segments) {
    if (distance <= candidate.end) {
      segment = candidate;
      break;
    }
  }
  const local = clamp((distance - segment.start) / Math.max(0.0001, segment.length));
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * local,
    y: segment.from.y + (segment.to.y - segment.from.y) * local,
  };
}

function drawAngularNode(drawing,
  point,
  radius,
  fill,
  stroke,
  { sides = 6, rotation = Math.PI / 6, lineWidth = 1.2, glow = 0 } = {},
) {
  drawing.save();
  drawing.beginPath();
  for (let index = 0; index < sides; index += 1) {
    const angle = rotation + index / sides * Math.PI * 2;
    const x = point.x + Math.cos(angle) * radius;
    const y = point.y + Math.sin(angle) * radius;
    if (index === 0) drawing.moveTo(x, y);
    else drawing.lineTo(x, y);
  }
  drawing.closePath();
  drawing.fillStyle = fill;
  drawing.shadowColor = glow > 0 ? stroke : "transparent";
  drawing.shadowBlur = glow;
  drawing.fill();
  drawing.shadowBlur = 0;
  drawing.strokeStyle = stroke;
  drawing.lineWidth = lineWidth;
  drawing.stroke();
  drawing.restore();
}

function drawCartoonGrabber(drawing, prefersReducedMotion,
  point,
  radius,
  color,
  label,
  {
    selected = false,
    time = 0,
    aspect = 0.8,
    alpha = 1,
  } = {},
) {
  const bob = prefersReducedMotion
    ? 0
    : Math.sin(time * 0.003 + point.x * 0.02) * (selected ? 1.2 : 0.45);
  const size = radius * (selected ? 1.08 : 1);
  drawing.save();
  drawing.globalAlpha = alpha;
  drawing.translate(point.x, point.y + bob);
  drawing.rotate(selected ? Math.sin(time * 0.0017) * 0.05 : 0);
  drawing.shadowColor = selected ? color : "transparent";
  drawing.shadowBlur = selected ? 16 : 0;
  drawing.beginPath();
  drawing.ellipse(0, 0, size, size * aspect, 0, 0, Math.PI * 2);
  drawing.fillStyle = color;
  drawing.fill();
  drawing.shadowBlur = 0;
  drawing.strokeStyle = selected ? "#f7faef" : "rgba(232,237,223,.62)";
  drawing.lineWidth = selected ? 3.2 : 1.6;
  drawing.stroke();

  drawing.beginPath();
  drawing.ellipse(
    -size * 0.28,
    -size * aspect * 0.28,
    Math.max(1.5, size * 0.2),
    Math.max(1, size * aspect * 0.13),
    -0.35,
    0,
    Math.PI * 2,
  );
  drawing.fillStyle = "rgba(255,255,255,.5)";
  drawing.fill();

  if (drawing.fillText) {
    drawing.font = `${selected ? 8 : 6}px monospace`;
    drawing.textAlign = "center";
    drawing.fillStyle = selected ? "#020302" : "rgba(2,3,2,.8)";
    drawing.fillText(label, 0, 2.5);
    if (selected) {
      drawing.fillStyle = color;
      drawing.font = "7px monospace";
      drawing.fillText("GRAB", 0, size * aspect + 12);
    }
  }
  drawing.restore();
}

function drawCartoonMouthPod(drawing, prefersReducedMotion, mouth, {
  selected = false,
  pressure = 0,
  time = 0,
} = {}) {
  const scale = selected ? 1.28 : 1;
  const opening = 4 + mouth.aperture * 9;
  const pulse = prefersReducedMotion
    ? 0
    : Math.sin(time * 0.004 + mouth.index * 1.37) * pressure * 1.8;
  drawing.save();
  drawing.translate(mouth.mouth.x, mouth.mouth.y);
  drawing.rotate(mouth.angle);
  drawing.scale?.(scale, scale);
  drawing.shadowColor = selected ? "rgba(216,255,87,.55)" : "transparent";
  drawing.shadowBlur = selected ? 18 : 0;

  drawing.beginPath();
  drawing.ellipse(-2, 0, 17 + pulse, 13 - pulse * 0.25, 0, 0, Math.PI * 2);
  drawing.fillStyle = mouth.muted ? "#19090c" : "#070807";
  drawing.fill();
  drawing.shadowBlur = 0;
  drawing.strokeStyle = mouth.muted
    ? "#ff745f"
    : selected
      ? "#d8ff57"
      : "rgba(232,237,223,.5)";
  drawing.lineWidth = selected ? 3 : 1.5;
  drawing.stroke();

  drawing.beginPath();
  drawing.ellipse(4, 0, 11.5, opening, 0, 0, Math.PI * 2);
  drawing.fillStyle = mouth.muted ? "#080303" : "#351127";
  drawing.fill();
  drawing.strokeStyle = mouth.muted
    ? "rgba(255,116,95,.68)"
    : "rgba(255,159,195,.75)";
  drawing.lineWidth = 1.5;
  drawing.stroke();

  drawing.beginPath();
  drawing.ellipse(5, opening * 0.36, 7.5, Math.max(1.7, opening * 0.32), 0, 0, Math.PI);
  drawing.fillStyle = "#c6a0ff";
  drawing.fill();

  for (const direction of [-1, 1]) {
    drawing.beginPath();
    drawing.moveTo(-1, direction * (opening - 0.6));
    drawing.quadraticCurveTo(4, direction * (opening - 3.2), 9, direction * (opening - 0.8));
    drawing.strokeStyle = "rgba(247,250,239,.9)";
    drawing.lineWidth = 2.2;
    drawing.stroke();
  }
  drawing.restore();

  if (drawing.fillText) {
    drawing.save();
    drawing.textAlign = "center";
    drawing.fillStyle = mouth.muted
      ? "#ff745f"
      : selected
        ? "#d8ff57"
        : "rgba(232,237,223,.68)";
    drawing.font = `${selected ? 9 : 7}px monospace`;
    drawing.fillText(
      selected ? `M${mouth.index + 1} · DRAG ME` : `M${mouth.index + 1}`,
      mouth.mouth.x,
      mouth.mouth.y - (selected ? 25 : 18),
    );
    drawing.restore();
  }
}

function drawSharedShapeBadge(drawing, view, geometry) {
  const { cssWidth, cssHeight } = view;
  if (!drawing.fillText) return;
  const anchor = tractPoint(geometry, 0.56, 0.2);
  const width = Math.min(228, cssWidth * 0.28);
  const height = 38;
  const x = clamp(
    anchor.x - width * 0.46,
    cssWidth * 0.3,
    cssWidth - width - 12,
  );
  const y = clamp(
    anchor.y - geometry.scale * 4.3,
    64,
    cssHeight - height - 84,
  );
  drawing.save();
  drawing.beginPath();
  if (drawing.roundRect) drawing.roundRect(x, y, width, height, 14);
  else drawing.rect(x, y, width, height);
  drawing.fillStyle = "rgba(2,3,2,.9)";
  drawing.fill();
  drawing.strokeStyle = "rgba(232,237,223,.42)";
  drawing.lineWidth = 2;
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(x + width * 0.55, y + height);
  drawing.lineTo(anchor.x, anchor.y);
  drawing.strokeStyle = "rgba(232,237,223,.32)";
  drawing.lineWidth = 2;
  drawing.stroke();
  drawing.textAlign = "center";
  drawing.font = "8px monospace";
  drawing.fillStyle = "#f7faef";
  drawing.fillText("SHARED MOUTH SHAPE", x + width * 0.5, y + 14);
  drawing.font = "7px monospace";
  drawing.fillStyle = "#c6a0ff";
  drawing.fillText("PURPLE", x + width * 0.31, y + 28);
  drawing.fillStyle = "#79dcff";
  drawing.fillText("+ BLUE", x + width * 0.5, y + 28);
  drawing.fillStyle = "rgba(232,237,223,.72)";
  drawing.fillText("→ ALL MOUTHS", x + width * 0.74, y + 28);
  drawing.restore();
}

function drawNetworkTopology(drawing, view, geometry, time, liveAlpha, performance) {
  const { sourcePressures, mouthPressures, selectedThroat, prefersReducedMotion, isAwake } = view;
  drawing.save();
  drawing.lineJoin = "miter";
  drawing.lineCap = "square";

  for (const source of geometry.pressureSources) {
    const energy = clamp(sourcePressures[source.index] ?? 0);
    tracePolyline(drawing, [source.handle, source.elbow, geometry.sourceHub]);
    drawing.strokeStyle = source.open
      ? `rgba(121,220,255,${0.18 + energy * 0.5})`
      : "rgba(255,116,95,.1)";
    drawing.lineWidth = source.open ? 1.5 + energy * 3.2 : 1;
    drawing.shadowColor = source.open ? "#79dcff" : "transparent";
    drawing.shadowBlur = source.open ? energy * 12 : 0;
    drawing.stroke();
    drawing.shadowBlur = 0;
  }

  tracePolyline(drawing, [geometry.sourceHub, geometry.rootKnee, geometry.manifold]);
  drawing.strokeStyle = "rgba(7,8,8,.96)";
  drawing.lineWidth = Math.max(16, geometry.scale * 0.72);
  drawing.stroke();
  drawing.strokeStyle = `rgba(216,255,87,${0.16 + liveAlpha * 0.34})`;
  drawing.lineWidth = 1.25;
  drawing.stroke();

  for (const mouth of geometry.mouths) {
    const selected = mouth.index === selectedThroat;
    const pressure = clamp(mouthPressures[mouth.index] ?? 0);
    tracePolyline(drawing, mouth.path);
    drawing.strokeStyle = mouth.muted
      ? "rgba(32,16,25,.78)"
      : selected
        ? "rgba(41,16,37,.94)"
        : "rgba(15,11,19,.88)";
    drawing.lineWidth = selected
      ? Math.max(13, geometry.scale * 0.62)
      : 7 + mouth.aperture * 5;
    drawing.shadowColor = mouth.muted
      ? "transparent"
      : selected
        ? "rgba(198,160,255,.22)"
        : "rgba(121,220,255,.13)";
    drawing.shadowBlur = mouth.muted ? 0 : 7 + pressure * 13;
    drawing.stroke();
    drawing.shadowBlur = 0;
    tracePolyline(drawing, mouth.path);
    drawing.strokeStyle = mouth.muted
      ? "rgba(255,116,95,.28)"
      : selected
        ? "rgba(198,160,255,.72)"
        : "rgba(232,237,223,.28)";
    drawing.lineWidth = selected ? 1.5 : 0.85;
    drawing.stroke();

    if (!mouth.muted && !prefersReducedMotion && isAwake()) {
      const packetProgress = (
        time * (0.00012 + liveAlpha * 0.00034)
        + mouth.index * 0.137
      ) % 1;
      const outward = segmentedPathPoint(mouth, packetProgress);
      const returning = segmentedPathPoint(mouth, 1 - packetProgress);
      drawAngularNode(drawing,
        outward,
        1.8 + pressure * 2.4,
        `rgba(216,255,87,${0.24 + liveAlpha * 0.5})`,
        "rgba(216,255,87,.42)",
        { sides: 4, rotation: Math.PI / 4 },
      );
      if (performance.coupling > 0.08) {
        drawAngularNode(drawing,
          returning,
          1.3 + performance.coupling * 2.1,
          `rgba(198,160,255,${0.15 + performance.coupling * 0.52})`,
          "rgba(198,160,255,.36)",
          { sides: 4, rotation: Math.PI / 4 },
        );
      }
    }

    drawCartoonMouthPod(drawing, prefersReducedMotion, mouth, {
      selected,
      pressure,
      time,
    });
  }
  drawing.restore();
}

function drawNetworkJunctions(drawing, view, geometry, time, performance) {
  const { sourcePressures, mouthPressures, selectedThroat, prefersReducedMotion, isAwake, cssHeight } = view;
  drawing.save();
  drawing.textAlign = "center";
  drawing.font = "7px monospace";
  for (const source of geometry.pressureSources) {
    const energy = clamp(sourcePressures[source.index] ?? 0);
    drawAngularNode(drawing,
      source.handle,
      7.5 + clamp(source.level) * 1.8,
      source.open ? "rgba(4,17,20,.98)" : "rgba(16,8,10,.96)",
      source.open ? "#79dcff" : "rgba(255,116,95,.55)",
      {
        sides: 4,
        rotation: Math.PI / 4,
        lineWidth: source.open ? 1.7 : 1,
        glow: source.open ? 3 + energy * 12 : 0,
      },
    );
    drawing.fillStyle = source.open ? "#79dcff" : "rgba(255,116,95,.64)";
    drawing.fillText(`P${source.index + 1}`, source.handle.x, source.handle.y + 2.5);
  }
  drawAngularNode(drawing,
    geometry.sourceHub,
    9,
    "rgba(4,8,8,.98)",
    isAwake() ? "#d8ff57" : "rgba(216,255,87,.52)",
    { sides: 5, rotation: -Math.PI / 2, glow: isAwake() ? 6 : 0 },
  );
  drawAngularNode(drawing,
    geometry.bodyHandles[0].handle,
    5.5,
    "rgba(5,8,7,.98)",
    "rgba(216,255,87,.62)",
    { sides: 4, rotation: Math.PI / 4 },
  );
  drawAngularNode(drawing,
    geometry.manifold,
    12 + performance.coupling * 9,
    "rgba(8,5,10,.98)",
    "rgba(198,160,255,.82)",
    {
      sides: Math.max(5, performance.throatCount + 2),
      rotation: time * (prefersReducedMotion ? 0 : 0.00008),
      lineWidth: 1.5,
      glow: performance.coupling * 12,
    },
  );
  drawing.fillStyle = "rgba(198,160,255,.88)";
  drawing.fillText("Σ", geometry.manifold.x, geometry.manifold.y + 2.5);

  for (const mouth of geometry.mouths) {
    drawAngularNode(drawing,
      mouth.gate,
      mouth.index === selectedThroat ? 7 : 5.5,
      "rgba(5,7,7,.98)",
      mouth.muted ? "#ff745f" : "#d8ff57",
      {
        sides: 4,
        rotation: Math.PI / 4,
        glow: mouth.muted ? 0 : clamp(mouthPressures[mouth.index] ?? 0) * 7,
      },
    );
  }

  drawing.textAlign = "left";
  drawing.fillStyle = "rgba(121,220,255,.52)";
  drawing.fillText("PRESSURE BANK", geometry.pressureSources[0].handle.x - 14, cssHeight * 0.09);
  drawing.fillStyle = "rgba(198,160,255,.5)";
  drawing.fillText(
    `AIRWAY CROSS-FEED ${Math.round(performance.coupling / 0.72 * 100)}%`,
    geometry.manifold.x - 34,
    geometry.manifold.y + 28,
  );
  drawing.restore();
}

/** Draw an already-prepared tract; callers retain geometry/hit-test state. */
export function drawPhysicalTract(drawing, geometry, time, liveAlpha, performance, view) {
  const {
    cssWidth, cssHeight, tractPressure, prefersReducedMotion,
    selectedTongue, selectedNose, pointerDrag, burstFlashUntil,
    burstFlashPlace, keyboardPulse, isAwake, colorWithAlpha,
  } = view;
  const pressure = clamp(tractPressure);
  const aperture = clamp(performance.articulationAperture);
  const closed = aperture < 0.04 || performance.glottalClosure > 0.84;
  const fricating = aperture > 0.2 && aperture < 0.55;
  const membraneDisplacement = (station) => (
    prefersReducedMotion
      ? 0
      : liveAlpha
        * 0.032
        * Math.sin(station * 1.87 - time * 0.005)
        * station / 43
  );
  const livingWall = Array.from(
    geometry.diameters,
    (diameter, station) => tractPoint(
      geometry,
      station / 43,
      diameter + membraneDisplacement(station),
    ),
  );

  drawing.save();
  drawing.lineJoin = "round";
  drawing.lineCap = "round";
  drawNetworkTopology(drawing, view, geometry, time, liveAlpha, performance);

  traceSmoothPolyline(drawing, geometry.baseline);
  traceSmoothPolyline(drawing, [...livingWall].reverse(), { begin: false });
  drawing.closePath();
  const tractGradient = drawing.createLinearGradient?.(
    cssWidth * 0.08,
    cssHeight * 0.82,
    cssWidth * 0.7,
    cssHeight * 0.15,
  );
  if (tractGradient) {
    tractGradient.addColorStop(0, "rgba(51,18,42,.94)");
    tractGradient.addColorStop(0.55, "rgba(31,15,34,.96)");
    tractGradient.addColorStop(1, "rgba(9,12,11,.98)");
    drawing.fillStyle = tractGradient;
  } else {
    drawing.fillStyle = "rgba(31,15,34,.96)";
  }
  drawing.shadowColor = closed ? "rgba(255,116,95,.36)" : "rgba(198,160,255,.2)";
  drawing.shadowBlur = closed ? 26 * pressure : 10 + liveAlpha * 8;
  drawing.fill();
  drawing.shadowBlur = 0;
  drawing.strokeStyle = "rgba(232,237,223,.58)";
  drawing.lineWidth = 1.35;
  drawing.stroke();

  for (let index = 2; index < 43; index += 2) {
    const baseline = geometry.baseline[index];
    const wall = livingWall[index];
    const behindClosure = index / 43 < geometry.constrictionProgress;
    const sectionEnergy = isAwake()
      ? 0.06 + liveAlpha * (0.1 + 0.16 * Math.sin(time * 0.004 - index * 0.74) ** 2)
      : 0.04;
    drawing.beginPath();
    drawing.moveTo(baseline.x, baseline.y);
    drawing.lineTo(wall.x, wall.y);
    drawing.strokeStyle = closed && behindClosure
      ? `rgba(255,116,95,${0.07 + pressure * 0.34})`
      : `rgba(198,160,255,${sectionEnergy})`;
    drawing.lineWidth = closed && behindClosure ? 0.8 + pressure * 1.2 : 0.55;
    drawing.stroke();
  }

  traceSmoothPolyline(drawing, livingWall);
  drawing.strokeStyle = "rgba(198,160,255,.82)";
  drawing.lineWidth = 2.3;
  drawing.stroke();

  const tongueMembrane = Array.from({ length: 25 }, (_, offset) => {
    const station = offset + 10;
    const mutation = clamp(performance.mutation);
    const mutationLobe = Math.sin(
      station * 0.74 + mutation * 5.2,
    ) * mutation * 0.045;
    return tractPoint(
      geometry,
      station / 43,
      geometry.diameters[station] * (0.72 + mutationLobe)
        + 0.22
        + membraneDisplacement(station) * 0.68,
    );
  });
  traceSmoothPolyline(drawing, tongueMembrane);
  drawing.strokeStyle = "rgba(198,160,255,.2)";
  drawing.lineWidth = Math.max(18, geometry.scale * 0.42);
  drawing.stroke();
  drawing.strokeStyle = "rgba(198,160,255,.48)";
  drawing.lineWidth = 1;
  drawing.stroke();

  for (let index = 0; index < performance.tongueCount; index += 1) {
    const tongueGeometry = geometry.tongueHandles[index];
    const point = tongueGeometry.handle;
    drawCartoonGrabber(drawing, prefersReducedMotion,
      point,
      index === selectedTongue ? 13 : 7,
      "#c6a0ff",
      `T${index + 1}`,
      {
        selected: index === selectedTongue,
        time,
        aspect: 0.72,
        alpha: index === selectedTongue ? 1 : 0.34,
      },
    );
  }

  for (let index = 0; index < performance.noseCount; index += 1) {
    const openness = Math.max(
      clamp(performance.nasalCoupling),
      clamp(performance.noses[index]?.openness),
    );
    const noseGeometry = geometry.noseHandles[index];
    drawing.beginPath();
    drawing.moveTo(noseGeometry.anchor.x, noseGeometry.anchor.y);
    drawing.lineTo(noseGeometry.handle.x, noseGeometry.handle.y);
    drawing.strokeStyle = `rgba(121,220,255,${0.16 + openness * 0.58})`;
    drawing.lineWidth = 3 + openness * 6;
    drawing.stroke();
    drawing.beginPath();
    drawing.arc(
      noseGeometry.handle.x,
      noseGeometry.handle.y,
      noseGeometry.radius,
      0,
      Math.PI * 2,
    );
    drawing.strokeStyle = `rgba(121,220,255,${
      0.14 + clamp(performance.noses[index]?.resonance) * 0.46
    })`;
    drawing.lineWidth = 1;
    drawing.stroke();
    drawCartoonGrabber(drawing, prefersReducedMotion,
      noseGeometry.handle,
      (selectedNose === index ? 12 : 7) + openness * 2.5,
      "#79dcff",
      `N${index + 1}`,
      {
        selected: selectedNose === index,
        time,
        aspect: 0.88,
        alpha: selectedNose === index ? 1 : 0.34,
      },
    );
  }

  drawCartoonGrabber(drawing, prefersReducedMotion,
    geometry.glottis,
    12,
    performance.glottalClosure > 0.84 ? "#ff745f" : "#d8ff57",
    "VOICE",
    {
      selected: pointerDrag?.type === "tract-glottis",
      time,
      aspect: 0.82,
    },
  );

  const constrictionColor = closed
    ? "#ff745f"
    : fricating
      ? "#ffcb69"
      : "#d8ff57";
  drawing.beginPath();
  drawing.arc(
    geometry.constriction.x,
    geometry.constriction.y,
    12 + (closed ? pressure * 10 : 0),
    0,
    Math.PI * 2,
  );
  drawing.fillStyle = closed
    ? `rgba(255,116,95,${0.08 + pressure * 0.2})`
    : "rgba(216,255,87,.055)";
  drawing.fill();
  drawing.strokeStyle = constrictionColor;
  drawing.lineWidth = pointerDrag?.type === "tract-constriction" ? 2.5 : 1.35;
  drawing.stroke();
  drawing.beginPath();
  drawing.moveTo(
    geometry.baseline[Math.round(geometry.constrictionProgress * 43)].x,
    geometry.baseline[Math.round(geometry.constrictionProgress * 43)].y,
  );
  drawing.lineTo(geometry.constriction.x, geometry.constriction.y);
  drawing.strokeStyle = colorWithAlpha(constrictionColor, closed ? 0.82 : 0.48);
  drawing.lineWidth = closed ? 2.1 : 1;
  drawing.stroke();

  if (fricating && !prefersReducedMotion) {
    for (let particle = 0; particle < 11; particle += 1) {
      const phase = time * 0.012 + particle * 2.399;
      const distance = 7 + (particle % 4) * 4;
      drawing.beginPath();
      drawing.arc(
        geometry.constriction.x + Math.cos(phase) * distance,
        geometry.constriction.y + Math.sin(phase * 1.17) * distance,
        0.7 + particle % 3 * 0.45,
        0,
        Math.PI * 2,
      );
      drawing.fillStyle = `rgba(255,203,105,${0.2 + liveAlpha * 0.55})`;
      drawing.fill();
    }
  }

  if (time < burstFlashUntil) {
    const elapsed = clamp((burstFlashUntil - time) / 150);
    const flashPoint = tractPoint(
      geometry,
      clamp((12 + burstFlashPlace * 30) / 43),
      0.5,
    );
    drawing.beginPath();
    drawing.arc(flashPoint.x, flashPoint.y, 9 + (1 - elapsed) * 28, 0, Math.PI * 2);
    drawing.strokeStyle = `rgba(255,203,105,${elapsed * 0.78})`;
    drawing.lineWidth = 1.6;
    drawing.stroke();
  }

  const pulseAge = time - keyboardPulse.startedAt;
  if (pulseAge >= 0 && pulseAge < 360 && keyboardPulse.letter) {
    const progress = clamp(pulseAge / 360);
    const pulsePoint = tractPoint(
      geometry,
      clamp((12 + keyboardPulse.place * 30) / 43),
      0.54,
    );
    const pulseColor = keyboardPulse.capital ? "198,160,255" : "216,255,87";
    for (let ring = 0; ring < (keyboardPulse.capital ? 3 : 2); ring += 1) {
      const ringProgress = clamp(progress - ring * 0.075);
      drawing.beginPath();
      drawing.arc(
        pulsePoint.x,
        pulsePoint.y,
        7 + ringProgress * (keyboardPulse.capital ? 42 : 31) + ring * 5,
        0,
        Math.PI * 2,
      );
      drawing.strokeStyle = `rgba(${pulseColor},${(1 - ringProgress) * (0.68 - ring * 0.12)})`;
      drawing.lineWidth = keyboardPulse.capital ? 1.7 : 1.2;
      drawing.stroke();
    }
    if (drawing.fillText) {
      drawing.fillStyle = `rgba(${pulseColor},${1 - progress})`;
      drawing.font = `${keyboardPulse.capital ? 11 : 9}px monospace`;
      drawing.textAlign = "center";
      drawing.fillText(
        keyboardPulse.capital
          ? `SHIFT+${keyboardPulse.letter.toUpperCase()}`
          : keyboardPulse.letter.toUpperCase(),
        pulsePoint.x,
        pulsePoint.y - 16 - progress * 12,
      );
    }
  }

  drawNetworkJunctions(drawing, view, geometry, time, performance);
  drawSharedShapeBadge(drawing, view, geometry);

  drawTractText(drawing, geometry, 0.035, -0.34, "GLOTTIS", 0.68);
  drawTractText(drawing, geometry, 20 / 43, -0.42, "K · NG", 0.5);
  drawTractText(drawing, geometry, 31 / 43, -0.44, "SH", 0.42);
  drawTractText(drawing, geometry, 36 / 43, -0.44, "T · S · N", 0.54);
  drawTractText(drawing, geometry, 41 / 43, -0.42, "P · F · M", 0.54);
  drawTractText(drawing, geometry, 1, 1.82, "LIPS", 0.68);

  if (drawing.fillText) {
    drawing.fillStyle = "rgba(232,237,223,.8)";
    drawing.font = "8px monospace";
    drawing.textAlign = "left";
    drawing.fillText(
      closed ? `SEALED · ${Math.round(pressure * 100)}% PRESSURE` : fricating ? "TURBULENCE WINDOW" : "DRAG PLACE × APERTURE",
      geometry.constriction.x + 18,
      geometry.constriction.y - 15,
    );
  }
  drawing.restore();
}
