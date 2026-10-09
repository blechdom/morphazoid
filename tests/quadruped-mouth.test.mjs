import test from "node:test";
import assert from "node:assert/strict";
import { QUADRUPED_ANIMALS, createQuadrupedState, deriveQuadrupedPose } from "../src/instruments/quadruped/quadruped.js";
import { quadrupedProfileMouth } from "../src/instruments/quadruped/quadruped-mouth.js";
import { QUADRUPED_VISUAL_SKINS, deriveQuadrupedVisualRig, drawQuadrupedVisualSkin } from "../src/instruments/quadruped/quadruped-visual-skins.js";

const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
const area = ([a, b, c]) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
const families = [...new Set(QUADRUPED_ANIMALS.map(animal => animal.morphology.family))];

test("every animal's mouth opens in profile around a fixed cheek hinge", () => {
  for (const family of families) {
    const closed = quadrupedProfileMouth(family, 0);
    assert.deepEqual(closed.lowerLip, closed.upperLip, family);
    assert.equal(area(closed.opening), 0, family);
    let previousArea = 0;
    for (const strength of [0.15, 0.4, 0.7, 1]) {
      const mouth = quadrupedProfileMouth(family, strength);
      assert.deepEqual(mouth.hinge, closed.hinge, family);
      assert.deepEqual(mouth.upperLip, closed.upperLip, family);
      assert.ok(mouth.lowerLip.y > mouth.upperLip.y, family);
      assert.ok(mouth.lowerLip.x > mouth.hinge.x, family);
      assert.ok(area(mouth.opening) > previousArea, family);
      previousArea = area(mouth.opening);
      const width = mouth.upperLip.x - mouth.hinge.x;
      const height = mouth.lowerLip.y - mouth.upperLip.y;
      assert.ok(width > height * 1.6, `${family} retains a long profile opening`);
      for (let index = 0; index < mouth.jaw.length; index++) {
        const next = (index + 1) % mouth.jaw.length;
        assert.ok(Math.abs(distance(mouth.jaw[index], mouth.jaw[next]) - distance(closed.jaw[index], closed.jaw[next])) < 1e-12, `${family} rigid jaw edge ${index}`);
      }
    }
  }
});

test("mouth strength is bounded and invalid strengths close the jaw", () => {
  for (const family of [...families, "unknown"]) {
    for (const value of [undefined, NaN, Infinity, -Infinity, -1]) {
      assert.deepEqual(quadrupedProfileMouth(family, value), quadrupedProfileMouth(family, 0));
    }
    assert.deepEqual(quadrupedProfileMouth(family, 2), quadrupedProfileMouth(family, 1));
  }
});

test("visual mouth follows voice strength and head transforms, and closes when playback stops", () => {
  for (const animal of QUADRUPED_ANIMALS) {
    const score = createQuadrupedState(animal.id);
    const pose = { ...deriveQuadrupedPose(score, 3.2), headPerformance: { strength: 1 }, cartwheel: 0.2 };
    const before = JSON.stringify({ score, pose });
    const open = deriveQuadrupedVisualRig(pose, 900, 600, 450, score);
    const stopped = deriveQuadrupedVisualRig(pose, 900, 600, 450, score, { playing: false });
    assert.ok(area(open.mouth.opening) > 0, animal.id);
    assert.deepEqual(stopped.mouth.lowerLip, stopped.mouth.upperLip, animal.id);
    assert.deepEqual(stopped.legs, open.legs, `${animal.id} mouth never moves feet`);
    const profile = quadrupedProfileMouth(animal.morphology.family, 1);
    assert.deepEqual(open.mouth.lowerLip, open.headPoint(profile.lowerLip.x, profile.lowerLip.y), animal.id);
    assert.equal(open.mouth.strength, 1);
    assert.equal(stopped.mouth.strength, 0);
    assert.equal(JSON.stringify({ score, pose }), before);
    // A renderer can split its upper/lower jaw without replacing the hit skull.
    assert.notDeepEqual(open.upperSkull, open.skull);
    const quietPose = { ...pose, headPerformance: { strength: 0 } };
    const quiet = deriveQuadrupedVisualRig(quietPose, 900, 600, 450, score);
    const local = rig => rig.skull.map(p => ({ x: p.x - rig.head.x, y: p.y - rig.head.y }));
    const quietSkull = local(quiet), openSkull = local(open);
    assert.ok(quietSkull.every((p, index) => distance(p, openSkull[index]) < 1e-10), `${animal.id} hit skull remains rigid`);
  }
});

function drawingContext() {
  const commands = [], paths = [];
  let activePath = [];
  const context = new Proxy({ globalAlpha: 1 }, {
    get(target, property) {
      if (property in target) return target[property];
      return (...args) => {
        assert.ok(args.filter(value => typeof value === "number").every(Number.isFinite), `${property} receives finite geometry`);
        commands.push([property, ...args]);
        if (property === "beginPath") activePath = [];
        if (property === "moveTo" || property === "lineTo") activePath.push({ x: args[0], y: args[1] });
        if (property === "fill" || property === "stroke") paths.push([...activePath]);
      };
    },
  });
  return { context, commands, paths };
}

test("every alternate skin renders voice articulation and a stopped pose equals rest", () => {
  for (const animal of QUADRUPED_ANIMALS) for (const skin of QUADRUPED_VISUAL_SKINS.filter(skin => skin.id !== "animal")) {
    const score = { ...createQuadrupedState(animal.id), visualSkinId: skin.id };
    const pose = deriveQuadrupedPose(score, 3.2);
    const quietPose = { ...pose, headPerformance: { strength: 0 } };
    const voicePose = { ...pose, headPerformance: { strength: 1 } };
    const render = (frame, playing) => {
      const { context, commands, paths } = drawingContext();
      assert.equal(drawQuadrupedVisualSkin(context, frame, 900, 600, 450, score, { playing }), true);
      const rig = deriveQuadrupedVisualRig(frame, 900, 600, 450, score, { playing });
      assert.ok(paths.some(path => path.length === 3 && path.every((p, index) => distance(p, rig.mouth.opening[index]) < 1e-10)), `${animal.id}/${skin.id} paints the profile aperture`);
      return commands;
    };
    const rest = render(quietPose, true), open = render(voicePose, true), stopped = render(voicePose, false);
    assert.notDeepEqual(open, rest, `${animal.id}/${skin.id} voice animates`);
    assert.deepEqual(stopped, rest, `${animal.id}/${skin.id} stops at rest`);
  }
});
