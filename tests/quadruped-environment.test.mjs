import test from "node:test";
import assert from "node:assert/strict";
import { deriveQuadrupedEnvironmentLayout, drawQuadrupedEnvironment } from "../src/instruments/quadruped/quadruped-environment.js";

const skins = ["animal", "skeleton", "constellation", "collage", "motion-card"];
const options = { width: 900, height: 450, groundY: 333, worldScale: 89, worldX: 14.9 };

test("world landmarks retain identity through forward and reverse cell crossings, pause and return travel", () => {
  for (const skinId of skins) for (const worldX of Array.from({ length: 801 }, (_, i) => (i - 400) * 0.2)) {
    const first = deriveQuadrupedEnvironmentLayout({ ...options, skinId, worldX });
    for (const travel of [-0.02, 0.02]) {
      const next = deriveQuadrupedEnvironmentLayout({ ...options, skinId, worldX: worldX + travel });
      const shared = first.props.flatMap(a => { const b = next.props.find(p => p.id === a.id); return b ? [[a, b]] : []; });
      if (first.props.length > 1) assert.ok(shared.length > 0);
      for (const [a, b] of shared) {
        assert.equal(a.kind, b.kind);
        assert.equal(a.seed, b.seed);
        assert.equal(a.size, b.size);
        assert.equal(a.groundOffset, b.groundOffset);
        assert.ok(Math.abs((b.x - a.x) + travel * options.worldScale * a.parallax) < 1e-8);
      }
      for (const prop of first.props.filter(p => !next.props.some(n => p.id === n.id))) {
        const moved = prop.x - travel * options.worldScale * prop.parallax;
        assert.ok(moved + prop.size < 0 || moved - prop.size > options.width, "a visible landmark disappeared at a cell boundary");
      }
      for (const prop of next.props.filter(p => !first.props.some(n => p.id === n.id))) {
        const previous = prop.x + travel * options.worldScale * prop.parallax;
        assert.ok(previous + prop.size < 0 || previous - prop.size > options.width, "a landmark appeared inside the view");
      }
    }
    assert.deepEqual(first.props, deriveQuadrupedEnvironmentLayout({ ...options, skinId, worldX }).props, "paused/return render changes scenery");
  }
});

test("scenery stays sparse across signed world travel, phone widths and ensemble lanes", () => {
  for (const skinId of skins) for (const compact of [false, true]) for (const [width, height] of [[115, 260], [390, 400], [844, 140], [900, 450], [1440, 600]]) {
    const distinct = new Set();
    let total = 0;
    for (let step = -240; step <= 240; step++) {
      const layout = deriveQuadrupedEnvironmentLayout({ ...options, width, height, groundY: height * 0.74, worldX: step * 0.61, skinId, compact });
      const sparse = compact || width < 480 || skinId === "skeleton";
      assert.ok(layout.props.length <= (sparse ? 2 : 3), `${skinId}: too many landmarks in ${width}px`);
      assert.ok(layout.props.filter(p => p.kind === "tombstone").length <= 1, "repeated gravestones in one view");
      assert.ok(layout.props.filter(p => p.kind === "dead-tree").length <= 1, "repeated trees in one view");
      for (const prop of layout.props) distinct.add(prop.kind);
      total += layout.props.length;
    }
    assert.ok(total / 481 >= 1 && total / 481 < 2.6, "sparse world lost its landmarks or became crowded");
    assert.equal(distinct.size, skinId === "skeleton" ? 2 : 4, "travel should reveal a variety of silhouettes");
  }
});

test("props are finite and bounded for compact lanes, huge travel and invalid inputs", () => {
  for (const skinId of skins) for (const [width, height] of [[115, 260], [844, 140], [1440, 600], [8192, 4096]]) {
    for (const worldX of [-1e8, -0.001, 0, 1000, 1e8]) {
      const layout = deriveQuadrupedEnvironmentLayout({ ...options, width, height, groundY: height * 0.74, worldX, worldScale: width * 0.08, skinId, compact: true });
      assert.ok(layout.props.length <= 2);
      assert.ok(layout.props.every(p => [p.x, p.y, p.size, p.rotation, p.alpha].every(Number.isFinite)));
      assert.ok(layout.props.every(p => p.size >= 0 && p.alpha >= 0 && p.alpha <= 1));
      assert.ok(layout.props.every(p => p.y - p.size >= Math.min(58, height * 0.36) - 1e-8));
    }
  }
  const invalid = deriveQuadrupedEnvironmentLayout({ width: Infinity, height: NaN, worldScale: 0, worldX: NaN, skinId: "__proto__", groundAt: () => NaN });
  assert.equal(invalid.skinId, "animal");
  assert.ok(invalid.props.every(p => [p.x, p.y, p.size].every(Number.isFinite)));
});

test("landmarks follow terrain with varied depth while geometric solids stay suspended", () => {
  const groundAt = x => 210 + Math.floor(x / 80) * 7;
  for (const skinId of skins) {
    const offsets = new Set();
    for (const worldX of [-30, 0, 30]) {
      const layout = deriveQuadrupedEnvironmentLayout({ ...options, skinId, worldX, groundAt });
      for (const prop of layout.props) {
        assert.ok(Math.abs(prop.y - groundAt(prop.x) + prop.groundOffset) < 1e-8);
        offsets.add(prop.groundOffset);
        if (skinId === "constellation") assert.ok(prop.groundOffset >= options.height * 0.18, "solid touches the ground");
      }
    }
    assert.ok(offsets.size > 2, "landmarks form repeated horizontal rows");
  }
});

test("skin worlds expose distinct props and deterministic travel does not mutate inputs", () => {
  const input = Object.freeze({ ...options, skinId: "skeleton" });
  const before = JSON.stringify(input);
  const skeleton = deriveQuadrupedEnvironmentLayout(input);
  assert.ok(skeleton.props.every(p => ["dead-tree", "tombstone"].includes(p.kind)));
  const geometry = deriveQuadrupedEnvironmentLayout({ ...options, skinId: "constellation" });
  assert.ok(geometry.props.every(p => ["diamond", "orbit", "floating-cube", "tetrahedron"].includes(p.kind)));
  assert.equal(JSON.stringify(input), before);
});

// Record vector paths to verify the requested full moon and unmarked stone,
// without relying on pixel snapshots or a particular Canvas implementation.
function recordCanvas() {
  const paths = [], stack = [];
  let path = [], origin = [0, 0];
  const context = new Proxy({
    globalAlpha: 1,
    createLinearGradient: () => ({ addColorStop() {} }),
    save: () => stack.push({ origin, fillStyle: context.fillStyle, globalAlpha: context.globalAlpha }),
    restore: () => { const saved = stack.pop(); origin = saved.origin; context.fillStyle = saved.fillStyle; context.globalAlpha = saved.globalAlpha; },
    translate: (x, y) => { origin = [origin[0] + x, origin[1] + y]; },
    beginPath: () => { path = []; },
    fill: () => paths.push({ action: "fill", path: [...path], origin, color: context.fillStyle }),
    stroke: () => paths.push({ action: "stroke", path: [...path], origin }),
  }, { get(target, key) { return key in target ? target[key] : (...args) => path.push([key, ...args]); } });
  return { context, paths };
}

test("skeleton renders a single full moon and a plain gravestone without cross marks", () => {
  const renderOptions = { ...options, worldX: 0, skinId: "skeleton" };
  const layout = deriveQuadrupedEnvironmentLayout(renderOptions);
  const stone = layout.props.find(p => p.kind === "tombstone");
  assert.ok(stone, "opening scene should contain its gravestone");
  const { context, paths } = recordCanvas();
  drawQuadrupedEnvironment(context, renderOptions);
  const circles = paths.filter(p => p.action === "fill" && p.path.some(command => command[0] === "arc"));
  assert.equal(circles.length, 1, "moon should be one full disc with no crescent mask");
  assert.equal(circles[0].color, "#c6d0b7");
  const stonePaths = paths.filter(p => p.action === "stroke" && p.origin[0] === stone.x && p.origin[1] === stone.y);
  assert.ok(stonePaths.length > 0);
  assert.ok(stonePaths.every(p => p.path.some(command => ["closePath", "ellipse"].includes(command[0]))), "plain gravestone contains an open cross or inscription stroke");
});
