import * as THREE from '../../../vendor/three/three.module.min.js';

/** Authored, mesh-free rigs: joints + motion only. No geometry, material or
 * texture is ever created. Joints are THREE.Bone objects. */

const DEG = Math.PI / 180;

export function bone(name, parent, x = 0, y = 0, z = 0) {
  const joint = new THREE.Bone();
  joint.name = name;
  joint.position.set(x, y, z);
  joint.userData.rest = { x, y, z };
  if (parent) parent.add(joint);
  return joint;
}

function collect(root) {
  const joints = [];
  root.traverse((object) => { if (object.isBone) joints.push(object); });
  return joints;
}

function limb(parent, prefix, attach, dir, upper, lower, lift) {
  const a = bone(`${prefix}A`, parent, attach[0], attach[1], attach[2]);
  const b = bone(`${prefix}B`, a, dir[0] * upper, dir[1] * upper + lift, dir[2] * upper);
  const c = bone(`${prefix}C`, b, dir[0] * lower, dir[1] * lower - lift - 0.14, dir[2] * lower);
  return { a, b, c };
}

function spineChain(root, count, step, prefix = 'seg') {
  const chain = [root];
  let parent = root;
  for (let i = 0; i < count; i += 1) {
    parent = bone(`${prefix}${i}`, parent, step[0], step[1], step[2]);
    chain.push(parent);
  }
  return chain;
}

function contactsFrom(joints, lift = 0.1) {
  return joints.map((joint, i) => ({ joint, lift, index: i }));
}

/* ---------- INSECTS & ARACHNIDS ---------- */

export function createSpider({ legs = 8 } = {}) {
  const root = bone('root', null, 0, 0.34, 0);
  const thorax = bone('thorax', root, 0, 0.02, 0.05);
  bone('abdomen', thorax, 0, 0.03, -0.3);
  const limbs = [];
  const perSide = Math.max(2, Math.round(legs / 2));
  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i += 1) {
      const angle = (i / perSide) * Math.PI - Math.PI / 2;
      const hip = bone(`${side < 0 ? 'L' : 'R'}Hip${i}`, thorax, Math.sin(angle) * 0.09, 0.02, Math.cos(angle) * 0.09);
      const knee = bone(`${side < 0 ? 'L' : 'R'}Knee${i}`, hip, Math.sin(angle) * 0.34, 0.16, Math.cos(angle) * 0.34);
      const foot = bone(`${side < 0 ? 'L' : 'R'}Foot${i}`, knee, Math.sin(angle) * 0.31, -0.34, Math.cos(angle) * 0.31);
      limbs.push({ hip, knee, foot, angle, index: i, side });
    }
  }
  return {
    id: 'spider', joints: collect(root),
    contacts: limbs.map((l) => ({ joint: l.foot, lift: 0.16, index: l.index, side: l.side })),
    limbs,
    update(pose, time) {
      const rate = pose.rate, amp = pose.amp * 0.68;
      root.position.y = 0.34 + Math.sin(time * 6 * rate) * 0.012 * pose.amp;
      for (const l of this.limbs) {
        const phase = ((l.index + (l.side < 0 ? 0 : 1)) % 2) * Math.PI + l.index * 0.62;
        l.hip.rotation.x = Math.sin(time * 6 * rate + phase) * amp;
        l.knee.rotation.x = (0.55 + Math.max(0, Math.sin(time * 6 * rate + phase + Math.PI / 2)) * 0.9) * amp * 1.3;
        l.foot.userData.phase = (time * rate * 3 + phase / (Math.PI * 2)) % 1;
      }
      thorax.rotation.x = Math.sin(time * 6 * rate) * 0.04 * pose.sway;
    },
  };
}

export function createAnt({ legs = 6 } = {}) {
  const root = bone('root', null, 0, 0.2, 0.1);
  const thorax = bone('thorax', root, 0, 0, 0);
  bone('abdomen', thorax, 0, 0.01, -0.24);
  const limbs = [];
  const perSide = Math.max(1, Math.round(legs / 2));
  for (const side of [-1, 1]) {
    for (let i = 0; i < perSide; i += 1) {
      const hip = bone(`${side < 0 ? 'L' : 'R'}Hip${i}`, thorax, side * 0.05, 0, 0.08 - i * 0.09);
      const knee = bone(`${side < 0 ? 'L' : 'R'}Knee${i}`, hip, side * 0.13, 0.05, 0);
      const foot = bone(`${side < 0 ? 'L' : 'R'}Foot${i}`, knee, side * 0.12, -0.16, 0);
      limbs.push({ hip, knee, foot, index: i, side });
    }
  }
  const antennae = [-1, 1].map((s) => bone(`antenna${s < 0 ? 'L' : 'R'}`, thorax, s * 0.03, 0.05, 0.12));
  return {
    id: 'ant', joints: collect(root),
    contacts: limbs.map((l) => ({ joint: l.foot, lift: 0.08, index: l.index })),
    update(pose, time) {
      const rate = pose.rate, amp = pose.amp * 0.6;
      root.position.z = 0.1 + Math.sin(time * 2 * rate) * 0.1;
      for (const l of limbs) {
        const phase = ((l.index + (l.side < 0 ? 0 : 1)) % 2) * Math.PI + l.index;
        l.hip.rotation.x = Math.sin(time * 9 * rate + phase) * amp;
        l.foot.userData.phase = (time * rate * 4 + phase / (Math.PI * 2)) % 1;
      }
      antennae.forEach((a, i) => { a.rotation.x = Math.sin(time * 7 + i) * 0.3 * pose.sway; });
    },
  };
}

export function createCentipede({ segments = 14 } = {}) {
  const root = bone('root', null, 0, 0.14, 0.6);
  const spine = spineChain(root, segments, [0, 0, -0.09], 'seg');
  const feet = [];
  spine.slice(1).forEach((joint, i) => {
    for (const side of [-1, 1]) {
      const foot = bone(`f${i}${side < 0 ? 'L' : 'R'}`, joint, side * 0.06, -0.06, 0);
      feet.push({ joint: foot, index: i, side });
    }
  });
  return {
    id: 'centipede', joints: collect(root),
    contacts: feet.map((f) => ({ joint: f.joint, lift: 0.05, index: f.index })),
    update(pose, time) {
      const wave = time * 5 * pose.rate;
      spine.forEach((joint, i) => {
        if (i === 0) return;
        joint.rotation.y = Math.sin(wave - i * 0.5) * pose.amp * 0.4;
        joint.position.y = Math.max(0, Math.sin(wave - i * 0.5 + Math.PI / 2)) * 0.02;
      });
      feet.forEach((f) => { f.joint.userData.phase = (wave / (Math.PI * 2) + f.index * 0.1) % 1; });
    },
  };
}

export function createScorpion({ legs = 8 } = {}) {
  const root = bone('root', null, 0, 0.22, 0.1);
  const body = bone('body', root, 0, 0, 0);
  const tail = spineChain(body, 5, [0, 0.06, -0.11], 'tail');
  const sting = tail[tail.length - 1];
  const claws = [-1, 1].map((s) => {
    const arm = bone(`clawArm${s < 0 ? 'L' : 'R'}`, body, s * 0.1, 0.02, 0.12);
    const claw = bone(`claw${s < 0 ? 'L' : 'R'}`, arm, s * 0.12, 0, 0.12);
    return { arm, claw, side: s };
  });
  const limbs = [];
  const legPairs = Math.max(1, Math.round(legs / 2));
  for (const side of [-1, 1]) for (let i = 0; i < legPairs; i += 1) {
    const hip = bone(`${side < 0 ? 'L' : 'R'}Hip${i}`, body, side * 0.07, 0, 0.06 - i * 0.06);
    const foot = bone(`${side < 0 ? 'L' : 'R'}Foot${i}`, hip, side * 0.2, -0.18, 0);
    limbs.push({ hip, foot, index: i, side });
  }
  return {
    id: 'scorpion', joints: collect(root),
    contacts: [{ joint: sting, lift: 0.2, index: 0 }, ...claws.map((c) => ({ joint: c.claw, lift: 0.1, index: c.side }))],
    update(pose, time) {
      const wave = time * 3 * pose.rate;
      tail.forEach((joint, i) => { if (i > 0) joint.rotation.x = 0.3 + Math.sin(wave - i * 0.5) * pose.amp * 0.4; });
      claws.forEach((c, i) => { c.arm.rotation.y = c.side * (0.3 + Math.sin(time * 2.2 * pose.rate + i) * pose.amp * 0.3); });
      limbs.forEach((l, i) => { l.hip.rotation.x = Math.sin(time * 7 * pose.rate + i) * pose.amp * 0.4; });
      sting.userData.phase = (time * pose.rate) % 1;
    },
  };
}

/* ---------- AQUATIC ---------- */

export function createFish({ segments = 6 } = {}) {
  const root = bone('root', null, 0, 0.5, 0.5);
  const spine = spineChain(root, segments, [0, 0, -0.18], 'spine');
  return {
    id: 'fish', joints: spine,
    contacts: contactsFrom(spine.slice(1), 0.03),
    update(pose, time) {
      const wave = time * 5 * pose.rate;
      root.position.x = Math.sin(time * 0.7) * 0.2 * pose.sway;
      spine.forEach((joint, i) => { if (i > 0) joint.rotation.y = Math.sin(wave - i * 0.8) * pose.amp * (0.14 + i * 0.05); });
    },
  };
}

export function createJellyfish({ arms = 8 } = {}) {
  const root = bone('root', null, 0, 0.9, 0);
  bone('bell', root, 0, 0.12, 0);
  const armsList = [];
  for (let i = 0; i < arms; i += 1) {
    const angle = (i / arms) * Math.PI * 2;
    const base = bone(`arm${i}`, root, Math.cos(angle) * 0.16, -0.02, Math.sin(angle) * 0.16);
    const tip = bone(`armTip${i}`, base, 0, -0.5, 0);
    armsList.push({ base, tip, angle, index: i });
  }
  return {
    id: 'jellyfish', joints: collect(root),
    contacts: armsList.map((a) => ({ joint: a.tip, lift: 0.1, index: a.index })),
    update(pose, time) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2.6 * pose.rate);
      root.scale.setScalar(0.92 + pulse * 0.16 * pose.amp);
      root.position.y = 0.9 - pulse * 0.12 * pose.amp;
      armsList.forEach((a, i) => {
        a.base.rotation.x = Math.sin(time * 2.6 * pose.rate + i * 0.7) * pose.amp * 0.4;
        a.base.rotation.z = Math.cos(time * 2.6 * pose.rate + i * 0.7) * pose.amp * 0.3;
        a.tip.userData.phase = (time * pose.rate + i * 0.1) % 1;
      });
    },
  };
}

export function createOctopus({ arms = 6 } = {}) {
  const root = bone('root', null, 0, 0.4, 0);
  bone('mantle', root, 0, 0.2, 0);
  const armsList = [];
  for (let i = 0; i < arms; i += 1) {
    const angle = (i / arms) * Math.PI * 2;
    const a = bone(`armA${i}`, root, Math.cos(angle) * 0.12, -0.05, Math.sin(angle) * 0.12);
    const b = bone(`armB${i}`, a, Math.cos(angle) * 0.2, -0.12, Math.sin(angle) * 0.2);
    const c = bone(`armC${i}`, b, Math.cos(angle) * 0.22, -0.05, Math.sin(angle) * 0.22);
    armsList.push({ a, b, c, angle, index: i });
  }
  return {
    id: 'octopus', joints: collect(root),
    contacts: armsList.map((a) => ({ joint: a.c, lift: 0.1, index: a.index })),
    update(pose, time) {
      const wave = time * 2.4 * pose.rate;
      armsList.forEach((a, i) => {
        const curl = Math.sin(wave + i * 0.9) * pose.amp;
        a.a.rotation.x = 0.3 + curl * 0.4;
        a.b.rotation.x = curl * 0.8;
        a.c.rotation.x = curl * 0.6;
        a.c.userData.phase = (wave / (Math.PI * 2) + i * 0.13) % 1;
      });
      root.position.y = 0.4 + Math.sin(wave * 0.7) * 0.06 * pose.amp;
    },
  };
}

export function createCrab({ legs = 8 } = {}) {
  const root = bone('root', null, 0, 0.18, 0);
  const body = bone('body', root, 0, 0.02, 0);
  const claws = [-1, 1].map((s) => {
    const arm = bone(`clawArm${s < 0 ? 'L' : 'R'}`, body, s * 0.14, 0.02, 0.1);
    const claw = bone(`claw${s < 0 ? 'L' : 'R'}`, arm, s * 0.14, 0, 0.1);
    return { arm, claw, side: s };
  });
  const limbs = [];
  const legPairs = Math.max(1, Math.round(legs / 2));
  for (const side of [-1, 1]) for (let i = 0; i < legPairs; i += 1) {
    const hip = bone(`${side < 0 ? 'L' : 'R'}Hip${i}`, body, side * 0.12, 0, 0.02 - i * 0.05);
    const foot = bone(`${side < 0 ? 'L' : 'R'}Foot${i}`, hip, side * 0.22, -0.15, 0);
    limbs.push({ hip, foot, index: i, side });
  }
  return {
    id: 'crab', joints: collect(root),
    contacts: claws.map((c) => ({ joint: c.claw, lift: 0.1, index: c.side })),
    update(pose, time) {
      // Crabs walk sideways.
      root.position.x = Math.sin(time * 2 * pose.rate) * 0.3 * pose.sway;
      limbs.forEach((l, i) => { l.hip.rotation.x = Math.sin(time * 8 * pose.rate + i) * pose.amp * 0.5; });
      claws.forEach((c, i) => { c.arm.rotation.z = c.side * (0.2 + Math.max(0, Math.sin(time * 3 * pose.rate + i)) * pose.amp * 0.5); });
    },
  };
}

/* ---------- FLYING ---------- */

export function createBat() {
  const root = bone('root', null, 0, 0.7, 0);
  const body = bone('body', root, 0, 0, 0);
  const wings = [-1, 1].map((side) => {
    const shoulder = bone(`shoulder${side < 0 ? 'L' : 'R'}`, body, side * 0.12, 0.02, 0);
    const elbow = bone(`elbow${side < 0 ? 'L' : 'R'}`, shoulder, side * 0.34, 0, 0.04);
    const tip = bone(`tip${side < 0 ? 'L' : 'R'}`, elbow, side * 0.4, -0.02, 0.1);
    return { shoulder, elbow, tip, side };
  });
  return {
    id: 'bat', joints: collect(root),
    contacts: wings.map((w) => ({ joint: w.tip, lift: 0.2, index: w.side })),
    wings,
    update(pose, time) {
      const flap = Math.sin(time * 8 * pose.rate);
      const fold = 0.5 + 0.5 * Math.sin(time * 8 * pose.rate + Math.PI / 2);
      for (const w of this.wings) {
        w.shoulder.rotation.z = -w.side * flap * pose.amp * 0.9;
        w.elbow.rotation.z = w.side * fold * pose.fold * 0.8;
        w.elbow.rotation.y = w.side * fold * pose.fold * 0.4;
      }
      root.position.y = 0.7 + Math.sin(time * 8 * pose.rate + Math.PI / 2) * 0.08 * pose.amp;
    },
  };
}

export function createBird() {
  const root = bone('root', null, 0, 0.7, 0);
  const body = bone('body', root, 0, 0, 0);
  bone('tail', body, 0, 0, -0.22);
  const wings = [-1, 1].map((side) => {
    const shoulder = bone(`shoulder${side < 0 ? 'L' : 'R'}`, body, side * 0.1, 0.02, 0);
    const tip = bone(`tip${side < 0 ? 'L' : 'R'}`, shoulder, side * 0.42, 0, 0.06);
    return { shoulder, tip, side };
  });
  return {
    id: 'bird', joints: collect(root),
    contacts: wings.map((w) => ({ joint: w.tip, lift: 0.2, index: w.side })),
    update(pose, time) {
      const flap = Math.sin(time * 7 * pose.rate);
      wings.forEach((w) => {
        w.shoulder.rotation.z = -w.side * (0.2 + flap * pose.amp * 0.8);
        w.tip.userData.phase = (time * pose.rate) % 1;
      });
      root.position.y = 0.7 + Math.sin(time * 7 * pose.rate + Math.PI / 2) * 0.1 * pose.amp;
      root.rotation.z = Math.sin(time * 1.1) * pose.sway * 0.1;
    },
  };
}

export function createButterfly() {
  const root = bone('root', null, 0, 0.6, 0);
  const body = bone('body', root, 0, 0, 0);
  const wings = [-1, 1].flatMap((side) => ([
    { wing: bone(`fore${side < 0 ? 'L' : 'R'}`, body, side * 0.12, 0.04, 0.05), side },
    { wing: bone(`hind${side < 0 ? 'L' : 'R'}`, body, side * 0.1, -0.02, -0.08), side },
  ]));
  return {
    id: 'butterfly', joints: collect(root),
    contacts: wings.map((w) => ({ joint: w.wing, lift: 0.15, index: w.side })),
    update(pose, time) {
      const flap = Math.sin(time * 11 * pose.rate);
      wings.forEach((w) => { w.wing.rotation.z = -w.side * flap * pose.amp; });
      root.position.y = 0.6 + Math.sin(time * 2.3) * 0.15 * pose.sway;
      root.position.x = Math.sin(time * 1.3) * 0.2 * pose.sway;
    },
  };
}

export function createDragonfly() {
  const root = bone('root', null, 0, 0.65, 0.1);
  const thorax = bone('thorax', root, 0, 0, 0);
  spineChain(thorax, 6, [0, 0, -0.09], 'abdomen');
  const wings = [-1, 1].flatMap((side) => ([
    { wing: bone(`fore${side < 0 ? 'L' : 'R'}`, thorax, side * 0.16, 0.03, 0.03), side },
    { wing: bone(`hind${side < 0 ? 'L' : 'R'}`, thorax, side * 0.15, 0.02, -0.04), side },
  ]));
  return {
    id: 'dragonfly', joints: collect(root),
    contacts: wings.map((w) => ({ joint: w.wing, lift: 0.12, index: w.side })),
    update(pose, time) {
      // Dragonflies hover: fast shimmer, slow drift.
      wings.forEach((w, i) => { w.wing.rotation.z = -w.side * Math.sin(time * 26 * pose.rate + i) * pose.amp * 0.4; });
      root.position.x = Math.sin(time * 0.9) * 0.25 * pose.sway;
      root.position.z = 0.1 + Math.cos(time * 0.7) * 0.2 * pose.sway;
    },
  };
}

/* ---------- SERPENT & WORM ---------- */

export function createSnake({ segments = 10 } = {}) {
  const root = bone('root', null, 0, 0.12, 0.6);
  const spine = spineChain(root, segments, [0, 0, -0.14], 'spine');
  return {
    id: 'snake', joints: spine,
    contacts: contactsFrom(spine.slice(1), 0.04),
    update(pose, time) {
      const wave = time * 4 * pose.rate;
      spine.forEach((joint, i) => { if (i > 0) joint.rotation.y = Math.sin(wave - i * 0.6) * pose.amp * 0.4; });
      root.position.x = Math.sin(wave * 0.5) * 0.1 * pose.sway;
    },
  };
}

export function createCaterpillar({ segments = 7 } = {}) {
  const root = bone('root', null, 0, 0.2, 0.4);
  const spine = spineChain(root, segments, [0, 0, -0.16], 'segment');
  return {
    id: 'caterpillar', joints: spine,
    contacts: contactsFrom(spine.slice(1), 0.05),
    update(pose, time) {
      const wave = time * 4.2 * pose.rate;
      spine.forEach((joint, i) => {
        if (i === 0) return;
        joint.rotation.x = Math.sin(wave - i * 0.9) * pose.amp * 0.5;
        joint.rotation.y = Math.sin(wave * 0.5 + i) * pose.sway * 0.12;
      });
    },
  };
}

export function createWorm({ segments = 8 } = {}) {
  const root = bone('root', null, 0, 0.1, 0.4);
  const spine = spineChain(root, segments, [0, 0, -0.11], 'seg');
  return {
    id: 'worm', joints: spine,
    contacts: contactsFrom(spine.slice(1), 0.03),
    update(pose, time) {
      const wave = time * 3.4 * pose.rate;
      spine.forEach((joint, i) => {
        if (i === 0) return;
        joint.rotation.x = Math.sin(wave - i * 0.7) * pose.amp * 0.4;
        joint.position.y = Math.max(0, Math.sin(wave - i * 0.7 + Math.PI / 2)) * 0.03;
      });
    },
  };
}

/* ---------- QUADRUPEDS & BIPEDS ---------- */

function quadrupedBody(root, legPositions, legSize = 0.24) {
  const legs = legPositions.map(([x, z], i) => {
    const hip = bone(`hip${i}`, root, x, 0, z);
    const knee = bone(`knee${i}`, hip, 0, -legSize, 0);
    const foot = bone(`foot${i}`, knee, 0, -legSize, 0.03);
    return { hip, knee, foot, index: i, front: z > 0 };
  });
  return legs;
}

function quadrupedGait(legs, pose, time, freq = 5.2) {
  for (const leg of legs) {
    // Diagonal pairs: front-left+rear-right vs front-right+rear-left.
    const phase = time * freq * pose.rate + ((leg.index % 2) ^ (leg.front ? 0 : 1)) * Math.PI;
    leg.hip.rotation.x = Math.sin(phase) * pose.amp * 0.7;
    leg.knee.rotation.x = Math.max(0, Math.sin(phase + Math.PI / 2)) * pose.amp * 0.9;
    leg.foot.userData.phase = (phase / (Math.PI * 2)) % 1;
  }
}

export function createWalker() {
  const root = bone('root', null, 0, 0.62, 0);
  const spine = bone('spine', root, 0, 0.12, 0);
  bone('head', spine, 0, 0.24, 0.01);
  const legs = [-1, 1].map((side) => {
    const hip = bone(`hip${side < 0 ? 'L' : 'R'}`, root, side * 0.09, -0.02, 0);
    const knee = bone(`knee${side < 0 ? 'L' : 'R'}`, hip, 0, -0.24, 0);
    const foot = bone(`foot${side < 0 ? 'L' : 'R'}`, knee, 0, -0.24, 0.03);
    return { hip, knee, foot, side };
  });
  const arms = [-1, 1].map((side) => {
    const shoulder = bone(`shoulder${side < 0 ? 'L' : 'R'}`, spine, side * 0.16, 0.14, 0);
    bone(`hand${side < 0 ? 'L' : 'R'}`, shoulder, side * 0.05, -0.3, 0);
    return { shoulder, side };
  });
  return {
    id: 'walker', joints: collect(root),
    contacts: legs.map((l) => ({ joint: l.foot, lift: 0.12, index: l.side })),
    update(pose, time) {
      legs.forEach((l) => {
        const phase = time * 5.2 * pose.rate + (l.side < 0 ? 0 : Math.PI);
        l.hip.rotation.x = Math.sin(phase) * pose.amp * 0.75;
        l.knee.rotation.x = Math.max(0, Math.sin(phase + Math.PI / 2)) * pose.amp * 0.9;
        l.foot.userData.phase = (phase / (Math.PI * 2)) % 1;
      });
      arms.forEach((a) => { a.shoulder.rotation.x = Math.sin(time * 5.2 * pose.rate + (a.side < 0 ? Math.PI : 0)) * pose.amp * 0.4; });
      root.position.y = 0.62 + Math.abs(Math.sin(time * 5.2 * pose.rate)) * 0.03 * pose.amp;
    },
  };
}

export function createHorse() {
  const root = bone('root', null, 0, 0.7, 0.2);
  const body = bone('body', root, 0, 0, 0);
  spineChain(body, 3, [0, 0.06, 0.16], 'neck');
  bone('tail', body, 0, 0.02, -0.5);
  const legs = quadrupedBody(body, [[-0.12, 0.3], [0.12, 0.3], [-0.12, -0.32], [0.12, -0.32]], 0.3);
  return {
    id: 'horse', joints: collect(root),
    contacts: legs.map((l) => ({ joint: l.foot, lift: 0.14, index: l.index })),
    update(pose, time) {
      quadrupedGait(legs, pose, time, 4.6);
      root.position.y = 0.7 + Math.abs(Math.sin(time * 4.6 * pose.rate)) * 0.04 * pose.amp;
      body.rotation.x = Math.sin(time * 4.6 * pose.rate) * 0.04 * pose.sway;
    },
  };
}

export function createCat() {
  const root = bone('root', null, 0, 0.42, 0.15);
  const body = bone('body', root, 0, 0, 0);
  spineChain(body, 2, [0, 0.05, 0.14], 'neck');
  const tail = spineChain(body, 4, [0, 0.03, -0.12], 'tail');
  const legs = quadrupedBody(body, [[-0.09, 0.18], [0.09, 0.18], [-0.09, -0.2], [0.09, -0.2]], 0.18);
  return {
    id: 'cat', joints: collect(root),
    contacts: legs.map((l) => ({ joint: l.foot, lift: 0.08, index: l.index })),
    update(pose, time) {
      quadrupedGait(legs, pose, time, 6);
      tail.forEach((joint, i) => { if (i > 0) joint.rotation.x = 0.3 + Math.sin(time * 2.4 * pose.rate - i * 0.5) * pose.sway * 0.4; });
      root.position.y = 0.42 + Math.abs(Math.sin(time * 6 * pose.rate)) * 0.02 * pose.amp;
    },
  };
}

export function createDog() {
  const root = bone('root', null, 0, 0.5, 0.18);
  const body = bone('body', root, 0, 0, 0);
  spineChain(body, 2, [0, 0.06, 0.16], 'neck');
  const tail = spineChain(body, 3, [0, 0.04, -0.14], 'tail');
  const legs = quadrupedBody(body, [[-0.1, 0.22], [0.1, 0.22], [-0.1, -0.24], [0.1, -0.24]], 0.22);
  return {
    id: 'dog', joints: collect(root),
    contacts: legs.map((l) => ({ joint: l.foot, lift: 0.1, index: l.index })),
    update(pose, time) {
      quadrupedGait(legs, pose, time, 5.6);
      tail.forEach((joint, i) => { if (i > 0) joint.rotation.y = Math.sin(time * 8 * pose.rate) * pose.sway * (0.3 + i * 0.2); });
    },
  };
}

export function createFrog() {
  const root = bone('root', null, 0, 0.22, 0.05);
  const body = bone('body', root, 0, 0, 0);
  const legs = [-1, 1].map((side) => {
    const thigh = bone(`thigh${side < 0 ? 'L' : 'R'}`, body, side * 0.12, 0, -0.05);
    const shin = bone(`shin${side < 0 ? 'L' : 'R'}`, thigh, side * 0.08, -0.06, -0.1);
    const foot = bone(`foot${side < 0 ? 'L' : 'R'}`, shin, side * 0.04, -0.06, 0.1);
    return { thigh, shin, foot, side };
  });
  return {
    id: 'frog', joints: collect(root),
    contacts: legs.map((l) => ({ joint: l.foot, lift: 0.15, index: l.side })),
    update(pose, time) {
      // Hop: crouch, leap, land.
      const cycle = (time * pose.rate) % 1;
      const hop = Math.max(0, Math.sin(cycle * Math.PI));
      legs.forEach((l) => {
        l.thigh.rotation.x = -0.5 - hop * 0.8 * pose.amp;
        l.shin.rotation.x = 1.2 - hop * 1.1 * pose.amp;
        l.foot.userData.phase = cycle;
      });
      root.position.y = 0.22 + hop * hop * 0.4 * pose.amp;
      root.position.z = 0.05 - cycle * 0.3 * pose.rate;
    },
  };
}

export function createKangaroo() {
  const root = bone('root', null, 0, 0.6, 0);
  const body = bone('body', root, 0, 0, 0);
  const legs = [-1, 1].map((side) => {
    const thigh = bone(`thigh${side < 0 ? 'L' : 'R'}`, body, side * 0.1, -0.05, 0);
    const shin = bone(`shin${side < 0 ? 'L' : 'R'}`, thigh, 0, -0.22, -0.05);
    const foot = bone(`foot${side < 0 ? 'L' : 'R'}`, shin, 0, -0.2, 0.08);
    return { thigh, shin, foot, side };
  });
  bone('tail', body, 0, -0.1, -0.4);
  return {
    id: 'kangaroo', joints: collect(root),
    contacts: legs.map((l) => ({ joint: l.foot, lift: 0.2, index: l.side })),
    update(pose, time) {
      const cycle = (time * pose.rate) % 1;
      const hop = Math.max(0, Math.sin(cycle * Math.PI));
      legs.forEach((l) => {
        l.thigh.rotation.x = -0.4 - hop * 0.9 * pose.amp;
        l.shin.rotation.x = 0.9 - hop * 1.2 * pose.amp;
        l.foot.userData.phase = cycle;
      });
      root.position.y = 0.6 + hop * hop * 0.5 * pose.amp;
    },
  };
}

/* ---------- NECKS & ARMS ---------- */

export function createCrane() {
  const root = bone('root', null, 0, 0.4, 0);
  const neck1 = bone('neck1', root, 0, 0.18, 0.02);
  const neck2 = bone('neck2', neck1, 0, 0.18, 0.03);
  const beak = bone('beak', neck2, 0, 0.16, 0.06);
  return {
    id: 'crane', joints: collect(root),
    contacts: [{ joint: beak, lift: 0.1, index: 0 }],
    update(pose, time) {
      const peck = Math.max(0, Math.sin((time * pose.rate % 1) * Math.PI * 2)) * pose.amp;
      neck1.rotation.x = 0.2 + peck * 0.7;
      neck2.rotation.x = -0.1 + peck * 0.8;
      beak.rotation.x = peck * 0.5;
      neck1.rotation.y = Math.sin(time * 0.6 * pose.rate) * pose.sway * 0.4;
      beak.userData.phase = (time * pose.rate) % 1;
    },
  };
}

export function createGiraffe() {
  const root = bone('root', null, 0, 0.9, 0.1);
  const body = bone('body', root, 0, 0, 0);
  const neck = spineChain(body, 4, [0, 0.2, 0.1], 'neck');
  const head = neck[neck.length - 1];
  const legs = quadrupedBody(body, [[-0.12, 0.25], [0.12, 0.25], [-0.12, -0.25], [0.12, -0.25]], 0.4);
  return {
    id: 'giraffe', joints: collect(root),
    contacts: [{ joint: head, lift: 0.1, index: 0 }, ...legs.map((l) => ({ joint: l.foot, lift: 0.1, index: l.index + 1 }))],
    update(pose, time) {
      quadrupedGait(legs, pose, time, 4);
      neck.forEach((joint, i) => { if (i > 0) joint.rotation.x = 0.2 + Math.sin(time * 1.6 * pose.rate - i * 0.4) * pose.sway * 0.2; });
    },
  };
}

/* ---------- PERCUSSION & ABSTRACT ---------- */

export function createWhip({ segments = 5 } = {}) {
  const root = bone('root', null, 0, 0.3, 0);
  const chain = spineChain(root, segments, [0, 0, -0.2], 'link');
  return {
    id: 'whip', joints: chain,
    contacts: contactsFrom(chain.slice(1), 0.06),
    update(pose, time) {
      root.rotation.z = Math.sin(time * 2.6 * pose.rate) * pose.amp * 0.4;
      chain.forEach((joint, i) => {
        if (i === 0) return;
        joint.rotation.z = Math.sin(time * 2.6 * pose.rate - i * 0.7) * pose.amp * (0.25 + i * 0.22);
        joint.rotation.x = Math.sin(time * 1.3 * pose.rate - i * 0.5) * pose.sway * 0.1;
      });
    },
  };
}

export function createStriker() {
  const root = bone('root', null, 0, 0.62, 0);
  const shoulder = bone('shoulder', root, 0, 0, 0);
  const elbow = bone('elbow', shoulder, 0, -0.26, 0.02);
  const mallet = bone('mallet', elbow, 0, -0.3, 0);
  return {
    id: 'striker', joints: collect(root),
    contacts: [{ joint: mallet, lift: 0.3, index: 0 }],
    update(pose, time) {
      const cycle = (time * pose.rate) % 1;
      const wind = Math.min(cycle / 0.55, 1);
      const strike = cycle < 0.55 ? 0 : Math.min((cycle - 0.55) / 0.12, 1);
      const recoil = cycle < 0.67 ? 0 : Math.min((cycle - 0.67) / 0.33, 1);
      const lift = Math.sin(wind * Math.PI * 0.5) * pose.amp;
      const down = strike * (1 - recoil) * lift * 1.6;
      shoulder.rotation.x = -lift * 0.9 + down * 0.9;
      elbow.rotation.x = -lift * 0.7 + down * 1.1;
      mallet.userData.phase = cycle;
    },
  };
}

export function createScorpionTail({ segments = 6 } = {}) {
  const root = bone('root', null, 0, 0.2, 0);
  const tail = spineChain(root, segments, [0, 0.08, -0.12], 'tail');
  const sting = tail[tail.length - 1];
  return {
    id: 'scorpionTail', joints: tail,
    contacts: [{ joint: sting, lift: 0.2, index: 0 }],
    update(pose, time) {
      const cycle = (time * pose.rate) % 1;
      const strike = Math.max(0, Math.sin(cycle * Math.PI));
      tail.forEach((joint, i) => {
        if (i === 0) return;
        joint.rotation.x = 0.4 + strike * pose.amp * (0.5 - i * 0.05);
      });
      sting.userData.phase = cycle;
    },
  };
}


/* ---------- Procedural random body plans ---------- */

/** Build a random creature rig from a seed: random limb count, segment count
 * and body plan, then reuses the closest authored gait. Deterministic per seed. */
export function createRandom({ seed = 1 } = {}) {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 0xffffffff; };
  const plans = [
    () => createSpider({ legs: 2 * (2 + Math.floor(rnd() * 5)) }),      // 4..12 legs
    () => createAnt({ legs: 2 * (3 + Math.floor(rnd() * 4)) }),          // 6..14
    () => createCentipede({ segments: 6 + Math.floor(rnd() * 14) }),     // 6..19
    () => createOctopus({ arms: 3 + Math.floor(rnd() * 8) }),            // 3..10
    () => createJellyfish({ arms: 4 + Math.floor(rnd() * 9) }),          // 4..12
    () => createSnake({ segments: 5 + Math.floor(rnd() * 12) }),         // 5..16
    () => createFish({ segments: 3 + Math.floor(rnd() * 8) }),           // 3..10
    () => createWhip({ segments: 3 + Math.floor(rnd() * 7) }),           // 3..9
  ];
  const index = Math.floor(rnd() * plans.length);
  const rig = plans[index]();
  rig.id = 'random';
  rig.randomSeed = seed;
  return rig;
}

export const RANDOM_RIG_LABEL = 'Random body plan (seeded)';

export const RIG_GROUPS = {
  'Insects & arachnids': ['spider', 'ant', 'centipede', 'scorpion'],
  Aquatic: ['fish', 'jellyfish', 'octopus', 'crab'],
  Flying: ['bat', 'bird', 'butterfly', 'dragonfly'],
  Serpent: ['snake', 'caterpillar', 'worm'],
  'Four & two legs': ['walker', 'horse', 'cat', 'dog', 'frog', 'kangaroo'],
  'Necks & tails': ['crane', 'giraffe', 'scorpionTail'],
  'Striking & whips': ['whip', 'striker'],
};

export const RIG_FACTORIES = {
  spider: createSpider, ant: createAnt, centipede: createCentipede, scorpion: createScorpion,
  fish: createFish, jellyfish: createJellyfish, octopus: createOctopus, crab: createCrab,
  bat: createBat, bird: createBird, butterfly: createButterfly, dragonfly: createDragonfly,
  snake: createSnake, caterpillar: createCaterpillar, worm: createWorm,
  walker: createWalker, horse: createHorse, cat: createCat, dog: createDog, frog: createFrog, kangaroo: createKangaroo,
  crane: createCrane, giraffe: createGiraffe, scorpionTail: createScorpionTail,
  whip: createWhip, striker: createStriker,
};

export const RIG_DESCRIPTIONS = {
  spider: '8 legs · tetrapod gait', ant: '6 legs · tripod + antennae',
  centipede: '14 segments · wave', scorpion: 'claws + striking tail',
  fish: 'lateral spine wave', jellyfish: 'pulsing bell + 8 arms',
  octopus: '6 curling arms', crab: 'sideways walk + claws',
  bat: 'fold + flap wings', bird: 'flap + tail',
  butterfly: '4 wing flutter', dragonfly: 'hover shimmer',
  snake: 'slither wave', caterpillar: 'peristaltic inch',
  worm: 'burrowing wave', walker: 'biped gait',
  horse: '4-leg diagonal gait', cat: 'prowl + tail',
  dog: 'trot + wag', frog: 'crouch and hop',
  kangaroo: 'bipedal hop', crane: 'neck peck',
  giraffe: 'long neck sway', scorpionTail: 'striking tail',
  whip: 'overshoot crack', striker: 'mallet snap',
};
