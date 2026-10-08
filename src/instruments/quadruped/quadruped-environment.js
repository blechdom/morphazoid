import { quadrupedCollageImage } from "./quadruped-visual-skins.js";

const TAU = Math.PI * 2;
const SKINS = new Set(["animal", "skeleton", "constellation", "collage", "motion-card"]);
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const mix = (a, b, amount) => a + (b - a) * amount;
const mod = (value, period) => ((value % period) + period) % period;
const hash = (cell, salt = 0) => {
  let value = (Math.trunc(cell) ^ salt) >>> 0;
  value = Math.imul(value ^ value >>> 16, 0x7feb352d);
  value = Math.imul(value ^ value >>> 15, 0x846ca68b);
  return ((value ^ value >>> 16) >>> 0) / 4294967296;
};
const THEMES = Object.freeze({
  animal: { sky: ["#101c1d", "#344132"], ground: "#65583b", ink: "#b2b780", props: ["cactus", "tumbleweed", "rock", "grass"] },
  skeleton: { sky: ["#151821", "#353c39"], ground: "#252b27", ink: "#b9c3a9", props: ["dead-tree", "tombstone", "ribs", "bone", "grave"] },
  constellation: { sky: ["#071124", "#0e1b36"], ground: "#101a32", ink: "#799de9", props: ["laser", "prism", "laser", "pylon"] },
  collage: { sky: ["#193b49", "#426c67"], ground: "#937947", ink: "#fff9e8", props: ["paper-tree", "cactus", "paper-flower", "tumbleweed"] },
  "motion-card": { sky: ["#eee4cd", "#ded0af"], ground: "#c7b796", ink: "#665539", props: ["cactus", "tumbleweed", "dead-tree", "grass"] },
});

// Screen position is entirely a function of the audio-clock motor's travel.
// A paused world is bit-for-bit stable; crossing a cell boundary only adds an
// offscreen prop and cannot reseed anything already visible. There are no timers.
export function deriveQuadrupedEnvironmentLayout(options = {}) {
  const width = clamp(finite(options.width, 1), 1, 8192);
  const height = clamp(finite(options.height, 1), 1, 4096);
  const groundY = clamp(finite(options.groundY, height * 0.74), 0, height);
  const worldScale = clamp(finite(options.worldScale, height * 0.16), 0.01, 4096);
  const worldX = clamp(finite(options.worldX, 0), -1e9, 1e9);
  const skinId = SKINS.has(options.skinId) ? options.skinId : "animal";
  const sampleGround = typeof options.groundAt === "function" ? options.groundAt : () => groundY;
  const groundAt = x => clamp(finite(sampleGround(x), groundY), -height, height * 2);
  const theme = THEMES[skinId];
  const salt = [...skinId].reduce((value, letter) => Math.imul(value + letter.charCodeAt(0), 31), 193);
  const props = [];
  const maxPerLayer = options.compact ? 5 : 7;
  for (const [layer, parallax] of [[0, 0.28], [1, 0.82]]) {
    const spacing = Math.max(2.5, width / maxPerLayer / worldScale / parallax);
    const left = worldX - width * 0.7 / (worldScale * parallax);
    const firstCell = Math.floor(left / spacing);
    const count = Math.min(13, Math.ceil(width * 1.4 / (spacing * worldScale * parallax)) + 2);
    for (let i = 0; i < count; i++) {
      const cell = firstCell + i;
      const seed = hash(cell, salt + layer * 719);
      const world = (cell + 0.15 + seed * 0.66) * spacing;
      const x = width * 0.5 + (world - worldX) * worldScale * parallax;
      const y = groundAt(x) - height * (layer === 0 ? 0.075 : 0.009);
      const size = Math.max(0, Math.min(height * (layer === 0 ? 0.17 : 0.22), Math.max(11, worldScale * (layer === 0 ? 0.56 : 0.85)), (y - Math.min(58, height * 0.36)) / (skinId === "constellation" ? 1.3 : 1)));
      const focusFade = clamp(0.27 + Math.abs(x - width * 0.5) / Math.max(1, width * 0.34), 0.27, 1);
      props.push({ id: `${skinId}:${layer}:${cell}`, cell, layer, parallax, world, x, y, size, seed,
        kind: theme.props[Math.floor(hash(cell, salt + layer * 719 + 47) * theme.props.length)],
        alpha: (layer === 0 ? 0.35 : 0.72) * focusFade,
        rotation: worldX * worldScale * parallax / Math.max(8, size * 0.3) + seed * TAU,
      });
    }
  }
  return { width, height, groundY, worldScale, worldX, skinId, props, groundAt, theme };
}

function traceTerrain(context, layout, fill = false) {
  const { width, height, groundAt } = layout;
  const step = Math.max(2, width / 900);
  context.beginPath();
  if (fill) context.moveTo(0, height);
  else context.moveTo(0, groundAt(0));
  for (let x = 0; x < width; x += step) context.lineTo(x, groundAt(x));
  context.lineTo(width, groundAt(width));
  if (fill) { context.lineTo(width, height); context.closePath(); }
}
function skyClip(context, layout) {
  const { width, height, groundAt } = layout;
  context.beginPath(); context.moveTo(0, -height); context.lineTo(width, -height);
  context.lineTo(width, groundAt(width));
  for (let x = width; x >= 0; x -= Math.max(2, width / 900)) context.lineTo(x, groundAt(x));
  context.closePath(); context.clip();
}
function polygon(context, points) {
  context.beginPath(); points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y)); context.closePath();
}
function line(context, points, color, width = 1) {
  context.beginPath(); points.forEach(([x, y], i) => i ? context.lineTo(x, y) : context.moveTo(x, y));
  context.strokeStyle = color; context.lineWidth = width; context.stroke();
}
function photoPiece(context, image, field, points, border = 2, opacity = 1) {
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(1, Math.max(...xs) - left), height = Math.max(1, Math.max(...ys) - top);
  context.save(); polygon(context, points); context.globalAlpha *= opacity;
  context.fillStyle = ["#629da0", "#b84634", "#507566", "#445f81", "#b2934f", "#884769"][field]; context.fill();
  context.save(); context.clip();
  if (image?.complete && image.naturalWidth) {
    const cell = image.naturalWidth / 3;
    const ratio = width / height;
    const cropWidth = ratio > 1 ? cell : cell * ratio, cropHeight = ratio > 1 ? cell / ratio : cell;
    context.drawImage(image, (field % 3) * cell + (cell - cropWidth) / 2, Math.floor(field / 3) * cell + (cell - cropHeight) / 2, cropWidth, cropHeight, left, top, width, height);
  }
  context.restore();
  if (border > 0) { context.strokeStyle = "#fff6e5"; context.lineWidth = border; context.stroke(); }
  context.restore();
}
function tornRectangle(x, y, width, height, seed) {
  const points = [[x, y]];
  for (let i = 1; i <= 12; i++) points.push([x + width * i / 12, y + (hash(i, seed) - 0.5) * 6]);
  for (let i = 1; i <= 5; i++) points.push([x + width + (hash(i, seed + 17) - 0.5) * 6, y + height * i / 5]);
  for (let i = 11; i >= 0; i--) points.push([x + width * i / 12, y + height + (hash(i, seed + 31) - 0.5) * 6]);
  points.push([x, y]); return points;
}

function drawCheckerWorld(context, layout, surface) {
  const { width, height, worldX, worldScale, groundAt } = layout;
  const cell = clamp(height * 0.15, 25, 64);
  const scroll = mod(worldX * worldScale * 0.22, cell);
  context.save(); skyClip(context, layout);
  // Outlines only: no star field, alternating solid tiles, or fake perspective
  // in the sky. The animal remains the brightest connected-line construction.
  context.strokeStyle = "#6087c42b"; context.lineWidth = 0.75;
  context.beginPath();
  for (let x = -scroll; x <= width + cell; x += cell) { context.moveTo(x, 0); context.lineTo(x, height); }
  for (let y = cell; y <= height; y += cell) { context.moveTo(0, y); context.lineTo(width, y); }
  context.stroke(); context.restore();
  traceTerrain(context, layout, true); context.fillStyle = "#101a30"; context.fill();
  context.save(); traceTerrain(context, layout, true); context.clip();
  const spacing = clamp(width / 8, 32, 100), shift = mod(worldX * worldScale * 0.82, spacing);
  context.strokeStyle = surface?.id === "water" ? "#64c9e877" : surface?.id === "crystal" ? "#bb82ef77" : "#778fd573";
  context.lineWidth = 0.85;
  for (let endX = -width - shift; endX <= width * 2 + spacing; endX += spacing) {
    context.beginPath();
    for (let step = 0; step <= 12; step++) {
      const t = step / 12, x = mix(width * 0.5 + (endX - width * 0.5) * 0.19, endX, t);
      const y = mix(groundAt(x), height, t);
      if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }
  for (let row = 1; row <= 7; row++) {
    const t = (row / 7) ** 1.9;
    context.beginPath();
    for (let x = 0; x <= width; x += Math.max(3, width / 160)) {
      const y = mix(groundAt(x), height, t);
      if (x === 0) context.moveTo(x, y); else context.lineTo(x, y);
    }
    context.stroke();
  }
  context.restore(); traceTerrain(context, layout); context.strokeStyle = "#9aacdf8c"; context.lineWidth = 1; context.stroke();
}

function drawCollageWorld(context, layout, image) {
  const { width, height, worldScale, worldX } = layout;
  context.save(); skyClip(context, layout);
  const tileWidth = Math.max(130, height * 1.22), shift = mod(worldX * worldScale * 0.18, tileWidth);
  const first = Math.floor(worldX * worldScale * 0.18 / tileWidth);
  for (let i = -1; i < Math.ceil(width / tileWidth) + 1; i++) {
    const x = i * tileWidth - shift, seed = first + i;
    photoPiece(context, image, mod(seed, 2) === 0 ? 0 : 3, tornRectangle(x - 3, -6, tileWidth + 7, height + 12, seed), 2.4, 0.5);
  }
  // A clipped fruit photograph becomes a paper sun; hills remain layered
  // magazine fragments. Every bright seam is the edge of an actual photo cutout.
  const sunX = width * 0.79, sunY = Math.min(height * 0.24, 82), sunR = Math.min(height * 0.09, width * 0.075);
  const sun = Array.from({ length: 30 }, (_, i) => [sunX + Math.cos(i / 30 * TAU) * sunR, sunY + Math.sin(i / 30 * TAU) * sunR]);
  photoPiece(context, image, 4, sun, 2.4, 0.84);
  const hillWidth = Math.max(140, width / 3), hillShift = mod(worldX * worldScale * 0.3, hillWidth);
  const hillCell = Math.floor(worldX * worldScale * 0.3 / hillWidth);
  for (let i = -1; i < Math.ceil(width / hillWidth) + 1; i++) {
    const x = i * hillWidth - hillShift, y = height * 0.7;
    photoPiece(context, image, mod(hillCell + i, 2) ? 2 : 5, [[x - 5, y], [x + hillWidth * 0.16, y - height * 0.08], [x + hillWidth * 0.37, y - height * 0.13], [x + hillWidth * 0.59, y - height * 0.07], [x + hillWidth * 0.91, y - height * 0.14], [x + hillWidth + 5, y], [x + hillWidth + 5, height], [x - 5, height]], 2, 0.47);
  }
  context.restore();
  traceTerrain(context, layout, true); context.fillStyle = "#9c8059"; context.fill();
  context.save(); traceTerrain(context, layout, true); context.clip();
  const groundWidth = Math.max(100, height * 0.6), groundShift = mod(worldX * worldScale, groundWidth);
  const groundCell = Math.floor(worldX * worldScale / groundWidth);
  for (let i = -1; i < Math.ceil(width / groundWidth) + 1; i++) {
    photoPiece(context, image, mod(groundCell + i, 3) === 0 ? 2 : 4, tornRectangle(i * groundWidth - groundShift - 3, 0, groundWidth + 6, height + 4, groundCell + i), 3, 0.64);
  }
  context.restore();
  traceTerrain(context, layout); context.strokeStyle = "#fff8e9"; context.lineWidth = 3; context.stroke();
}

function drawMaterial(context, layout, surface = {}) {
  const { width, height, worldScale, worldX, groundAt, skinId } = layout;
  const spacing = clamp(worldScale * 0.65, 18, 70), shift = mod(worldX * worldScale, spacing);
  context.save(); traceTerrain(context, layout, true); context.clip();
  context.globalAlpha *= skinId === "collage" ? 0.22 : skinId === "skeleton" ? 0.17 : 0.32;
  context.strokeStyle = skinId === "motion-card" ? "#665539" : surface.id === "snow" ? "#f2f6ee" : surface.id === "water" ? "#91d5e3" : "#cfba8c";
  context.fillStyle = context.strokeStyle; context.lineWidth = 0.8;
  for (let i = -1; i < Math.ceil(width / spacing) + 1; i++) {
    const x = i * spacing - shift, floor = groundAt(x);
    if (surface.id === "wood") line(context, [[x, floor], [x + spacing * 0.3, height]], context.strokeStyle, 1);
    else if (["metal", "stone"].includes(surface.id)) {
      context.strokeRect(x + 2, floor + 8, spacing - 4, Math.max(9, height - floor - 14));
      if (surface.id === "metal") { context.beginPath(); context.arc(x + 6, floor + 13, 1, 0, TAU); context.fill(); }
    } else if (surface.id === "crystal") line(context, [[x, floor + 18], [x + spacing * 0.45, floor + 5], [x + spacing * 0.85, floor + 22], [x, floor + 18]], context.strokeStyle);
    else if (surface.id === "water") {
      context.beginPath(); context.ellipse(x + spacing * 0.4, floor + 13 + mod(i, 3) * 5, spacing * 0.4, 3, 0, 0, Math.PI); context.stroke();
    } else {
      for (let j = 0; j < 3; j++) {
        context.beginPath(); context.ellipse(x + j * spacing * 0.22, floor + 10 + j * 13, surface.id === "snow" ? 1.4 : 2.4, 1, 0.2, 0, TAU); context.fill();
      }
    }
  }
  context.restore();
}

function drawProp(context, prop, layout, image) {
  const { kind, size: s, x, y, seed } = prop;
  if (s < 2 || x + s < 0 || x - s > layout.width) return;
  const paper = layout.skinId === "motion-card", collage = layout.skinId === "collage";
  const ink = paper ? "#69573b" : layout.skinId === "skeleton" ? "#9daa96" : "#758968";
  context.save(); context.globalAlpha *= prop.alpha; context.translate(x, y); context.lineCap = "round"; context.lineJoin = "round";
  context.strokeStyle = ink; context.fillStyle = paper ? "#77613e17" : "#17241d"; context.lineWidth = Math.max(0.8, s * 0.022);
  if (["dead-tree", "paper-tree"].includes(kind)) {
    const branches = [[[0, 0], [-0.05, -0.42], [0.02, -0.82], [-0.05, -1]], [[-0.035, -0.35], [-0.3, -0.54], [-0.38, -0.87]], [[0, -0.56], [0.27, -0.74], [0.38, -0.71]], [[-0.28, -0.52], [-0.45, -0.63]], [[0.26, -0.74], [0.21, -0.96]], [[0.015, -0.73], [-0.17, -0.9]]];
    for (let i = 0; i < branches.length; i++) {
      const points = branches[i].map(([px, py]) => [px * s, py * s]);
      if (collage) line(context, points, "#fff6e5", Math.max(2.5, s * 0.09));
      line(context, points, collage ? "#609887" : ink, Math.max(0.9, s * (i === 0 ? 0.07 : 0.023)));
    }
    if (collage) for (let i = 0; i < 3; i++) {
      const px = (i - 1) * s * 0.25, py = -s * (0.62 + (i % 2) * 0.24);
      photoPiece(context, image, i === 1 ? 1 : 3, [[px - s * 0.13, py], [px - s * 0.2, py - s * 0.17], [px, py - s * 0.24], [px + s * 0.17, py - s * 0.12], [px + s * 0.06, py + s * 0.08]], 1.7);
    }
  } else if (kind === "tombstone" || kind === "grave") {
    context.rotate((seed - 0.5) * 0.16);
    if (kind === "grave") {
      line(context, [[0, 0], [0, -s * 0.92]], ink, Math.max(2, s * 0.11));
      line(context, [[-s * 0.28, -s * 0.61], [s * 0.28, -s * 0.61]], ink, Math.max(2, s * 0.1));
    } else {
      context.beginPath(); context.moveTo(-s * 0.26, 0); context.lineTo(-s * 0.26, -s * 0.52); context.quadraticCurveTo(-s * 0.27, -s * 0.95, s * 0.05, -s * 0.93); context.quadraticCurveTo(s * 0.29, -s * 0.9, s * 0.29, -s * 0.49); context.lineTo(s * 0.29, 0); context.closePath(); context.fill(); context.stroke();
      line(context, [[0, -s * 0.65], [0, -s * 0.32]], ink, 0.9);
      line(context, [[-s * 0.11, -s * 0.52], [s * 0.11, -s * 0.52]], ink, 0.9);
      line(context, [[-s * 0.15, -s * 0.19], [s * 0.13, -s * 0.19]], ink, 0.65);
    }
    context.beginPath(); context.ellipse(0, 1, s * 0.43, s * 0.07, 0, 0, TAU); context.stroke();
  } else if (kind === "bone" || kind === "ribs") {
    if (kind === "ribs") {
      for (let i = 0; i < 5; i++) {
        context.beginPath(); context.ellipse((i - 2) * s * 0.14, -s * 0.11, s * 0.14, s * (0.27 - Math.abs(i - 2) * 0.035), -0.15, Math.PI, TAU + 0.2); context.stroke();
      }
      line(context, [[-s * 0.4, -s * 0.08], [s * 0.41, -s * 0.13]], ink, Math.max(1, s * 0.032));
    } else {
      context.rotate(-0.2); line(context, [[-s * 0.4, -s * 0.12], [s * 0.35, -s * 0.12]], ink, Math.max(1.2, s * 0.065));
      for (const end of [-0.4, 0.35]) for (const off of [-0.05, 0.05]) { context.beginPath(); context.arc(end * s, (-0.12 + off) * s, s * 0.06, 0, TAU); context.fillStyle = ink; context.fill(); }
    }
  } else if (kind === "laser" || kind === "prism" || kind === "pylon") {
    const color = seed > 0.5 ? "#c47cff" : "#69dded";
    line(context, [[-s * 0.2, 0], [0, -s * 0.62], [s * 0.2, 0], [-s * 0.2, 0]], color, 1);
    line(context, [[-s * 0.13, -s * 0.2], [s * 0.13, -s * 0.2]], color, 0.7);
    if (kind === "laser") {
      const reach = s * (1.1 + seed);
      line(context, [[0, -s * 0.6], [reach * (seed > 0.5 ? 1 : -1), -s * 1.25]], `${color}4d`, 3.5);
      line(context, [[0, -s * 0.6], [reach * (seed > 0.5 ? 1 : -1), -s * 1.25]], color, 0.7);
    } else if (kind === "prism") line(context, [[-s * 0.2, 0], [s * 0.38, -s * 0.12], [s * 0.14, -s * 0.73], [0, -s * 0.62]], color, 0.65);
  } else if (kind === "cactus") {
    const points = [[-0.09, 0], [-0.09, -0.33], [-0.3, -0.33], [-0.39, -0.44], [-0.39, -0.73], [-0.26, -0.73], [-0.26, -0.46], [-0.09, -0.46], [-0.09, -0.91], [0, -1], [0.09, -0.91], [0.09, -0.58], [0.26, -0.58], [0.26, -0.81], [0.39, -0.81], [0.39, -0.54], [0.29, -0.44], [0.09, -0.44], [0.09, 0]].map(([px, py]) => [px * s, py * s]);
    if (collage) photoPiece(context, image, 2, points, 1.8);
    else { polygon(context, points); context.fill(); context.stroke(); line(context, [[0, -s * 0.86], [0, -s * 0.05]], ink, 0.5); }
  } else if (kind === "tumbleweed") {
    const r = s * 0.28;
    context.translate(0, -r); context.rotate(prop.rotation);
    for (let i = 0; i < 6; i++) {
      context.beginPath(); context.ellipse(0, 0, r, r * (0.31 + i * 0.055), i / 6 * Math.PI, 0, TAU); context.stroke();
    }
  } else if (kind === "paper-flower") {
    line(context, [[0, 0], [s * 0.05, -s * 0.65]], "#fff6e5", 2.8);
    const points = Array.from({ length: 24 }, (_, i) => { const r = s * (i % 4 < 2 ? 0.27 : 0.19); return [Math.cos(i / 24 * TAU) * r, -s * 0.7 + Math.sin(i / 24 * TAU) * r]; });
    photoPiece(context, image, 1, points, 1.7);
  } else if (kind === "rock") {
    polygon(context, [[-s * 0.34, 0], [-s * 0.22, -s * 0.24], [s * 0.04, -s * 0.31], [s * 0.3, -s * 0.12], [s * 0.39, 0]]); context.fill(); context.stroke();
  } else for (let i = -2; i <= 2; i++) line(context, [[0, 0], [i * s * 0.09, -s * (0.17 + hash(i, Math.floor(seed * 1e5)) * 0.23)]], ink, 0.8);
  context.restore();
}

/** Draw a full skin-specific world, then leave the context ready for feet/actors. */
export function drawQuadrupedEnvironment(context, options = {}) {
  const layout = deriveQuadrupedEnvironmentLayout(options);
  const { width, height, skinId, theme } = layout;
  const image = skinId === "collage" ? quadrupedCollageImage("vintage-magazine-face-fields") : null;
  context.save(); context.beginPath(); context.rect(0, 0, width, height); context.clip();
  const sky = context.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, theme.sky[0]); sky.addColorStop(1, theme.sky[1]);
  context.fillStyle = sky; context.fillRect(0, 0, width, height);
  if (skinId === "constellation") drawCheckerWorld(context, layout, options.surface);
  else if (skinId === "collage") drawCollageWorld(context, layout, image);
  else {
    if (skinId === "skeleton") {
      const x = width * 0.8, y = height * 0.24, r = Math.min(height * 0.065, width * 0.06);
      context.save(); context.globalAlpha = 0.26; context.fillStyle = "#c6d0b7"; context.beginPath(); context.arc(x, y, r, 0, TAU); context.fill(); context.fillStyle = theme.sky[0]; context.beginPath(); context.arc(x + r * 0.45, y - r * 0.23, r * 0.88, 0, TAU); context.fill(); context.restore();
    }
    traceTerrain(context, layout, true);
    context.fillStyle = skinId === "animal" ? options.surface?.color ?? theme.ground : theme.ground; context.fill();
    traceTerrain(context, layout); context.strokeStyle = skinId === "motion-card" ? "#7d6a4380" : "#d2d5b842"; context.lineWidth = 1; context.stroke();
  }
  if (skinId !== "constellation") drawMaterial(context, layout, options.surface);
  for (const prop of layout.props) drawProp(context, prop, layout, image);
  // Keep the static title corner quiet without masking the moving stage.
  if (skinId === "collage") {
    const shade = context.createLinearGradient(0, 0, 0, Math.min(90, height * 0.42));
    shade.addColorStop(0, "#0c222759"); shade.addColorStop(1, "#0c222700");
    context.fillStyle = shade; context.fillRect(0, 0, width, Math.min(90, height * 0.42));
  }
  context.restore();
  return { skinId, propCount: layout.props.filter(p => p.x + p.size >= 0 && p.x - p.size <= width && p.size >= 2).length, collageReady: Boolean(image?.complete && image.naturalWidth) };
}
