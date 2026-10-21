import {
  MARBLE_RADIUS, SLICE_CELLS, SOURCE_COUNT, clamp,
  coordinatesOf, needleNormalAt, needleRadius, normalAt,
  playRadius, playerOrientation, rotateNormal, zoneBasis, zoneContainsNormal,
  zoneEdge, zoneSurfacePoint,
} from "./model.js";

const TAU = Math.PI * 2;
// The floor and captured waves share colors; the ball itself is neutral chrome.
const PIGMENTS = ["#ff65b6", "#4adbea", "#ffc365", "#b997ff",
  "#ff8757", "#f17ed5", "#c1f08b", "#6ca7ff"];
const METAL = ["#f3fdff", "#53626c", "#b5cbd1", "#19232b"];
// Look down onto the recording table: rolling across it must not look like
// spinning a flat record from the side.
const RECORD_VIEW_TILT = .92;

function recordRadius(width, height) {
  return Math.min(MARBLE_RADIUS, width * .22, height * .18);
}
function mapFrame(width, height) {
  const radius = recordRadius(width, height);
  const left = radius + 10, right = width - left;
  const top = Math.min(130, height * .30);
  const bottom = height - Math.max(56, radius + 10);
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

// Keep the floor and the play stage black, not a colored wash behind the waves.
function makeBackdrop(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

// Small imperfections rotate with the empty marble; reflections stay still in
// screen space, so its motion cannot look like a flat record spinning.
const INCLUSIONS = Array.from({ length: 160 }, (_, index) => {
  const y = 1 - 2 * (index + .5) / 160, ring = Math.sqrt(1 - y * y);
  const angle = index * 2.399963229728653 + (fleck(index * 919 + 7) - .5) * .7;
  return {
    normal: [ring * Math.cos(angle), y, ring * Math.sin(angle)],
    size: .003 + fleck(index * 991 + 78) ** 3 * .03,
    aspect: .65 + fleck(index * 577 + 29) * .45,
    angle: fleck(index * 301 + 31) * TAU,
  };
});

function surfacePoint(cx, cy, radius, normal, orientation, tilt) {
  const [x, y, z] = rotateNormal(orientation, normal);
  const up = Math.sqrt(1 - tilt * tilt);
  return { x: cx + x * radius, y: cy - (y * up - z * tilt) * radius,
    front: y * tilt + z * up };
}
const waveHeight = value => Math.sign(value) * Math.sqrt(Math.abs(value));
// Grain geometry never changes after pickup. Cache spherical points, then
// rotate only the visible grains each frame; the audio clock takes priority.
const GRAIN_GEOMETRY = new WeakMap();
function geometryFor(grain) {
  let geometry = GRAIN_GEOMETRY.get(grain);
  if (geometry) return geometry;
  const basis = zoneBasis(grain);
  const angle = grain.tilt ?? 0, cosine = Math.cos(angle), sine = Math.sin(angle);
  const surface = (u, v) => zoneSurfacePoint(grain,
    u * cosine - v * sine, u * sine + v * cosine, basis);
  const outline = Array.from({ length: 16 }, (_, vertex) => {
    const theta = vertex * TAU / 16, edge = zoneEdge(grain, theta);
    return surface(Math.cos(theta) * edge, Math.sin(theta) * edge);
  });
  const trace = grain.waveTrace?.length > 1
    ? Array.from(grain.waveTrace, (value, sample) => surface(
      -.8 + sample / (grain.waveTrace.length - 1) * 1.6,
      waveHeight(value) * .72))
    : null;
  geometry = { basis, outline, trace,
    reach: Math.max(TAU * grain.angularRadius, Math.PI * grain.latitudeRadius / 7) * 1.3 };
  GRAIN_GEOMETRY.set(grain, geometry);
  return geometry;
}

// A collected mark stays at one location on the marble. Find whether a newer
// zone crosses older paint once, not on every audio-driven animation frame.
const OVERLAPPING_GRAINS = new WeakMap();
function overlappingGrains(ribbons) {
  let overlapping = OVERLAPPING_GRAINS.get(ribbons);
  if (overlapping) return overlapping;
  overlapping = new Set();
  const earlier = [];
  for (const grain of ribbons) {
    const geometry = geometryFor(grain);
    for (const prior of earlier) {
      const other = geometryFor(prior);
      const [x, y, z] = geometry.basis.center;
      const [u, v, w] = other.basis.center;
      const reach = geometry.reach + other.reach;
      // Opposite sides can project to the same screen pixels without ever
      // sharing a spherical zone. Reject those pairs before testing edges.
      if (2 - 2 * (x * u + y * v + z * w) > reach * reach) continue;
      if (zoneContainsNormal(prior, geometry.basis.center)
        || zoneContainsNormal(grain, other.basis.center)
        || geometry.outline.some(point => zoneContainsNormal(prior, point))
        || other.outline.some(point => zoneContainsNormal(grain, point))) {
        overlapping.add(grain);
        break;
      }
    }
    earlier.push(grain);
  }
  OVERLAPPING_GRAINS.set(ribbons, overlapping);
  return overlapping;
}

function outlinePath(ctx, outline) {
  ctx.beginPath();
  for (let vertex = 0; vertex < outline.length; vertex++) {
    const point = outline[vertex];
    if (!vertex) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function projectGrain(geometry, cx, cy, radius, orientation, tilt) {
  const center = surfacePoint(cx, cy, radius, geometry.basis.center, orientation, tilt);
  if (center.front < -.06) return null;
  const outline = geometry.outline.map(normal =>
    surfacePoint(cx, cy, radius, normal, orientation, tilt));
  return { center, outline };
}

function paintGrain(ctx, grain, geometry, projected, contacting, cx, cy,
  radius, orientation, tilt, opacity) {
  const { center, outline } = projected;
  const trace = geometry.trace, touched = contacting.has(grain.key);
  const color = PIGMENTS[grain.sourceIndex];
  outlinePath(ctx, outline);
  // The patch is the whole sounding zone, including the space between wave
  // crests. Its waveform is paint, never an additional contact test.
  ctx.globalAlpha = opacity * (trace
    ? .11 + Math.max(0, center.front) * .15
    : .35 + Math.max(0, center.front) * .5);
  ctx.fillStyle = color;
  ctx.fill();
  if (touched) {
    ctx.globalAlpha = opacity * .14;
    ctx.fillStyle = "#f8ffff";
    ctx.fill();
  }
  if (trace) {
    ctx.save();
    ctx.clip();
    ctx.beginPath();
    let open = false;
    for (const normal of trace) {
      const point = surfacePoint(cx, cy, radius, normal, orientation, tilt);
      if (point.front < .01) { open = false; continue; }
      if (open) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
      open = true;
    }
    ctx.globalAlpha = opacity * (.26 + Math.max(0, center.front) * .5);
    ctx.strokeStyle = "#080d12";
    ctx.lineWidth = Math.max(2, radius * .025);
    ctx.lineJoin = ctx.lineCap = "round";
    ctx.stroke();
    ctx.globalAlpha = opacity * (touched ? 1 : .5 + Math.max(0, center.front) * .48);
    ctx.strokeStyle = touched ? "#f8ffff" : color;
    ctx.lineWidth = Math.max(1.4, radius * .015);
    ctx.stroke();
    ctx.restore();
  }
}

function paintBall(ctx, cx, cy, radius, orientation, ribbons,
  contacting = new Set(), tilt = .25, transparency = 0) {
  ctx.save();
  const shadow = ctx.createRadialGradient(cx + radius * .07, cy + radius * .94, 0,
    cx + radius * .1, cy + radius * .94, radius * 1.37);
  shadow.addColorStop(0, "rgba(151,184,193,.20)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(cx + radius * .1, cy + radius * .94,
    radius * 1.35, radius * .33, -.11, 0, TAU);
  ctx.fill();

  const body = ctx.createRadialGradient(cx - radius * .31, cy - radius * .42,
    radius * .01, cx + radius * .18, cy + radius * .12, radius * 1.24);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(.18, "#e0edf0");
  body.addColorStop(.32, "#667982");
  body.addColorStop(.48, "#12232c");
  body.addColorStop(.6, "#c7dce1");
  body.addColorStop(.78, "#4b5d65");
  body.addColorStop(1, "#070c12");
  ctx.beginPath(); ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fillStyle = body; ctx.fill();
  ctx.save(); ctx.clip();

  // Broad light/dark studio reflections give the ball a mirror-chrome
  // surface, not tinted glass or moving concentric stripes.
  const reflection = ctx.createLinearGradient(
    cx - radius * .32, cy - radius, cx + radius * .24, cy + radius);
  reflection.addColorStop(0, "rgba(255,255,255,.48)");
  reflection.addColorStop(.24, "rgba(0,8,16,.09)");
  reflection.addColorStop(.35, "rgba(0,7,13,.72)");
  reflection.addColorStop(.47, "rgba(240,253,255,.65)");
  reflection.addColorStop(.54, "rgba(255,255,255,.22)");
  reflection.addColorStop(.66, "rgba(3,12,20,.60)");
  reflection.addColorStop(.84, "rgba(187,219,226,.24)");
  reflection.addColorStop(1, "rgba(0,0,0,.46)");
  ctx.fillStyle = reflection;
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  const glint = ctx.createLinearGradient(cx - radius, cy - radius, cx + radius * .4, cy);
  glint.addColorStop(0, "rgba(255,255,255,0)");
  glint.addColorStop(.51, "rgba(255,255,255,.72)");
  glint.addColorStop(1, "rgba(182,223,231,.04)");
  ctx.fillStyle = glint;
  ctx.beginPath();
  ctx.moveTo(cx - radius * .94, cy - radius * .38);
  ctx.bezierCurveTo(cx - radius * .57, cy - radius * .98,
    cx + radius * .08, cy - radius * .84, cx + radius * .26, cy - radius * .62);
  ctx.bezierCurveTo(cx - radius * .09, cy - radius * .57,
    cx - radius * .52, cy - radius * .35, cx - radius * .94, cy - radius * .19);
  ctx.closePath(); ctx.fill();

  for (let index = 0; index < INCLUSIONS.length; index++) {
    const inclusion = INCLUSIONS[index];
    const point = surfacePoint(cx, cy, radius, inclusion.normal, orientation, tilt);
    if (point.front < .09) continue;
    const size = radius * inclusion.size * Math.sqrt(point.front);
    ctx.fillStyle = METAL[index % METAL.length];
    ctx.globalAlpha = .19 + point.front * .31;
    ctx.beginPath();
    ctx.ellipse(point.x, point.y, size, size * inclusion.aspect, inclusion.angle, 0, TAU);
    ctx.fill();
    if (index % 5 === 0) {
      ctx.fillStyle = "#f3feff";
      ctx.globalAlpha = .18 + point.front * .24;
      ctx.beginPath();
      ctx.arc(point.x - size * .32, point.y - size * .23, Math.max(.3, size * .2), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  const overlaps = transparency > 0 && ribbons.length > 1
    ? overlappingGrains(ribbons) : null;
  for (const grain of ribbons) {
    const geometry = geometryFor(grain);
    const projected = projectGrain(geometry, cx, cy, radius, orientation, tilt);
    const opacity = overlaps?.has(grain) ? 1 - transparency / 100 : 1;
    if (projected && opacity > 0) paintGrain(ctx, grain, geometry, projected, contacting,
      cx, cy, radius, orientation, tilt, opacity);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // Screen-anchored specular spot: it stays put as the wave paint rolls.
  const bloom = ctx.createRadialGradient(cx - radius * .4, cy - radius * .48, 0,
    cx - radius * .36, cy - radius * .45, radius * .84);
  bloom.addColorStop(0, "rgba(255,255,255,.48)");
  bloom.addColorStop(.3, "rgba(227,251,255,.11)");
  bloom.addColorStop(1, "rgba(255,255,255,0)");
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
  ctx.strokeStyle = "#080e13";
  ctx.lineWidth = Math.max(8, radius * .09);
  ctx.shadowColor = "rgba(0,0,0,.75)";
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
    ctx.strokeStyle = "rgba(22,40,48,.85)";
    ctx.lineWidth = Math.max(1, radius * .012);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - nx * half + dx / length * 1.8, y - ny * half + dy / length * 1.8);
    ctx.lineTo(x + nx * half + dx / length * 1.8, y + ny * half + dy / length * 1.8);
    ctx.strokeStyle = "rgba(245,253,255,.65)";
    ctx.lineWidth = Math.max(.8, radius * .006);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(start.x, start.y, radius * .018, radius * .037, -.2, 0, TAU);
  ctx.fillStyle = "#101a20"; ctx.fill();
  ctx.strokeStyle = "#97f3ee"; ctx.lineWidth = Math.max(1, radius * .009);
  ctx.stroke();
  const footprint = radius * Math.sin(needleRadius(width));
  if (touching) {
    const glowRadius = Math.max(radius * .12, footprint * 1.65);
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    glow.addColorStop(0, "rgba(255,255,255,.6)");
    glow.addColorStop(1, "rgba(255,120,203,0)");
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, glowRadius, 0, TAU); ctx.fill();
  }
  if (footprint > radius * .035) {
    // A translucent mouth shows the actual circular area sampled by the
    // audio clock; it widens in place without hiding the paint below it.
    ctx.beginPath(); ctx.arc(cx, cy, footprint, 0, TAU);
    ctx.fillStyle = "rgba(30,53,60,.19)"; ctx.fill();
    ctx.strokeStyle = touching ? "#f8ffff" : "#ff9bd6";
    ctx.lineWidth = Math.max(1.2, radius * .012);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * .027, radius * .033, -.7, 0, TAU);
  ctx.fillStyle = "#18252d"; ctx.fill();
  ctx.strokeStyle = "#ffd1ec"; ctx.lineWidth = Math.max(1, radius * .008);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius * .013, 0, TAU);
  ctx.fillStyle = touching ? "#fff7e9" : "#ec8ac3";
  ctx.fill();
  ctx.restore();
}

function waveAt(trace, phase) {
  // Reflect only the off-table overhang, so the ribbons continue to both
  // sides without hard caps, labels, or a discontinuity at phase 0/1.
  const p = clamp(phase < 0 ? -phase : phase > 1 ? 2 - phase : phase, 0, 1);
  const at = p * (trace.length - 1);
  const first = Math.floor(at), next = Math.min(first + 1, trace.length - 1);
  return waveHeight(trace[first] * (1 - (at - first)) + trace[next] * (at - first));
}

function wavePath(ctx, frame, trace, x0, x1, y) {
  const distance = frame.right - frame.left;
  const step = distance / (SLICE_CELLS * 2);
  ctx.beginPath();
  for (let x = x0; x < x1; x += step) {
    const height = waveAt(trace, (x - frame.left) / distance) * frame.row * .41;
    if (x === x0) ctx.moveTo(x, y - height);
    else ctx.lineTo(x, y - height);
  }
  ctx.lineTo(x1, y - waveAt(trace, (x1 - frame.left) / distance) * frame.row * .41);
}

function paintRecord(ctx, width, height, sources, ribbons, position, orientation,
  active, transparency) {
  const frame = mapFrame(width, height), distance = frame.right - frame.left;
  const occupied = new Set(ribbons.map(grain => grain.key));
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let index = 0; index < SOURCE_COUNT; index++) {
    const trace = sources[index]?.waveTrace;
    if (!trace?.length) continue;
    const { y } = mapXY(frame, 0, index);
    const color = PIGMENTS[index];
    // The dim trace records where a wave was; only uncollected cells shine.
    wavePath(ctx, frame, trace, 0, width, y);
    ctx.strokeStyle = color;
    ctx.globalAlpha = .11;
    ctx.lineWidth = 1.35;
    ctx.stroke();
    let cell = 0;
    while (cell < SLICE_CELLS) {
      if (occupied.has(sources[index].floorId * SLICE_CELLS + cell)) { cell++; continue; }
      const start = cell;
      do { cell++; }
      while (cell < SLICE_CELLS
        && !occupied.has(sources[index].floorId * SLICE_CELLS + cell));
      wavePath(ctx, frame, trace,
        start ? frame.left + start / SLICE_CELLS * distance : 0,
        cell === SLICE_CELLS ? width : frame.left + cell / SLICE_CELLS * distance, y);
      ctx.globalAlpha = .17;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.globalAlpha = .95;
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
  const { x, y } = mapXY(frame, position.phase, position.lane);
  paintBall(ctx, x, y, recordRadius(width, height), orientation, ribbons,
    active && occupied.has(active.key) ? new Set([active.key]) : new Set(),
    RECORD_VIEW_TILT, transparency);
}

function paintPlay(ctx, width, height, ribbons, orientation, phase, needle,
  wander, needleWidth, playPose, transparency) {
  const cx = width * .49, cy = height * .46;
  const radius = playRadius(width, height);
  const probe = needleNormalAt(orientation, phase, needle, wander, playPose);
  const touching = ribbons.filter(grain => zoneContainsNormal(grain, probe,
    needleRadius(needleWidth)));
  const touchingKeys = new Set(touching.map(grain => grain.key));
  const glow = ctx.createRadialGradient(cx, cy, radius * .22,
    cx, cy, radius * 1.78);
  glow.addColorStop(0, "rgba(143,184,194,.12)");
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(cx - radius * 1.78, cy - radius * 1.78, radius * 3.56, radius * 3.56);
  paintBall(ctx, cx, cy, radius,
    playerOrientation(orientation, phase, needle, wander, playPose), ribbons,
    touchingKeys, 0, transparency);
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
  ctx.fillStyle = "#06090b";
  ctx.fillRect(left, top, usable, mapHeight);
  ctx.strokeStyle = "rgba(195,220,229,.3)";
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
    const trace = grain.waveTrace;
    ctx.beginPath();
    if (trace?.length > 1) {
      const reach = Math.max(1.1, grain.angularRadius * usable * .63);
      const rise = Math.max(1, grain.latitudeRadius / 7 * mapHeight * .7);
      const cosine = Math.cos(grain.tilt), sine = Math.sin(grain.tilt);
      for (let sample = 0; sample < trace.length; sample++) {
        const dx = (sample / (trace.length - 1) * 2 - 1) * reach;
        const dy = -waveHeight(trace[sample]) * rise;
        const px = x + dx * cosine - dy * sine;
        const py = y + dx * sine + dy * cosine;
        if (sample) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.globalAlpha = touchingKeys.has(grain.key) ? .9 : .58;
      ctx.strokeStyle = PIGMENTS[grain.sourceIndex];
      ctx.lineWidth = 1.05;
      ctx.stroke();
    } else {
      ctx.ellipse(x, y, Math.max(1.1, grain.angularRadius * usable * .63),
        Math.max(1, grain.latitudeRadius / 7 * mapHeight * .7), grain.tilt, 0, TAU);
      ctx.globalAlpha = touchingKeys.has(grain.key) ? .8 : .32;
      ctx.fillStyle = PIGMENTS[grain.sourceIndex];
      ctx.fill();
    }
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
  ctx.strokeStyle = "rgba(234,249,253,.82)";
  ctx.lineWidth = 1.15; ctx.stroke();
  ctx.beginPath();
  ctx.arc(left + needleHere.angle * usable, mapY(needleHere.latitude), 3.4, 0, TAU);
  ctx.fillStyle = "#f2fcff"; ctx.fill();
  return touching.length;
}

export function createGlobuleView(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas is unavailable.");
  let backdrop = null, backdropWidth = 0, backdropHeight = 0;
  function render({ mode, sources, ribbons, position, orientation, phase, needle,
    wander, needleWidth, playPose, active, layerTransparency = 0 }) {
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
    if (!backdrop || backdropWidth !== Math.ceil(width) || backdropHeight !== Math.ceil(height)) {
      backdrop = makeBackdrop(width, height);
      backdropWidth = Math.ceil(width); backdropHeight = Math.ceil(height);
    }
    context.setTransform(deviceWidth / width, 0, 0, deviceHeight / height, 0, 0);
    context.globalAlpha = 1;
    context.drawImage(backdrop, 0, 0, width, height);
    if (mode === "record") {
      paintRecord(context, width, height, sources, ribbons, position, orientation,
        active, layerTransparency);
      return 0;
    }
    return paintPlay(context, width, height, ribbons, orientation, phase,
      needle, wander, needleWidth, playPose, layerTransparency);
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
