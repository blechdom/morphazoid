import assert from "node:assert/strict";
import { createContext, runInContext } from "node:vm";

import { clamp } from "../../src/throatazoid.js";
import { tractPoint } from "../../src/families/tract/geometry.js";
import { drawPhysicalTract } from "../../src/families/tract/rendering.js";

const methods = [
  "save", "restore", "beginPath", "closePath", "moveTo", "lineTo",
  "quadraticCurveTo", "ellipse", "fill", "stroke", "translate", "rotate",
  "scale", "fillText", "rect", "roundRect", "arc",
];

/** Record every Canvas command/property write, including optional fallbacks. */
export function recordTractDrawing(missing = [], beforeCommand = () => {}) {
  const commands = [];
  const context = Object.fromEntries(methods
    .filter((name) => !missing.includes(name))
    .map((name) => [name, (...args) => {
      beforeCommand();
      commands.push(["call", name, ...args]);
    }]));
  if (!missing.includes("createLinearGradient")) {
    context.createLinearGradient = (...args) => {
      const gradient = { gradient: commands.length };
      commands.push(["call", "createLinearGradient", ...args]);
      return {
        ...gradient,
        addColorStop: (...values) => { commands.push(["colorStop", gradient.gradient, ...values]); },
      };
    };
  }
  const drawing = new Proxy(context, {
    set(target, name, value) {
      commands.push(["set", name, value?.addColorStop ? { gradient: value.gradient } : value]);
      target[name] = value;
      return true;
    },
  });
  return { commands, drawing };
}

/**
 * Runs either the frozen page functions or a current page wrapper. Model,
 * animation and hit-test state stay explicit, just as they do in the page.
 */
export function createTractRenderingHarness(fixture, source = fixture.block) {
  let geometry;
  let animatedProfile;
  let preparation;
  let commands;
  const context = createContext({
    clamp, tractPoint,
    drawTractGeometry: drawPhysicalTract,
    tractGeometry(performance, profile) {
      preparation.push(["geometry", performance, profile]);
      assert.equal(profile, animatedProfile, "draw uses the supplied animated profile");
      return geometry;
    },
    animatedTractDiameterProfile(performance, time) {
      preparation.push(["profile", performance, time]);
      return animatedProfile;
    },
  });
  runInContext(`${fixture.colorWithAlpha}\n${source}`, context);
  const render = runInContext("drawPhysicalTract", context);
  const convertColor = runInContext("colorWithAlpha", context);
  return {
    render(scene, { explicitPerformance = false, missing = [] } = {}) {
      geometry = scene.geometry;
      animatedProfile = scene.profile ?? geometry.diameters;
      preparation = [];
      let firstCommand = true;
      const trace = recordTractDrawing(missing, () => {
        if (!firstCommand) return;
        firstCommand = false;
        assert.equal(context.currentTract, geometry, "tract alias is updated before drawing");
        assert.equal(context.currentTongues, geometry.tongueHandles, "tongue aliases precede drawing");
        assert.equal(context.currentNoses, geometry.noseHandles, "nose aliases precede drawing");
        assert.equal(context.currentBodyHandles, geometry.bodyHandles, "body aliases precede drawing");
      });
      commands = trace.commands;
      Object.assign(context, scene.view, {
        state: scene.state,
        drawing: trace.drawing,
        currentTract: null, currentTongues: null, currentNoses: null, currentBodyHandles: null,
        isAwake() {
          commands.push(["isAwake"]);
          return scene.awake;
        },
        colorWithAlpha(color, alpha) {
          commands.push(["colorWithAlpha", color, alpha]);
          return convertColor(color, alpha);
        },
      });
      const performance = explicitPerformance ? scene.performance : scene.state;
      render(scene.time, scene.liveAlpha, ...(explicitPerformance ? [performance] : []));
      assert.equal(context.currentTract, geometry, "hit-test geometry identity");
      assert.equal(context.currentTongues, geometry.tongueHandles, "tongue handle identity");
      assert.equal(context.currentNoses, geometry.noseHandles, "nose handle identity");
      assert.equal(context.currentBodyHandles, geometry.bodyHandles, "body handle identity");
      assert.equal(preparation.length, 2, "profile and geometry are prepared exactly once");
      assert.equal(preparation[0][0], "profile", "profile precedes geometry");
      assert.equal(preparation[1][0], "geometry");
      assert.equal(preparation[0][1], performance, "current or explicitly supplied performance");
      assert.equal(preparation[1][1], performance);
      assert.equal(preparation[0][2], scene.time, "unchanged animation time");
      return commands;
    },
  };
}
