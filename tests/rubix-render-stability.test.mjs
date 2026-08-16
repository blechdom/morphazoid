import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function functionSource(source, name) {
  const signature = new RegExp(`function\\s+${name}\\s*\\(`);
  const match = signature.exec(source);
  assert.ok(match, `${name} should exist`);

  const openingBrace = source.indexOf("{", match.index + match[0].length);
  assert.notEqual(openingBrace, -1, `${name} should have a body`);

  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(match.index, index + 1);
  }

  assert.fail(`${name} should have a complete body`);
}

function declaredFunctionContaining(source, pattern) {
  const marker = pattern.exec(source);
  assert.ok(marker, `${pattern} should exist`);
  const declarations = [...source.slice(0, marker.index).matchAll(/function\s+([\w$]+)\s*\(/g)];
  for (const declaration of declarations.reverse()) {
    const body = functionSource(source, declaration[1]);
    if (declaration.index + body.length > marker.index) {
      return { name: declaration[1], source: body };
    }
  }
  assert.fail(`${pattern} should be owned by a declared function`);
}

function bracedSource(source, startIndex) {
  const openingBrace = source.indexOf("{", startIndex);
  assert.notEqual(openingBrace, -1, "block should have an opening brace");
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(startIndex, index + 1);
  }
  assert.fail("block should have a closing brace");
}

test("Rubix canvas resize observations are stable no-ops until size or DPR changes", async () => {
  const app = await readFile(new URL("rubix-app.js", root), "utf8");
  const observer = app.match(/new\s+ResizeObserver\s*\(\s*([\w$]+)/);
  assert.ok(observer, "the stage should use a named ResizeObserver callback");
  const resize = functionSource(app, observer[1]);
  assert.match(app, /\.observe\s*\(\s*stageWrap\s*\)/, "the observer should watch the stage wrapper");
  assert.match(
    resize,
    /getBoundingClientRect\s*\(\s*\)|contentRect|borderBoxSize/,
    "resize should consume an observed CSS size",
  );
  assert.match(resize, /devicePixelRatio/);

  const redrawIndex = resize.search(/\brequestDraw\s*\(/);
  assert.ok(redrawIndex >= 0, "a real resize should invalidate the drawing");

  // Accept any cached metric representation and helper naming. An unchanged
  // observation must stop before even invalidating the coalesced draw frame.
  const noChangeReturn = resize.match(/if\s*\([\s\S]*?\)\s*(?:\{\s*)?return(?:\s+[^;]+)?;/);
  assert.ok(noChangeReturn, "unchanged size and DPR should take an early no-op return");
  assert.ok(noChangeReturn.index < redrawIndex);

  const backingStoreOwner = declaredFunctionContaining(app, /canvas\.width\s*=(?!=)/);
  const transformOwner = declaredFunctionContaining(app, /drawing\.setTransform\s*\(/);
  assert.equal(
    transformOwner.name,
    backingStoreOwner.name,
    "the backing-store reset and DPR transform should be one atomic operation",
  );
  assert.notEqual(
    backingStoreOwner.name,
    observer[1],
    "ResizeObserver should defer its clearing backing-store write until paint",
  );

  const combinedBackingStoreGuard = /if\s*\([^)]*\)\s*\{[\s\S]*?canvas\.width\s*=(?!=)[\s\S]*?canvas\.height\s*=(?!=)/.test(backingStoreOwner.source);
  const individuallyGuardedBackingStore = ["width", "height"].every((dimension) => new RegExp(
    `if\\s*\\([^)]*\\)\\s*(?:\\{\\s*)?canvas\\.${dimension}\\s*=(?!=)`,
  ).test(backingStoreOwner.source));
  assert.ok(
    combinedBackingStoreGuard || individuallyGuardedBackingStore,
    "backing dimensions should only be assigned after comparing their real pixel sizes",
  );

  const drawFrame = functionSource(app, "drawFrame");
  const applyResizeIndex = backingStoreOwner.name === "drawFrame"
    ? drawFrame.search(/canvas\.width\s*=(?!=)/)
    : drawFrame.search(new RegExp(`\\b${backingStoreOwner.name}\\s*\\(`));
  const paintIndex = Math.min(
    ...[...drawFrame.matchAll(/\b(?:drawBackdrop|drawCube)\s*\(/g)].map(({ index }) => index),
  );
  assert.ok(applyResizeIndex >= 0, "drawFrame should synchronously apply a pending resize");
  assert.ok(applyResizeIndex < paintIndex, "resize and repaint should happen in the same frame without a flash");
});

test("Rubix drawing coalesces invalidations into one animation frame", async () => {
  const app = await readFile(new URL("rubix-app.js", root), "utf8");
  const requestDraw = functionSource(app, "requestDraw");
  const drawFrame = functionSource(app, "drawFrame");

  assert.match(
    requestDraw,
    /if\s*\(\s*!\s*scheduledFrame\s*\)[\s\S]*scheduledFrame\s*=\s*requestAnimationFrame\s*\(\s*drawFrame\s*\)/,
    "repeated invalidations should share one pending frame",
  );
  assert.match(
    drawFrame,
    /scheduledFrame\s*=\s*0/,
    "the pending-frame token should clear when drawing begins",
  );
  assert.equal(
    [...app.matchAll(/requestAnimationFrame\s*\(\s*drawFrame\s*\)/g)].length,
    1,
    "canvas frames should only be created by the coalescing scheduler",
  );
});

test("Rubix renderer has no idle continuous draw loop", async () => {
  const app = await readFile(new URL("rubix-app.js", root), "utf8");
  const drawFrame = functionSource(app, "drawFrame");

  assert.doesNotMatch(drawFrame, /requestAnimationFrame\s*\(/);
  assert.match(
    drawFrame,
    /if\s*\([^)]*\)\s*(?:\{\s*)?requestDraw\s*\(\s*\)/,
    "the following frame should only be requested behind an active-motion condition",
  );
  assert.doesNotMatch(
    app,
    /setInterval\s*\(\s*(?:drawFrame|requestDraw)\b/,
    "drawing should remain event-driven while the cube is idle",
  );
});

test("Rubix mobile canvas keeps synchronized compositing and caps coarse-pointer DPR", async () => {
  const app = await readFile(new URL("rubix-app.js", root), "utf8");
  const contextSetup = app.match(/canvas\.getContext\s*\(\s*["']2d["']\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
  assert.ok(contextSetup, "the Rubix stage should create a 2D canvas context");
  assert.doesNotMatch(
    contextSetup[0],
    /desynchronized\s*:\s*true/,
    "mobile compositing should not opt into a potentially tearing desynchronized context",
  );

  const observer = app.match(/new\s+ResizeObserver\s*\(\s*([\w$]+)/);
  assert.ok(observer);
  const resize = functionSource(app, observer[1]);
  assert.match(
    resize,
    /matchMedia\s*\(\s*["']\(pointer\s*:\s*coarse\)["']\s*\)/,
    "coarse-pointer devices should take the mobile canvas budget",
  );
  const conditionalCap = resize.match(/\?\s*(\d+(?:\.\d+)?)\s*:\s*(?:[\w$.]*devicePixelRatio|deviceRatio)\b/);
  assert.ok(conditionalCap, "mobile/coarse DPR should have an explicit numeric cap");
  assert.ok(
    Number(conditionalCap[1]) <= 2,
    `mobile/coarse DPR cap should be at most 2, received ${conditionalCap[1]}`,
  );
});

test("Rubix mobile stage uses stable viewport rows and a local positioning context", async () => {
  const css = await readFile(new URL("rubix.css", root), "utf8");
  const shellRules = [...css.matchAll(/\.rubix-shell\s*\{([^}]*)\}/g)]
    .filter((match) => /[ds]vh/.test(match[1]));
  assert.ok(shellRules.length > 0, "mobile Rubix layout should define viewport-sized stage rows");

  for (const [, declarations] of shellRules) {
    const rows = [...declarations.matchAll(/grid-template-rows\s*:\s*([^;]+);/g)];
    const dynamicRows = rows.find((match) => /dvh/.test(match[1]));
    const stableRows = rows.find((match) => /svh/.test(match[1]));
    assert.ok(dynamicRows, "each viewport-sized row should retain a dvh fallback");
    assert.ok(stableRows, "each viewport-sized row should prefer stable svh sizing");
    assert.ok(dynamicRows.index < stableRows.index, "svh should override the earlier dvh fallback");
    assert.equal(
      dynamicRows[1].replace(/dvh/g, "vh").replace(/\s+/g, " ").trim(),
      stableRows[1].replace(/svh/g, "vh").replace(/\s+/g, " ").trim(),
      "dvh and svh declarations should describe the same row geometry",
    );
  }

  const mobileMedia = [...css.matchAll(/@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/g)]
    .filter((match) => Number(match[1]) <= 960)
    .map((match) => bracedSource(css, match.index));
  assert.ok(
    mobileMedia.some((block) => /\.rubix-stage\s*\{[^}]*position\s*:\s*relative\s*;/s.test(block)),
    "the phone/tablet stage should establish a stable relative positioning context",
  );
});
