import { chiptuneDancerPose, drawChiptuneDancer } from "../webgpu-chiptune/webgpu-chiptune-dancers.js";

// Complete figures on the original half-unit pixel grid. Poses still come from
// the audible performer; skins own no clock, audio, or musical state.
export const SKINS = Object.freeze([
  Object.freeze({ id: "original", label: "Original characters" }),
  Object.freeze({ id: "cubist", label: "Picasso pixels" }),
  Object.freeze({ id: "anime", label: "Cute anime" }),
  Object.freeze({ id: "swirl", label: "8-bit swirlies" }),
]);
const LEGACY_SKINS = Object.freeze({ animals: "anime", blobs: "swirl", arcade: "cubist" });
export function normalizeChiptuneSkin(value) {
  return SKINS.some(skin => skin.id === value) ? value
    : Object.hasOwn(LEGACY_SKINS, value) ? LEGACY_SKINS[value] : "original";
}

const INK = "#19152d", WHITE = "#fff5df", PEACH = "#ffd0b2", PINK = "#ff739f";
const VOICES = ["drums", "bass", "arp", "lead", "upperOne", "upperTwo", "noise"];
const CUBIST = ["#ff7960", "#e9b844", "#6ad5c2", "#b496f4", "#60a8f2", "#f1a7c8", "#caed79"];
const HAIR = ["#ffc55d", "#c5a2ff", "#ff94c8", "#73dedd", "#a3b4ff", "#f4a77c", "#b6e686"];

function pixelBrush(context, x, ground, unit) {
  const px = unit * .5;
  const rect = (gx, gy, width, height, color) => {
    context.fillStyle = color;
    const left = Math.round(x + gx * px), top = Math.round(ground + gy * px);
    context.fillRect(left, top,
      Math.max(1, Math.round(x + (gx + width) * px) - left),
      Math.max(1, Math.round(ground + (gy + height) * px) - top));
  };
  const line = (a, b, width, color) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))));
    for (let n = 0; n <= steps; n++) {
      rect(Math.round(a[0] + (b[0] - a[0]) * n / steps) - width / 2,
        Math.round(a[1] + (b[1] - a[1]) * n / steps) - width / 2, width, width, color);
    }
  };
  // Scan-convert facets into pixel rows instead of antialiased vector paths.
  const facet = (points, color) => {
    const top = Math.floor(Math.min(...points.map(point => point[1])));
    const bottom = Math.ceil(Math.max(...points.map(point => point[1])));
    for (let y = top; y < bottom; y++) {
      const cuts = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length], scan = y + .5;
        if ((a[1] <= scan && b[1] > scan) || (b[1] <= scan && a[1] > scan)) {
          cuts.push(a[0] + (scan - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
        }
      }
      cuts.sort((a, b) => a - b);
      for (let i = 0; i + 1 < cuts.length; i += 2) {
        const left = Math.round(cuts[i]), right = Math.round(cuts[i + 1]);
        if (right > left) rect(left, y, right - left, 1, color);
      }
    }
  };
  return { rect, line, facet };
}

function figure(brush, pose, body, accent, hands) {
  const { rect, line } = brush;
  const limb = (a, joint, b, color) => {
    const width = pose.key === "bass" ? 4 : 2;
    line(a, joint, width + 2, INK); line(joint, b, width + 2, INK);
    line(a, joint, width, color); line(joint, b, width, color);
    rect(joint[0] - 1, joint[1] - 1, 2, 2, accent);
  };
  pose.legs.forEach((leg, i) => {
    limb(leg.hip, leg.knee, leg.foot, accent);
    rect(leg.foot[0] - (i ? 1 : 4), leg.foot[1], 5, 3, INK);
    rect(leg.foot[0] - (i ? 0 : 3), leg.foot[1], 4, 2, WHITE);
  });
  const w = pose.identity.shoulders;
  rect(pose.sway - w - 1, pose.shoulderY - 1, w * 2 + 2, pose.identity.torso + 2, INK);
  rect(pose.sway - w, pose.shoulderY, w * 2, pose.identity.torso, body);
  pose.arms.forEach((arm, i) => {
    limb(arm.shoulder, arm.elbow, arm.wrist, body);
    rect(arm.wrist[0] - 2, arm.wrist[1] - 1, 4, 3, hands);
    if (pose.key === "drums") line(arm.wrist,
      [arm.wrist[0] + (i ? 1 : -1) * (3 + pose.jiggle), arm.wrist[1] - 6], 1, WHITE);
  });
}

function cubistFigure(brush, pose, index) {
  const { rect, line, facet } = brush;
  const main = CUBIST[index], other = CUBIST[(index + 2) % CUBIST.length];
  figure(brush, pose, main, "#5586ce", "#eacb7a");
  const sx = pose.sway, sy = pose.shoulderY, w = pose.identity.shoulders;
  facet([[sx - w, sy], [sx + w, sy + 3], [sx - w, pose.hipY]], other);
  rect(sx, sy + 2, 1, pose.identity.torso - 3, INK);
  rect(sx + 1, pose.hipY - 3, Math.max(1, w - 1), 2, WHITE);
  const [x, y] = pose.head;
  facet([[x - 7, y - 7], [x + 2, y - 9], [x + 6, y - 5],
    [x + 7, y + 2], [x + 1, y + 5], [x - 6, y + 3]], INK);
  facet([[x - 6, y - 6], [x, y - 8], [x + 1, y + 4], [x - 5, y + 2]], main);
  facet([[x, y - 8], [x + 5, y - 4], [x + 6, y + 1], [x + 1, y + 4]], "#efcb6b");
  facet([[x - 6, y - 6], [x - 1, y - 7], [x - 4, y - 2]], other);
  // A frontal eye and higher profile eye/nose show two viewpoints in one face.
  rect(x - 5, y - 3, 4, pose.blink ? 1 : 3, WHITE);
  rect(x - 3, y - 3, 1, pose.blink ? 1 : 3, INK);
  rect(x + 1, y - 5, 4, pose.blink ? 1 : 2, WHITE);
  rect(x + 2, y - 5, 1, 2, INK);
  line([x, y - 3], [x + 2, y + 1], 1, INK);
  rect(x + 1, y + 1, 3, 1, INK);
  rect(x - 3, y + 2, 3, 1, "#d95164");
  rect(x - 2, y + 3, 3, 1, INK);
  rect(x - 5, y, 2, 1, other);
}

function animeFigure(brush, pose, index) {
  const { rect, facet } = brush;
  const hair = HAIR[index], uniform = CUBIST[(index + 4) % CUBIST.length];
  figure(brush, pose, uniform, hair, PEACH);
  const sx = pose.sway, sy = pose.shoulderY, w = pose.identity.shoulders;
  facet([[sx - w, sy], [sx, sy + 4], [sx + w, sy]], WHITE);
  rect(sx - 2, sy + 2, 2, 2, PINK); rect(sx + 1, sy + 2, 2, 2, PINK);
  rect(sx, sy + 3, 1, 3, WHITE);
  rect(sx - w, pose.hipY - 2, w * 2, 2, hair);
  const [x, y] = pose.head;
  rect(x - 5, y - 8, 10, 1, INK);
  rect(x - 7, y - 7, 14, 10, INK);
  rect(x - 6, y - 7, 12, 10, hair);
  rect(x - 6, y - 4, 12, 8, PEACH);
  rect(x - 5, y + 4, 10, 1, PEACH);
  rect(x - 4, y + 5, 8, 1, INK);
  rect(x - 6, y - 6, 12, 2, hair);
  for (let n = 0; n < 4; n++) rect(x - 6 + n * 3, y - 5, 2, 1 + (n + index) % 3, hair);
  for (const side of [-1, 1]) {
    const ex = x + (side < 0 ? -5 : 2);
    rect(ex, y - 2, 3, 1, INK);
    if (!pose.blink) {
      rect(ex, y - 1, 3, 4, WHITE);
      rect(ex + (side < 0 ? 1 : 0), y, 2, 3, "#6862b8");
      rect(ex + 1, y, 1, 2, INK);
      rect(ex, y - 1, 1, 1, WHITE);
    }
    rect(x + (side < 0 ? -6 : 4), y + 3, 2, 1, PINK);
  }
  rect(x - 1, y + 3, 2, 1 + Math.round(pose.expression), "#c86280");
  if (index % 3 === 0) {
    for (const side of [-1, 1]) {
      rect(x + side * 6 - 1, y - 8, 3, 3, INK);
      rect(x + side * 6, y - 8, 2, 2, hair);
      rect(x + side * 6, y - 5, 2, 2, WHITE);
    }
  } else if (index % 3 === 1) {
    rect(x - 5, y - 7, 10, 2, WHITE);
    rect(x + 3, y - 6, 2, 2, PINK);
  } else {
    rect(x - 7, y - 5, 2, 9, hair); rect(x + 5, y - 5, 2, 9, hair);
    rect(x - 5, y - 7, 3, 1, WHITE);
  }
}

function swirlFigure(brush, pose, index) {
  const { rect, line } = brush;
  const neon = ["#63f5e3", "#ff7fc4", "#ffe276", "#a697ff"];
  const a = neon[index % 4], b = neon[(index + 1) % 4], c = neon[(index + 2) % 4];
  const diamond = (x, y, radius, color) => {
    for (let row = -radius; row <= radius; row++) {
      const half = radius - Math.abs(row);
      rect(x - half, y + row, half * 2 + 1, 1, color);
    }
  };
  for (const limb of [...pose.legs.map(leg => [leg.hip, leg.knee, leg.foot]),
    ...pose.arms.map(arm => [arm.shoulder, arm.elbow, arm.wrist])]) {
    line(limb[0], limb[1], 3, INK); line(limb[1], limb[2], 3, INK);
    line(limb[0], limb[1], 1, a); line(limb[1], limb[2], 1, b);
    diamond(...limb[1], 2, c); diamond(...limb[2], 2, b);
    rect(limb[2][0], limb[2][1], 1, 1, INK);
  }
  const turn = (pose.moving ? pose.frame : 0) + index;
  const spiral = (cx, cy, radius, color, rotation) => {
    const transform = ([x, y]) => {
      for (let n = 0; n < rotation % 4; n++) [x, y] = [-y, x];
      return [cx + x, cy + y];
    };
    let point = [-radius, radius];
    for (let r = radius; r >= 1; r -= 2) {
      for (const next of [[-r, -r], [r, -r], [r, r - 2], [-r + 2, r - 2]]) {
        line(transform(point), transform(next), 1, color); point = next;
      }
    }
  };
  const cy = (pose.shoulderY + pose.hipY) / 2;
  diamond(pose.sway, cy, 5, INK);
  diamond(pose.sway, cy, 4, a);
  diamond(pose.sway, cy, 2, INK);
  spiral(pose.sway, cy, 3, c, turn);
  const [x, y] = pose.head;
  if (index % 2) {
    diamond(x, y - 1, 7, INK); diamond(x, y - 1, 6, b);
    diamond(x, y - 1, 4, INK);
  } else {
    rect(x - 7, y - 8, 15, 15, INK);
    rect(x - 6, y - 7, 13, 13, b);
    rect(x - 5, y - 6, 11, 11, INK);
  }
  spiral(x, y - 1, 5, a, turn);
  rect(x, y - 1, 2, 2, c);
  rect(x - 6, y - 7, 2, 2, WHITE);
}

/** The default still renders the original six dancers pixel-for-pixel. */
export function drawSimdChiptuneDancer(context, actor, x, ground, unit, colors, reducedMotion, skin = "original") {
  const variant = normalizeChiptuneSkin(skin);
  const originalActor = actor.key === "noise" ? { ...actor, key: "upperOne" } : actor;
  if (variant === "original") {
    drawChiptuneDancer(context, originalActor, x, ground, unit, colors, reducedMotion);
    if (actor.key === "noise") noiseAccents(pixelBrush(context, x, ground, unit).rect,
      chiptuneDancerPose(originalActor, reducedMotion), colors);
    return;
  }
  const pose = chiptuneDancerPose(originalActor, reducedMotion);
  const brush = pixelBrush(context, x, ground, unit);
  const index = Math.max(0, VOICES.indexOf(actor.key));
  if (variant === "cubist") cubistFigure(brush, pose, index);
  else if (variant === "anime") animeFigure(brush, pose, index);
  else swirlFigure(brush, pose, index);
}

function noiseAccents(rect, pose, colors) {
  const [x, y] = pose.head, width = pose.identity.head;
  // A static-signal robot: Circuit's skeleton, a stepped aerial and side coils.
  rect(x - 2, y - 8, 3, 1, colors.spark);
  rect(x - 1, y - 7, 2, 1, colors.spark);
  rect(x - 2, y - 6, 2, 1, colors.spark);
  for (const side of [-1, 1]) {
    rect(x + side * (width + 1) - 1, y - 3, 2, 2, colors.mid);
    rect(x + side * (width + 2) - 1, y - 1, 2, 2, colors.highlight);
  }
  rect(pose.sway - 2, pose.shoulderY + 2, 4, 4, colors.outline);
  const bars = pose.moving ? pose.frame % 3 : 0;
  for (let index = 0; index < 3; index++) {
    const height = 1 + (index + bars) % 3;
    rect(pose.sway - 1 + index, pose.shoulderY + 5 - height, 1, height, colors.spark);
  }
}
