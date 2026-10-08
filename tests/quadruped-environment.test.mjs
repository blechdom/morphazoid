import test from "node:test";
import assert from "node:assert/strict";
import { deriveQuadrupedEnvironmentLayout } from "../src/instruments/quadruped/quadruped-environment.js";

const skins = ["animal", "skeleton", "constellation", "collage", "motion-card"];
const options = { width: 900, height: 450, groundY: 333, worldScale: 89, worldX: 14.9 };

test("world props retain identity and move opposite continuous motor travel with parallax", () => {
  for (const skinId of skins) {
    const first = deriveQuadrupedEnvironmentLayout({ ...options, skinId });
    const next = deriveQuadrupedEnvironmentLayout({ ...options, skinId, worldX: options.worldX + 0.02 });
    const shared = first.props.flatMap(a => { const b = next.props.find(p => p.id === a.id); return b ? [[a, b]] : []; });
    assert.ok(shared.length >= 8);
    for (const [a, b] of shared) {
      assert.equal(a.kind, b.kind);
      assert.equal(a.seed, b.seed);
      assert.ok(Math.abs((b.x - a.x) + 0.02 * options.worldScale * a.parallax) < 1e-8);
    }
    assert.deepEqual(first.props, deriveQuadrupedEnvironmentLayout({ ...options, skinId }).props, "paused render changes scenery");
  }
});

test("props are finite and bounded for compact lanes, landscape, huge travel and invalid inputs", () => {
  for (const skinId of skins) for (const [width, height] of [[115, 260], [844, 140], [1440, 600], [8192, 4096]]) {
    for (const worldX of [-1e8, -0.001, 0, 1000, 1e8]) {
      const layout = deriveQuadrupedEnvironmentLayout({ ...options, width, height, groundY: height * 0.74, worldX, worldScale: width * 0.08, skinId, compact: true });
      assert.ok(layout.props.length <= 26);
      assert.ok(layout.props.every(p => [p.x, p.y, p.size, p.rotation, p.alpha].every(Number.isFinite)));
      assert.ok(layout.props.every(p => p.size >= 0 && p.alpha >= 0 && p.alpha <= 1));
      assert.ok(layout.props.every(p => p.y - p.size * (skinId === "constellation" ? 1.3 : 1) >= Math.min(58, height * 0.36) - 1e-8));
    }
  }
  const invalid = deriveQuadrupedEnvironmentLayout({ width: Infinity, height: NaN, worldScale: 0, worldX: NaN, skinId: "__proto__", groundAt: () => NaN });
  assert.equal(invalid.skinId, "animal");
  assert.ok(invalid.props.every(p => [p.x, p.y, p.size].every(Number.isFinite)));
});

test("every scenery anchor follows the supplied ground profile, including discrete stairs", () => {
  const groundAt = x => 210 + Math.floor(x / 80) * 7;
  for (const skinId of skins) {
    const layout = deriveQuadrupedEnvironmentLayout({ ...options, skinId, groundAt });
    for (const prop of layout.props) assert.ok(Math.abs(prop.y - groundAt(prop.x) + options.height * (prop.layer === 0 ? 0.075 : 0.009)) < 1e-8);
  }
});

test("skin worlds expose distinct props and deterministic travel does not mutate inputs", () => {
  const input = Object.freeze({ ...options, skinId: "skeleton" });
  const before = JSON.stringify(input);
  const skeleton = deriveQuadrupedEnvironmentLayout(input);
  assert.ok(skeleton.props.every(p => ["dead-tree", "tombstone", "ribs", "bone", "grave"].includes(p.kind)));
  const geometry = deriveQuadrupedEnvironmentLayout({ ...options, skinId: "constellation" });
  assert.ok(geometry.props.every(p => ["laser", "prism", "pylon"].includes(p.kind)));
  assert.equal(JSON.stringify(input), before);
});
