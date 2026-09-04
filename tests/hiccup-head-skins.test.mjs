import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const root = new URL("../", import.meta.url);
const EXPECTED_SKIN_IDS = Object.freeze([
  "checker",
  "cutout-collage",
  "photo-1904",
  "food-portrait",
  "ascii",
  "wild-ink",
]);

function sourceForNamedArray(source, name) {
  const start = source.indexOf(`const ${name}`);
  assert.notEqual(start, -1, `${name} must be declared`);
  const assignment = source.indexOf("=", start);
  const arrayStart = source.indexOf("[", assignment);
  assert.notEqual(arrayStart, -1, `${name} must contain an array`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = arrayStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[") depth += 1;
    else if (character === "]") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name} must contain a closed array`);
}

function sourceForRegistryEntry(registry, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`\\bid\\s*:\\s*["']${escapedId}["']`);
  const match = marker.exec(registry);
  assert.ok(match, `${id} must have a visual-skin registry entry`);
  const nextEntryOffset = registry.slice(match.index + match[0].length)
    .search(/\n\s*Object\.freeze\(\s*\{\s*\n\s*id\s*:/);
  const end = nextEntryOffset < 0
    ? registry.length
    : match.index + match[0].length + nextEntryOffset;
  return registry.slice(match.index, end);
}

function sourceForFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name}() must be declared`);
  let parameterDepth = 1;
  let bodyStart = -1;
  let parameterQuote = "";
  let parameterEscaped = false;
  for (let index = start + marker.length; index < source.length; index += 1) {
    const character = source[index];
    if (parameterQuote) {
      if (parameterEscaped) parameterEscaped = false;
      else if (character === "\\") parameterEscaped = true;
      else if (character === parameterQuote) parameterQuote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      parameterQuote = character;
      continue;
    }
    if (character === "(") parameterDepth += 1;
    else if (character === ")") {
      parameterDepth -= 1;
      if (parameterDepth === 0) {
        bodyStart = source.indexOf("{", index + 1);
        break;
      }
    }
  }
  assert.notEqual(bodyStart, -1, `${name}() must have a body`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = bodyStart; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  assert.fail(`${name}() must have a closed body`);
}

function sourceForCallContaining(source, callee, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${callee}() must reference ${marker}`);
  const start = source.lastIndexOf(`${callee}(`, markerIndex);
  assert.notEqual(start, -1, `${marker} must be inside a ${callee}() call`);
  const open = source.indexOf("(", start);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") depth += 1;
    else if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        assert.ok(markerIndex < index, `${marker} must be an argument to ${callee}()`);
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${callee}() call containing ${marker} must be closed`);
}

function sourceForSwitchCase(source, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const marker = new RegExp(`\\bcase\\s+["']${escapedId}["']\\s*:`);
  const match = marker.exec(source);
  assert.ok(match, `${id} needs its own render branch`);
  const start = match.index;
  const remainder = source.slice(start + match[0].length);
  const nextCase = remainder.search(/\n\s*(?:case\s+["']|default\s*:)/);
  return nextCase < 0
    ? source.slice(start)
    : source.slice(start, start + match[0].length + nextCase);
}

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function openingTagById(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.match(new RegExp(
    `<[a-z][\\w:-]*\\b[^>]*\\bid="${escapedId}"[^>]*>`,
    "i",
  ))?.[0] ?? "";
}

function elementTextById(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(
    `<([a-z][\\w:-]*)\\b[^>]*\\bid="${escapedId}"[^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i",
  ));
  return (match?.[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

test("Hiccup Head exposes exactly six visual skins with checker as the stable fallback", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const registry = sourceForNamedArray(app, "HICCUP_HEAD_VISUAL_SKINS");
  const ids = [...registry.matchAll(/\bid\s*:\s*["']([^"']+)["']/g)]
    .map(([, id]) => id);

  assert.equal(ids[0], "checker", "the current checker face stays the default skin");
  assert.deepEqual(ids, EXPECTED_SKIN_IDS, "Zombie Zoid is the final built-in skin");
  assert.equal(new Set(ids).size, 6, "skin IDs must be unique");
  assert.match(app, /\blet\s+visualSkinId\s*=/);
  const validator = sourceForFunction(app, "validVisualSkinId");
  assert.match(validator, /["']checker["']/);

  const setter = sourceForFunction(app, "setVisualSkin");
  assert.match(setter, /validVisualSkinId\s*\(/);
});

test("the static visual-skin selector mirrors registry order and ends with Zombie Zoid", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
  ]);
  const select = html.match(
    /<select\b[^>]*\bid=["']visualSkinSelect["'][^>]*>[\s\S]*?<\/select>/i,
  )?.[0] ?? "";
  assert.ok(select, "the static visual-skin selector must exist");
  const optionIds = [...select.matchAll(/<option\b[^>]*\bvalue=["']([^"']+)["']/gi)]
    .map(([, id]) => id);
  assert.deepEqual(optionIds, EXPECTED_SKIN_IDS);
  assert.equal(optionIds.at(-1), "wild-ink");
  const lastOptionText = select.match(
    /<option\b[^>]*\bvalue=["']wild-ink["'][^>]*>([\s\S]*?)<\/option>/i,
  )?.[1].replace(/<[^>]+>/g, "").trim();
  assert.equal(lastOptionText, "Zombie Zoid");
  const registry = sourceForNamedArray(app, "HICCUP_HEAD_VISUAL_SKINS");
  assert.match(sourceForRegistryEntry(registry, "wild-ink"), /\blabel\s*:\s*["']Zombie Zoid["']/);
  assert.doesNotMatch(`${html}\n${registry}`, /Wild ink zombie skull/i);
});

test("Zombie Zoid uses dedicated non-human anatomy without changing shared controls", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const registry = sourceForNamedArray(app, "HICCUP_HEAD_VISUAL_SKINS");
  assert.match(
    registry,
    /id\s*:\s*["']wild-ink["'][\s\S]{0,220}?(?:label|description)\s*:\s*["'][^"']*(?:wild|alien|zombie|skull)/i,
    "the selector should identify Zombie Zoid as the deliberately non-human skin",
  );

  const silhouette = sourceForFunction(app, "appendWildInkSkullSilhouette");
  assert.match(silhouette, /cranium|alien|skull/i);
  assert.match(silhouette, /jaw/i);

  const face = sourceForFunction(app, "drawFace");
  assert.match(face, /if\s*\(wildInk\)[\s\S]{0,180}?drawWildInkAlienZombieDecay\s*\(/);
});

test("Zombie Zoid cycles deterministic alien-zombie decay without brain or neon anatomy", async () => {
  const [app, model, processor, assetReadme] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
    readFile(new URL("assets/hiccup-head/skins/README.md", root), "utf8"),
  ]);
  const palettes = sourceForNamedArray(app, "WILD_INK_DECAY_PALETTES");
  assert.equal(
    (palettes.match(/Object\.freeze\(\s*\{/g) ?? []).length,
    3,
    "Zombie Zoid needs exactly three explicit decay palette states",
  );
  for (const stateName of ["bloody", "maggoty"]) {
    assert.match(palettes, new RegExp(`\\b${stateName}\\b`, "i"));
  }
  assert.doesNotMatch(palettes, /\bbrain(?:y)?\b/i);

  const selectPalette = sourceForFunction(app, "wildInkDecayPaletteForStep");
  assert.match(selectPalette, /\bstep\b/);
  assert.match(selectPalette, /WILD_INK_DECAY_PALETTES/);
  assert.match(
    selectPalette,
    /%\s*(?:WILD_INK_DECAY_PALETTES\.length|3)/,
    "palette state must wrap predictably across the three scheduled steps",
  );
  assert.doesNotMatch(selectPalette, /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now/);

  const decay = sourceForFunction(app, "drawWildInkAlienZombieDecay");
  const skullDetails = sourceForFunction(app, "drawWildInkSkullDetails");
  const composedAnatomy = `${decay}\n${skullDetails}`;
  assert.match(decay, /beat\?*\.step|beat\s*&&\s*beat\.step/);
  assert.match(decay, /wildInkDecayPaletteForStep\s*\(/);
  const paletteCallStart = decay.indexOf("wildInkDecayPaletteForStep(");
  const paletteCallEnd = decay.indexOf(");", paletteCallStart);
  const paletteCall = decay.slice(paletteCallStart, paletteCallEnd + 2);
  assert.match(paletteCall, /step/i, "the palette selector must receive the scheduled beat step");
  assert.doesNotMatch(paletteCall, /ordinal|phase/i, "beat ordinal may place marks but must not choose the palette");
  assert.match(composedAnatomy, /angular[\s\S]{0,140}?sockets?|sockets?[\s\S]{0,140}?angular/i);
  assert.match(composedAnatomy, /hostile|predatory/i);
  assert.ok((skullDetails.match(/context\.lineTo\s*\(/g) ?? []).length >= 4, "eye sockets must use an angular path");
  assert.doesNotMatch(
    decay,
    /\bbrain(?:Color|y)?\b|\bgyr(?:us|i|usCount)\b/i,
    "the canvas anatomy must not draw a vector brain",
  );
  assert.match(decay, /sinew/i);
  assert.match(composedAnatomy, /torn|tears?|ripped/i);
  assert.match(decay, /for\s*\([^)]*maggot[^)]*\)/i);
  assert.match(decay, /context\.(?:arc|ellipse|quadraticCurveTo)\s*\(/);
  assert.doesNotMatch(
    decay,
    /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now|new\s+Image|drawImage\s*\(/,
    "decay anatomy and maggot marks must be original deterministic canvas paint",
  );

  const paintOnly = `${palettes}\n${selectPalette}\n${decay}`;
  assert.doesNotMatch(
    paintOnly,
    /\b(?:audioContext|graph|sourceNode|facePostNode|audioConfiguration|postConfiguration|postStrike|scheduleSequence)\b|\.port\.postMessage\s*\(/,
  );
  assert.doesNotMatch(paintOnly, /\b(?:layout|pose)\.[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\*=|\/=)/);
  assert.doesNotMatch(
    decay,
    /\b(?:handles|hotspots|hands|toothTines|toothGapGeometry|tongueTipGeometry)\s*=|\b(?:buildHitGeometry|faceLayout|eyebrowGeometry|sideSpaghettiHairGeometry)\s*\(/,
  );
  assert.doesNotMatch(`${model}\n${processor}`, /WILD_INK_DECAY|wildInkDecay|AlienZombie/i);

  const face = sourceForFunction(app, "drawFace");
  assert.match(
    face,
    /if\s*\(wildInk\)[\s\S]{0,180}?drawWildInkAlienZombieDecay\(context,\s*layout,\s*skinBeat\)/,
  );
  assert.doesNotMatch(
    composedAnatomy,
    /\bWILD_INK_NEON|\bneon\b|#(?:efff00|39ff14)\b/i,
    "Zombie Zoid anatomy must use the darker sickly palette, not neon yellow or green",
  );

  const boltMarker = face.indexOf("const boltSegments");
  const wildHairStart = face.lastIndexOf("if (wildInk)", boltMarker);
  const wildHairEnd = face.indexOf("continue;", boltMarker);
  assert.ok(wildHairStart >= 0 && boltMarker > wildHairStart && wildHairEnd > boltMarker);
  const wildHair = face.slice(wildHairStart, wildHairEnd + "continue;".length);
  assert.doesNotMatch(wildHair, /\bWILD_INK_NEON|\bneon\b|#(?:efff00|39ff14)\b/i);
  assert.match(wildHair, /wildInkDecay\?\.parasite/);
  assert.match(wildHair, /wildInkDecay\?\.tissue/);
  const hairGeometryStart = face.lastIndexOf("const hair = sideSpaghettiHairGeometry", wildHairStart);
  assert.ok(hairGeometryStart >= 0);
  const hairGeometry = face.slice(hairGeometryStart, wildHairEnd);
  assert.match(hairGeometry, /sideSpaghettiHairGeometry\(layout,\s*pose,\s*side\)/);
  assert.match(wildHair, /context\.moveTo\(rootX,\s*rootY\)/);
  assert.match(wildHair, /directionX\s*\*\s*strandLength\s*\*\s*progress/);
  assert.match(wildHair, /directionY\s*\*\s*strandLength\s*\*\s*progress/);
  assert.match(wildHair, /normalX\s*\*\s*zig|normalY\s*\*\s*zig/);

  const registry = sourceForNamedArray(app, "HICCUP_HEAD_VISUAL_SKINS");
  const wildEntry = sourceForRegistryEntry(registry, "wild-ink");
  assert.match(wildEntry, /fieldAsset\s*:\s*["']\.\/assets\/hiccup-head\/skins\/wild-ink-decay-fields\.webp["']/);
  assert.doesNotMatch(wildEntry, /\bbrain(?:y)?\b/i);
  await access(new URL("./assets/hiccup-head/skins/wild-ink-decay-fields.webp", root), fsConstants.R_OK);
  const assetDocStart = assetReadme.indexOf("`wild-ink-decay-fields.webp`");
  assert.notEqual(assetDocStart, -1);
  const assetDocEnd = assetReadme.indexOf("\n\n", assetDocStart);
  const wildAssetDoc = assetReadme.slice(
    assetDocStart,
    assetDocEnd < 0 ? assetReadme.length : assetDocEnd,
  );
  assert.match(wildAssetDoc, /2048\s*[×x]\s*512/i);
  assert.match(wildAssetDoc, /four[\s\S]{0,100}?(?:one row|single row)|4\s*[×x]\s*1/i);
  assert.match(
    wildAssetDoc,
    /blood[\s\S]{0,120}?(?:viscera|guts)[\s\S]{0,120}?maggot[\s\S]{0,160}?cheese[\s\S]{0,80}?pepperoni/i,
    "the local atlas documentation must retain all four fields in row order",
  );
  assert.doesNotMatch(wildAssetDoc, /\bbrain(?:y)?\b/i);
  assert.doesNotMatch(app, /\bWILD_INK_NEON|#(?:efff00|39ff14)\b/i);
  assert.match(app, /const\s+WILD_INK_DECAY_FIELD_COLUMNS\s*=\s*4\s*;/);
  assert.match(app, /const\s+WILD_INK_DECAY_FIELD_ROWS\s*=\s*1\s*;/);
  assert.match(app, /const\s+WILD_INK_DECAY_FIELD_COUNT\s*=\s*4\s*;/);
  const photoField = sourceForFunction(app, "drawWildInkDecayPhotoField");
  assert.match(photoField, /beat\?\.step/);
  assert.match(photoField, /step\s*%\s*WILD_INK_DECAY_FIELD_COUNT/);
  assert.match(photoField, /naturalWidth\s*\/\s*WILD_INK_DECAY_FIELD_COLUMNS/);
  assert.match(photoField, /naturalHeight\s*\/\s*WILD_INK_DECAY_FIELD_ROWS/);
  assert.match(photoField, /context\.drawImage\s*\(/);
  assert.doesNotMatch(photoField, /ordinal|Math\.random|Date\.now|performance\.now/);
  assert.match(
    face,
    /if\s*\(wildInk\)[\s\S]{0,180}?skinFieldAsset[\s\S]{0,100}?drawWildInkDecayPhotoField\(context,\s*skinFieldAsset,\s*layout,\s*skinBeat\)/,
  );
});

test("Zombie Zoid swaps hidden slap mitts for large paint-only ice-cream cones", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const cone = sourceForFunction(app, "drawZombieZoidIceCreamCone");
  assert.match(cone, /ice cream|waffle cone/i);
  assert.match(cone, /coneLength\s*=\s*Math\.max\(r\s*\*\s*(\d+(?:\.\d+)?)/);
  const lengthScale = Number(cone.match(/coneLength\s*=\s*Math\.max\(r\s*\*\s*(\d+(?:\.\d+)?)/)?.[1]);
  assert.ok(lengthScale >= 2.5, "the cone must be visibly larger than the old palm radius");
  assert.match(cone, /for\s*\(let\s+groove\s*=/);
  assert.ok((cone.match(/context\.lineTo\s*\(/g) ?? []).length >= 4, "the cone needs a triangular waffle body");
  const scoopBodyStart = cone.indexOf("context.fillStyle = scoop");
  const meltStart = cone.indexOf("// A few melting lobes", scoopBodyStart);
  assert.ok(scoopBodyStart >= 0 && meltStart > scoopBodyStart);
  const scoopScales = [...cone.slice(scoopBodyStart, meltStart).matchAll(/r\s*\*\s*(\d+(?:\.\d+)?)/g)]
    .map(([, scale]) => Number(scale));
  assert.ok(Math.max(...scoopScales) >= 1, "the ice-cream scoop must fill at least the former palm radius");
  assert.match(cone, /for\s*\(const\s*\[dripX,\s*dripY,\s*dripRadius\]/);
  assert.doesNotMatch(
    cone,
    /\b(?:audioContext|graph|sourceNode|facePostNode|audioConfiguration|voiceSlots|postConfiguration|postStrike|scheduleSequence|triggerSound)\b|\.port\.postMessage\s*\(/,
  );
  assert.doesNotMatch(cone, /\bhand\.[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\*=|\/=)/);

  const drawHands = sourceForFunction(app, "drawHands");
  assert.match(drawHands, /const\s+zombieZoid\s*=\s*visualSkin\.id\s*===\s*["']wild-ink["']/);
  const hiddenGuard = drawHands.indexOf("if (!selected && active <= 0.01) continue");
  const coneCall = drawHands.indexOf("drawZombieZoidIceCreamCone(");
  assert.ok(hiddenGuard >= 0 && coneCall > hiddenGuard, "cones must retain the hidden-at-rest slap guard");
  assert.match(
    drawHands,
    /if\s*\(zombieZoid\)\s*\{[\s\S]{0,260}?drawZombieZoidIceCreamCone\([\s\S]{0,260}?\}\s*else\s*\{/,
    "only Zombie Zoid may replace the existing hand renderer",
  );
  assert.match(drawHands, /const\s+travel\s*=\s*1\s*-\s*\(1\s*-\s*clamp\(active\)\)\s*\*\*\s*2/);
  assert.match(drawHands, /palmX\s*=\s*hand\.x\s*\+\s*\(hand\.targetX\s*-\s*hand\.x\)\s*\*\s*travel/);
  assert.match(drawHands, /palmY\s*=\s*hand\.y\s*\+\s*\(hand\.targetY\s*-\s*hand\.y\)\s*\*\s*travel/);

  const hitGeometry = sourceForFunction(app, "buildHitGeometry");
  assert.match(hitGeometry, /id\s*:\s*["']left["'][\s\S]{0,100}?soundId\s*:\s*["']slap["']/);
  assert.match(hitGeometry, /id\s*:\s*["']right["'][\s\S]{0,100}?soundId\s*:\s*["']smack["']/);
  const drag = sourceForFunction(app, "beginHandDragFromSound");
  assert.match(drag, /soundId\s*!==\s*["']slap["']\s*&&\s*soundId\s*!==\s*["']smack["']/);
  assert.match(drag, /soundId\s*===\s*["']slap["']\s*\?\s*["']left["']\s*:\s*["']right["']/);
});

test("Zombie Zoid paints both draggable ears as circular saw blades", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const saw = sourceForFunction(app, "drawZombieZoidSawBlade");
  const toothCount = Number(saw.match(/const\s+toothCount\s*=\s*(\d+)/)?.[1]);
  assert.ok(toothCount >= 12, "a saw ear needs enough teeth to read as a circular blade");
  assert.match(saw, /for\s*\(let\s+tooth\s*=\s*0;\s*tooth\s*<\s*toothCount/);
  assert.ok((saw.match(/context\.lineTo\s*\(/g) ?? []).length >= 2);
  assert.match(saw, /createRadialGradient\s*\(/);
  assert.match(saw, /for\s*\(let\s+hole\s*=\s*0;/);
  assert.match(saw, /context\.arc\(\s*0,\s*0,/);
  assert.doesNotMatch(saw, /\bWILD_INK_NEON|\bneon\b|#(?:efff00|39ff14)\b/i);
  assert.doesNotMatch(
    saw,
    /\b(?:audioContext|graph|sourceNode|facePostNode|audioConfiguration|earSpread|handles|postConfiguration|postStrike|scheduleSequence|triggerSound)\b|\.port\.postMessage\s*\(/,
  );

  const face = sourceForFunction(app, "drawFace");
  const earStart = face.indexOf("// Ears are stereo controls");
  const earEnd = face.indexOf("// An opaque two-color checkerboard", earStart);
  assert.ok(earStart >= 0 && earEnd > earStart);
  const ears = face.slice(earStart, earEnd);
  assert.match(ears, /for\s*\(const\s+side\s+of\s+\[-1,\s*1\]\)/);
  assert.match(ears, /earX\s*=\s*cx\s*\+\s*side\s*\*\s*rx\s*\*\s*\(0\.88\s*\+\s*earSpread\s*\*\s*0\.64\)/);
  assert.match(ears, /earY\s*=\s*cy\s*\+\s*ry\s*\*\s*0\.03/);
  assert.match(ears, /earRadius\s*=\s*Math\.min\(rx,\s*ry\)\s*\*\s*\(0\.15\s*\+\s*earSpread\s*\*\s*0\.04\)/);
  assert.match(
    ears,
    /if\s*\(wildInk\)\s*\{\s*drawZombieZoidSawBlade\(context,\s*earX,\s*earY,\s*earRadius,\s*side\);\s*\}\s*else\s+if\s*\(atlasReady\)/,
  );

  const hitGeometry = sourceForFunction(app, "buildHitGeometry");
  for (const [id, axis] of [["left-ear", "x-invert"], ["right-ear", "x"]]) {
    assert.match(
      hitGeometry,
      new RegExp(`id\\s*:\\s*["']${id}["'][\\s\\S]{0,180}?key\\s*:\\s*["']earSpread["'][\\s\\S]{0,180}?axis\\s*:\\s*["']${axis}["']`),
    );
  }
});

test("visual beats use the due paint timestamp without entering the audio clock", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const flush = sourceForFunction(app, "flushVisualQueue");
  const stepBranchStart = flush.indexOf('event.type === "step"');
  const stepBranchEnd = flush.indexOf("const sound =", stepBranchStart);
  assert.ok(stepBranchStart >= 0 && stepBranchEnd > stepBranchStart);
  const stepBranch = flush.slice(stepBranchStart, stepBranchEnd);
  assert.match(stepBranch, /visibleStep\s*=\s*event\.step/);
  assert.match(
    stepBranch,
    /visualBeatStartedAt\s*=\s*event\.due/,
    "a delayed paint frame must retain the scheduled visual onset",
  );
  assert.doesNotMatch(stepBranch, /visualBeatStartedAt\s*=\s*now/);

  const beatFrame = sourceForFunction(app, "visualSkinBeatFrame");
  assert.match(beatFrame, /visualBeatStartedAt|age/i);
  assert.doesNotMatch(beatFrame, /Math\.random|Date\.now|performance\.now/);

  const drawStage = sourceForFunction(app, "drawStage");
  const flushIndex = drawStage.indexOf("flushVisualQueue(now)");
  const beatIndex = drawStage.indexOf("visualSkinBeatFrame(");
  const backgroundIndex = drawStage.indexOf("drawBackground(", beatIndex);
  const faceIndex = drawStage.indexOf("drawFace(", beatIndex);
  assert.ok(flushIndex >= 0 && beatIndex > flushIndex, "the due visual queue must advance before beat paint is sampled");
  assert.ok(backgroundIndex > beatIndex && faceIndex > beatIndex, "one sampled visual beat must reach background and face paint");
  assert.match(
    drawStage,
    /const\s+checkerStep\s*=\s*sequencePlaying\s*&&\s*visibleStep\s*>=\s*0[\s\S]{0,100}?visibleStep\s*%\s*sequenceLength/,
    "the paint frame must derive its step from the due visual playhead",
  );
  const beatSelection = drawStage.slice(beatIndex, Math.max(backgroundIndex, faceIndex) + 260);
  assert.match(beatSelection, /visualBeatStartedAt/);
  assert.match(beatSelection, /drawBackground\([^;]*\b(?:skin|visual)Beat\b[^;]*\)/);
  assert.match(beatSelection, /drawFace\([^;]*\b(?:skin|visual)Beat\b[^;]*\)/);

  const scheduler = app.slice(
    app.indexOf("function scheduleSequenceAhead("),
    app.indexOf("async function startSequence("),
  );
  assert.doesNotMatch(scheduler, /visualBeatStartedAt|visualSkinBeatFrame|drawVisualSkinBeatField/);
});

test("every non-checker skin owns a deterministic, visibly distinct face-field beat", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const field = sourceForFunction(app, "drawVisualSkinBeatField");
  const expectedDetails = new Map([
    ["wild-ink", [/(?:decay|registration|grain)/i]],
    ["cutout-collage", [/registration/i, /bands?/i]],
    ["photo-1904", [/exposure/i]],
    ["food-portrait", [/colou?r/i, /wedges?/i, /glint/i]],
    ["ascii", [/scan/i, /glitch/i]],
  ]);
  const branches = [];
  for (const [id, details] of expectedDetails) {
    const branch = sourceForSwitchCase(field, id);
    branches.push(branch.replace(/case\s+["'][^"']+["']\s*:/, "").replace(/\s+/g, " ").trim());
    for (const detail of details) assert.match(branch, detail, `${id} is missing ${detail}`);
    assert.match(branch, /\b(?:beat|pulse|envelope)\b/i, `${id} must respond to the sampled visual beat`);
    assert.match(
      branch,
      /context\.(?:fill|stroke|fillRect|strokeRect|arc|ellipse|lineTo|drawImage|globalAlpha|globalCompositeOperation)/,
      `${id} must execute a real canvas paint operation`,
    );
  }
  assert.equal(new Set(branches).size, expectedDetails.size, "skin beat branches may not alias one generic effect");
  assert.doesNotMatch(field, /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now/);
});

test("skin beat render helpers are paint-only and Zombie Zoid retains low-fi ink texture", async () => {
  const [app, model, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  const beatFrame = sourceForFunction(app, "visualSkinBeatFrame");
  const field = sourceForFunction(app, "drawVisualSkinBeatField");
  const helpers = `${beatFrame}\n${field}`;
  assert.doesNotMatch(
    helpers,
    /\b(?:audioContext|graph|sourceNode|facePostNode|postConfiguration|postStrike|scheduleSequence|nextStepTime|sequenceStepIntervalSeconds)\b|\.port\.postMessage\s*\(|\bpostMessage\s*\(/,
  );
  assert.doesNotMatch(helpers, /\b(?:layout|pose)\.[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\*=|\/=)/);
  assert.doesNotMatch(
    helpers,
    /\b(?:handles|hotspots|hands|toothTines|toothGapGeometry|tongueTipGeometry)\s*=|\b(?:buildHitGeometry|faceLayout|eyebrowGeometry|sideSpaghettiHairGeometry)\s*\(/,
    "beat decoration must not alter shared interaction geometry",
  );
  assert.doesNotMatch(`${model}\n${processor}`, /visualSkinBeat|visualBeatStartedAt|drawVisualSkinBeatField/);

  const wildBranch = sourceForSwitchCase(field, "wild-ink");
  assert.match(wildBranch, /decay|grain/i);
  assert.match(wildBranch, /globalCompositeOperation\s*=\s*["']multiply["']/);
  assert.match(wildBranch, /getLowFiPhotoGrainPattern\s*\(/);
  assert.doesNotMatch(
    wildBranch,
    /globalCompositeOperation\s*=\s*["'](?:lighter|color-dodge)["']|shadowBlur\s*=|filter\s*=\s*["'][^"']*blur/i,
    "the skull pulse should read as restrained photocopy ink, not a bright glow",
  );

});

test("visual skin and camera share a panel row above the mutable face preset", async () => {
  const html = await readFile(new URL("hiccup-head.html", root), "utf8");
  const mastheadStart = html.indexOf('<header class="masthead">');
  const mastheadEnd = html.indexOf("</header>", mastheadStart);
  const masthead = html.slice(mastheadStart, mastheadEnd);
  assert.doesNotMatch(masthead, /id="(?:visualSkinSelect|openWebcamSkinButton)"/);

  const panelStart = html.indexOf('<aside class="panel hiccup-head-panel"');
  const panelEnd = html.indexOf("</aside>", panelStart);
  const panel = html.slice(panelStart, panelEnd);
  const skinDeck = panel.indexOf('class="hiccup-head-skin-deck"');
  const skinTools = panel.indexOf('class="hiccup-head-skin-tools"');
  const skinSelect = panel.indexOf('id="visualSkinSelect"');
  const camera = panel.indexOf('id="openWebcamSkinButton"');
  const facePreset = panel.indexOf('class="hiccup-head-preset-deck"');
  assert.ok(panelStart >= 0 && panelEnd > panelStart, "the Hiccup Head control panel must exist");
  assert.ok(
    skinDeck >= 0 && skinTools > skinDeck && skinSelect > skinTools && camera > skinSelect && facePreset > camera,
    "the visual skin selector and camera must share the first panel row above the mutable face preset",
  );

  const pads = html.indexOf('id="padBankTitle"');
  const voices = html.indexOf('id="voiceCollectionTitle"');
  assert.ok(pads >= 0 && voices > pads, "Voice Collection must appear below Mouth, Throat & Face");
});

test("ASCII terminal builds its patterned face components from cached density-shaded glyphs", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const styleStart = app.indexOf("const ASCII_GLYPH_STYLES");
  const styleEnd = app.indexOf("function asciiSeedForRole", styleStart);
  assert.ok(styleStart >= 0 && styleEnd > styleStart);
  const styles = app.slice(styleStart, styleEnd);
  const requiredRoles = [
    "head", "ear-left", "ear-right", "eye-white", "iris-left", "iris-right",
    "pupil", "brow-left", "brow-right", "nose",
    "lips", "tooth", "tooth-hit", "tongue", "hair-left",
    "hair-right", "tether-left", "tether-right", "hand", "kiss", "brush",
  ];
  for (const role of requiredRoles) {
    const escaped = role.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(styles, new RegExp(`(?:["']${escaped}["']|\\b${escaped})\\s*:`), `${role} needs a glyph style`);
    assert.match(
      app,
      new RegExp(`asciiPaint\\([\\s\\S]{0,140}?["']${escaped}["']`),
      `${role} must be applied to a rendered component`,
    );
  }

  const pattern = sourceForFunction(app, "getAsciiGlyphPattern");
  assert.match(pattern, /asciiGlyphPatterns\.(?:has|get|set)/);
  assert.match(pattern, /createPattern\s*\(/);
  assert.match(pattern, /style\.density/);
  assert.match(pattern, /glyphIndex/);
  assert.match(pattern, /colorIndex/);
  assert.doesNotMatch(pattern, /Math\.random|\b(?:audioContext|graph|state)\s*(?:=|\.)/);
});

test("ASCII eyes use explicit independent top and bottom glyph shutters", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const shutters = sourceForFunction(app, "drawAsciiEyeShutters");
  assert.match(shutters, /\bclosure\b/);
  assert.match(shutters, /\bleftEye\b/);
  assert.match(
    shutters,
    /for\s*\(const\s+verticalSide\s+of\s+\[-1,\s*1\]\)/,
    "one explicit pass each must paint the independently moving upper and lower shutters",
  );
  assert.match(shutters, /upper[\s\S]{0,100}?lower|top[\s\S]{0,100}?bottom/i);
  assert.match(shutters, /asciiPaint\s*\(/, "shutters must reuse a cached glyph pattern");
  assert.ok((shutters.match(/context\.fill\s*\(/g) ?? []).length >= 2);
  assert.match(shutters, /context\.(?:clip|ellipse|arc)\s*\(/);
  assert.doesNotMatch(
    shutters,
    /\blidCover\b|document\.createElement\s*\(|\.createPattern\s*\(|\.fillText\s*\(|Math\.random|Date\.now|performance\.now/,
    "ASCII shutters must be explicit cached paths, not the old tiny generic cover or per-frame glyph rasterization",
  );
  assert.doesNotMatch(
    shutters,
    /\b(?:audioContext|graph|sourceNode|facePostNode|postConfiguration|postStrike)\b|\.port\.postMessage\s*\(/,
  );
  assert.doesNotMatch(shutters, /\b(?:layout|pose)\.[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\*=|\/=)/);
  assert.doesNotMatch(
    shutters,
    /\b(?:handles|hotspots|hands|toothTines|toothGapGeometry|tongueTipGeometry)\s*=|\bbuildHitGeometry\s*\(/,
  );

  const styleStart = app.indexOf("const ASCII_GLYPH_STYLES");
  const styleEnd = app.indexOf("function asciiSeedForRole", styleStart);
  const styles = app.slice(styleStart, styleEnd);
  for (const role of ["lid-left", "lid-right"]) {
    assert.match(styles, new RegExp(`["']${role}["']\\s*:`));
    assert.match(shutters, new RegExp(`["']${role}["']`));
  }

  const face = sourceForFunction(app, "drawFace");
  assert.match(face, /leftEye\s*\?\s*pose\.leftEyeClosure\s*:\s*pose\.rightEyeClosure/);
  assert.match(
    face,
    /if\s*\(asciiSkin\)\s*\{[\s\S]{0,320}?drawAsciiEyeShutters\s*\([\s\S]{0,260}?\beyeClosure\b[\s\S]{0,160}?\}\s*else\s*\{/,
    "ASCII must take its own shutter branch while other skins keep the generic lid path",
  );
});

test("ASCII keeps the oral cavity opaque black without per-frame glyph rasterization", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const styleStart = app.indexOf("const ASCII_GLYPH_STYLES");
  const styleEnd = app.indexOf("function asciiSeedForRole", styleStart);
  assert.ok(styleStart >= 0 && styleEnd > styleStart);
  const styles = app.slice(styleStart, styleEnd);
  assert.doesNotMatch(
    styles,
    /(?:["']mouth["']|\bmouth)\s*:/,
    "the black cavity is deliberately not an ASCII pattern role",
  );

  const face = sourceForFunction(app, "drawFace");
  const mouthStart = face.indexOf("const lipRimWidth");
  const mouthEnd = face.indexOf("if (atlasReady", mouthStart);
  assert.ok(mouthStart >= 0 && mouthEnd > mouthStart, "the single oral-cavity paint must be identifiable");
  const cavityPaint = face.slice(mouthStart, mouthEnd);
  assert.match(
    cavityPaint,
    /context\.fillStyle\s*=\s*asciiSkin\s*\?\s*["']#(?:000|000000)["']/i,
    "ASCII must use solid, fully opaque black for its one mouth cavity",
  );
  assert.doesNotMatch(cavityPaint, /asciiPaint|getAsciiGlyphPattern|createPattern|fillText/);

  const pattern = sourceForFunction(app, "getAsciiGlyphPattern");
  const cacheHit = pattern.indexOf("asciiGlyphPatterns.has(");
  const tileCreation = pattern.indexOf('document.createElement("canvas")');
  const cacheWrite = pattern.indexOf("asciiGlyphPatterns.set(");
  assert.ok(cacheHit >= 0 && tileCreation > cacheHit && cacheWrite > tileCreation);
  for (const name of ["drawFace", "drawBackground", "drawVisualSkinBeatField"]) {
    const painter = sourceForFunction(app, name);
    assert.doesNotMatch(
      painter,
      /document\.createElement\s*\(|\.createPattern\s*\(/,
      `${name} must reuse cached ASCII tiles instead of constructing patterns per frame`,
    );
  }
});

test("skin selection is an explicitly visual-only accessible control", async () => {
  const [html, app] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
  ]);
  const selectTag = html.match(/<select\b[^>]*\bid="visualSkinSelect"[^>]*>/i)?.[0] ?? "";
  assert.ok(selectTag, "the visual skin selector must be present");

  const labelText = (
    html.match(/<label\b[^>]*\bfor="visualSkinSelect"[^>]*>([\s\S]*?)<\/label>/i)?.[1]
    ?? attribute(selectTag, "aria-label")
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  assert.match(labelText, /(?:visual\s+)?skin|appearance/i);

  const descriptionId = attribute(selectTag, "aria-describedby");
  assert.ok(descriptionId, "the selector must reference its visual-only explanation");
  const description = elementTextById(html, descriptionId);
  assert.match(description, /(?:appearance|visual)/i);
  assert.match(description, /(?:sound|audio)/i);
  assert.match(description, /(?:only|unchanged|does not|won't|will not)/i);

  assert.match(
    app,
    /visualSkinSelect["']\)\?*\.addEventListener\(["']change["'][\s\S]{0,260}?setVisualSkin\(/,
    "the selector must call the visual-only setter",
  );
});

test("raster-backed skins use readable project-local assets", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const registry = sourceForNamedArray(app, "HICCUP_HEAD_VISUAL_SKINS");
  const rasterPaths = [...registry.matchAll(/["']([^"']+\.(?:avif|png|webp|jpe?g))(?:\?[^"']*)?["']/gi)]
    .map(([, path]) => path);

  assert.ok(rasterPaths.length >= 3, "collage, 1904 photo, and food skins need local raster art");
  assert.equal(new Set(rasterPaths).size, rasterPaths.length, "skin assets should not alias one image");
  for (const path of rasterPaths) {
    assert.match(path, /^(?:\.\/)?assets\/hiccup-head\/skins\//);
    assert.doesNotMatch(path, /^(?:data:|https?:|\/)|(?:^|\/)\.\.(?:\/|$)/i);
    await access(new URL(path, root), fsConstants.R_OK);
  }

  for (const id of ["cutout-collage", "photo-1904", "food-portrait"]) {
    const idPattern = new RegExp(`\\bid\\s*:\\s*["']${id}["']`);
    const entryStart = registry.search(idPattern);
    assert.notEqual(entryStart, -1, `${id} must be registered`);
    const nextEntryOffset = registry.slice(entryStart + 1).search(/\bid\s*:\s*["']/);
    const nextEntry = nextEntryOffset < 0 ? -1 : entryStart + 1 + nextEntryOffset;
    const entry = registry.slice(entryStart, nextEntry < 0 ? registry.length : nextEntry);
    assert.match(entry, /(?:\.\/)?assets\/hiccup-head\/skins\/[^"']+\.(?:avif|png|webp|jpe?g)/i);
  }
});

test("cutout collage cycles one local 3 by 2 face-field sheet by due beat ordinal", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const registry = sourceForNamedArray(app, "HICCUP_HEAD_VISUAL_SKINS");
  const cutoutEntry = sourceForRegistryEntry(registry, "cutout-collage");
  const fieldAsset = cutoutEntry.match(/\bfieldAsset\s*:\s*["']([^"']+)["']/)?.[1];
  assert.equal(
    fieldAsset,
    "./assets/hiccup-head/skins/vintage-magazine-face-fields.webp",
    "all six collage fields must be cells in one project-local image",
  );
  await access(new URL(fieldAsset, root), fsConstants.R_OK);

  assert.match(app, /const\s+MAGAZINE_FACE_FIELD_COLUMNS\s*=\s*3\s*;/);
  assert.match(app, /const\s+MAGAZINE_FACE_FIELD_ROWS\s*=\s*2\s*;/);
  assert.match(app, /const\s+MAGAZINE_FACE_FIELD_COUNT\s*=\s*6\s*;/);
  const orderSource = sourceForNamedArray(app, "MAGAZINE_FACE_FIELD_ORDER");
  const order = [...orderSource.matchAll(/\b([0-5])\b/g)].map(([, value]) => Number(value));
  assert.equal(order.length, 6);
  assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5]);

  const painter = sourceForFunction(app, "drawCutoutCollageBeatField");
  assert.match(painter, /beat\?\.ordinal/);
  assert.match(painter, /ordinal\s*%\s*MAGAZINE_FACE_FIELD_COUNT/);
  assert.match(painter, /naturalWidth\s*\/\s*MAGAZINE_FACE_FIELD_COLUMNS/);
  assert.match(painter, /naturalHeight\s*\/\s*MAGAZINE_FACE_FIELD_ROWS/);
  assert.match(painter, /orderedIndex\s*%\s*MAGAZINE_FACE_FIELD_COLUMNS/);
  assert.match(painter, /Math\.floor\(orderedIndex\s*\/\s*MAGAZINE_FACE_FIELD_COLUMNS\)/);
  assert.match(painter, /context\.drawImage\s*\(/);
  assert.doesNotMatch(
    painter,
    /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now|new\s+Image|createElement/,
  );

  const prime = sourceForFunction(app, "primeVisualSkinAsset");
  assert.match(prime, /visualSkinFieldAssets/);
  assert.match(prime, /skin\.fieldAsset/);
  const face = sourceForFunction(app, "drawFace");
  assert.match(
    face,
    /visualSkin\.id\s*===\s*["']cutout-collage["']\s*&&\s*skinFieldAsset[\s\S]{0,140}?drawCutoutCollageBeatField\s*\(/,
  );

  const beatFrame = sourceForFunction(app, "visualSkinBeatFrame");
  assert.match(beatFrame, /ordinal\s*:\s*seededOrdinal/);
  const flush = sourceForFunction(app, "flushVisualQueue");
  assert.match(flush, /visualBeatOrdinal\s*=\s*Number\.isInteger\(event\.ordinal\)/);
  assert.match(flush, /visualBeatStartedAt\s*=\s*event\.due/);
});

test("the 1904 atlas uses its measured visual head center as an explicit anchor", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const anchorsStart = app.indexOf("const SKIN_ATLAS_PART_ANCHORS");
  const anchorsEnd = app.indexOf("function drawSkinAtlasPart", anchorsStart);
  assert.ok(anchorsStart >= 0 && anchorsEnd > anchorsStart);
  const anchors = app.slice(anchorsStart, anchorsEnd);
  assert.match(anchors, /["']photo-1904["']/);
  assert.match(anchors, /\[SKIN_ATLAS_PART\.head\]/);
  assert.match(anchors, /\bx\s*:\s*135\s*\/\s*256/);
  assert.match(anchors, /\by\s*:\s*132\.5\s*\/\s*256/);

  const renderer = sourceForFunction(app, "drawSkinAtlasPart");
  assert.match(renderer, /SKIN_ATLAS_PART_ANCHORS\[visualSkinId\]\?\.\[part\]/);
  assert.match(renderer, /x\s*-\s*\(partAnchor\.x\s*-\s*0\.5\)\s*\*\s*width/);
  assert.match(renderer, /y\s*-\s*\(partAnchor\.y\s*-\s*0\.5\)\s*\*\s*height/);

  const face = sourceForFunction(app, "drawFace");
  assert.match(
    face,
    /drawSkinAtlasPart\(context,\s*skinAtlas,\s*SKIN_ATLAS_PART\.head,\s*cx,\s*cy,/,
    "the atlas anchor, not an ad-hoc layout shift, must center the 1904 head",
  );
});

test("atlas border scraps are cropped without rescaling the noses or hair", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const insetsStart = app.indexOf("const SKIN_ATLAS_SOURCE_INSETS");
  const insetsEnd = app.indexOf("function drawSkinAtlasPart", insetsStart);
  assert.ok(insetsStart >= 0 && insetsEnd > insetsStart);
  const insets = app.slice(insetsStart, insetsEnd);
  assert.match(insets, /"cutout-collage"[\s\S]*?SKIN_ATLAS_PART\.nose[\s\S]*?top[\s\S]*?SKIN_ATLAS_PART\.hair[\s\S]*?top/);
  assert.match(insets, /"food-portrait"[\s\S]*?SKIN_ATLAS_PART\.nose[\s\S]*?top[\s\S]*?SKIN_ATLAS_PART\.hair[\s\S]*?bottom/);

  const renderer = sourceForFunction(app, "drawSkinAtlasPart");
  assert.match(renderer, /SKIN_ATLAS_SOURCE_INSETS\[visualSkinId\]/);
  assert.match(renderer, /\(column \+ insetLeft\) \* sourceWidth/);
  assert.match(renderer, /-width \* 0\.5 \+ width \* insetLeft/);
  assert.match(renderer, /-height \* 0\.5 \+ height \* insetTop/);
});

test("changing a skin cannot write audio, model, voice, pattern, or scheduler state", async () => {
  const [app, model, processor] = await Promise.all([
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  const setter = sourceForFunction(app, "setVisualSkin");

  const forbiddenSetterWork = [
    /\bstate\s*(?:=|\.)/,
    /\b(?:audioContext|graph|voiceSlots|faceEffectEnabled)\b/,
    /\bpattern\s*(?:=|\[|\.)/,
    /\bsequence(?:Step|Playing|Length)\s*(?:=|\+\+|--|\.)/,
    /\b(?:postConfiguration|scheduleSequence|setCurrentPattern|setPreset|triggerSound)\s*\(/,
    /\.port\.postMessage\s*\(/,
  ];
  for (const forbidden of forbiddenSetterWork) assert.doesNotMatch(setter, forbidden);

  const audioSources = `${model}\n${processor}`;
  assert.doesNotMatch(audioSources, /\b(?:visualSkin|visual-skin)\b/i);
  for (const id of EXPECTED_SKIN_IDS.slice(1)) {
    assert.equal(audioSources.includes(id), false, `${id} must stay out of the audio model`);
  }
});

test("webcam cut-up is an accessible explicit-consent dialog with visible privacy terms", async () => {
  const html = await readFile(new URL("hiccup-head.html", root), "utf8");
  const requiredIds = [
    "openWebcamSkinButton", "webcamSkinDialog", "webcamSkinTitle",
    "webcamSkinIntro", "webcamSkinPrivacy", "webcamSkinPreview",
    "webcamSkinVideo", "webcamSkinFrame", "webcamSkinGuides",
    "webcamGuideSelect", "webcamGuideSize", "webcamSkinStatus",
    "webcamSkinError", "startWebcamButton", "freezeWebcamButton",
    "retakeWebcamButton", "useWebcamSkinButton", "forgetWebcamSkinButton",
    "closeWebcamSkinButton",
  ];
  for (const id of requiredIds) {
    assert.ok(openingTagById(html, id), `${id} must be present`);
  }

  const opener = openingTagById(html, "openWebcamSkinButton");
  assert.equal(attribute(opener, "aria-haspopup"), "dialog");
  assert.equal(attribute(opener, "aria-controls"), "webcamSkinDialog");
  assert.match(attribute(opener, "aria-label"), /webcam|camera|photo/i);

  const dialog = openingTagById(html, "webcamSkinDialog");
  assert.match(dialog, /^<dialog\b/i);
  assert.equal(attribute(dialog, "aria-labelledby"), "webcamSkinTitle");
  const describedBy = attribute(dialog, "aria-describedby").split(/\s+/);
  assert.ok(describedBy.includes("webcamSkinIntro"));
  assert.ok(describedBy.includes("webcamSkinPrivacy"));

  const privacyTag = openingTagById(html, "webcamSkinPrivacy");
  const privacy = elementTextById(html, "webcamSkinPrivacy");
  assert.doesNotMatch(privacyTag, /\bhidden\b|\bsr-only\b/i, "privacy terms must be visible");
  assert.match(privacy, /(?:this\s+)?tab|session/i);
  assert.match(privacy, /never\s+(?:be\s+)?uploaded|not\s+uploaded/i);
  assert.match(privacy, /never\s+(?:be\s+)?saved|not\s+saved|reload(?:ing)?[^.]*removes?/i);
  assert.match(
    `${elementTextById(html, "webcamSkinIntro")} ${elementTextById(html, "startWebcamButton")}`,
    /start[^.]*camera|camera[^.]*start/i,
    "the camera must be presented as an explicit user action",
  );

  const video = openingTagById(html, "webcamSkinVideo");
  assert.match(video, /\bautoplay\b/i);
  assert.match(video, /\bmuted\b/i);
  assert.match(video, /\bplaysinline\b/i);
  assert.match(attribute(video, "aria-label"), /mirrored|webcam|camera/i);
  assert.equal(attribute(openingTagById(html, "webcamSkinStatus"), "role"), "status");
  assert.equal(attribute(openingTagById(html, "webcamSkinStatus"), "aria-live"), "polite");
  assert.equal(attribute(openingTagById(html, "webcamSkinError"), "role"), "alert");
});

test("opening or requesting the webcam crosses one narrow audio-silence boundary", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const silence = sourceForFunction(app, "silenceHiccupHeadForWebcam");
  assert.match(
    silence,
    /stopSequence\(\s*(?:false|\{\s*announceState\s*:\s*false\s*\})\s*\)/,
    "camera mode must stop the sequencer without an extra transport announcement",
  );
  for (const node of ["sourceNode", "facePostNode"]) {
    assert.match(
      silence,
      new RegExp(`graph(?:\\?\\.|\\.)${node}(?:\\?\\.|\\.)port\\.postMessage\\s*\\(\\s*\\{\\s*type\\s*:\\s*["']silence["']`),
      `${node} must receive an explicit silence command`,
    );
  }
  assert.match(silence, /clearNativeRoomHistory\s*\(\s*\)/);
  const directSuspend = /audioContext(?:\?\.|\.)suspend(?:\?\.)?\s*\(/.test(silence);
  if (!directSuspend) {
    const alias = silence.match(/const\s+([A-Za-z_$][\w$]*)\s*=\s*audioContext\s*;/)?.[1];
    assert.ok(alias, "the suspended context must be the current audioContext");
    assert.match(
      silence,
      new RegExp(`${alias}(?:\\?\\.|\\.)suspend(?:\\?\\.)?\\s*\\(`),
    );
  }
  assert.doesNotMatch(
    silence,
    /postConfiguration|postStrike|setPreset|setCurrentPattern|disposeAudioGraph|releaseOutput|audioContext(?:\?\.|\.)close|\b(?:state|pattern)\s*=(?!=)/,
    "the isolation boundary may silence and suspend, but must not retune or dispose the instrument",
  );

  const open = sourceForFunction(app, "openWebcamSkinDialog");
  const openSilence = open.indexOf("silenceHiccupHeadForWebcam(");
  const showModal = open.indexOf("showModal(");
  assert.ok(openSilence >= 0 && showModal > openSilence, "audio must be silenced before the modal becomes active");
  assert.doesNotMatch(open, /audioContext|sourceNode|facePostNode|postMessage|postConfiguration|postStrike/);

  const request = sourceForFunction(app, "requestWebcamPreview");
  const requestSilence = request.indexOf("silenceHiccupHeadForWebcam(");
  const getUserMedia = request.indexOf("getUserMedia(");
  assert.ok(requestSilence >= 0 && getUserMedia > requestSilence, "audio must be silenced before camera permission/capture");
  assert.doesNotMatch(
    request,
    /\b(?:graph|audioContext|sourceNode|facePostNode|audioConfiguration|updateNativeFaceEffects|postConfiguration|postStrike)\b|\b(?:state|pattern)\s*=(?!=)/,
    "the request path must cross the named silence helper instead of touching the graph directly",
  );

  const start = sourceForFunction(app, "startSequence");
  const initializeAudio = sourceForFunction(app, "initializeAudio");
  assert.match(start, /await\s+ensureAudio\s*\(\s*\)/);
  assert.match(initializeAudio, /await\s+audioContext\.resume\s*\(\s*\)/);
});

test("webcam permission, mirrored freeze, errors, and track cleanup are explicit and bounded", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const request = sourceForFunction(app, "requestWebcamPreview");
  assert.match(request, /navigator\.mediaDevices\?\.getUserMedia/);
  assert.match(request, /navigator\.mediaDevices\.getUserMedia\s*\(\s*\{[\s\S]*?audio\s*:\s*false/);
  assert.match(request, /video\s*:\s*\{[\s\S]*?facingMode\s*:\s*\{\s*ideal\s*:\s*["']user["']/);
  assert.match(request, /generation\s*!==\s*webcamRequestGeneration/);
  assert.match(request, /!webcamDialogIsOpen\(\)[\s\S]{0,100}?stopMediaTracks\(stream\)/);
  const appWithoutRequest = app.slice(0, app.indexOf(request))
    + app.slice(app.indexOf(request) + request.length);
  assert.doesNotMatch(
    appWithoutRequest,
    /\bgetUserMedia\b/,
    "permission probing and requests must remain inside requestWebcamPreview",
  );

  for (const name of ["initialize", "openWebcamSkinDialog", "setVisualSkin"]) {
    assert.doesNotMatch(sourceForFunction(app, name), /getUserMedia|requestWebcamPreview/);
  }
  const bindings = sourceForFunction(app, "bindWebcamPhotoBooth");
  assert.match(bindings, /startWebcamButton[\s\S]{0,100}?addEventListener\(["']click["'],\s*requestWebcamPreview\)/);
  assert.match(bindings, /retakeWebcamButton[\s\S]{0,100}?addEventListener\(["']click["'],\s*requestWebcamPreview\)/);

  const freeze = sourceForFunction(app, "freezeWebcamFrame");
  assert.equal((freeze.match(/\.drawImage\s*\(/g) ?? []).length, 1, "Freeze must copy exactly one frame");
  assert.match(freeze, /translate\(size,\s*0\)[\s\S]{0,80}?scale\(-1,\s*1\)/);
  assert.ok(freeze.indexOf("stopWebcamStream(") > freeze.indexOf(".drawImage("));
  assert.doesNotMatch(freeze, /requestAnimationFrame|setInterval|setTimeout|MediaRecorder/);

  const stopTracks = sourceForFunction(app, "stopMediaTracks");
  assert.match(stopTracks, /stream\?\.getTracks\?\.\(\)/);
  assert.match(stopTracks, /track\.stop\(\)/);
  const stopStream = sourceForFunction(app, "stopWebcamStream");
  assert.match(stopStream, /stopMediaTracks\(webcamStream\)/);
  assert.match(stopStream, /stopMediaTracks\(video\.srcObject\)/);
  assert.match(stopStream, /video\.srcObject\s*=\s*null/);
  for (const name of ["closeWebcamSkinDialog", "forgetWebcamSkin"]) {
    assert.match(sourceForFunction(app, name), /stopWebcamStream\s*\(/);
  }

  const errors = sourceForFunction(app, "friendlyWebcamError");
  for (const errorName of ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError"]) {
    assert.match(errors, new RegExp(`["']${errorName}["']`));
  }
  assert.match(request, /webcamPhase\s*=\s*["']error["']/);
  assert.match(request, /setWebcamError\s*\(/);
});

test("webcam pixels become one session-only atlas and never enter storage, upload, or frame loops", async () => {
  const [html, app, model, processor] = await Promise.all([
    readFile(new URL("hiccup-head.html", root), "utf8"),
    readFile(new URL("hiccup-head-app.js", root), "utf8"),
    readFile(new URL("src/hiccup-head.js", root), "utf8"),
    readFile(new URL("src/hiccup-head-processor.js", root), "utf8"),
  ]);
  const ephemeralStart = app.indexOf("const WEBCAM_CUTUP_VISUAL_SKIN");
  const ephemeralEnd = app.indexOf("const VISUAL_SKIN_STORAGE_KEY", ephemeralStart);
  assert.ok(ephemeralStart >= 0 && ephemeralEnd > ephemeralStart);
  const ephemeral = app.slice(ephemeralStart, ephemeralEnd);
  assert.match(ephemeral, /id\s*:\s*["']webcam-cutup["']/);
  assert.match(ephemeral, /sessionOnly\s*:\s*true/);

  const initialSelect = html.match(/<select\b[^>]*\bid="visualSkinSelect"[^>]*>[\s\S]*?<\/select>/i)?.[0] ?? "";
  assert.ok(initialSelect);
  assert.doesNotMatch(initialSelect, /<option\b[^>]*\bvalue="webcam-cutup"/i);
  const option = sourceForFunction(app, "ensureWebcamSkinOption");
  assert.match(option, /document\.createElement\(["']option["']\)/);
  assert.match(option, /WEBCAM_CUTUP_VISUAL_SKIN\.id/);

  const apply = sourceForFunction(app, "applyWebcamSkin");
  assert.match(apply, /const\s+atlas\s*=\s*buildWebcamSkinAtlas\(\)/);
  assert.match(apply, /visualSkinById\.set\(WEBCAM_CUTUP_VISUAL_SKIN\.id/);
  assert.match(apply, /visualSkinAssets\.set\([\s\S]{0,100}?\{\s*image\s*:\s*atlas,\s*ready\s*:\s*true\s*\}/);
  assert.match(apply, /ensureWebcamSkinOption\(\)/);
  assert.match(apply, /setVisualSkin\([\s\S]{0,100}?persist\s*:\s*false/);
  assert.equal(
    (app.match(/\bbuildWebcamSkinAtlas\s*\(/g) ?? []).length,
    2,
    "the frozen pixels must be assembled once on Apply, not rebuilt in drawStage",
  );

  const captureHelpers = [
    "freezeWebcamFrame", "drawWebcamCrop",
    "paintWebcamAtlasPart", "paintWebcamHeadMosaic", "buildWebcamSkinAtlas",
    "applyWebcamSkin",
  ].map((name) => sourceForFunction(app, name)).join("\n");
  assert.doesNotMatch(
    captureHelpers,
    /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon|MediaRecorder|toDataURL|toBlob|indexedDB|localStorage|sessionStorage|graph|audioContext|facePostNode|sourceNode|audioConfiguration|updateNativeFaceEffects|voiceSlots|postConfiguration|postStrike|setPreset|setCurrentPattern)\b|\.port\.postMessage\s*\(|\b(?:state|pattern)\s*=(?!=)/i,
  );
  assert.doesNotMatch(`${model}\n${processor}`, /webcam|mediaStream|getUserMedia/i);

  const setter = sourceForFunction(app, "setVisualSkin");
  assert.match(setter, /persist\s*&&\s*nextId\s*!==\s*["']webcam-cutup["']/);
  const stored = sourceForFunction(app, "storedVisualSkinId");
  assert.match(stored, /stored\s*===\s*["']webcam-cutup["']\s*\?\s*["']checker["']/);

  const drawStage = sourceForFunction(app, "drawStage");
  const nextFrame = drawStage.indexOf("requestAnimationFrame(drawStage)");
  const flush = drawStage.indexOf("flushVisualQueue(now)");
  const cameraGuard = drawStage.indexOf("if (webcamDialogIsOpen()) return");
  const firstStagePaint = drawStage.indexOf("drawBackground(");
  assert.ok(
    nextFrame >= 0 && flush > nextFrame && cameraGuard > flush && firstStagePaint > cameraGuard,
    "the visual queue must keep advancing before camera-dialog stage paint is skipped",
  );
  assert.doesNotMatch(
    drawStage,
    /buildWebcamSkinAtlas|paintWebcam|webcamSkinVideo|webcamSkinFrame|drawWebcamCrop/,
  );
});

test("webcam head mosaic preserves row bands and wide feature crops", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const mosaic = sourceForFunction(app, "paintWebcamHeadMosaic");
  assert.match(mosaic, /const\s+divisions\s*=\s*4\s*;/);
  const permutationSource = sourceForNamedArray(mosaic, "permutation");
  const permutation = [...permutationSource.matchAll(/\b(\d+)\b/g)]
    .map(([, value]) => Number(value));
  assert.equal(permutation.length, 16, "the 4 by 4 head mosaic needs one source for every target cell");
  assert.deepEqual(
    [...permutation].sort((a, b) => a - b),
    Array.from({ length: 16 }, (_, index) => index),
    "the mosaic must be a true permutation rather than duplicating facial cells",
  );
  for (const [targetIndex, sourceIndex] of permutation.entries()) {
    assert.equal(
      Math.floor(sourceIndex / 4),
      Math.floor(targetIndex / 4),
      `mosaic target ${targetIndex} must source from the same facial row band`,
    );
  }
  assert.match(mosaic, /sourceRow\s*=\s*Math\.floor\(sourceIndex\s*\/\s*divisions\)/);
  assert.match(mosaic, /targetRow\s*=\s*Math\.floor\(target\s*\/\s*divisions\)/);
  assert.match(mosaic, /sourceRect\.y\s*\+\s*sourceRow\s*\*\s*sourceTileHeight/);
  assert.match(mosaic, /dy\s*=\s*targetRow\s*\*\s*tileSize/);
  assert.doesNotMatch(mosaic, /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now/);

  const build = sourceForFunction(app, "buildWebcamSkinAtlas");
  for (const part of ["lips", "hair"]) {
    const call = sourceForCallContaining(build, "paintWebcamAtlasPart", `SKIN_ATLAS_PART.${part}`);
    assert.match(
      call,
      /\{\s*preserveWholeCrop\s*:\s*true\s*\}/,
      `${part} must retain the complete wide guide crop when packed into the atlas`,
    );
  }

  const crop = sourceForFunction(app, "drawWebcamCrop");
  const wholeCropStart = crop.indexOf("if (preserveWholeCrop)");
  const coverCropStart = crop.indexOf("const sourceRatio", wholeCropStart);
  assert.ok(wholeCropStart >= 0 && coverCropStart > wholeCropStart);
  const wholeCropBranch = crop.slice(wholeCropStart, coverCropStart);
  for (const edge of ["x", "y", "width", "height"]) {
    assert.match(wholeCropBranch, new RegExp(`sourceRect\\.${edge}`));
  }
  assert.match(wholeCropBranch, /context\.drawImage\s*\(/);
  assert.match(wholeCropBranch, /\breturn\s*;/);
});

test("webcam mouth paints one full photographed oval over a smaller cavity", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  const face = sourceForFunction(app, "drawFace");
  assert.match(face, /const\s+webcamSkin\s*=\s*visualSkin\.id\s*===\s*["']webcam-cutup["']/);
  const branchStart = face.indexOf("if (webcamSkin && atlasReady");
  const branchEnd = face.indexOf("} else if (atlasReady", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart, "the webcam mouth needs a dedicated atlas branch");
  const webcamMouth = face.slice(branchStart, branchEnd);

  const fullEllipse = webcamMouth.search(
    /context\.ellipse\(\s*cx,\s*mouthY,\s*mouthWidth,\s*liveOpening,\s*0,\s*0,\s*Math\.PI\s*\*\s*2\s*\)/,
  );
  const clip = webcamMouth.indexOf("context.clip()", fullEllipse);
  const lips = webcamMouth.indexOf("SKIN_ATLAS_PART.lips", clip);
  assert.ok(fullEllipse >= 0 && clip > fullEllipse && lips > clip, "the lip photo must be clipped to the complete live mouth ellipse");

  const lipsCall = sourceForCallContaining(webcamMouth, "drawSkinAtlasPart", "SKIN_ATLAS_PART.lips");
  const photographedWidthScale = Number(lipsCall.match(/mouthWidth\s*\*\s*(\d+(?:\.\d+)?)/)?.[1]);
  const photographedHeightScale = Number(lipsCall.match(/liveOpening\s*\*\s*(\d+(?:\.\d+)?)/)?.[1]);
  assert.ok(photographedWidthScale >= 2, "the photographed lips must span the mouth diameter");
  assert.ok(photographedHeightScale >= 2, "the photographed lips must span the mouth height");

  const afterLips = webcamMouth.slice(webcamMouth.indexOf(lipsCall) + lipsCall.length);
  const cavity = afterLips.match(
    /context\.ellipse\(\s*cx,\s*mouthY(?:\s*\+[^,]+)?,\s*mouthWidth\s*\*\s*(\d+(?:\.\d+)?),\s*Math\.max\(\s*1,\s*liveOpening\s*\*\s*(\d+(?:\.\d+)?)\s*\)/,
  );
  assert.ok(cavity, "the webcam mouth must redraw a distinct inner cavity after the lip photo");
  assert.ok(Number(cavity[1]) > 0 && Number(cavity[1]) < 1, "the cavity must be narrower than the mouth");
  assert.ok(Number(cavity[2]) > 0 && Number(cavity[2]) < 1, "the cavity must be shorter than the mouth");

  assert.doesNotMatch(
    webcamMouth,
    /\b(?:audioContext|graph|sourceNode|facePostNode|audioConfiguration|voiceSlots|postConfiguration|postStrike|scheduleSequence|triggerSound)\b|\.port\.postMessage\s*\(/,
  );
  assert.doesNotMatch(
    webcamMouth,
    /\b(?:handles|hotspots|toothTines|toothGapGeometry|tongueTipGeometry|handGeometry|earGeometry)\b/,
    "the visual mouth composite must not replace shared interaction geometry",
  );
  assert.doesNotMatch(
    webcamMouth,
    /\b(?:pose|layout)\.[A-Za-z_$][\w$]*\s*(?:=|\+=|-=|\*=|\/=)|\b(?:mouthWidth|liveOpening)\s*(?:=|\+=|-=|\*=|\/=)/,
  );
});

test("face presets, face mutation, and resets preserve the selected visual skin", async () => {
  const app = await readFile(new URL("hiccup-head-app.js", root), "utf8");
  for (const name of ["setPreset", "randomizeFace", "resetAll", "resetFaceEffects"]) {
    const body = sourceForFunction(app, name);
    assert.doesNotMatch(body, /\b(?:visualSkinId|HICCUP_HEAD_VISUAL_SKINS|visualSkinSelect)\b/);
    assert.doesNotMatch(body, /\bsetVisualSkin\s*\(/);
  }
});
