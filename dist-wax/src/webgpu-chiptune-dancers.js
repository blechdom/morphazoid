// Articulated pixel dancers. All motion comes from the audible voice's phrase
// and body taps; this module owns no clock, timer, audio, or random state.
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number(v) || 0));
const mix = (a, b, t) => a + (b - a) * t;
// hip sway, crouch, left/right arm angle, left/right foot reach, left/right knee lift
const phrases = {
  upperOne: [[0,0,-1.4,0,0,0,0,0],[-1,0,-1.4,1.4,-2,1,0,1],[0,1,0,1.4,0,0,0,0],[1,0,-2.5,2.5,1,-2,1,0],
    [0,0,0,1.4,0,0,0,0],[1,0,-1.4,1.4,1,-2,1,0],[0,1,-1.4,0,0,0,0,0],[-1,0,-2.5,2.5,-2,1,0,1]],
  upperTwo: [[-2,1,-.4,1,-3,3,0,3],[0,0,-1,.4,2,-2,3,0],[2,1,-1.2,.2,3,-3,3,0],[0,0,-.2,1.2,-2,2,0,3],
    [-2,1,-.4,1,-4,2,0,4],[0,0,-1,.4,2,-2,4,0],[2,1,-1.2,.2,3,-4,4,0],[0,0,-.2,1.2,-2,2,0,4]],
  bass: [[-1,2,-.8,.8,-1,1,0,0],[-2,3,-1.2,.3,-2,0,0,1],[0,0,-2.3,2.3,0,0,0,0],[2,3,-.3,1.2,0,2,1,0],
    [1,2,-.8,.8,-1,1,0,0],[0,4,-1.4,1.4,-2,2,0,0],[-1,0,-2,1.2,0,0,1,0],[1,2,-.4,2,-1,1,0,1]],
  lead: [[-2,0,-2.5,.6,0,1,0,0],[1,0,-1.6,2.8,-1,2,0,2],[2,0,-.3,2.8,2,-1,2,0],[0,1,-2.8,2.4,-2,2,0,0],
    [-2,0,-2.8,.3,1,-1,0,1],[0,0,-2.4,1.6,-1,2,0,2],[2,0,-.6,2.5,2,0,2,0],[0,1,-1.5,1.5,-1,1,0,0]],
  arp: [[-1,0,-1.2,2.2,-2,1,0,4],[1,0,-2.2,1.2,-1,2,4,0],[0,1,-2.6,2.6,-2,2,0,0],[1,0,-.6,2.4,2,-2,4,0],
    [-1,0,-2.4,.6,-2,2,0,4],[0,0,-2.8,2.8,0,0,3,3],[1,1,-1.4,1.4,2,-2,4,0],[-1,0,-2.2,2.2,-2,2,0,4]],
  drums: [[0,1,-1.8,.6,-1,1,0,1],[1,0,-.6,1.8,0,1,1,0],[-1,1,-1.8,.6,-1,0,0,1],[0,0,-.6,1.8,0,0,1,0],
    [0,1,-2,2,-1,1,0,0],[1,0,-.4,1.8,0,1,1,0],[-1,1,-1.8,.4,-1,0,0,1],[0,0,-2.4,2.4,0,0,1,1]],
};
export const CHIPTUNE_DANCER_IDENTITIES = Object.freeze({
  upperOne: Object.freeze({ name: "Circuit · popping", shoulders: 4, hips: 3, head: 5, torso: 10 }),
  upperTwo: Object.freeze({ name: "Dash · shuffle", shoulders: 3, hips: 2, head: 4, torso: 9 }),
  bass: Object.freeze({ name: "Thump · stomp", shoulders: 6, hips: 4, head: 6, torso: 8 }),
  lead: Object.freeze({ name: "Nova · vogue", shoulders: 3, hips: 2, head: 4, torso: 11 }),
  arp: Object.freeze({ name: "Orbit · high-step", shoulders: 3, hips: 2, head: 6, torso: 8 }),
  drums: Object.freeze({ name: "Rattle · stick dance", shoulders: 4, hips: 3, head: 5, torso: 9 }),
});

export function chiptuneDancerPose(actor, reducedMotion = false) {
  const key = CHIPTUNE_DANCER_IDENTITIES[actor.key] ? actor.key : "upperOne";
  const identity = CHIPTUNE_DANCER_IDENTITIES[key];
  const moving = !reducedMotion && !actor.resting;
  const phase = moving ? ((actor.dancePhase % 1) + 1) % 1 : 0;
  const position = phase * 8;
  const frame = Math.floor(position);
  const blend = key === "upperOne" ? clamp((position % 1 - .65) / .35, 0, 1)
    : (position % 1) ** 2 * (3 - 2 * (position % 1));
  const values = phrases[key][frame].map((v, i) => mix(v, phrases[key][(frame + 1) % 8][i], blend));
  const taps = moving ? actor.bodyMotion ?? {} : {};
  const strength = moving ? .55 + clamp(actor.levelUnit, 0, 1) * .45 : 0;
  const sway = values[0] * strength;
  const crouch = values[1] * strength + clamp(taps.squash, 0, 1) * (key === "bass" ? 2 : .6);
  const jump = clamp(taps.jump, 0, 1) * (key === "arp" ? 3 : key === "drums" ? 2 : 1);
  const hipY = -13 + crouch - jump;
  const shoulderY = hipY - identity.torso;
  const legs = [-1, 1].map((side, i) => {
    const lift = values[6 + i] * strength + clamp(taps[i ? "rightLeg" : "leftLeg"], 0, 1) * 2;
    return {
      hip: [sway + side * identity.hips, hipY],
      knee: [side * (identity.hips + 1) + values[4 + i] * .65, -6 - lift],
      foot: [side * (identity.hips + 1) + values[4 + i], -lift * .7 - jump],
    };
  });
  const arms = [-1, 1].map((side, i) => {
    const angle = moving ? values[2 + i] + side * clamp(taps[i ? "rightArm" : "leftArm"], 0, 1) * .5 : side * .25;
    const shoulder = [sway + side * identity.shoulders, shoulderY];
    const elbow = [shoulder[0] + Math.sin(angle) * 5, shoulder[1] + Math.cos(angle) * 5];
    const bend = angle + side * (key === "upperOne" ? 1.5 : key === "lead" ? 1.2 : .7);
    const wrist = [elbow[0] + Math.sin(bend) * 5, elbow[1] + Math.cos(bend) * 5];
    return { shoulder, elbow, wrist };
  });
  return { key, identity, frame, sway, hipY, shoulderY, legs, arms,
    head: [sway * 1.2, shoulderY - 7], blink: moving && phase > .94,
    expression: clamp(taps.leftArm + taps.rightArm || actor.onset, 0, 1),
    jiggle: clamp(taps.jiggle, -1, 1), moving };
}

export function drawChiptuneDancer(context, actor, x, ground, unit, colors, reducedMotion) {
  const p = chiptuneDancerPose(actor, reducedMotion);
  const px = unit * .5;
  const rect = (gx, gy, w, h, color) => {
    context.fillStyle = color;
    const left = Math.round(x + gx * px), top = Math.round(ground + gy * px);
    context.fillRect(left, top, Math.max(1, Math.round(x + (gx + w) * px) - left),
      Math.max(1, Math.round(ground + (gy + h) * px) - top));
  };
  const line = (a, b, width, color) => {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]))));
    for (let n = 0; n <= steps; n++) rect(Math.round(mix(a[0], b[0], n / steps)) - width / 2,
      Math.round(mix(a[1], b[1], n / steps)) - width / 2, width, width, color);
  };
  const limb = (a, joint, b, thick, color) => {
    line(a, joint, thick + 2, colors.outline); line(joint, b, thick + 2, colors.outline);
    line(a, joint, thick, color); line(joint, b, thick, color);
    rect(joint[0] - 1, joint[1] - 1, 2, 2, colors.highlight);
  };
  // Separated thighs, knees, shins and shoes remain readable in silhouette.
  p.legs.forEach((leg, i) => {
    limb(leg.hip, leg.knee, leg.foot, p.key === "bass" ? 4 : 2, colors.mid);
    rect(leg.foot[0] - (i ? 1 : 4), leg.foot[1], 5, 3, colors.outline);
    rect(leg.foot[0] - (i ? 0 : 3), leg.foot[1], 4, 2, colors.highlight);
    if (p.key === "upperTwo") rect(leg.foot[0] - 3, leg.foot[1] + 2, 6, 1, colors.spark);
  });
  const w = p.identity.shoulders;
  rect(p.sway - w - 1, p.shoulderY - 1, w * 2 + 2, p.identity.torso + 2, colors.outline);
  rect(p.sway - w, p.shoulderY, w * 2, p.identity.torso, colors.body);
  rect(p.sway - w, p.hipY - 2, w * 2, 2, colors.mid);
  rect(p.sway - 1, p.shoulderY + 2, 2, 3, colors.spark);
  p.arms.forEach((arm, i) => {
    limb(arm.shoulder, arm.elbow, arm.wrist, p.key === "bass" ? 4 : 2, colors.body);
    rect(arm.wrist[0] - 2, arm.wrist[1] - 1, 4, 3, colors.highlight);
    if (p.key === "drums") {
      const end = [arm.wrist[0] + (i ? 1 : -1) * (3 + p.jiggle), arm.wrist[1] - 6];
      line(arm.wrist, end, 1, "#fff4bd");
    } else if (p.key === "lead") {
      line(arm.wrist, [arm.wrist[0] + (i ? 2 : -2), arm.wrist[1] + 4], 1, colors.spark);
    }
  });
  const [hx, hy] = p.head, hw = p.identity.head;
  rect(hx - 1, p.shoulderY - 3, 2, 4, colors.highlight);
  rect(hx - hw - 1, hy - 5, hw * 2 + 2, 10, colors.outline);
  rect(hx - hw, hy - 4, hw * 2, 8, colors.body);
  rect(hx - hw, hy - 4, hw * 2, 2, colors.mid);
  // Species and hairstyles: antenna robot, swept runner, horned bass, asymmetrical
  // lead fringe, satellite ears, and a headphone/mohawk percussionist.
  if (p.key === "upperOne") {
    rect(hx - 1, hy - 8, 1, 3, colors.highlight); rect(hx - 2, hy - 9, 3, 2, colors.spark);
    rect(hx - hw - 2, hy - 1, 2, 3, colors.mid); rect(hx + hw, hy - 1, 2, 3, colors.mid);
  } else if (p.key === "upperTwo") {
    for (let n = 0; n < 4; n++) rect(hx - 4 + n * 2, hy - 7 + n % 2, 3, 4, colors.spark);
    rect(hx + hw, hy - 2, 3, 2, colors.highlight);
  } else if (p.key === "bass") {
    for (const side of [-1, 1]) {
      rect(hx + side * 6 - 1, hy - 7, 3, 5, colors.highlight);
      rect(hx + side * 7 - 1, hy - 8, 2, 3, colors.spark);
    }
  } else if (p.key === "lead") {
    for (let n = 0; n < 5; n++) rect(hx - 4 + n, hy - 7 + n * .5, 3, 4, colors.spark);
    rect(hx - 5, hy - 3, 2, 8, colors.mid);
  } else if (p.key === "arp") {
    for (const side of [-1, 1]) {
      line([hx + side * 5, hy - 4], [hx + side * 8, hy - 8], 1, colors.highlight);
      rect(hx + side * 8 - 1, hy - 9, 3, 3, colors.spark);
    }
  } else {
    rect(hx - 1, hy - 8, 3, 5, colors.spark);
    rect(hx - hw - 2, hy - 2, 3, 5, colors.mid);
    rect(hx + hw - 1, hy - 2, 3, 5, colors.mid);
    rect(p.sway - 4, p.hipY - 5, 8, 5, colors.outline);
    rect(p.sway - 3, p.hipY - 5, 6, 2, colors.spark);
    rect(p.sway - 3, p.hipY - 3, 6, 2, colors.mid);
  }
  const wide = p.key === "arp" || p.key === "bass";
  for (const side of [-1, 1]) {
    const ex = hx + side * (wide ? 3 : 2) - (wide ? 2 : 1);
    const ew = wide ? 4 : 3;
    rect(ex, hy - 2, ew, p.blink ? 1 : 4, "#effcff");
    if (!p.blink) rect(ex + (p.frame % 4 < 2 ? 1 : 0), hy - 1, 2, 2, colors.outline);
    if (p.key === "bass") rect(ex, hy - 3, ew, 1, colors.mid);
  }
  rect(hx - 2, hy + 3, 4, 1 + Math.round(p.expression), colors.outline);
  if (p.key === "bass") {
    rect(hx - 2, hy + 3, 1, 2, "#effcff"); rect(hx + 1, hy + 3, 1, 2, "#effcff");
  }
}
