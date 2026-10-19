import test from "node:test";
import assert from "node:assert/strict";
import { getLoomLayout, hitTestLoom, drawTimeLoom } from "../src/instruments/time-loom/time-loom-renderer.js";

const phrase = { start: .12, end: .62, stretch: 1, reverse: false, next: null };

test("all knots and stretch handles stay reachable in desktop and phone stages", () => {
  for (const [width, height] of [[850, 600], [380, 440], [520, 260]]) {
    const layout = getLoomLayout(width, height, [.5, 1, 4].map(stretch => ({ ...phrase, stretch })));
    for (const item of layout) {
      assert.ok(item.top > item.railY);
      assert.ok(item.label.y < height);
      for (const [part, point] of [["start", item.knotStart], ["end", item.knotEnd], ["stretch", item.tassel]]) {
        assert.ok(point.x >= 24 && point.x <= width - 24);
        assert.ok(point.y >= 24 && point.y <= height - 24);
        assert.deepEqual(hitTestLoom(layout, point.x, point.y), { cord: item.cord, part });
      }
    }
  }
});

test("short passages have separately graspable knots without changing source times", () => {
  const [item] = getLoomLayout(380, 240, [{ ...phrase, start: .5, end: .525, stretch: .5 }]);
  assert.ok(Math.hypot(item.knotEnd.x - item.knotStart.x, item.knotEnd.y - item.knotStart.y) >= 39.9);
  assert.equal(item.knotStart.y, item.top + item.length * .5);
  assert.equal(item.knotEnd.y, item.top + item.length * .525);
  assert.deepEqual(hitTestLoom([item], item.knotStart.x - 8, item.knotStart.y), { cord: 0, part: "start" });
  assert.deepEqual(hitTestLoom([item], item.knotEnd.x + 8, item.knotEnd.y), { cord: 0, part: "end" });
});

test("pulling a tassel lengthens the visible passage while its suspension stays fixed", () => {
  const versions = [.5, 1, 2, 4].map(stretch => getLoomLayout(850, 600, [{ ...phrase, stretch }])[0]);
  assert.equal(new Set(versions.map(item => item.top)).size, 1);
  for (let i = 1; i < versions.length; i++) {
    assert.ok(versions[i].bottom > versions[i - 1].bottom);
    assert.ok(versions[i].tassel.y > versions[i - 1].tassel.y);
    assert.ok(versions[i].knotEnd.y > versions[i - 1].knotEnd.y);
  }
});

test("ties run from the sounding exit to the destination entry in either direction", () => {
  const layout = getLoomLayout(850, 600, [
    { ...phrase, next: 1, reverse: true },
    { ...phrase, start: .3, end: .9, reverse: true },
    { ...phrase, next: 0 },
  ]);
  assert.deepEqual(layout[0].link.from, layout[0].knotStart);
  assert.deepEqual(layout[0].link.to, layout[1].knotEnd);
  assert.deepEqual(layout[2].link.from, layout[2].knotEnd);
  assert.deepEqual(layout[2].link.to, layout[0].knotEnd);
  assert.equal(layout[1].link, null);
  const curve = layout[0].link;
  const x = (curve.from.x + 3 * curve.control1.x + 3 * curve.control2.x + curve.to.x) / 8;
  const y = (curve.from.y + 3 * curve.control1.y + 3 * curve.control2.y + curve.to.y) / 8;
  assert.deepEqual(hitTestLoom(layout, x, y), { cord: 0, part: "link" });
});

test("empty and invalid pointer states are safe", () => {
  assert.deepEqual(getLoomLayout(380, 440), []);
  assert.equal(hitTestLoom([], 20, 20), null);
  assert.equal(hitTestLoom(getLoomLayout(380, 440, [phrase]), NaN, 20), null);
  assert.deepEqual(drawTimeLoom(null, 380, 440, {}), []);
});
