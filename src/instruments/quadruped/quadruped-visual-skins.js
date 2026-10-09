import { QUADRUPED_LANES, QUADRUPED_STEP_COUNT, quadrupedAnimal, solveQuadrupedLimbChain } from "./quadruped.js";
import { quadrupedProfileMouth } from "./quadruped-mouth.js";

export const QUADRUPED_VISUAL_SKINS = Object.freeze([
  Object.freeze({ id: "animal", label: "Original" }),
  Object.freeze({ id: "skeleton", label: "Skeleton" }),
  Object.freeze({ id: "constellation", label: "Constellation" }),
  Object.freeze({ id: "collage", label: "Cutout collage" }),
  Object.freeze({ id: "motion-card", label: "Motion cards" }),
]);

const TAU = Math.PI * 2;
const mix = (a, b, t) => a + (b - a) * t;
const limit = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value ?? 0));
const point = (x, y) => ({ x, y });
const between = (a, b, t) => point(mix(a.x, b.x, t), mix(a.y, b.y, t));
const ellipsePoints = (x, y, rx, ry, count = 12) => Array.from({ length: count }, (_, index) => {
  const angle = index / count * TAU;
  return point(x + Math.cos(angle) * rx, y + Math.sin(angle) * ry);
});

// Presentation geometry uses the same fixed-segment IK and body transforms as
// the original skin. No skin drives the clock, contact model, or audio engine.
export function deriveQuadrupedVisualRig(pose, width, height, groundY, score, { playing = true } = {}) {
  const animal = quadrupedAnimal(score.animalId);
  const m = animal.morphology;
  const scale = Math.min(height * 0.27, width * 0.145) * animal.bodyScale;
  const center = point(width * 0.5, groundY - scale * mix(m.clearance + pose.bodyLift * 0.38, m.bodyHeight * 0.48, pose.bodySlide));
  const gather = m.family === "feline" ? limit(pose.spineFlex, -0.2, 0.2) : 0;
  const bodyWidth = m.bodyWidth * (1 - gather * 0.8);
  const bodyHeight = m.bodyHeight * (1 + Math.max(0, gather) * 0.9);
  const wave = m.family === "lizard" ? Math.sin(pose.position / QUADRUPED_STEP_COUNT * TAU) * 0.11 : 0;
  const rotation = pose.bodyPitch + pose.bodyRoll * 0.22 - pose.rearBalance * 0.58 + wave + (pose.forwardRoll + pose.cartwheel) * TAU;
  const bodyPoint = (x, y) => point(center.x + scale * (x * Math.cos(rotation) - y * Math.sin(rotation)), center.y + scale * (x * Math.sin(rotation) + y * Math.cos(rotation)));
  const performance = playing ? pose.headPerformance ?? {} : {};
  const head = bodyPoint(m.headForward, -m.headRise);
  head.y += scale * (-pose.headLift * (m.family === "lizard" ? 0.06 : 0.16) + pose.headNod * 0.12 - limit(performance.headToss) * 0.13 - limit(performance.strength) * 0.065 + limit(performance.neckSway, -1, 1) * 0.06);
  const headRotation = (pose.forwardRoll + pose.cartwheel) * TAU;
  const headPoint = (x, y) => point(head.x + scale * m.headScale * (x * Math.cos(headRotation) - y * Math.sin(headRotation)), head.y + scale * m.headScale * (x * Math.sin(headRotation) + y * Math.cos(headRotation)));
  const body = [
    [-0.53, 0], [-0.44, -0.4 * m.haunch], [-0.24, -0.53], [0.06, -0.5], [0.36, -0.45 * m.shoulder], [0.53, -0.02],
    [0.44, 0.37], [0.16, 0.47], [-0.14, m.family === "feline" ? 0.25 : 0.47], [-0.42, 0.39],
  ].map(([x, y]) => bodyPoint(x * bodyWidth, y * bodyHeight));
  const neck = [bodyPoint(bodyWidth * 0.32, -bodyHeight * 0.2), bodyPoint(m.headForward - m.neckLength * 0.28, -m.headRise * 0.58), headPoint(-0.15, 0.26)];
  const hips = {
    "rear-left": bodyPoint(-bodyWidth * 0.4, bodyHeight * 0.2 * m.haunch),
    "rear-right": bodyPoint(-bodyWidth * 0.37, bodyHeight * 0.22 * m.haunch),
    "front-left": bodyPoint(bodyWidth * 0.37, bodyHeight * 0.18 * m.shoulder),
    "front-right": bodyPoint(bodyWidth * 0.4, bodyHeight * 0.2 * m.shoulder),
  };
  const legs = QUADRUPED_LANES.map(({ id, color }) => {
    const leg = pose.legs[id];
    const front = id.startsWith("front");
    const far = id.endsWith("left");
    const hip = hips[id];
    const contactY = groundY - (leg.footWorldY - pose.bodyGroundHeight) * scale * 0.74;
    const spread = far ? -0.07 : 0.07;
    let foot = point(mix(center.x + leg.footX * scale * 0.74, hip.x + scale * ((front ? -0.16 : 0.18) + spread), pose.rollTuck), mix(contactY - leg.lift * scale * 0.46, hip.y + scale * (0.24 + spread), pose.rollTuck));
    if (pose.cartwheel > 0 && !leg.grounded) {
      const angle = pose.cartwheel * TAU + (front ? -0.7 : 0.7) + (far ? -0.28 : 0.28);
      const reach = scale * (front ? m.frontUpper + m.frontLower : m.hindUpper + m.hindLower) * 0.9;
      foot = point(hip.x - Math.sin(angle) * reach, hip.y + Math.cos(angle) * reach);
    }
    const digitigrade = ["feline", "canid", "rabbit"].includes(m.family);
    const chain = solveQuadrupedLimbChain(hip.x, hip.y, foot.x, foot.y, scale * (front ? m.frontUpper : m.hindUpper), scale * (front ? m.frontLower : m.hindLower), scale * m.distal, m.family === "lizard" ? (far ? -1 : 1) : front ? m.foreBend : m.hindBend, m.family === "amphibian" && !front ? -1 : front ? -0.025 : digitigrade ? 0.09 : 0.035, m.family === "amphibian" && !front ? -0.12 : -1);
    return { id, color, far, front, contactY, impact: leg.impact, grounded: leg.grounded, points: [hip, point(chain.kneeX, chain.kneeY), point(chain.ankleX, chain.ankleY), point(chain.footX, chain.footY)] };
  });
  const longFace = ["equid", "bovid", "goat", "giraffe", "camel", "canid"].includes(m.family);
  let skull = longFace
    ? [[-0.45, -0.46], [0.04, -0.53], [0.49, -0.06], [0.86, 0.18], [0.77, 0.46], [0.12, 0.42], [-0.43, 0.15]]
    : [[-0.56, -0.32], [-0.23, -0.64], [0.23, -0.6], [0.59, -0.13], [0.67, 0.22], [0.29, 0.51], [-0.33, 0.38]];
  if (["amphibian", "lizard"].includes(m.family)) skull = [[-0.66, -0.17], [-0.37, -0.47], [0.24, -0.39], [0.78, -0.04], [0.67, 0.25], [-0.35, 0.3]];
  if (m.family === "rodent") skull = [[-0.54, -0.25], [-0.05, -0.5], [0.93, 0.22], [0.12, 0.47], [-0.46, 0.32]];
  const profile = quadrupedProfileMouth(m.family, performance.strength);
  const toHead = p => headPoint(p.x, p.y);
  const mouth = {
    strength: profile.strength, angle: profile.angle,
    ...Object.fromEntries(["hinge", "upperLip", "lowerLip", "chin", "back"].map(key => [key, toHead(profile[key])])),
    opening: profile.opening.map(toHead), jaw: profile.jaw.map(toHead),
  };
  // Split only the painted face at its profile slit. The original skull remains
  // available to the gesture hit rig, independent of the voice's opening.
  const foreheadCount = m.family === "rodent" ? 3 : longFace || ["amphibian", "lizard"].includes(m.family) ? 4 : 5;
  const upperSkull = [...skull.slice(0, foreheadCount).map(([x, y]) => headPoint(x, y)), mouth.upperLip, mouth.hinge, headPoint(...skull[skull.length - 1])];
  const features = [];
  const feature = (points, kind = "ear") => features.push({ kind, points: points.map(([x, y]) => headPoint(x, y)) });
  if (m.family === "elephant") {
    feature([[-0.15, -0.4], [-0.68, -0.62], [-0.99, -0.26], [-0.84, 0.47], [-0.31, 0.58], [-0.16, 0.1]]);
    const raised = limit(performance.trunkRaise);
    feature([[0.25, 0.05], [0.52, 0.38], [0.61, mix(0.97, -0.4, raised)], [0.82, mix(1.13, -1.2, raised)], [0.96, mix(0.94, -1.35, raised)], [0.75, mix(0.89, -1.29, raised)], [0.72, mix(0.31, -0.08, raised)], [0.43, -0.12]], "trunk");
    feature([[0.18, 0.33], [0.57, 0.5], [0.72, 0.3], [0.41, 0.36]], "horn");
  } else if (m.family === "rodent") {
    for (const x of [-0.3, 0.17]) features.push({ kind: "ear", points: ellipsePoints(x, -0.55, 0.32, 0.37, 10).map(p => headPoint(p.x, p.y)) });
  } else if (m.family === "ceratopsian") {
    features.push({ kind: "frill", points: ellipsePoints(-0.43, -0.13, 0.55, 0.85, 14).map((p, i) => headPoint(p.x - (i % 2) * 0.07, p.y)) });
    for (const [x, y, length] of [[-0.22, -0.36, 0.9], [0.09, -0.33, 0.79], [0.63, -0.01, 0.31]]) feature([[x - 0.06, y + 0.09], [x + length, y - length * 0.52], [x + 0.16, y + 0.08]], "horn");
  } else if (m.family === "amphibian") {
    for (const x of [-0.29, 0.31]) features.push({ kind: "eye", points: ellipsePoints(x, -0.4, 0.22, 0.23, 10).map(p => headPoint(p.x, p.y)) });
  } else if (m.family !== "lizard") {
    const earHeight = m.family === "rabbit" ? 1.48 : m.family === "feline" || m.family === "canid" ? 0.78 : 0.53;
    for (const x of [-0.3, 0.14]) feature([[x - 0.15, -0.39], [x - 0.07, -0.43 - earHeight], [x + 0.18, -0.49]]);
  }
  if (["bovid", "goat"].includes(m.family)) for (const x of [-0.25, 0.19]) feature([[x - 0.07, -0.42], [x - 0.32, -0.95], [x - 0.16, -1.72], [x + 0.03, -1.11], [x + 0.12, -0.49]], "horn");
  if (m.family === "giraffe") for (const x of [-0.2, 0.17]) feature([[x - 0.06, -0.5], [x - 0.09, -1], [x + 0.08, -1.04], [x + 0.07, -0.48]], "horn");
  if (animal.id === "unicorn") feature([[0.04, -0.49], [0.42, -1.5 - limit(performance.hornPulse) * 0.25], [0.3, -0.43]], "horn");
  const tailRoot = bodyPoint(-bodyWidth * 0.51, -bodyHeight * 0.12);
  const tail = Array.from({ length: 7 }, (_, i) => {
    const t = i / 6;
    return point(tailRoot.x - scale * m.tailLength * t, tailRoot.y + scale * (Math.sin(pose.tailAngle + t * 2.1) * 0.2 * t + t * 0.06));
  });
  const humps = m.family === "camel" ? [-0.23, 0.22].map(x => [[x - 0.21, -0.3], [x - 0.09, -0.95], [x + 0.08, -0.96], [x + 0.23, -0.3]].map(([px, py]) => bodyPoint(px * bodyWidth, py * bodyHeight))) : [];
  return { skinId: score.visualSkinId ?? "animal", animal, morphology: m, scale, center, rotation, bodyWidth, bodyHeight, body, bodyPoint, head, headPoint, skull: skull.map(([x, y]) => headPoint(x, y)), upperSkull, mouth, headRotation, neck, legs, tail, features, humps, pose };
}

function path(context, points, close = false) {
  context.beginPath();
  points.forEach((p, index) => index ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y));
  if (close) context.closePath();
}
function stroke(context, points, color, width = 1, close = false) {
  path(context, points, close); context.strokeStyle = color; context.lineWidth = width; context.stroke();
}
function dot(context, p, radius, color) {
  context.fillStyle = color; context.beginPath(); context.arc(p.x, p.y, radius, 0, TAU); context.fill();
}
function bone(context, a, b, radius, color) {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 0.01) return;
  context.save(); context.translate(a.x, a.y); context.rotate(Math.atan2(b.y - a.y, b.x - a.x));
  context.fillStyle = color; context.beginPath();
  context.moveTo(0, -radius); context.bezierCurveTo(length * 0.32, -radius * 0.24, length * 0.68, -radius * 0.24, length, -radius);
  context.quadraticCurveTo(length + radius, 0, length, radius); context.bezierCurveTo(length * 0.68, radius * 0.24, length * 0.32, radius * 0.24, 0, radius);
  context.quadraticCurveTo(-radius, 0, 0, -radius); context.fill(); context.restore();
}
/** Ground stamps and landing flashes share each skin's drawing language. */
export function drawQuadrupedFootprint(context, {
  skinId = "animal", x = 0, y = 0, radiusX = 8, radiusY = 3,
  color = "#d8ebbe", laneId = "front-left", alpha = 1, pulse = false,
} = {}) {
  const w = Math.max(3, radiusX), h = Math.max(1.4, radiusY);
  context.save(); context.translate(x, y); context.globalAlpha *= limit(alpha);
  context.lineWidth = Math.max(0.8, Math.min(1.5, w * 0.1));
  context.lineJoin = "round"; context.lineCap = "round";
  if (skinId === "constellation") {
    // Hollow rectangular traces keep the checkerboard visible through them.
    context.strokeStyle = color;
    context.strokeRect(-w, -h, w * 2, h * 2);
  } else if (skinId === "skeleton") {
    const ivory = "#f4e7c6";
    for (const toe of [-1, 0, 1]) {
      const heel = point(-w * 0.75, 0), joint = point(-w * 0.1, toe * h * 0.42);
      const tip = point(w * (toe === 0 ? 0.9 : 0.65), toe * h);
      stroke(context, [heel, joint, tip], ivory, Math.max(0.85, h * 0.3));
      dot(context, joint, Math.max(0.5, h * 0.19), ivory);
      dot(context, tip, Math.max(0.5, h * 0.19), ivory);
    }
  } else if (skinId === "collage") {
    const points = [[-1, -0.5], [-0.6, -1], [-0.12, -0.7], [0.45, -1],
      [1, -0.35], [0.78, 0.7], [0.2, 1], [-0.4, 0.62], [-0.88, 0.9]]
      .map(([px, py]) => point(px * w, py * h));
    if (pulse) stroke(context, points, "#fff8e9", Math.max(1, h * 0.28), true);
    else {
      const field = Math.max(0, QUADRUPED_LANES.findIndex(lane => lane.id === laneId));
      drawPaperPiece(context, points, field, Math.max(20, w * 7), collageImage("vintage-magazine-face-fields"));
    }
  } else if (skinId === "motion-card") {
    const ink = "#493724";
    const points = [[-1, -0.15], [-0.65, -0.8], [0.38, -1], [1, -0.28],
      [0.78, 0.65], [-0.28, 1], [-0.86, 0.52]].map(([px, py]) => point(px * w, py * h));
    stroke(context, points, ink, Math.max(0.8, h * 0.22), true);
    if (!pulse) for (const offset of [-0.45, 0, 0.45]) {
      stroke(context, [point(w * (offset - 0.16), h * 0.54), point(w * (offset + 0.12), -h * 0.54)], ink, 0.65);
    }
  } else {
    context.beginPath(); context.ellipse(0, 0, w, h, pulse ? 0 : -0.08, 0, TAU);
    context.fillStyle = color; context.strokeStyle = pulse ? color : "#040d0beb";
    if (!pulse) context.fill();
    context.stroke();
  }
  context.restore();
}

function contact(context, leg, rig, color = leg.color) {
  if (leg.impact < 0.025 || rig.pose.bodySlide > 0.85) return;
  const strength = limit(leg.impact), p = leg.points[3];
  drawQuadrupedFootprint(context, {
    skinId: rig.skinId, x: p.x, y: leg.contactY + 1, color, laneId: leg.id,
    radiusX: rig.scale * (0.1 + (1 - strength) * 0.26), radiusY: rig.scale * 0.034,
    alpha: strength * 0.85, pulse: true,
  });
}

function drawSkeleton(context, rig) {
  const { scale: s, bodyPoint: bp, bodyWidth: w, bodyHeight: h, morphology: m } = rig;
  const ivory = "#f4e7c6", shade = "#b6ac94", joint = "#182325";
  const drawLeg = leg => {
    context.save(); context.globalAlpha *= (leg.far ? 0.42 : 1) * (1 - rig.pose.bodySlide);
    leg.points.slice(1).forEach((p, i) => {
      bone(context, leg.points[i], p, s * (i === 0 ? 0.03 : 0.018), ivory);
      if (i === 1) {
        const a = between(leg.points[i], p, 0.12), b = between(leg.points[i], p, 0.86);
        stroke(context, [point(a.x + s * 0.038, a.y), point(b.x + s * 0.038, b.y)], shade, Math.max(1, s * 0.012));
      }
      dot(context, p, Math.max(1.1, s * 0.014), joint);
    });
    const foot = leg.points[3];
    for (let toe = -1; toe <= 1; toe++) bone(context, foot, point(foot.x + s * 0.05 + toe * s * 0.037, foot.y + toe * s * 0.015), s * 0.012, ivory);
    context.restore(); contact(context, leg, rig);
  };
  rig.legs.filter(l => l.far).forEach(drawLeg);
  // An expressive skeleton drawing, not an anatomical reconstruction. Features
  // such as ears and humps survive as faint silhouettes for species recognition.
  for (let i = 0; i < 10; i++) {
    const x = mix(-w * 0.43, w * 0.39, i / 9);
    const y = -h * (0.28 + Math.sin(i / 9 * Math.PI) * 0.08);
    bone(context, bp(x, y - 0.043), bp(x + w * 0.035, y + 0.035), s * 0.027, ivory);
  }
  for (let i = 0; i < 7; i++) {
    const x = mix(-w * 0.18, w * 0.34, i / 6), depth = h * (0.49 - Math.abs(i / 6 - 0.5) * 0.2);
    const a = bp(x, -h * 0.31), b = bp(x + w * 0.12, -h * 0.06), c = bp(x + w * 0.025, depth);
    context.beginPath(); context.moveTo(a.x, a.y); context.quadraticCurveTo(b.x, b.y, c.x, c.y); context.strokeStyle = ivory; context.lineWidth = Math.max(1.3, s * 0.019); context.stroke();
  }
  for (const [x, radius] of [[-0.39, 0.105], [0.35, 0.09]]) {
    const points = ellipsePoints(x * w, h * 0.03, w * radius, h * 0.3, 10).map(p => bp(p.x, p.y));
    stroke(context, points, ivory, Math.max(1.5, s * 0.03), true);
  }
  for (let segment = 0; segment < 2; segment++) {
    const a = rig.neck[segment], b = rig.neck[segment + 1];
    for (let i = 0; i < 4; i++) bone(context, between(a, b, i / 4), between(a, b, (i + 0.83) / 4), s * 0.029, ivory);
  }
  rig.tail.slice(1).forEach((p, i) => bone(context, rig.tail[i], p, s * (0.027 - i * 0.0036), shade));
  for (const hump of rig.humps) stroke(context, hump, "#9d9f8f55", Math.max(1, s * 0.01));
  for (const f of rig.features.filter(f => f.kind === "ear" || f.kind === "frill")) {
    path(context, f.points, true); context.fillStyle = "#f4e7c615"; context.fill(); context.strokeStyle = "#b6ac9470"; context.lineWidth = Math.max(1, s * 0.012); context.stroke();
  }
  rig.legs.filter(l => !l.far).forEach(drawLeg);
  path(context, rig.upperSkull, true); context.fillStyle = ivory; context.fill();
  path(context, rig.mouth.jaw, true); context.fillStyle = ivory; context.fill();
  stroke(context, [rig.mouth.lowerLip, rig.mouth.chin, rig.mouth.back, rig.mouth.hinge], shade, Math.max(0.8, s * 0.01));
  for (const f of rig.features.filter(f => !["ear", "frill"].includes(f.kind))) {
    path(context, f.points, true); context.fillStyle = f.kind === "trunk" ? "#b6ac9455" : ivory; context.fill(); context.strokeStyle = shade; context.lineWidth = Math.max(1, s * 0.012); context.stroke();
  }
  const eye = rig.headPoint(m.family === "amphibian" ? 0.23 : 0.05, -0.2);
  dot(context, eye, s * m.headScale * 0.145, joint);
  dot(context, rig.headPoint(0.5, 0.12), s * m.headScale * 0.064, joint);
  path(context, rig.mouth.opening, true); context.fillStyle = joint; context.fill();
  stroke(context, rig.mouth.opening, joint, Math.max(0.8, s * 0.01), true);
  // Teeth follow each rigid jaw edge, with the lower row rotating at the cheek.
  for (const [lip, direction] of [[rig.mouth.upperLip, 1], [rig.mouth.lowerLip, -1]]) {
    const a = rig.mouth.hinge, dx = lip.x - a.x, dy = lip.y - a.y;
    for (let tooth = 0; tooth < 5; tooth++) {
      const t = 0.34 + tooth * 0.13, root = between(a, lip, t);
      const tip = point(root.x - dy * 0.075 * direction, root.y + dx * 0.075 * direction);
      path(context, [between(a, lip, t - 0.036), tip, between(a, lip, t + 0.036)], true);
      context.fillStyle = ivory; context.fill(); context.strokeStyle = shade; context.lineWidth = Math.max(0.45, s * 0.004); context.stroke();
    }
  }
  dot(context, rig.mouth.hinge, Math.max(0.9, s * m.headScale * 0.05), shade);
}

function drawConstellation(context, rig) {
  const s = rig.scale, gold = "#e8c46b", lilac = "#cb8fff", white = "#fff5dc";
  const mesh = (points, color, hub = null) => {
    stroke(context, points, color, Math.max(0.8, s * 0.009), true);
    if (hub) points.filter((_, i) => i % 2 === 0).forEach(p => stroke(context, [p, hub], `${color}80`, Math.max(0.65, s * 0.005)));
    for (const p of points) dot(context, p, Math.max(1.3, s * 0.017), white);
  };
  for (const leg of rig.legs) {
    context.save(); context.globalAlpha *= (leg.far ? 0.42 : 1) * (1 - rig.pose.bodySlide);
    stroke(context, leg.points, leg.far ? lilac : gold, Math.max(1, s * 0.012));
    for (const p of leg.points) dot(context, p, Math.max(1.4, s * 0.021), white);
    context.restore(); contact(context, leg, rig);
  }
  mesh(rig.body, gold, rig.center);
  stroke(context, [rig.body[1], rig.body[6], rig.body[3], rig.body[8], rig.body[4]], `${lilac}99`, Math.max(0.8, s * 0.006));
  stroke(context, rig.neck, gold, Math.max(1, s * 0.012));
  mesh(rig.upperSkull, gold, rig.head);
  mesh(rig.mouth.jaw, lilac);
  stroke(context, rig.mouth.opening, gold, Math.max(0.8, s * 0.01), true);
  for (const f of rig.features) mesh(f.points, f.kind === "horn" ? lilac : gold);
  for (const hump of rig.humps) mesh(hump, gold);
  stroke(context, rig.tail, `${gold}bb`, Math.max(0.8, s * 0.009));
  rig.tail.filter((_, i) => i % 2 === 0).forEach(p => dot(context, p, Math.max(1.1, s * 0.013), white));
  dot(context, rig.headPoint(0.12, -0.15), Math.max(1.8, s * 0.023), lilac);
}

// Reuse the project's original ImageGen assets. Their provenance and complete
// atlas layout are documented in assets/hiccup-head/skins/README.md.
const collageImages = new Map();
function collageImage(name) {
  if (collageImages.has(name)) return collageImages.get(name);
  if (typeof globalThis.Image !== "function") return null;
  const image = new Image();
  image.decoding = "async";
  image.src = new URL(`../../../assets/hiccup-head/skins/${name}.webp`, import.meta.url).href;
  collageImages.set(name, image);
  return image;
}
function drawPaperPiece(context, points, field, scale, image) {
  const torn = points.flatMap((a, index) => {
    const b = points[(index + 1) % points.length], length = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(1, Math.min(12, Math.ceil(length / Math.max(4, scale * 0.075))));
    return Array.from({ length: count }, (_, j) => {
      const p = between(a, b, j / count), tooth = Math.sin((index * 17 + j * 11) * 1.73) * scale * 0.009;
      return point(p.x + tooth, p.y - tooth);
    });
  });
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const left = Math.min(...xs), top = Math.min(...ys), width = Math.max(1, Math.max(...xs) - left), height = Math.max(1, Math.max(...ys) - top);
  context.save();
  path(context, torn, true); context.fillStyle = ["#54a6a9", "#e36046", "#688c72", "#6185ae", "#d6b257", "#b7598e"][field % 6];
  context.shadowColor = "#00000065"; context.shadowBlur = scale * 0.034; context.shadowOffsetY = scale * 0.026; context.fill();
  context.strokeStyle = "#fff0d4"; context.lineWidth = Math.max(1.3, scale * 0.035); context.stroke();
  context.shadowBlur = 0; context.shadowOffsetY = 0; context.clip();
  if (image?.complete && image.naturalWidth) {
    const cell = image.naturalWidth / 3;
    context.drawImage(image, (field % 3) * cell, Math.floor(field / 3) * cell, cell, cell, left, top, width, height);
  }
  // A quiet halftone over the source photograph gives all of the cut pieces a
  // shared print surface without generating a new texture every animation frame.
  context.fillStyle = "#27160918";
  const spacing = Math.max(3.5, scale * 0.05);
  for (let y = top; y < top + height; y += spacing) for (let x = left; x < left + width; x += spacing) context.fillRect(x, y, 0.8, 0.8);
  context.restore();
}
function strip(a, b, width) {
  const length = Math.max(0.01, Math.hypot(b.x - a.x, b.y - a.y));
  const nx = -(b.y - a.y) / length * width / 2, ny = (b.x - a.x) / length * width / 2;
  return [point(a.x + nx, a.y + ny), point(b.x + nx * 0.7, b.y + ny * 0.7), point(b.x - nx * 0.7, b.y - ny * 0.7), point(a.x - nx, a.y - ny)];
}
function drawCollage(context, rig) {
  const fields = collageImage("vintage-magazine-face-fields"), eyes = collageImage("cut-paper-collage");
  const { scale: s, morphology: m } = rig;
  const seed = [...rig.animal.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const piece = (points, offset) => drawPaperPiece(context, points, (seed + offset) % 6, s, fields);
  const drawLeg = leg => {
    context.save(); context.globalAlpha *= (leg.far ? 0.63 : 1) * (1 - rig.pose.bodySlide);
    leg.points.slice(1).forEach((p, i) => piece(strip(leg.points[i], p, s * Math.max(0.04, m.legWidth * (i === 0 ? 1.6 : 1.05))), i + (leg.front ? 0 : 2)));
    piece(ellipsePoints(leg.points[3].x, leg.points[3].y, s * m.footWidth * 0.72, s * m.footWidth * 0.28, 8), 4);
    context.restore(); contact(context, leg, rig);
  };
  rig.legs.filter(l => l.far).forEach(drawLeg);
  rig.tail.slice(1).forEach((p, i) => piece(strip(rig.tail[i], p, s * (0.05 - i * 0.005)), i % 2));
  piece(rig.body, 0);
  for (const hump of rig.humps) piece(hump, 4);
  const hipPatch = ellipsePoints(-rig.bodyWidth * 0.25, rig.bodyHeight * 0.03, rig.bodyWidth * 0.21, rig.bodyHeight * 0.44, 10).map(p => rig.bodyPoint(p.x, p.y));
  piece(hipPatch, 3);
  rig.neck.slice(1).forEach((p, i) => piece(strip(rig.neck[i], p, s * (m.family === "giraffe" ? 0.17 : 0.14)), 2));
  for (const f of rig.features.filter(f => f.kind === "ear" || f.kind === "frill")) piece(f.points, 1);
  rig.legs.filter(l => !l.far).forEach(drawLeg);
  piece(rig.upperSkull, 2);
  piece(rig.mouth.jaw, 5);
  for (const f of rig.features.filter(f => !["ear", "frill"].includes(f.kind))) piece(f.points, f.kind === "horn" ? 4 : 1);
  const eye = rig.headPoint(0.08, -0.17), eyeSize = s * m.headScale * 0.63;
  if (eyes?.complete && eyes.naturalWidth) {
    context.save(); context.translate(eye.x, eye.y); context.rotate(rig.headRotation - 0.15);
    context.drawImage(eyes, 256, 0, 256, 256, -eyeSize / 2, -eyeSize / 2, eyeSize, eyeSize); context.restore();
  } else {
    dot(context, eye, eyeSize * 0.21, "#fff6e7"); dot(context, eye, eyeSize * 0.09, "#183734");
  }
  path(context, rig.mouth.opening, true); context.fillStyle = "#281b25"; context.fill();
  stroke(context, rig.mouth.opening, "#f8eaca", Math.max(0.8, s * 0.009), true);
}

function smoothOutline(context, points) {
  context.beginPath();
  const start = between(points[points.length - 1], points[0], 0.5);
  context.moveTo(start.x, start.y);
  points.forEach((p, i) => {
    const end = between(p, points[(i + 1) % points.length], 0.5);
    context.quadraticCurveTo(p.x, p.y, end.x, end.y);
  });
  context.closePath();
}

function drawMotionCard(context, rig) {
  const { scale: s, morphology: m } = rig;
  const ink = "#493724", quiet = "#49372448";
  const outline = (points, smooth = false) => { if (smooth) smoothOutline(context, points); else path(context, points, true); context.fillStyle = "#5d41221b"; context.fill(); context.strokeStyle = ink; context.lineWidth = Math.max(1.2, s * 0.018); context.stroke(); };
  const leg = l => {
    context.save(); context.globalAlpha *= (l.far ? 0.4 : 1) * (1 - rig.pose.bodySlide);
    stroke(context, l.points, ink, Math.max(1.8, s * m.legWidth * 0.72));
    const foot = l.points[3]; stroke(context, [point(foot.x - s * m.footWidth / 2, foot.y), point(foot.x + s * m.footWidth / 2, foot.y)], l.color, Math.max(2.2, s * 0.035)); context.restore();
    contact(context, l, rig, ink);
  };
  rig.legs.filter(l => l.far).forEach(leg);
  outline(rig.body, true);
  for (const hump of rig.humps) outline(hump, true);
  context.save(); smoothOutline(context, rig.body); context.clip();
  for (let i = -8; i <= 8; i++) stroke(context, [rig.bodyPoint(i * 0.11, -rig.bodyHeight * 0.6), rig.bodyPoint(i * 0.11 - 0.25, rig.bodyHeight * 0.6)], quiet, Math.max(0.6, s * 0.006));
  context.restore();
  stroke(context, rig.neck, ink, Math.max(2, s * 0.037));
  stroke(context, rig.tail, ink, Math.max(1, s * 0.018));
  for (const f of rig.features.filter(f => f.kind === "ear" || f.kind === "frill")) outline(f.points);
  rig.legs.filter(l => !l.far).forEach(leg);
  // Keep the slit and jaw corners crisp like a side-profile ink study.
  outline(rig.upperSkull);
  outline(rig.mouth.jaw);
  for (const f of rig.features.filter(f => !["ear", "frill"].includes(f.kind))) outline(f.points);
  dot(context, rig.headPoint(0.12, -0.16), Math.max(1.3, s * m.headScale * 0.055), ink);
  path(context, rig.mouth.opening, true); context.fillStyle = ink; context.fill();
  stroke(context, rig.mouth.opening, ink, Math.max(0.8, s * 0.012), true);
  if (rig.animal.id === "giraffe" || rig.animal.id === "cheetah") {
    for (let i = 0; i < 9; i++) dot(context, rig.bodyPoint((i % 5 - 2) * rig.bodyWidth * 0.16, (i < 5 ? -0.17 : 0.16) * rig.bodyHeight), s * (rig.animal.id === "giraffe" ? 0.042 : 0.018), ink);
  }
}

const SKIN_RENDERERS = new Map([
  ["skeleton", drawSkeleton], ["constellation", drawConstellation],
  ["collage", drawCollage], ["motion-card", drawMotionCard],
]);

/** Paint an alternate animal skin; false asks the caller to use its original renderer. */
export function drawQuadrupedVisualSkin(context, pose, width, height, groundY, score, options = {}) {
  const renderer = SKIN_RENDERERS.get(score.visualSkinId);
  if (!renderer || !(width > 0 && height > 0)) return false;
  const rig = deriveQuadrupedVisualRig(pose, width, height, groundY, score, options);
  context.save(); context.lineCap = "round"; context.lineJoin = "round";
  renderer(context, rig); context.restore();
  return true;
}

// The world and articulated cutouts share one lazily loaded original atlas.
export { collageImage as quadrupedCollageImage };
