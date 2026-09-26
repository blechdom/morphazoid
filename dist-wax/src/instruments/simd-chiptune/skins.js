import {
  CHIPTUNE_DANCER_IDENTITIES,
  chiptuneDancerPose,
  drawChiptuneDancer,
} from "../webgpu-chiptune/webgpu-chiptune-dancers.js";

// Costumes for the original articulated pixel dancers. The original renderer
// supplies every limb, proportion and pose; accents use its exact half-unit grid.
// No clocks, audio, random state, images, vector paths or smoothing live here.
export const SKINS = Object.freeze([
  Object.freeze({ id: "original", label: "Original characters" }),
  Object.freeze({ id: "animals", label: "Pixel animals" }),
  Object.freeze({ id: "blobs", label: "Pixel blobs" }),
  Object.freeze({ id: "arcade", label: "Arcade crew" }),
]);

const WHITE = "#effcff";
const PINK = "#ff98bd";

function pixelBrush(context, x, ground, unit) {
  const px = unit * .5;
  // Keep this rounding identical to drawChiptuneDancer: no additional backing
  // resolution, transforms or antialiasing are introduced when changing skins.
  return (gx, gy, width, height, color) => {
    context.fillStyle = color;
    const left = Math.round(x + gx * px), top = Math.round(ground + gy * px);
    context.fillRect(left, top,
      Math.max(1, Math.round(x + (gx + width) * px) - left),
      Math.max(1, Math.round(ground + (gy + height) * px) - top));
  };
}

function eyes(rect, pose, colors, { single = false, visor = false } = {}) {
  const [x, y] = pose.head;
  if (single) {
    rect(x - 3, y - 3, 6, pose.blink ? 1 : 5, WHITE);
    if (!pose.blink) rect(x - 1 + (pose.frame % 4 < 2 ? 1 : 0), y - 2, 2, 3, colors.outline);
    return;
  }
  const wide = pose.key === "arp" || pose.key === "bass";
  if (visor) rect(x - (wide ? 5 : 4), y - 3, wide ? 10 : 8, 5, colors.outline);
  for (const side of [-1, 1]) {
    const ex = x + side * (wide ? 3 : 2) - (wide ? 2 : 1);
    const width = wide ? 4 : 3;
    rect(ex, y - 2, width, pose.blink ? 1 : 4, visor ? colors.spark : WHITE);
    if (!pose.blink) rect(ex + (pose.frame % 4 < 2 ? 1 : 0), y - 1, 2, 2, colors.outline);
  }
}

function face(rect, pose, colors, options) {
  const [x, y] = pose.head, width = pose.identity.head;
  rect(x - width, y - 4, width * 2, 8, colors.body);
  rect(x - width, y - 4, width * 2, 1, colors.mid);
  eyes(rect, pose, colors, options);
  rect(x - 2, y + 3, 4, 1 + Math.round(pose.expression), colors.outline);
}

function chest(rect, pose, colors, skin) {
  const x = pose.sway, y = pose.shoulderY;
  if (skin === "animals") {
    rect(x - 2, y + 3, 4, Math.max(3, pose.identity.torso - 5), colors.highlight);
    rect(x - 1, y + 3, 2, 2, WHITE);
  } else if (skin === "blobs") {
    rect(x - 2, y + 2, 2, 3, colors.highlight);
    rect(x + 1, y + 5, 2, 2, colors.spark);
    rect(x - 2, pose.hipY - 2, 1, 2, colors.body);
    rect(x + 1, pose.hipY - 2, 1, 2, colors.body);
  } else {
    rect(x - pose.identity.shoulders, y + 2, pose.identity.shoulders * 2, 2, colors.mid);
    rect(x - 1, y + 2, 2, 3, colors.spark);
    rect(x - 2, pose.hipY - 2, 4, 1, colors.highlight);
  }
}

function animalAccents(rect, pose, colors, key) {
  const [x, y] = pose.head, width = pose.identity.head;
  face(rect, pose, colors);
  chest(rect, pose, colors, "animals");
  if (key === "drums") {
    // Frog: raised square eye sockets and a wide cheek line above the drum.
    rect(x - 2, y - 7, 4, 3, colors.body);
    for (const side of [-1, 1]) {
      const ex = x + side * 4 - 2;
      rect(ex - 1, y - 8, 5, 5, colors.outline);
      rect(ex, y - 7, 3, 4, colors.body);
      rect(ex, y - 6, 3, pose.blink ? 1 : 3, WHITE);
      if (!pose.blink) rect(ex + 1, y - 5, 1, 2, colors.outline);
      rect(x + side * 4 - 1, y + 1, 2, 1, PINK);
    }
    rect(x - 4, y - 2, 8, 3, colors.body);
    rect(x - 3, y + 3, 6, 1, colors.outline);
  } else if (key === "bass") {
    // Bear: the original horns become small block ears; legs stay Thump's.
    for (const side of [-1, 1]) {
      rect(x + side * 6 - 2, y - 8, 4, 4, colors.outline);
      rect(x + side * 6 - 1, y - 7, 2, 3, colors.highlight);
      rect(x + side * 6 - 1, y - 6, 2, 1, PINK);
    }
    rect(x - 3, y + 2, 6, 3, colors.highlight);
    rect(x - 1, y + 2, 2, 1, colors.outline);
    rect(x, y + 3, 1, 2, colors.outline);
  } else if (key === "arp") {
    // Rabbit: Orbit's satellite stalks become ears, at the same height.
    for (const side of [-1, 1]) {
      rect(x + side * 7 - 1, y - 9, 3, 6, colors.outline);
      rect(x + side * 7, y - 8, 1, 5, colors.highlight);
      rect(x + side * 7, y - 7, 1, 3, PINK);
    }
    rect(x - 1, y + 2, 2, 1, PINK);
    rect(x - 1, y + 4, 2, 2, WHITE);
  } else if (key === "lead") {
    // Cat: pointed pixel ears, small whiskers, and the original vogue hands.
    for (const side of [-1, 1]) {
      rect(x + side * 4 - 1, y - 8, 2, 4, colors.outline);
      rect(x + side * 4 - 1, y - 6, 2, 2, PINK);
      rect(x + side * 4 - (side < 0 ? 2 : 0), y + 1, 3, 1, colors.highlight);
    }
    rect(x - 1, y + 2, 2, 1, PINK);
  } else if (key === "upperOne") {
    // Owl: compact ear tufts and a light facial disk around Circuit's eyes.
    for (const side of [-1, 1]) {
      rect(x + side * 4 - 1, y - 7, 2, 3, colors.mid);
      rect(x + side * 3 - 2, y - 3, 4, 5, colors.highlight);
    }
    eyes(rect, pose, colors);
    rect(x, y + 2, 1, 2, colors.spark);
    rect(x - 1, y + 2, 3, 1, colors.spark);
  } else if (key === "upperTwo") {
    // Fox: Dash keeps its swept forelock, with pointed ears and pale cheeks.
    for (const side of [-1, 1]) {
      rect(x + side * 4 - 1, y - 8, 2, 4, colors.outline);
      rect(x + side * 4 - 1, y - 6, 2, 2, PINK);
      rect(x + side * 3 - 1, y + 1, 3, 3, colors.highlight);
    }
    rect(x - 1, y + 2, 2, 2, colors.outline);
  } else {
    // Axolotl: six tiny gills, still within the original satellite-ear width.
    for (const side of [-1, 1]) {
      for (let row = 0; row < 3; row++) {
        rect(x + side * (width + 2) - 1, y - 5 + row * 3, 3, 1, PINK);
        rect(x + side * (width + 1), y - 4 + row * 2, 1, 1, colors.highlight);
      }
    }
    rect(x - 4, y + 1, 2, 1, PINK);
    rect(x + 3, y + 1, 2, 1, PINK);
  }
}

function blobAccents(rect, pose, colors, key) {
  const [x, y] = pose.head, width = pose.identity.head;
  face(rect, pose, colors, { single: key === "lead" });
  chest(rect, pose, colors, "blobs");
  // A gummy hood follows each original hairstyle, rather than changing body size.
  const lobe = { drums: -2, bass: 2, arp: 0, lead: -1, upperOne: 1, upperTwo: -2, noise: 0 }[key];
  rect(x + lobe - 2, y - 7, 4, 3, colors.body);
  rect(x + lobe - 1, y - 7, 2, 1, colors.highlight);
  rect(x - width + 1, y - 3, 1, 2, colors.highlight);
  rect(x + width - 2, y + 2, 2, 2, colors.mid);
  for (const side of [-1, 1]) rect(x + side * (width - 1) - 1, y + 4, 2, 2, colors.body);
  if (key === "drums") {
    rect(x - 4, y + 1, 2, 1, PINK); rect(x + 3, y + 1, 2, 1, PINK);
  } else if (key === "bass") {
    rect(x - 5, y - 3, 4, 1, colors.mid); rect(x + 2, y - 3, 4, 1, colors.mid);
    rect(x - 1, y + 4, 2, 1, WHITE);
  } else if (key === "arp") {
    rect(x - 1, y - 6, 3, 2, colors.spark);
    rect(x + 1, y - 5, 1, 1, colors.outline);
  } else if (key === "upperOne") {
    rect(x - 1, y - 6, 3, 2, WHITE); rect(x, y - 6, 1, 2, colors.outline);
  } else if (key === "upperTwo") {
    rect(x - width - 1, y - 5, width * 2 + 3, 2, colors.mid);
    rect(x - 2, y - 5, 2, 1, colors.spark);
  } else if (key === "noise") {
    for (const side of [-1, 1]) {
      rect(x + side * 3, y + 4, 1, 3, colors.highlight);
      rect(x + side * 3 + 1, y + 6, 1, 1, colors.mid);
    }
  }
}

function arcadeAccents(rect, pose, colors, key) {
  const [x, y] = pose.head, width = pose.identity.head;
  face(rect, pose, colors, { visor: key === "drums" || key === "arp" });
  chest(rect, pose, colors, "arcade");
  if (key === "drums") {
    rect(x - width, y - 4, width * 2, 2, colors.highlight);
    rect(x - 2, y + 3, 4, 1, colors.mid);
    for (const side of [-1, 1]) rect(x + side * (width + 1) - 1, y - 2, 2, 4, colors.spark);
  } else if (key === "bass") {
    rect(x - width, y - 4, width * 2, 2, colors.mid);
    rect(x - 3, y - 4, 1, 2, colors.outline);
    rect(x + 2, y - 4, 1, 2, colors.outline);
    rect(x - 4, y + 3, 3, 1, colors.highlight);
    rect(x + 2, y + 3, 3, 1, colors.highlight);
  } else if (key === "arp") {
    rect(x - width, y - 4, width * 2, 1, WHITE);
    rect(x - width, y - 4, 1, 8, WHITE);
    rect(x + width - 1, y - 4, 1, 8, WHITE);
    rect(x - width, y + 3, width * 2, 1, WHITE);
  } else if (key === "lead") {
    rect(x - width - 1, y - 5, width * 2 + 2, 2, colors.mid);
    rect(x - 2, y - 5, 3, 1, colors.spark);
    rect(pose.sway - 3, pose.shoulderY, 6, 2, colors.spark);
    rect(pose.sway + 2, pose.shoulderY + 2, 2, 4, colors.spark);
  } else if (key === "upperOne") {
    // A short stepped hat fits Circuit's original antenna height.
    rect(x - 1, y - 9, 2, 2, colors.mid);
    rect(x - 2, y - 7, 4, 2, colors.mid);
    rect(x - width, y - 5, width * 2, 2, colors.mid);
    rect(x, y - 7, 1, 1, colors.spark);
    rect(x - 1, y + 4, 3, 2, WHITE);
  } else if (key === "upperTwo") {
    rect(x - width - 1, y - 3, width * 2 + 2, 1, colors.spark);
    rect(x - 1, y - 5, 2, 2, colors.highlight);
    rect(pose.sway - 1, pose.shoulderY + 4, 2, 3, WHITE);
  } else {
    rect(x - width + 1, y - 4, width * 2 - 2, 2, colors.highlight);
    for (let index = 0; index < 3; index++) rect(x - 3 + index * 3, y + 4, 1, 2, colors.spark);
    rect(pose.sway - 2, pose.shoulderY + 3, 4, 3, colors.outline);
    rect(pose.sway - 1, pose.shoulderY + 4, 2, 1, colors.spark);
  }
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

/** Original six characters remain pixel-for-pixel identical in the default skin. */
export function drawSimdChiptuneDancer(context, actor, x, ground, unit, colors, reducedMotion, skin = "original") {
  const variant = SKINS.some(entry => entry.id === skin) ? skin : "original";
  const noise = actor.key === "noise";
  const originalActor = noise ? { ...actor, key: "upperOne" } : actor;
  drawChiptuneDancer(context, originalActor, x, ground, unit, colors, reducedMotion);
  if (variant === "original" && !noise) return;
  if (!noise && !CHIPTUNE_DANCER_IDENTITIES[actor.key]) return;
  const pose = chiptuneDancerPose(originalActor, reducedMotion);
  const rect = pixelBrush(context, x, ground, unit);
  if (variant === "animals") animalAccents(rect, pose, colors, actor.key);
  else if (variant === "blobs") blobAccents(rect, pose, colors, actor.key);
  else if (variant === "arcade") arcadeAccents(rect, pose, colors, actor.key);
  else noiseAccents(rect, pose, colors);
}
