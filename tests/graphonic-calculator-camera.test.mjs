import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_X_RANGE, createCamera, formatCoordinate, formatTick, homeView, minorTicks, niceStep, niceTicks, panView, squareView, zoomAxes, zoomView,
} from "../src/instruments/graphonic-calculator/camera.js";

const VIEW_KEYS = ["xMin", "xMax", "yMin", "yMax"];
const SIZES = [[1440, 900], [390, 844]];

const closeRelative = (actual, expected, tolerance = 1e-9, label = "") => {
  const scale = Math.max(1, Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale, `${label}${actual} != ${expected}`);
};
const viewClose = (actual, expected, tolerance = 1e-9) => {
  for (const key of VIEW_KEYS) closeRelative(actual[key], expected[key], tolerance, `${key}: `);
};
const spanX = (view) => view.xMax - view.xMin;
const spanY = (view) => view.yMax - view.yMin;
const EMPTY_TICKS = { step: 1, minorStep: 0.2, decimals: 0, ticks: [] };

test("HOME_X_RANGE is a frozen -10..10 range", () => {
  assert.deepEqual(HOME_X_RANGE, { xMin: -10, xMax: 10 });
  assert.ok(Object.isFrozen(HOME_X_RANGE));
});

test("homeView spans -10..10 with square units centered on y = 0", () => {
  for (const [width, height] of SIZES) {
    const view = homeView(width, height);
    assert.equal(view.xMin, -10);
    assert.equal(view.xMax, 10);
    assert.equal(view.yMin, -view.yMax);
    const camera = createCamera(view, width, height);
    assert.ok(Math.abs(camera.scaleX - camera.scaleY) < 1e-12, `${width}x${height}: ${camera.scaleX} vs ${camera.scaleY}`);
    closeRelative(spanY(view), (20 * height) / width);
  }
  assert.deepEqual(homeView(1440, 900), { xMin: -10, xMax: 10, yMin: -6.25, yMax: 6.25 });
  for (const [width, height] of [[0, 900], [-5, 900], [NaN, 900], ["1440", 900]]) {
    assert.deepEqual(homeView(width, height), { xMin: -10, xMax: 10, yMin: -9000, yMax: 9000 });
  }
  const flat = homeView(1440, Infinity);
  assert.equal(flat.yMin, -flat.yMax);
  closeRelative(flat.yMax, 10 / 1440, 1e-12);
  assert.deepEqual(homeView(undefined, null), { xMin: -10, xMax: 10, yMin: -10, yMax: 10 });
  assert.deepEqual(homeView(), { xMin: -10, xMax: 10, yMin: -10, yMax: 10 });
});

test("squareView keeps the x-range and y-center and recomputes the y-span", () => {
  const view = { xMin: -5, xMax: 15, yMin: 0, yMax: 100 };
  const squared = squareView(view, 800, 400);
  assert.deepEqual(squared, { xMin: -5, xMax: 15, yMin: 45, yMax: 55 });
  assert.deepEqual(view, { xMin: -5, xMax: 15, yMin: 0, yMax: 100 });
  assert.notEqual(squared, view);
  const camera = createCamera(squared, 800, 400);
  assert.ok(Math.abs(camera.scaleX - camera.scaleY) < 1e-12);
  const tall = squareView(view, 390, 844);
  closeRelative(spanY(tall), (20 * 844) / 390);
  closeRelative((tall.yMin + tall.yMax) / 2, 50);
  assert.deepEqual(squareView(homeView(1440, 900), 1440, 900), homeView(1440, 900));
  assert.deepEqual(squareView({ xMin: 0, xMax: 0, yMin: 0, yMax: 1 }, 1440, 900), homeView(1440, 900));
  assert.deepEqual(squareView({ xMin: NaN, xMax: 1, yMin: 0, yMax: 1 }, 1440, 900), homeView(1440, 900));
  assert.deepEqual(squareView(null, 1440, 900), homeView(1440, 900));
  assert.deepEqual(squareView(undefined, 0, 0), homeView(1, 1));
});

test("createCamera maps corners exactly and round-trips interior points", () => {
  for (const [width, height] of SIZES) {
    const view = { xMin: -3, xMax: 7, yMin: -2.5, yMax: 4 };
    const camera = createCamera(view, width, height);
    assert.equal(camera.width, width);
    assert.equal(camera.height, height);
    assert.deepEqual(camera.view, view);
    assert.notEqual(camera.view, view);
    closeRelative(camera.scaleX, width / 10, 1e-12);
    closeRelative(camera.scaleY, height / 6.5, 1e-12);
    assert.deepEqual(camera.toPixel(view.xMin, view.yMax), [0, 0]);
    assert.deepEqual(camera.toPixel(view.xMax, view.yMin), [width, height]);
    assert.deepEqual(camera.toWorld(0, 0), [view.xMin, view.yMax]);
    assert.deepEqual(camera.toWorld(width, height), [view.xMax, view.yMin]);
    const [px, py] = camera.toPixel(1, 2);
    closeRelative(px, ((1 - view.xMin) * width) / 10, 1e-12);
    closeRelative(py, ((view.yMax - 2) * height) / 6.5, 1e-12);
    for (const [x, y] of [[-3, -2.5], [7, 4], [0, 0], [0.1, -0.3], [6.999, 3.999], [-2.123456789, 1.987654321]]) {
      const [rx, ry] = camera.toWorld(...camera.toPixel(x, y));
      closeRelative(rx, x, 1e-9, "x: ");
      closeRelative(ry, y, 1e-9, "y: ");
    }
    for (const [sx, sy] of [[0, 0], [width, height], [width / 3, height / 7], [1, height - 1]]) {
      const [rx, ry] = camera.toPixel(...camera.toWorld(sx, sy));
      closeRelative(rx, sx, 1e-9, "px: ");
      closeRelative(ry, sy, 1e-9, "py: ");
    }
  }
  const fallback = createCamera({ xMin: 0, xMax: 0, yMin: 0, yMax: 1 }, 1440, 900);
  assert.deepEqual(fallback.view, homeView(1440, 900));
  assert.deepEqual(createCamera(null, 1440, 900).view, homeView(1440, 900));
  assert.deepEqual(createCamera({ xMin: 0, xMax: 1e-330, yMin: 0, yMax: 1 }, 1440, 900).view, homeView(1440, 900));
  const unit = createCamera(homeView(1440, 900), 0, NaN);
  assert.equal(unit.width, 1);
  assert.equal(unit.height, 1);
  assert.deepEqual(unit.toPixel(10, -6.25), [1, 1]);
  assert.equal(createCamera(homeView(1440, 900), 1440, 900).toPixel(NaN, Infinity).length, 2);
  assert.equal(createCamera(homeView(1440, 900), 1440, 900).toWorld(undefined, "7").length, 2);
});

test("panView moves the content with the pointer", () => {
  const home = homeView(1440, 900);
  const right = panView(home, 10, 0, 1440, 900);
  viewClose(right, { xMin: -10 - 10 / 72, xMax: 10 - 10 / 72, yMin: -6.25, yMax: 6.25 });
  const down = panView(home, 0, 10, 1440, 900);
  viewClose(down, { xMin: -10, xMax: 10, yMin: -6.25 + 10 / 72, yMax: 6.25 + 10 / 72 });
  const diagonal = panView(home, -36, 18, 1440, 900);
  viewClose(diagonal, { xMin: -9.5, xMax: 10.5, yMin: -6, yMax: 6.5 });
  assert.deepEqual(home, { xMin: -10, xMax: 10, yMin: -6.25, yMax: 6.25 });
  const before = createCamera(home, 1440, 900);
  const after = createCamera(diagonal, 1440, 900);
  for (const [px, py] of [[0, 0], [700, 300], [1440, 900]]) {
    const [x, y] = before.toWorld(px, py);
    const [nx, ny] = after.toWorld(px - 36, py + 18);
    closeRelative(nx, x);
    closeRelative(ny, y);
  }
  const unchanged = panView(home, NaN, Infinity, 1440, 900);
  assert.deepEqual(unchanged, home);
  assert.notEqual(unchanged, home);
  assert.deepEqual(panView(null, 10, 10, 1440, 900), panView(home, 10, 10, 1440, 900));
  const far = { xMin: 1.7e308, xMax: 1.7e308 + 1e300, yMin: 0, yMax: 1 };
  assert.equal(panView(far, -1e12, 0, 1440, 900), far);
});

test("zoomView keeps the world point under the anchor fixed and scales the spans", () => {
  const home = homeView(1440, 900);
  const before = createCamera(home, 1440, 900);
  for (const [px, py] of [[0, 0], [720, 450], [1440, 900], [100, 800], [1337.5, 12.25]]) {
    for (const factor of [2, 0.5, 1.1, 3.7, 0.123, 1]) {
      const zoomed = zoomView(home, factor, px, py, 1440, 900);
      assert.notEqual(zoomed, home);
      closeRelative(spanX(zoomed), 20 / factor);
      closeRelative(spanY(zoomed), 12.5 / factor);
      const [x, y] = before.toWorld(px, py);
      const [zx, zy] = createCamera(zoomed, 1440, 900).toWorld(px, py);
      closeRelative(zx, x, 1e-9, `anchor x @${px},${py} x${factor}: `);
      closeRelative(zy, y, 1e-9, `anchor y @${px},${py} x${factor}: `);
    }
  }
  assert.deepEqual(home, { xMin: -10, xMax: 10, yMin: -6.25, yMax: 6.25 });
  const centered = zoomView(home, 2, 720, 450, 1440, 900);
  viewClose(centered, { xMin: -5, xMax: 5, yMin: -3.125, yMax: 3.125 });
  const corner = zoomView(home, 2, 0, 0, 1440, 900);
  viewClose(corner, { xMin: -10, xMax: 0, yMin: 0, yMax: 6.25 });
});

test("zooming in then out at the same anchor restores the view", () => {
  const home = homeView(1440, 900);
  for (const [px, py] of [[0, 0], [720, 450], [1440, 900], [100, 800]]) {
    const restored = zoomView(zoomView(home, 2, px, py, 1440, 900), 0.5, px, py, 1440, 900);
    viewClose(restored, home);
    const stretched = zoomAxes(zoomAxes(home, 3, 0.25, px, py, 1440, 900), 1 / 3, 4, px, py, 1440, 900);
    viewClose(stretched, home);
  }
});

test("zoom returns the input view unchanged when the span clamp or factor is violated", () => {
  const tiny = { xMin: 0, xMax: 1e-9, yMin: 0, yMax: 1e-9 };
  assert.equal(zoomView(tiny, 2, 0, 0, 100, 100), tiny);
  assert.equal(zoomView(tiny, 1.0001, 50, 50, 100, 100), tiny);
  assert.notEqual(zoomView(tiny, 0.5, 50, 50, 100, 100), tiny);
  const huge = { xMin: -5e14, xMax: 5e14, yMin: -5e14, yMax: 5e14 };
  assert.equal(zoomView(huge, 0.5, 50, 50, 100, 100), huge);
  assert.notEqual(zoomView(huge, 2, 50, 50, 100, 100), huge);
  const home = homeView(1440, 900);
  for (const factor of [0, -1, NaN, Infinity, -Infinity, undefined, "2"]) {
    assert.equal(zoomView(home, factor, 720, 450, 1440, 900), home);
  }
  assert.equal(zoomAxes(home, 2, 0, 720, 450, 1440, 900), home);
  assert.equal(zoomAxes(home, NaN, 2, 720, 450, 1440, 900), home);
  assert.equal(zoomAxes(tiny, 0.5, 2, 50, 50, 100, 100), tiny);
  assert.equal(zoomAxes(huge, 2, 0.5, 50, 50, 100, 100), huge);
  assert.deepEqual(zoomView(null, 2, 720, 450, 1440, 900), zoomView(home, 2, 720, 450, 1440, 900));
  assert.deepEqual(zoomView({ xMin: 1, xMax: 0, yMin: 0, yMax: 1 }, 0, 0, 0, 1440, 900), home);
  assert.equal(zoomView(home, 2, 1e308, 0, 1440, 900), home);
});

test("zoomAxes stretches each axis independently and centers non-finite anchors", () => {
  const home = homeView(1440, 900);
  const stretched = zoomAxes(home, 2, 1, 100, 800, 1440, 900);
  closeRelative(spanX(stretched), 10);
  closeRelative(spanY(stretched), 12.5);
  const [x, y] = createCamera(home, 1440, 900).toWorld(100, 800);
  const [sx, sy] = createCamera(stretched, 1440, 900).toWorld(100, 800);
  closeRelative(sx, x);
  closeRelative(sy, y);
  const squeezed = zoomAxes(home, 1, 0.5, 0, 0, 1440, 900);
  viewClose(squeezed, { xMin: -10, xMax: 10, yMin: -18.75, yMax: 6.25 });
  viewClose(zoomAxes(home, 2, 2, NaN, undefined, 1440, 900), zoomView(home, 2, 720, 450, 1440, 900));
  assert.deepEqual(home, { xMin: -10, xMax: 10, yMin: -6.25, yMax: 6.25 });
});

test("view functions never mutate their inputs", () => {
  const frozen = Object.freeze({ xMin: -4, xMax: 4, yMin: -2, yMax: 2 });
  squareView(frozen, 1440, 900);
  createCamera(frozen, 1440, 900).toPixel(1, 1);
  panView(frozen, 5, -5, 1440, 900);
  zoomView(frozen, 2, 10, 10, 1440, 900);
  zoomAxes(frozen, 2, 3, 10, 10, 1440, 900);
  zoomView(frozen, 0, 10, 10, 1440, 900);
  assert.deepEqual(frozen, { xMin: -4, xMax: 4, yMin: -2, yMax: 2 });
});

test("niceStep picks the finest 1-2-5 step that fits the tick budget", () => {
  assert.equal(niceStep(20, 10), 2);
  assert.equal(niceStep(20, 5), 5);
  assert.equal(niceStep(0.001, 10), 0.0001);
  assert.equal(niceStep(7e6, 10), 1e6);
  assert.equal(niceStep(20), 2);
  assert.equal(niceStep(1, 10), 0.1);
  assert.equal(niceStep(0.7, 10), 0.1);
  assert.equal(niceStep(2e6, 10), 2e5);
  assert.equal(niceStep(30, 10), 5);
  assert.equal(niceStep(100, 10), 10);
  assert.equal(niceStep(-20, 10), 2);
  assert.equal(niceStep(20, 1), 20);
  assert.equal(niceStep(20, 0), 20);
  assert.equal(niceStep(20, -3), 20);
  assert.equal(niceStep(20, NaN), 2);
  assert.equal(niceStep(20, Infinity), 0.02);
  for (const span of [NaN, Infinity, -Infinity, 0, -0, undefined, null, "20"]) assert.equal(niceStep(span, 10), 1);
});

test("niceTicks produces exact tick arrays without floating noise", () => {
  const cases = [
    [[-10, 10], { step: 2, minorStep: 0.5, decimals: 0, ticks: [-10, -8, -6, -4, -2, 0, 2, 4, 6, 8, 10] }],
    [[0, 0.001], { step: 0.0001, minorStep: 0.00002, decimals: 4, ticks: [0, 0.0001, 0.0002, 0.0003, 0.0004, 0.0005, 0.0006, 0.0007, 0.0008, 0.0009, 0.001] }],
    [[-0.35, 0.35], { step: 0.1, minorStep: 0.02, decimals: 1, ticks: [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3] }],
    [[1e6, 3e6], { step: 200000, minorStep: 50000, decimals: 0, ticks: [1000000, 1200000, 1400000, 1600000, 1800000, 2000000, 2200000, 2400000, 2600000, 2800000, 3000000] }],
    [[-10, 10, 5], { step: 5, minorStep: 1, decimals: 0, ticks: [-10, -5, 0, 5, 10] }],
    [[0.3, 0.9, 10], { step: 0.1, minorStep: 0.02, decimals: 1, ticks: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] }],
    [[-6.25, 6.25], { step: 2, minorStep: 0.5, decimals: 0, ticks: [-6, -4, -2, 0, 2, 4, 6] }],
  ];
  for (const [args, expected] of cases) {
    const result = niceTicks(...args);
    assert.deepEqual(result, expected, `niceTicks(${args.join(", ")})`);
    for (const tick of result.ticks) {
      assert.equal(tick, Number(tick.toFixed(result.decimals)));
      assert.ok(!Object.is(tick, -0), "tick must not be -0");
      assert.ok(tick >= args[0] - 1e-12 && tick <= args[1] + 1e-12);
    }
    assert.ok(result.ticks.length <= (args[2] ?? 10) + 1);
  }
  assert.equal(niceTicks(-10, 10, 1000).ticks.length <= 1001, true);
  assert.equal(niceTicks(-10, 10, Infinity).ticks.length, niceTicks(-10, 10, 1000).ticks.length);
});

test("niceTicks returns the empty fallback for degenerate and non-finite ranges", () => {
  for (const args of [[5, 5], [1, 0], [NaN, 1], [0, NaN], [-Infinity, Infinity], [0, Infinity], [-1e308, 1e308], [0, 1e-320], [undefined, undefined], [null, 1]]) {
    assert.deepEqual(niceTicks(...args), EMPTY_TICKS, `niceTicks(${args.join(", ")})`);
  }
});

test("minorTicks excludes major ticks and keeps the rounding discipline", () => {
  assert.deepEqual(minorTicks(-10, 10, 2, 0.5), [
    -9.5, -9, -8.5, -7.5, -7, -6.5, -5.5, -5, -4.5, -3.5, -3, -2.5, -1.5, -1, -0.5,
    0.5, 1, 1.5, 2.5, 3, 3.5, 4.5, 5, 5.5, 6.5, 7, 7.5, 8.5, 9, 9.5,
  ]);
  assert.deepEqual(minorTicks(-0.35, 0.35, 0.1, 0.02), [
    -0.34, -0.32, -0.28, -0.26, -0.24, -0.22, -0.18, -0.16, -0.14, -0.12, -0.08, -0.06, -0.04, -0.02,
    0.02, 0.04, 0.06, 0.08, 0.12, 0.14, 0.16, 0.18, 0.22, 0.24, 0.26, 0.28, 0.32, 0.34,
  ]);
  const large = minorTicks(1e6, 3e6, 2e5, 5e4);
  assert.equal(large.length, 30);
  for (const tick of large) {
    assert.notEqual(tick % 2e5, 0);
    assert.equal(tick % 5e4, 0);
  }
  for (const [min, max] of [[-10, 10], [0, 0.001], [-0.35, 0.35], [1e6, 3e6]]) {
    const { step, minorStep, ticks } = niceTicks(min, max);
    const minors = minorTicks(min, max, step, minorStep);
    const majors = new Set(ticks);
    for (const tick of minors) {
      assert.ok(!majors.has(tick), `${tick} is a major tick`);
      assert.ok(!Object.is(tick, -0));
      assert.ok(tick >= min - 1e-12 && tick <= max + 1e-12);
    }
    assert.equal(new Set(minors).size, minors.length);
    const positions = Math.floor(max / minorStep + 1e-9) - Math.ceil(min / minorStep - 1e-9) + 1;
    assert.equal(minors.length, positions - ticks.length);
  }
  for (const args of [[0, 1, 0, 0.2], [0, 1, 1, NaN], [0, 1, 1, 0], [0, 1, 1, -0.2], [1, 0, 1, 0.2], [NaN, 1, 1, 0.2], [0, Infinity, 1, 0.2], [0, 1e9, 1, 0.2], [0, 1, 1e-150, 1e-151]]) {
    assert.deepEqual(minorTicks(...args), [], `minorTicks(${args.join(", ")})`);
  }
});

test("formatTick prints integers plainly, trims decimals and compacts exponents", () => {
  assert.equal(formatTick(4, 0), "4");
  assert.equal(formatTick(-10, 0), "-10");
  assert.equal(formatTick(4, 3), "4");
  assert.equal(formatTick(0.5, 1), "0.5");
  assert.equal(formatTick(-2.25, 2), "-2.25");
  assert.equal(formatTick(0.30000000000000004, 1), "0.3");
  assert.equal(formatTick(2.5, 4), "2.5");
  assert.equal(formatTick(0.0001, 4), "0.0001");
  assert.equal(formatTick(999999, 0), "999999");
  assert.equal(formatTick(1e6, 0), "1e6");
  assert.equal(formatTick(1500000, 0), "1.5e6");
  assert.equal(formatTick(-2000000, 0), "-2e6");
  assert.equal(formatTick(1e21, 0), "1e21");
  assert.equal(formatTick(2.5e-5, 6), "2.5e-5");
  assert.equal(formatTick(-2.5e-5, 6), "-2.5e-5");
  assert.equal(formatTick(7 * 1e-5, 5), "7e-5");
  assert.equal(formatTick(0.00009, 5), "9e-5");
  assert.equal(formatTick(0, 0), "0");
  assert.equal(formatTick(0, 3), "0");
  assert.equal(formatTick(-0, 0), "0");
  assert.equal(formatTick(-0.004, 2), "0");
  assert.equal(formatTick(0.5), "0.5");
  assert.equal(formatTick(1.5, NaN), "1.5");
  assert.equal(formatTick(1.5, -2), "2");
  assert.equal(formatTick(1.5, 1e9), "1.5");
  assert.equal(formatTick(NaN, 0), "");
  assert.equal(formatTick(Infinity, 0), "");
  assert.equal(formatTick(-Infinity, 0), "");
  assert.equal(formatTick(undefined, 0), "");
  assert.equal(formatTick("4", 0), "");
  for (const [min, max] of [[-10, 10], [0, 0.001], [-0.35, 0.35], [1e6, 3e6]]) {
    const { decimals, ticks } = niceTicks(min, max);
    for (const tick of ticks) assert.doesNotMatch(formatTick(tick, decimals), /000000|e\+|^-0$/);
  }
});

test("formatCoordinate shows up to four significant digits and never -0", () => {
  assert.equal(formatCoordinate(Math.PI), "3.142");
  assert.equal(formatCoordinate(-2.25), "-2.25");
  assert.equal(formatCoordinate(10), "10");
  assert.equal(formatCoordinate(0.5), "0.5");
  assert.equal(formatCoordinate(123456), "123500");
  assert.equal(formatCoordinate(999999.6), "1e6");
  assert.equal(formatCoordinate(1234567), "1.235e6");
  assert.equal(formatCoordinate(-1e6), "-1e6");
  assert.equal(formatCoordinate(0.0001), "0.0001");
  assert.equal(formatCoordinate(0.000099996), "0.0001");
  assert.equal(formatCoordinate(0.000025), "2.5e-5");
  assert.equal(formatCoordinate(1e-5), "1e-5");
  assert.equal(formatCoordinate(-1e-30), "-1e-30");
  assert.equal(formatCoordinate(0.30000000000000004), "0.3");
  assert.equal(formatCoordinate(0), "0");
  assert.equal(formatCoordinate(-0), "0");
  assert.equal(formatCoordinate(-1e-400), "0");
  assert.equal(formatCoordinate(NaN), "undefined");
  assert.equal(formatCoordinate(undefined), "undefined");
  assert.equal(formatCoordinate("1"), "undefined");
  assert.equal(formatCoordinate(Infinity), "∞");
  assert.equal(formatCoordinate(-Infinity), "-∞");
});

test("tick generation terminates and stays exact far from the origin", () => {
  for (const [min, max] of [[1e15, 1e15 + 1], [1e17, 1e17 + 96], [9e14, 9e14 + 1]]) {
    const result = niceTicks(min, max, 16);
    assert.deepEqual(result.ticks, [], `${min}..${max} is below floating-point tick resolution`);
    assert.deepEqual(minorTicks(min, max, 0.5, 0.1), []);
  }
  for (const [min, max] of [[1e4, 1e4 + 0.007], [127688.3577, 127688.3586], [1e9 + 0.3, 1e9 + 0.9], [-5e8 - 0.25, -5e8 + 0.25]]) {
    const { step, minorStep, decimals, ticks } = niceTicks(min, max, 16);
    assert.ok(ticks.length > 0, `${min}..${max} produces ticks`);
    assert.equal(new Set(ticks).size, ticks.length);
    for (const tick of ticks) { assert.ok(tick >= min - step * 1e-9 && tick <= max + step * 1e-9); assert.equal(tick, Number(tick.toFixed(decimals))); }
    const minors = minorTicks(min, max, step, minorStep);
    assert.deepEqual(minors.filter((value) => ticks.includes(value)), [], `${min}..${max} leaks no major tick into the minors`);
    const positions = [...minors, ...ticks].sort((a, b) => a - b);
    assert.ok(positions[0] < min + minorStep && positions.at(-1) > max - minorStep, `${min}..${max} keeps both end positions`);
    const slack = Math.max(minorStep * 1e-6, Math.abs(max) * Number.EPSILON * 8);
    for (let i = 1; i < positions.length; i++) assert.ok(Math.abs(positions[i] - positions[i - 1] - minorStep) < slack, `${min}..${max} has no gaps`);
  }
});

test("minorTicks honours quarter and eighth style steps and extreme inputs stay finite", () => {
  assert.deepEqual(minorTicks(0, 1, 1, 0.25), [0.25, 0.5, 0.75]);
  assert.deepEqual(minorTicks(0, 10, 5, 2.5), [2.5, 7.5]);
  assert.deepEqual(minorTicks(0, 2, 1, 0.125), [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.125, 1.25, 1.375, 1.5, 1.625, 1.75, 1.875]);
  assert.ok(Number.isFinite(niceStep(1.2e308, 1)));
  assert.ok(Number.isFinite(niceStep(1.7e308, 1)));
  for (const [width, height] of [[1, 1e308], [1e308, 1]]) {
    const view = homeView(width, height);
    for (const value of Object.values(view)) assert.ok(Number.isFinite(value), `homeView(${width}, ${height}) stays finite`);
    assert.ok(view.yMax > view.yMin);
  }
  for (const value of [1.7976e308, -1.7976e308, Number.MAX_VALUE, -Number.MAX_VALUE]) {
    const text = formatCoordinate(value);
    assert.match(text, /^-?1\.798e308$/, `formatCoordinate(${value}) = ${text}`);
  }
});
