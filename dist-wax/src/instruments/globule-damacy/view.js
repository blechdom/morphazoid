import {
  MARBLE_RADIUS, SLICE_CELLS, SOURCE_COUNT, clamp,
  coordinatesOf, needleNormalAt, needleRadius, normalAt,
  playRadius, playerOrientation, rotateNormal, zoneBasis, zoneContainsNormal,
  zoneEdge, zoneSurfacePoint,
} from "./model.js";

const TAU = Math.PI * 2;
// Glittering lacquer trapped inside a worn, hand-marbled piece of glass.
const PIGMENTS = ["#ff65b6", "#4adbea", "#ffc365", "#b997ff",
  "#ff8757", "#f17ed5", "#c1f08b", "#6ca7ff"];
const GLASS = ["#51326d", "#e36eac", "#f8d7a9", "#5d9cac", "#aa69bc"];

function mapFrame(width, height) {
  const left = Math.min(62, width * .13), right = width - Math.min(30, width * .055);
  const top = Math.min(117, height * .24), bottom = height - 56;
  return { left, right, top, bottom, row: (bottom - top) / SOURCE_COUNT };
}
function mapXY(frame, phase, lane) {
  return { x: frame.left + clamp(phase, 0, 1) * (frame.right - frame.left),
    y: frame.top + (clamp(lane, 0, 7) + .5) * frame.row };
}
function fleck(seed) {
  let value = Math.imul(seed ^ (seed >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

// Make the table once per resize. Painting its fibers on every audio-driven
// frame would cost more than the ball, and the floor must not animate by itself.
function makePaper(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d", { alpha: false });
  const wash = ctx.createLinearGradient(0, 0, width, height);
  wash.addColorStop(0, "#382039");
  wash.addColorStop(.44, "#25182e");
  wash.addColorStop(1, "#111224");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, width, height);
  let seed = 1846;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
    / 4294967296);
  for (let layer = 0; layer < 22; layer++) {
    const y = random() * height;
    ctx.beginPath();
    for (let x = -20; x <= width + 20; x += 24) {
      const rough = y + Math.sin(x * .014 + layer * 7) * (2 + random() * 7);
      if (x === -20) ctx.moveTo(x, rough);
      else ctx.lineTo(x, rough);
    }
    ctx.strokeStyle = layer % 3 ? "rgba(243,154,206,.055)" : "rgba(8,6,23,.24)";
    ctx.lineWidth = 4 + random() * 24;
    ctx.stroke();
  }
  // Ground grain, brush hairs and accidental little splashes. All authored
  // marks are deterministic and original; no painted image is sampled.
  for (let mark = 0; mark < Math.min(3600, width * height / 95); mark++) {
    const x = random() * width, y = random() * height, size = .4 + random() * 1.3;
    ctx.fillStyle = mark % 4 ? "rgba(255,205,224,.10)" : "rgba(9,7,28,.28)";
    ctx.fillRect(x, y, size * (mark % 6 ? 1 : 3), size);
  }
  for (let thread = 0; thread < 150; thread++) {
    const x = random() * width, y = random() * height;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (random() - .5) * 39, y + (random() - .5) * 10);
    ctx.strokeStyle = "rgba(247,198,238,.10)";
    ctx.lineWidth = .45 + random() * .5;
    ctx.stroke();
  }
  for (let splash = 0; splash < 32; splash++) {
    const x = random() * width, y = random() * height;
    const color = PIGMENTS[splash % PIGMENTS.length];
    ctx.fillStyle = color;
    ctx.globalAlpha = .055 + random() * .08;
    for (let drop = 0; drop < 7; drop++) {
      const angle = random() * TAU, spread = random() ** 2 * 29;
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(angle) * spread, y + Math.sin(angle) * spread,
        1 + random() * 4, .6 + random() * 2.4, angle, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  const vignette = ctx.createRadialGradient(width * .5, height * .48, height * .19,
    width * .5, height * .5, Math.max(width, height) * .73);
  vignette.addColorStop(0, "rgba(5,5,17,0)");
  vignette.addColorStop(1, "rgba(6,4,20,.66)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

// These glass threads belong to the sphere, so they turn about both axes with
// the collected paint. They are not audio tracks and carry no hidden notes.
const VEINS = Array.from({ length: 12 }, (_, index) => Array.from({ length: 92 },
  (_, step) => {
    const t = step / 91;
    const longitude = index * .079 + t * (.42 + (index % 4) * .13)
      + .037 * Math.sin(TAU * (2.7 * t + index * .19));
    const height = clamp(3.5 + 2.72 * Math.sin(TAU * (t * .69 + index * .143))
      + .48 * Math.sin(TAU * (t * 2.3 - index * .31)), .02, 6.98);
    return normalAt(longitude, height);
  }));
const INCLUSIONS = Array.from({ length: 145 }, (_, index) => {
  const y = 1 - 2 * (index + .5) / 145, ring = Math.sqrt(1 - y * y);
  const angle = index * 2.399963229728653;
  return [ring * Math.cos(angle), y, ring * Math.sin(angle)];
});

function surfacePoint(cx, cy, radius, normal, orientation, tilt) {
  const [x, y, z] = rotateNormal(orientation, normal);
  const up = Math.sqrt(1 - tilt * tilt);
  return { x: cx + x * radius, y: cy - (y * up - z * tilt) * radius,
    front: y * tilt + z * up };
}
function drawVein(ctx, cx, cy, radius, orientation, tilt, points) {
  ctx.beginPath();
  let open = false;
  for (const normal of points) {
    const spot = surfacePoint(cx, cy, radius, normal, orientation, tilt);
    if (spot.front < .015) { open = false; continue; }
    if (open) ctx.lineTo(spot.x, spot.y);
    else ctx.moveTo(spot.x, spot.y);
    open = true;
  }
  ctx.stroke();
}
function paintBall(ctx, cx, cy, radius, orientation, ribbons,
  contacting = new Set(), tilt = .25) {
  ctx.save();
  const shadow = ctx.createRadialGradient(cx + radius * .07, cy + radius * .95, 0,
    cx + radius * .1, cy + radius * .94, radius * 1.37);
  shadow.addColorStop(0, "rgba(5,2,19,.8)");
  shadow.addColorStop(1, "rgba(5,2,19,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(cx + radius * .1, cy + radius * .94,
    radius * 1.35, radius * .33, -.11, 0, TAU);
  ctx.fill();

  const body = ctx.createRadialGradient(cx - radius * .36, cy - radius * .43,
    radius * .025, cx + radius * .26, cy + radius * .23, radius * 1.15);
  body.addColorStop(0, "#fff2f9");
  body.addColorStop(.18, "#ecc9e4");
  body.addColorStop(.42, "#b77eae");
  body.addColorStop(.7, "#5b456d");
  body.addColorStop(1, "#171528");
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fillStyle = body; ctx.fill();
  ctx.save(); ctx.clip();

  // Inside the glass: intertwined violet/cyan/champagne filaments and trapped
  // bubbles, rather than a clean plastic sphere with flat printed spots.
  for (let index = 0; index < VEINS.length; index++) {
    ctx.strokeStyle = "#211b38";
    ctx.globalAlpha = .17;
    ctx.lineWidth = radius * (.067 + (index % 3) * .012);
    drawVein(ctx, cx, cy, radius, orientation, tilt, VEINS[index]);
    ctx.strokeStyle = GLASS[index % GLASS.length];
    ctx.globalAlpha = .38;
    ctx.lineWidth = radius * (.028 + (index % 3) * .007);
    drawVein(ctx, cx, cy, radius, orientation, tilt, VEINS[index]);
    ctx.strokeStyle = "#ffe8df";
    ctx.globalAlpha = .18;
    ctx.lineWidth = Math.max(.6, radius * .005);
    drawVein(ctx, cx, cy, radius, orientation, tilt, VEINS[index]);
  }
  ctx.globalAlpha = 1;
  for (let index = 0; index < INCLUSIONS.length; index++) {
    const point = surfacePoint(cx, cy, radius, INCLUSIONS[index], orientation, tilt);
    if (point.front < .06) continue;
    const size = radius * (.003 + fleck(index * 991 + 78) * .009);
    ctx.fillStyle = "rgba(29,16,39,.26)";
    ctx.beginPath(); ctx.ellipse(point.x, point.y, size, size * .66, -.3, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,230,247,.45)";
    ctx.beginPath(); ctx.arc(point.x - size * .38, point.y - size * .4,
      Math.max(.25, size * .25), 0, TAU); ctx.fill();
  }

  for (const grain of ribbons) {
    const basis = zoneBasis(grain);
    const center = surfacePoint(cx, cy, radius, basis.center, orientation, tilt);
    if (center.front < -.06) continue;
    const angle = grain.tilt ?? 0, cosine = Math.cos(angle), sine = Math.sin(angle);
    ctx.beginPath();
    for (let vertex = 0; vertex < 16; vertex++) {
      const theta = vertex * TAU / 16;
      const edge = zoneEdge(grain, theta);
      const u = Math.cos(theta) * edge, v = Math.sin(theta) * edge;
      const point = surfacePoint(cx, cy, radius,
        zoneSurfacePoint(grain, u * cosine - v * sine, u * sine + v * cosine, basis),
        orientation, tilt);
      if (!vertex) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    const touched = contacting.has(grain.key);
    ctx.globalAlpha = Math.min(1, .27 + Math.max(0, center.front) * .63);
    ctx.fillStyle = PIGMENTS[grain.sourceIndex];
    ctx.fill();
    if (touched) {
      ctx.globalAlpha = .32;
      ctx.fillStyle = "#fff0fd";
      ctx.fill();
    }
    // One bristle stroke inside the sounding footprint: the ornament cannot
    // suggest a clickable/sounding fleck outside the actual contact zone.
    if (center.front > .03) {
      const p = zoneSurfacePoint(grain, -.32, -.19, basis);
      const q = zoneSurfacePoint(grain, .12, -.36, basis);
      const start = surfacePoint(cx, cy, radius, p, orientation, tilt);
      const end = surfacePoint(cx, cy, radius, q, orientation, tilt);
      ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y);
      ctx.strokeStyle = "#ffdef6";
      ctx.globalAlpha = touched ? .92 : .28;
      ctx.lineWidth = Math.max(.6, radius * .004);
      ctx.stroke();
    }
  }
  ctx.restore();

  // Glaze and reflected light, without concentric ornament or a stroked rim.
  const bloom = ctx.createRadialGradient(cx - radius * .37, cy - radius * .48, 0,
    cx - radius * .36, cy - radius * .47, radius * .82);
  bloom.addColorStop(0, "rgba(255,247,255,.52)");
  bloom.addColorStop(.33, "rgba(255,229,252,.13)");
  bloom.addColorStop(1, "rgba(255,236,254,0)");
  ctx.fillStyle = bloom;
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU); ctx.fill();
  ctx.restore();
}

/** The ribbed elbow, hollow mouth and reading tip are fixed to the stage;
 * only the painted ball beneath this straw receives a playback rotation. */
function paintStraw(ctx, cx, cy, radius, touching, width) {
  const start = { x: cx + radius * 1.54, y: cy - radius * .77 };
  const shoulder = { x: cx + radius * .92, y: start.y };
  const control1 = { x: cx + radius * .68, y: shoulder.y };
  const control2 = { x: cx + radius * .61, y: cy - radius * .50 };
  const elbow = { x: cx + radius * .47, y: cy - radius * .39 };
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(shoulder.x, shoulder.y);
    ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y,
      elbow.x, elbow.y);
    ctx.lineTo(cx, cy);
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  trace();
  ctx.strokeStyle = "#28172f";
  ctx.lineWidth = Math.max(8, radius * .09);
  ctx.shadowColor = "rgba(20,6,30,.7)";
  ctx.shadowBlur = radius * .09;
  ctx.shadowOffsetY = radius * .035;
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = ctx.shadowOffsetY = 0;
  const lacquer = ctx.createLinearGradient(start.x, start.y, cx, cy);
  lacquer.addColorStop(0, "#56e2e9");
  lacquer.addColorStop(.37, "#91edf0");
  lacquer.addColorStop(.48, "#ffb7dd");
  lacquer.addColorStop(1, "#ff65b6");
  trace();
  ctx.strokeStyle = lacquer;
  ctx.lineWidth = Math.max(5, radius * .065);
  ctx.stroke();
  trace();
  ctx.strokeStyle = "rgba(255,250,238,.57)";
  ctx.lineWidth = Math.max(1, radius * .01);
  ctx.stroke();

  // Transverse colored ridges make the flexible bend read as a real straw,
  // rather than another smooth metal tonearm or a painted line on the ball.
  for (let rib = 1; rib <= 11; rib++) {
    const t = rib / 12, s = 1 - t;
    const x = s ** 3 * shoulder.x + 3 * s ** 2 * t * control1.x
      + 3 * s * t ** 2 * control2.x + t ** 3 * elbow.x;
    const y = s ** 3 * shoulder.y + 3 * s ** 2 * t * control1.y
      + 3 * s * t ** 2 * control2.y + t ** 3 * elbow.y;
    const dx = 3 * s ** 2 * (control1.x - shoulder.x)
      + 6 * s * t * (control2.x - control1.x) + 3 * t ** 2 * (elbow.x - control2.x);
    const dy = 3 * s ** 2 * (control1.y - shoulder.y)
      + 6 * s * t * (control2.y - control1.y) + 3 * t ** 2 * (elbow.y - control2.y);
    const length = Math.hypot(dx, dy), nx = -dy / length, ny = dx / length;
    const half = radius * .036;
    ctx.beginPath();
    ctx.moveTo(x - nx * half, y - ny * half);
    ctx.lineTo(x + nx * half, y + ny * half);
    ctx.strokeStyle = "rgba(77,23,74,.85)";
    ctx.lineWidth = Math.max(1, radius * .012);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - nx * half + dx / length * 1.8, y - ny * half + dy / length * 1.8);
    ctx.lineTo(x + nx * half + dx / length * 1.8, y + ny * half + dy / length * 1.8);
    ctx.strokeStyle = "rgba(255,226,249,.65)";
    ctx.lineWidth = Math.max(.8, radius * .006);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(start.x, start.y, radius * .018, radius * .037, -.2, 0, TAU);
  ctx.fillStyle = "#291f38"; ctx.fill();
  ctx.strokeStyle = "#97f3ee"; ctx.lineWidth = Math.max(1, radius * .009);
  ctx.stroke();
  const footprint = radius * Math.sin(needleRadius(width));
  if (touching) {
    const glowRadius = Math.max(radius * .12, footprint * 1.65);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    glow.addColorStop(0, "rgba(255,242,251,.6)");
    glow.addColorStop(1, "rgba(255,120,203,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, glowRadius, 0, TAU); ctx.fill();
  }
  if (footprint > radius * .035) {
    // A translucent mouth shows the actual circular area sampled by the
    // audio clock; it widens in place without hiding the paint below it.
    ctx.beginPath(); ctx.arc(cx, cy, footprint, 0, TAU);
    ctx.fillStyle = "rgba(113,30,105,.19)"; ctx.fill();
    ctx.strokeStyle = touching ? "#fff1ea" : "#ff9bd6";
    ctx.lineWidth = Math.max(1.2, radius * .012);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * .027, radius * .033, -.7, 0, TAU);
  ctx.fillStyle = "#462341"; ctx.fill();
  ctx.strokeStyle = "#ffd1ec"; ctx.lineWidth = Math.max(1, radius * .008);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius * .013, 0, TAU);
  ctx.fillStyle = touching ? "#fff7e9" : "#ec8ac3";
  ctx.fill();
  ctx.restore();
}

function waveformAt(shape, phase, row) {
  const at = clamp(phase, 0, 1) * (shape.length - 1);
  const first = Math.floor(at), next = Math.min(first + 1, shape.length - 1);
  const peak = shape[first] * (1 - (at - first)) + shape[next] * (at - first);
  return Math.max(.75, Math.sqrt(clamp(peak, 0, 1)) * row * .38);
}

function waveShape(ctx, frame, distance, shape, startCell, endCell) {
  const y = mapXY(frame, 0, 0).y;
  ctx.beginPath();
  for (let cell = startCell; cell <= endCell; cell++) {
    const phase = cell / SLICE_CELLS, x = frame.left + phase * distance;
    const peak = waveformAt(shape, phase, frame.row);
    if (cell === startCell) ctx.moveTo(x, y - peak);
    else ctx.lineTo(x, y - peak);
  }
  for (let cell = endCell; cell >= startCell; cell--) {
    const phase = cell / SLICE_CELLS, x = frame.left + phase * distance;
    ctx.lineTo(x, y + waveformAt(shape, phase, frame.row));
  }
  ctx.closePath();
}

function paintRecord(ctx, width, height, sources, ribbons, position, orientation, active) {
  const frame = mapFrame(width, height), distance = frame.right - frame.left;
  const occupied = new Set(ribbons.map(grain => grain.key));
  ctx.fillStyle = "#c6a9d9";
  ctx.font = "11px ui-monospace, monospace";
  for (const [phase, word] of [[0, "start"], [1, "end"]]) {
    const x = frame.left + phase * distance;
    ctx.fillText(word, x - (phase ? 20 : 0), frame.bottom + 21);
  }
  ctx.lineCap = "round";
  for (let index = 0; index < SOURCE_COUNT; index++) {
    const shape = sources[index]?.waveform;
    if (!shape) continue;
    ctx.save();
    ctx.translate(0, index * frame.row);
    ctx.fillStyle = PIGMENTS[index];
    waveShape(ctx, frame, distance, shape, 0, SLICE_CELLS);
    ctx.globalAlpha = .12;
    ctx.fill();
    let cell = 0;
    while (cell < SLICE_CELLS) {
      if (occupied.has(sources[index].floorId * SLICE_CELLS + cell)) { cell++; continue; }
      const start = cell;
      do { cell++; }
      while (cell < SLICE_CELLS
        && !occupied.has(sources[index].floorId * SLICE_CELLS + cell));
      waveShape(ctx, frame, distance, shape, start, cell);
      ctx.globalAlpha = .82;
      ctx.fill();
    }
    ctx.restore();
    const { y } = mapXY(frame, 0, index);
    ctx.fillStyle = PIGMENTS[index];
    ctx.beginPath(); ctx.arc(frame.left - 18, y, 3.2, 0, TAU); ctx.fill();
  }
  const { x, y } = mapXY(frame, position.phase, position.lane);
  paintBall(ctx, x, y, MARBLE_RADIUS, orientation, ribbons,
    active && occupied.has(active.key) ? new Set([active.key]) : new Set());
}

function paintPlay(ctx, width, height, ribbons, orientation, phase, needle,
  wander, needleWidth, playPose) {
  const cx = width * .49, cy = height * .46;
  const radius = playRadius(width, height);
  const probe = needleNormalAt(orientation, phase, needle, wander, playPose);
  const touching = ribbons.filter(grain => zoneContainsNormal(grain, probe,
    needleRadius(needleWidth)));
  const touchingKeys = new Set(touching.map(grain => grain.key));
  const glow = ctx.createRadialGradient(cx, cy, radius * .22,
    cx, cy, radius * 1.78);
  glow.addColorStop(0, "rgba(239,90,187,.15)");
  glow.addColorStop(1, "rgba(11,6,28,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - radius * 1.78, cy - radius * 1.78, radius * 3.56, radius * 3.56);
  paintBall(ctx, cx, cy, radius,
    playerOrientation(orientation, phase, needle, wander, playPose), ribbons, touchingKeys, 0);
  paintStraw(ctx, cx, cy, radius, touching.length > 0, needleWidth);
  const locationAt = p => coordinatesOf(rotateNormal(orientation,
    needleNormalAt(orientation, p, needle, wander, playPose)));
  const needleHere = locationAt(phase);

  // The unwrapped print uses actual spherical longitude/latitude for BOTH
  // painted grains and the reader path, even after a free manual roll.
  const left = Math.min(43, width * .08), usable = width - left * 2;
  const mapHeight = Math.min(48, Math.max(31, height * .1));
  const top = height - 37 - mapHeight;
  const mapY = latitude => top + 5 + latitude / 7 * (mapHeight - 10);
  const paper = ctx.createLinearGradient(0, top, 0, top + mapHeight);
  paper.addColorStop(0, "rgba(158,104,177,.19)");
  paper.addColorStop(.54, "rgba(47,25,65,.56)");
  paper.addColorStop(1, "rgba(150,91,165,.22)");
  ctx.fillStyle = paper;
  ctx.fillRect(left, top, usable, mapHeight);
  ctx.strokeStyle = "rgba(221,166,222,.38)";
  ctx.lineWidth = .8;
  ctx.beginPath();
  ctx.moveTo(left, top + 2);
  ctx.lineTo(left + usable, top + 1);
  ctx.moveTo(left, top + mapHeight - 1);
  ctx.lineTo(left + usable, top + mapHeight);
  ctx.stroke();
  for (const grain of ribbons) {
    const coordinate = coordinatesOf(rotateNormal(orientation,
      grain.normal ?? normalAt(grain.angle, grain.latitude)));
    const x = left + coordinate.angle * usable, y = mapY(coordinate.latitude);
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(1.1, grain.angularRadius * usable * .63),
      Math.max(1, grain.latitudeRadius / 7 * mapHeight * .7), grain.tilt, 0, TAU);
    ctx.globalAlpha = touchingKeys.has(grain.key) ? .8 : .32;
    ctx.fillStyle = PIGMENTS[grain.sourceIndex];
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  let previous = null;
  for (let step = 0; step <= 96; step++) {
    const here = locationAt(step / 96);
    const x = left + here.angle * usable, y = mapY(here.latitude);
    if (previous && Math.abs(here.angle - previous.angle) <= .5)
      ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
    previous = here;
  }
  ctx.strokeStyle = "rgba(255,210,244,.82)";
  ctx.lineWidth = 1.15; ctx.stroke();
  ctx.beginPath();
  ctx.arc(left + needleHere.angle * usable, mapY(needleHere.latitude), 3.4, 0, TAU);
  ctx.fillStyle = "#ffe2f4"; ctx.fill();
  return touching.length;
}

export function createGlobuleView(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable.");
  let paper = null, paperWidth = 0, paperHeight = 0;
  function render({ mode, sources, ribbons, position, orientation, phase, needle,
    wander, needleWidth, playPose, active }) {
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width, height = bounds.height;
    if (!width || !height) return 0;
    const pixelRatio = Math.min(1.75, globalThis.devicePixelRatio || 1,
      Math.sqrt(1_400_000 / (width * height)));
    const deviceWidth = Math.round(width * pixelRatio);
    const deviceHeight = Math.round(height * pixelRatio);
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      canvas.width = deviceWidth; canvas.height = deviceHeight;
    }
    if (!paper || paperWidth !== Math.ceil(width) || paperHeight !== Math.ceil(height)) {
      paper = makePaper(width, height);
      paperWidth = Math.ceil(width); paperHeight = Math.ceil(height);
    }
    context.setTransform(deviceWidth / width, 0, 0, deviceHeight / height, 0, 0);
    context.globalAlpha = 1;
    context.drawImage(paper, 0, 0, width, height);
    if (mode === "record") {
      paintRecord(context, width, height, sources, ribbons, position, orientation, active);
      return 0;
    }
    return paintPlay(context, width, height, ribbons, orientation, phase,
      needle, wander, needleWidth, playPose);
  }
  function pointFor(event, clampOutside = false) {
    const bounds = canvas.getBoundingClientRect();
    const localX = event.clientX - bounds.left, localY = event.clientY - bounds.top;
    const frame = mapFrame(bounds.width, bounds.height);
    if (!clampOutside && (localX < frame.left || localX > frame.right
      || localY < frame.top || localY > frame.bottom)) return null;
    return {
      phase: clamp((localX - frame.left) / (frame.right - frame.left), 0, 1),
      lane: clamp((localY - frame.top) / frame.row - .5, 0, SOURCE_COUNT - 1),
    };
  }
  return { render, pointFor };
}
