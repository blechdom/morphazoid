import { drawKaijuSkin } from "./skin-kaiju.js";
import { drawFractureSkin } from "./skin-fracture.js";
import { drawWormSkin } from "./skin-worms.js";
import { chiptuneDancerPose, drawChiptuneDancer } from "../webgpu-chiptune/webgpu-chiptune-dancers.js";

// Complete figures on the original half-unit pixel grid. Poses still come from
// the audible performer; skins own no clock, audio, or musical state.
export const SKINS = Object.freeze([
  Object.freeze({ id: "original", label: "Original characters" }),
  Object.freeze({ id: "cubist", label: "Fracture parade" }),
  Object.freeze({ id: "anime", label: "Nightmare kaiju" }),
  Object.freeze({ id: "swirl", label: "Cosmic worms" }),
]);
const LEGACY_SKINS = Object.freeze({ animals: "anime", blobs: "swirl", arcade: "cubist" });
export function normalizeChiptuneSkin(value) {
  return SKINS.some(skin => skin.id === value) ? value
    : Object.hasOwn(LEGACY_SKINS, value) ? LEGACY_SKINS[value] : "original";
}

const VOICES = ["drums", "bass", "arp", "lead", "upperOne", "upperTwo", "noise"];

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

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** Keep the original artwork, but give its SIMD rig a much broader dance. */
export function simdChiptuneDancePose(actor, reducedMotion = false) {
  const pose = chiptuneDancerPose(actor, reducedMotion);
  if (!pose.moving) return pose;
  const index = Math.max(0, VOICES.indexOf(actor.key));
  const phase = ((actor.dancePhase % 1) + 1) % 1 * Math.PI * 2;
  const rock = Math.sin(phase * 2 + index * .6);
  const sway = clamp(pose.sway * 1.6 + Math.sin(phase) * 1.4, -3.2, 3.2);
  const hipY = clamp(pose.hipY + rock * 1.7, -14.5, -7);
  const shoulderY = hipY - pose.identity.torso;
  const arms = pose.arms.map((arm, i) => {
    const side = i ? 1 : -1;
    const angle = Math.atan2(arm.elbow[0] - arm.shoulder[0], arm.elbow[1] - arm.shoulder[1])
      + Math.sin(phase * 2 + i * Math.PI + index * .4) * .8;
    const bend = angle + side * (pose.key === "upperOne" ? 1.5 : pose.key === "lead" ? 1.2 : .7);
    const shoulder = [sway + side * pose.identity.shoulders, shoulderY];
    const elbow = [clamp(shoulder[0] + Math.sin(angle) * 5, -15, 15), shoulder[1] + Math.cos(angle) * 5];
    const wrist = [clamp(elbow[0] + Math.sin(bend) * 5, -15, 15), elbow[1] + Math.cos(bend) * 5];
    return { shoulder, elbow, wrist };
  });
  const legs = pose.legs.map((leg, i) => {
    const side = i ? 1 : -1;
    const step = Math.sin(phase * 2 + i * Math.PI);
    const lift = Math.max(0, step) * 4;
    return {
      hip: [sway + side * pose.identity.hips, hipY],
      knee: [clamp(leg.knee[0] + side * step * 2, -13, 13), leg.knee[1] - lift * .65],
      foot: [clamp(leg.foot[0] + side * step * 3, -14, 14), leg.foot[1] - lift],
    };
  });
  return { ...pose, sway, hipY, shoulderY, arms, legs,
    head: [sway * 1.2, shoulderY - 7 + rock],
  };
}

/** Skin motion changes the visual rig only; musical actors remain immutable. */
export function drawSimdChiptuneDancer(context, actor, x, ground, unit, colors, reducedMotion, skin = "original") {
  const variant = normalizeChiptuneSkin(skin);
  const originalActor = actor.key === "noise" ? { ...actor, key: "upperOne" } : actor;
  if (variant === "original") {
    const pose = simdChiptuneDancePose(originalActor, reducedMotion);
    drawChiptuneDancer(context, originalActor, x, ground, unit, colors, reducedMotion, pose);
    if (actor.key === "noise") noiseAccents(pixelBrush(context, x, ground, unit).rect, pose, colors);
    return;
  }
  const pose = chiptuneDancerPose(originalActor, reducedMotion);
  pose.phase = pose.moving ? ((actor.dancePhase % 1) + 1) % 1 : 0;
  const brush = pixelBrush(context, x, ground, unit);
  const index = Math.max(0, VOICES.indexOf(actor.key));
  if (variant === "cubist") drawFractureSkin(brush, pose, index);
  else if (variant === "anime") drawKaijuSkin(brush, pose, index);
  else drawWormSkin(brush, pose, index);
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
