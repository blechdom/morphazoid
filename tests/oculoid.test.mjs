import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import * as THREE from "../vendor/three/three.module.min.js";
import { restoreGlobuleDamacySite } from "./helpers/globule-damacy-site-reference.mjs";
import { oculoidSiteChanges, restoreOculoidSite } from "./helpers/oculoid-site-reference.mjs";
import { restoreWitchesBrewRefresh } from "./helpers/witches-brew-refresh-reference.mjs";
import { witchSiteChanges } from "./helpers/witch-site-reference.mjs";
import { OculoidDsp } from "../src/instruments/oculoid/oculoid-dsp.js";
import { OculoidMidiState } from "../src/instruments/oculoid/oculoid-midi.js";
import { instrumentById } from "../src/site/instrument-catalog.js";
import { instrumentMidiCapabilityForId } from "../src/site/instrument-midi-capabilities.js";
import { TAP_TEMPO_TARGETS } from "../src/site/tap-tempo-targets.js";
import {
  boundedEyeTurn, canthusRecessPoint, colorizeIrisPixels, eyeClusterLayout, eyeEnsemblePose,
  eyeballPatternShade,
  GLOBE_HULL_RADIUS, GLOBE_SQUASH,
  hexEyeColor, LID_PATCH_X, LID_SHELL_RADIUS, MAX_EYE_TURN,
  oculoidPokeContact, oculoidPokeDisplacement, OCULOID_POKE_HOME, stepOculoidPoke,
  boundedOculoidStretch, oculoidStretchWeight,
  normalizeOculoidSurface, OCULOID_SURFACE_DEFAULTS, OCULOID_SURFACE_RANGES,
  eyePoseWithRetractor, stepOculoidElastic,
  oculoidFlashlightExposure, oculoidLitPupil,
  OCULOID_APPEARANCE_DEFAULTS, OCULOID_CRY_TEMPO_RANGE, OCULOID_DEFAULTS, OCULOID_IRIS_COLORS,
  OCULOID_IRIS_PATTERNS, OCULOID_LIGHT_DEFAULTS, OCULOID_LIGHT_PATTERNS, OCULOID_LIGHT_RANGES,
  OCULOID_EYE_COUNTS, OCULOID_EYEBALL_STYLES, OCULOID_EYELID_STYLES, OCULOID_ENSEMBLES,
  OCULOID_RANGES, OCULOID_SCLERA_COLORS, OCULOID_SCLERA_PATTERNS,
  OCULOID_SKIN_FINISHES, OCULOID_SKIN_PATTERNS,
  eyePose, eyeSoundTargets, globeHullDepth,
  lashPoint, lashShape, lidCameraDistance, lidEdge, lidLipPoint, lidPatchPoint,
  lidPatternShade, lidShellNormal, lidSurfaceDepth, normalizeOculoid, normalizeOculoidEnsemble,
  oculoidSonicWardrobe, normalizeOculoidLighting,
  oculoidLightPosition, TEAR_CYCLE_BEATS, TEAR_DROP_SCALE, TEAR_RELEASE_BEAT,
  TEAR_TIP_HEIGHT, tearDropMotion, tearDropPose,
} from "../src/instruments/oculoid/oculoid-model.js";
import { OCULOID_PRESETS, randomizeOculoid, randomOculoidStyle,
} from "../src/instruments/oculoid/oculoid-presets.js";
import {
  bendTearAwayFromLid, buildBackShellGeometry, buildCanthusRecess, buildLidSideCap, buildSkinPatch,
  createFallbackTearGeometry, createOculoidPokeDeformer,
  bindEyeballPatternCoordinates, setOculoidSkinFinish,
  writeCanthusRecess, writeSkinPatch,
} from "../src/instruments/oculoid/oculoid-viewer.js";
import { createOculoidWardrobe, eyewearPose, scarfPose, toothPose, tonguePose,
  OCULOID_HAIRCUTS, OCULOID_HATS, OCULOID_WARDROBE_DEFAULTS,
} from "../src/instruments/oculoid/oculoid-wardrobe.js";

const note = (type, n, velocity = 100, sourceId = "keyboard", channel = 0) =>
  ({ type, note: n, velocity, sourceId, channel });
const cc = (controller, value, sourceId = "keyboard", channel = 0) =>
  ({ type: "controlChange", controller, value, sourceId, channel });

test("chrome studio is visual-only, bounded, and both lights orbit the eye independently", () => {
  const original = normalizeOculoidLighting();
  assert.deepEqual(original, OCULOID_LIGHT_DEFAULTS);
  assert.equal(original.finish, "chrome");
  assert.equal(original.keyBrightness, 1);
  assert.deepEqual(OCULOID_LIGHT_RANGES.keyBrightness, [0, 2]);
  assert.equal(Object.keys(OCULOID_LIGHT_RANGES).length, 6);
  const limited = normalizeOculoidLighting({
    keyAzimuth: 1000, keyElevation: -1000, fillAzimuth: -Infinity,
    fillElevation: "30", keyBrightness: -7, reflection: 3,
    finish: "matte", pattern: "plaid", lightPattern: "checker", color: "#B34E72",
  });
  assert.deepEqual(limited, {
    finish: "matte", color: "#b34e72", pattern: "plaid", lightPattern: "checker",
    keyAzimuth: 140, keyElevation: -75, fillAzimuth: original.fillAzimuth,
    fillElevation: 30, keyBrightness: 0, reflection: 2,
  });
  assert.equal(normalizeOculoidLighting({ keyBrightness: 9 }).keyBrightness, 2);
  assert.equal(normalizeOculoidLighting({ keyBrightness: NaN }).keyBrightness, 1);
  assert.deepEqual(normalizeOculoidLighting({ finish: "invalid" }), original);
  assert.deepEqual(normalizeOculoidLighting({ pattern: "invalid" }), original);
  assert.deepEqual(normalizeOculoidLighting({ color: "bad", reflection: NaN }), original);
  assert.equal(normalizeOculoidLighting({ customColor: "#47edac" }).color, "#47edac",
    "older in-memory chrome colors remain valid after separating finish and color");
  assert.deepEqual(normalizeOculoidLighting({ lightPattern: "invalid" }), original);
  assert.deepEqual(OCULOID_LIGHT_PATTERNS, ["none", "checker", "dots", "stripes", "ripples"]);
  assert.deepEqual(OCULOID_SKIN_PATTERNS, ["solid", "stripes", "plaid", "dots", "checker"]);
  assert.deepEqual(OCULOID_SKIN_FINISHES.map(item => item.id), [
    "chrome", "matte", "wet", "gooey", "clumpy",
  ]);
  assert.ok(Object.keys(OCULOID_DEFAULTS).every(key => !(key in original)),
    "light positions, brightness and finish must not enter full musical presets or audio");
  assert.deepEqual(normalizeOculoid({ ...OCULOID_DEFAULTS, ...original }), OCULOID_DEFAULTS);
  for (const [yaw, pitch, radius] of [[-140, 75, 7], [140, -75, 6], [0, 0, 7]]) {
    const point = oculoidLightPosition(yaw, pitch, radius);
    assert.ok(point.every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(...point) - radius) < 1e-12);
    assert.equal(Math.sign(point[0]), Math.sign(yaw));
    assert.equal(Math.sign(point[1]), Math.sign(pitch));
  }
  assert.deepEqual(oculoidLightPosition(Infinity, NaN, -2), [0, 0, 0.01]);
});

test("a visible iris hit bounds the flashlight reflex without changing the manual pupil", () => {
  assert.equal(oculoidFlashlightExposure(null), 0);
  assert.equal(oculoidFlashlightExposure({ x: NaN, y: 0, z: 1 }), 0);
  assert.equal(oculoidFlashlightExposure({ x: 0, y: 0, z: 1 }), 1);
  assert.equal(oculoidFlashlightExposure({ x: 0.44, y: 0, z: 0.9 }) > 0, true);
  assert.equal(oculoidFlashlightExposure({ x: 0.56, y: 0, z: 0.8 }), 0);
  assert.equal(oculoidFlashlightExposure({ x: 0, y: 0, z: -1 }), 0);
  assert.equal(oculoidLitPupil(0.42, 0), 0.42);
  assert.ok(oculoidLitPupil(0.42, 0.8) < 0.15);
  assert.ok(oculoidLitPupil(0.42, 1) > 0.05);
  assert.equal(oculoidLitPupil(0.42, Infinity), 0.42);
  assert.ok(Math.abs(oculoidLitPupil(2, 2) - 0.16) < 1e-12);
  assert.equal(oculoidLitPupil(0, 1), 0);
  assert.equal(Object.keys(normalizeOculoid({ flashlightExposure: 1 })).includes("flashlightExposure"), false,
    "Flash and studio lights must never be saved as musical preset parameters");
});

test("chrome, matte, wet, gooey and clumpy take any tint without coloring the socket", () => {
  const shell = Object.fromEntries(["front", "back", "rim", "lining"].map(part =>
    [part, new THREE.MeshPhysicalMaterial({ color: 0x704b33 })]));
  const socket = new THREE.MeshBasicMaterial({ color: 0x030306, side: THREE.BackSide });
  const original = { ...shell };
  try {
    setOculoidSkinFinish(shell, "chrome");
    const baseReflection = shell.front.envMapIntensity;
    for (const [part, material] of Object.entries(shell)) {
      assert.equal(material, original[part], "finish must not replace or leak shell materials");
      assert.equal(material.metalness, 1);
      assert.ok(material.roughness >= 0.1 && material.roughness <= 0.18,
        "chrome retains a smooth metal finish without hard-edged mirror cards");
      assert.ok(material.envMapIntensity > 1);
      assert.equal(material.bumpScale, 0, "no pores should break the mirror surface");
    }
    setOculoidSkinFinish(shell, "chrome", 0);
    assert.ok(shell.front.envMapIntensity < baseReflection);
    assert.ok(shell.front.envMapIntensity > 0,
      "turning off the key leaves some environment/fill reflection");
    setOculoidSkinFinish(shell, "chrome", 2);
    assert.ok(shell.front.envMapIntensity > baseReflection);
    setOculoidSkinFinish(shell, "chrome", 1, "#ef3981", 0.3);
    assert.equal(shell.front.color.getHexString(), "ef3981");
    assert.equal(shell.back.color.getHexString(), "ef3981");
    assert.equal(shell.lining.color.getHexString(), "ef3981");
    assert.equal(shell.front.metalness, 1);
    assert.ok(shell.front.envMapIntensity < baseReflection);
    setOculoidSkinFinish(shell, "chrome", 1, "#ef3981", 0);
    assert.equal(shell.front.envMapIntensity, 0);
    assert.equal(shell.front.color.getHexString(), "ef3981",
      "reflection can dim without changing the custom tint");
    setOculoidSkinFinish(shell, "chrome", 1, "invalid", 2);
    assert.equal(shell.front.color.getHexString(), "f2f1ef");
    assert.ok(shell.front.envMapIntensity > baseReflection);
    setOculoidSkinFinish(shell, "chrome", 1);
    assert.equal(shell.front.color.getHex(), shell.back.color.getHex(),
      "the back/front join must reflect the same tint");
    assert.equal(shell.lining.emissive.getHex(), 0);
    assert.equal(socket.color.getHex(), 0x030306);
    setOculoidSkinFinish(shell, "matte", 1, "#704b33");
    for (const material of Object.values(shell)) {
      assert.equal(material.color.getHex(), 0x704b33);
      assert.equal(material.metalness, 0);
      assert.equal(material.roughness, 0.99);
      assert.equal(material.envMapIntensity, 0);
    }
    assert.equal(shell.lining.emissive.getHex(), 0x704b33);
    assert.equal(shell.lining.emissiveIntensity, 0.65);
    assert.equal(socket.color.getHex(), 0x030306, "the cavity never takes the skin finish");
    for (const finish of OCULOID_SKIN_FINISHES) {
      setOculoidSkinFinish(shell, finish.id, 1, "#b94a75");
      assert.equal(shell.front.color.getHexString(), "b94a75", `${finish.id} keeps the picked tint`);
      assert.equal(shell.back.color.getHexString(), "b94a75", "front and back use the same tint");
      assert.equal(shell.rim.metalness, Number(finish.metal));
      assert.equal(socket.color.getHex(), 0x030306);
    }
    setOculoidSkinFinish(shell, "wet", 1, "#b94a75");
    assert.equal(shell.front.clearcoat, 1);
    assert.ok(shell.front.roughness < 0.25 && shell.front.envMapIntensity > 0);
    setOculoidSkinFinish(shell, "gooey", 1, "#b94a75");
    assert.ok(shell.front.clearcoat > 0.9 && shell.front.roughness > 0.3);
    assert.ok(shell.front.bumpScale > 0.01);
    setOculoidSkinFinish(shell, "clumpy", 1, "#b94a75");
    assert.ok(shell.front.roughness > 0.7 && shell.front.bumpScale > 0.02);
    assert.ok(shell.front.clearcoat < 0.2);
    setOculoidSkinFinish(shell, "chrome", 1, "#b94a75");
    assert.equal(shell.front.clearcoat, 0, "finish changes must release the wet coat");
    assert.equal(shell.front.bumpScale, 0);
  } finally {
    for (const material of Object.values(shell)) material.dispose();
    socket.dispose();
  }
});

test("visual-only iris palettes preserve the licensed texture fibers and transparent pixels", () => {
  assert.deepEqual(OCULOID_APPEARANCE_DEFAULTS,
    { eyeLook: "textured", irisColor: "violet", irisPattern: "natural",
      scleraColor: "pearl", scleraPattern: "solid", scleraPatternColor: "#35274e" });
  assert.deepEqual(normalizeOculoid({ ...OCULOID_DEFAULTS, ...OCULOID_APPEARANCE_DEFAULTS }),
    OCULOID_DEFAULTS, "the default palette is visual-only");
  assert.equal(OCULOID_IRIS_COLORS.length, 13);
  assert.equal(new Set(OCULOID_IRIS_COLORS.map(option => option.id)).size, 13);
  assert.equal(new Set(OCULOID_IRIS_COLORS.map(option => option.swatch)).size, 13);
  assert.equal(OCULOID_IRIS_COLORS[0].id, "original");
  assert.deepEqual(OCULOID_IRIS_PATTERNS, ["natural", "stripes", "rings", "dots"]);
  assert.deepEqual(OCULOID_SCLERA_PATTERNS, ["solid", "dots", "stripes", "checker"]);
  assert.deepEqual(OCULOID_SCLERA_COLORS.map(option => option.id),
    ["natural", "ivory", "rose", "pearl", "ink", "orchid", "mint", "cobalt", "coral"]);
  assert.equal(OCULOID_SCLERA_COLORS[0].tint, 0xffffff);
  assert.ok(OCULOID_IRIS_COLORS.some(option => option.id === OCULOID_APPEARANCE_DEFAULTS.irisColor));
  assert.ok(OCULOID_SCLERA_COLORS.some(option => option.id === OCULOID_APPEARANCE_DEFAULTS.scleraColor));
  assert.ok(OCULOID_IRIS_COLORS.every(option => !(option.id in OCULOID_DEFAULTS)),
    "appearance is not a musical preset or synthesis parameter");
  const source = Uint8Array.from([0, 0, 0, 0, 75, 120, 80, 127, 230, 250, 235, 255]);
  const copy = Uint8Array.from(source);
  for (const option of OCULOID_IRIS_COLORS.slice(1, 8)) {
    const recolored = colorizeIrisPixels(source, option.swatch);
    assert.ok(recolored instanceof Uint8ClampedArray);
    assert.deepEqual([recolored[3], recolored[7], recolored[11]], [0, 127, 255]);
    for (const channel of [0, 1, 2]) {
      assert.ok(recolored[channel] < recolored[channel + 4]
        && recolored[channel + 4] < recolored[channel + 8],
      "both dark and bright source fibers keep their luminance ordering");
    }
    assert.notDeepEqual(recolored, source);
  }
  assert.deepEqual(source, copy, "the licensed source map is never edited");
  assert.ok(Math.max(...colorizeIrisPixels(source, OCULOID_IRIS_COLORS.at(-1).swatch))
    <= 255, "blackout preserves alpha without recoloring the source");
  assert.equal(hexEyeColor("#fF00a9"), "#ff00a9");
  assert.equal(hexEyeColor("red"), "#9876b8");
  assert.equal(hexEyeColor("#000000ff"), "#9876b8");
  assert.throws(() => colorizeIrisPixels([0, 0, 0, 255], 0x784523), TypeError);
  assert.throws(() => colorizeIrisPixels(new Uint8Array([0, 0, 0]), 0x784523), TypeError);
  assert.throws(() => colorizeIrisPixels(source, -1), TypeError);
  assert.throws(() => colorizeIrisPixels(source, 0xffffff, { pattern: "invalid" }), TypeError);
  // The GLB iris reads the bottom-left high-V 0.268 of its own atlas (flipY=false).
  // Keep every pixel outside it unchanged and prove both styles alter its fibers.
  const atlas = new Uint8Array(64 * 64 * 4);
  for (let i = 0; i < atlas.length; i += 4) atlas.set([75 + i % 67, 90, 110, 210], i);
  const options = { width: 64, atlas: true };
  const plain = colorizeIrisPixels(atlas, 0xff00ff, options);
  const stripes = colorizeIrisPixels(atlas, 0xff00ff, { ...options, pattern: "stripes" });
  const rings = colorizeIrisPixels(atlas, 0xff00ff, { ...options, pattern: "rings" });
  const dots = colorizeIrisPixels(atlas, 0xff00ff, { ...options, pattern: "dots" });
  const sample = (pixels, x, y) => [...pixels.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 4)];
  assert.notDeepEqual(sample(plain, 4, 54), sample(atlas, 4, 54));
  for (const pixels of [plain, stripes, rings, dots]) {
    assert.deepEqual(sample(pixels, 4, 4), sample(atlas, 4, 4));
    assert.deepEqual(sample(pixels, 18, 18), sample(atlas, 18, 18));
    assert.deepEqual(sample(pixels, 60, 60), sample(atlas, 60, 60));
    assert.equal(sample(pixels, 4, 54)[3], 210);
  }
  assert.notDeepEqual(stripes, plain);
  assert.notDeepEqual(rings, stripes);
  assert.notDeepEqual(dots, plain);
  assert.notDeepEqual(dots, rings);
  assert.deepEqual(sample(atlas, 4, 54), [75 + (54 * 64 + 4) * 4 % 67, 90, 110, 210],
    "original atlas stays untouched");
});

test("spherical lid patches meet at identical coordinates for antialiased patterns, without vertex colors", () => {
  const shell = new THREE.MeshPhysicalMaterial();
  const socket = new THREE.MeshBasicMaterial({ color: 0x030306 });
  const upper = buildSkinPatch(true, shell, shell, socket, shell);
  const back = buildBackShellGeometry();
  try {
    for (const blink of [0.04, 1]) {
      writeSkinPatch(upper, blink, -1);
      const frontPositions = upper.mesh.geometry.getAttribute("position");
      const backPositions = back.getAttribute("position");
      for (let slice = 0; slice <= 112; slice += 8) {
        const front = slice * 39 + 38, rear = (slice + 8) * 53;
        for (let channel = 0; channel < 3; channel++) {
          assert.ok(Math.abs(frontPositions.array[front * 3 + channel]
            - backPositions.array[rear * 3 + channel]) < 1e-6,
          "identical surface points cannot split a sphere-local pixel pattern");
        }
      }
    }
    for (const geometry of [upper.mesh.geometry, back])
      assert.equal(geometry.getAttribute("color"), undefined,
        "fragment patterns do not interpolate sparse vertex colors");
    assert.equal(socket.color.getHex(), 0x030306);
    for (const pattern of OCULOID_SKIN_PATTERNS.filter(value => value !== "solid")) {
      const shade = Array.from({ length: 300 }, (_, i) => lidPatternShade(
        Math.cos(i * Math.PI / 150), i % 5 === 0 ? 0 : 0.3,
        Math.sin(i * Math.PI / 150), pattern));
      assert.ok(Math.min(...shade) < 0.5 && Math.max(...shade) > 0.9);
      assert.equal(lidPatternShade(-1, 0.3, 1e-8, pattern),
        lidPatternShade(-1, 0.3, -1e-8, pattern), "the longitude wrap cannot create a side seam");
    }
    assert.equal(lidPatternShade(1, 0, 0, "dots"), 0.16);
    assert.equal(lidPatternShade(Math.cos(0.09), 0, Math.sin(0.09), "dots"), 1,
      "polka dots are now smaller than the earlier 0.15-radian spots");
  } finally {
    upper.mesh.geometry.dispose();
    upper.inside.geometry.dispose();
    back.dispose();
    shell.dispose();
    socket.dispose();
  }
});

test("the original globe coordinates follow deformation without painting vertex colors or the iris", () => {
  const source = new THREE.SphereGeometry(1, 72, 48);
  const positions = source.getAttribute("position");
  const spherePositions = Float32Array.from(positions.array);
  bindEyeballPatternCoordinates(source, spherePositions);
  const clone = source.clone();
  try {
    assert.equal(source.getAttribute("color"), undefined);
    for (const pattern of OCULOID_SCLERA_PATTERNS) {
      assert.ok(!(pattern in OCULOID_DEFAULTS), "pattern is visual only");
      for (const theta of [-Math.PI + 1e-8, Math.PI - 1e-8])
        assert.equal(eyeballPatternShade(Math.cos(theta), 0.2, Math.sin(theta), pattern),
          eyeballPatternShade(-1, 0.2, 0, pattern), "no longitudinal texture seam");
    }
    for (const name of ["oculoidSphere", "oculoidOriginal"]) {
      const attribute = source.getAttribute(name), copied = clone.getAttribute(name);
      assert.equal(attribute.count, positions.count);
      assert.notEqual(attribute.array, copied.array, "each eye owns its original coordinates");
      assert.deepEqual(attribute.array, copied.array);
    }
    positions.setXYZ(2, 10, 11, 12);
    assert.deepEqual([...source.getAttribute("oculoidOriginal").array.slice(6, 9)],
      [...clone.getAttribute("oculoidOriginal").array.slice(6, 9)],
      "Poke never moves the pattern's sphere-local reference");
  } finally {
    source.dispose();
    clone.dispose();
  }
});

test("the twelve exact shared-source additions reverse to captured pre-Oculoid hashes", async () => {
  assert.equal(oculoidSiteChanges.schemaVersion, 1);
  assert.deepEqual(oculoidSiteChanges.changes.map(change => change.file), [
    "src/site/instrument-registry.js", "src/site/instrument-catalog.js",
    "src/site/catalogue-taxonomy.js", "src/site/instrument-midi-capabilities.js",
    "src/site/tap-tempo-targets.js", "src/pages/manifest.js",
    "scripts/site/runtime-files.tsv", "README.md", "docs/THIRD_PARTY_NOTICES.md",
    "docs/tap-tempo-controls.json", "docs/tap-tempo-controls.md",
    "assets/instruments/CATALOGUE_LOGOS.md",
  ]);
  for (const change of oculoidSiteChanges.changes) {
    const source = restoreGlobuleDamacySite(
      restoreWitchesBrewRefresh(
        await readFile(new URL(`../${change.file}`, import.meta.url), "utf8"),
        change.file, { allowRestored: true },
      ),
      change.file, { allowRestored: true },
    );
    const restore = value => restoreOculoidSite(value, change.file);
    const hash = value => createHash("sha256").update(value).digest("hex");
    const restored = restore(source);
    assert.notEqual(source, restored);
    assert.doesNotMatch(restored, /oculoid/);
    let historical = restored;
    // Witch's Tap controls changed *after* the 528ddd4 Oculoid baseline,
    // then were retired. Reconstruct only that exact historical two-control
    // block for this pinned hash, without reintroducing UI controls today.
    const oldWitchTap = {
      "src/site/tap-tempo-targets.js":
        `export const TAP_TEMPO_TARGETS = [
  {"route": "witch.html", "selector": "#speed", "mapping": {"unit": "powerHz", "floor": 0, "span": 1.909859317102744, "exponent": 1}, "title": "Tap one complete cauldron turn"},
  {"route": "witch.html", "selector": "#flightSpeed", "mapping": {"unit": "powerHz", "floor": 1.15, "span": 7.8, "exponent": 1}, "title": "Tap one broom note"},
`,
      "docs/tap-tempo-controls.json":
        `  "confirmed": [
    {"route": "witch", "selector": "#speed", "mapping": {"unit": "powerHz", "floor": 0, "span": 1.909859317102744, "exponent": 1}, "note": "Tap one complete cauldron turn. Audio and Play stay independent.", "source": "src/pages/witch.html"},
    {"route": "witch", "selector": "#flightSpeed", "mapping": {"unit": "powerHz", "floor": 1.15, "span": 7.8, "exponent": 1}, "note": "Tap one broom note. Audio and Play stay independent.", "source": "src/pages/witch.html"},
`,
      "docs/tap-tempo-controls.md":
        "| [Witch](../witch.html) | `#speed` (cauldron turn), `#flightSpeed` (broom note) |\n| [Wobblini]",
    }[change.file];
    if (oldWitchTap) {
      const { before, after } = witchSiteChanges.changes
        .find(item => item.file === change.file).replacements[0];
      assert.equal(historical.split(before).length - 1, 1, change.file);
      assert.equal(historical.includes(after), false, change.file);
      historical = historical.replace(before, () => oldWitchTap);
    }
    assert.equal(hash(historical), change.sha256, change.file);
    assert.equal(change.replacements.length, 1);
    for (const { before, after } of change.replacements) {
      assert.ok(before.length);
      assert.match(after, /oculoid/);
      assert.throws(() => restore(source.replace(after, "")), /exact Oculoid amendment/);
      assert.throws(() => restore(source + after), /exact Oculoid amendment/);
    }
    assert.notEqual(hash(restore(source + "\n// unrelated drift\n")), change.sha256,
      "unrelated metadata edits must not pass a historical hash");
  }
  for (const change of oculoidSiteChanges.changes) {
    const source = await readFile(new URL(`../${change.file}`, import.meta.url), "utf8");
    assert.equal(restoreOculoidSite(restoreOculoidSite(source, change.file), change.file,
      { allowRestored: true }), restoreOculoidSite(source, change.file), change.file);
  }
  assert.equal(restoreOculoidSite(Buffer.from("raw bytes"), "README.md").toString(), "raw bytes");
  assert.equal(restoreOculoidSite("untouched", "unrelated.js"), "untouched");
});

test("the approved new catalogue card and pitched-MIDI classification match the playable eye", async () => {
  const item = instrumentById("oculoid");
  const { additions } = JSON.parse(await readFile(
    new URL("./fixtures/catalogue-oculoid.json", import.meta.url), "utf8",
  ));
  assert.deepEqual(additions, [{
    id: item.id, label: item.label, href: item.href, imageHref: item.imageHref,
    categoryId: "wip", categoryLabel: "Work in Progress", tags: item.tags.slice(1),
  }]);
  assert.equal(item.status, "Work in Progress");
  assert.deepEqual(instrumentMidiCapabilityForId(item.id), {
    id: item.id, midiInput: true, midiInputMode: "universal-control",
    noteMode: "pitched", audioInput: false, midiOutput: false,
    startsAudio: true, computerKeyboardMode: "midi",
  });
  assert.deepEqual(TAP_TEMPO_TARGETS.filter(target => target.route === item.href), [
    { route: item.href, selector: "#tempo", mapping: { unit: "bpm" },
      title: "Tap one eye-motion beat" },
    { route: item.href, selector: "#cryTempo", mapping: { unit: "bpm" },
      title: "Tap one Cry beat (four beats per drop)" },
  ]);
  const { confirmed } = JSON.parse(await readFile(
    new URL("../docs/tap-tempo-controls.json", import.meta.url), "utf8",
  ));
  assert.deepEqual(confirmed.filter(target => target.route === "oculoid"), [{
    route: "oculoid", selector: "#tempo", mapping: { unit: "bpm" },
    note: "One tap per eye-motion beat changes the native Tempo input; repeating LFO styles and Audio remain independent.",
    source: "src/pages/oculoid.html",
  }, {
    route: "oculoid", selector: "#cryTempo", mapping: { unit: "bpm" },
    note: "One tap per tear beat; four beats grow and release each drop. Cry and Tear remain independent of Motion tempo.",
    source: "src/pages/oculoid.html",
  }]);
});

function renderVoice(settings, { seconds = 0.45, enabled = true, playing = false,
  gesture = false, ensemble, wardrobe, lidsVisible = true } = {}) {
  const synth = new OculoidDsp(48000);
  synth.setConfig(settings);
  if (ensemble) synth.setEnsemble(ensemble);
  if (wardrobe) synth.setWardrobe(wardrobe);
  synth.setLidsVisible(lidsVisible);
  synth.enabled = enabled;
  synth.setTransport({ playing, beat: 0, audioTime: 0 });
  const left = new Float32Array(Math.floor(48000 * seconds));
  const right = new Float32Array(left.length);
  let moved = false;
  // AudioWorklet calls the DSP with 128 samples. Rendering a single 0.45s
  // block would skip the LFO motion and event crossings between its endpoints.
  for (let i = 0; i < left.length; i += 128) {
    if (gesture && !moved && i / 48000 >= 0.08) {
      const gazeX = settings.gazeX ?? 0;
      synth.setConfig(typeof gesture === "object" ? { ...settings, ...gesture }
        : { ...settings, gazeX: gazeX > 0.4 ? gazeX - 0.28 : gazeX + 0.28 });
      moved = true;
    }
    synth.render(left.subarray(i, i + 128), right.subarray(i, i + 128), i / 48000);
  }
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const rms = samples => Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
  return { synth, left, right, peak, leftRms: rms(left), rightRms: rms(right) };
}

test("one bounded musical state drives the rotating globe, independent lid margins and voice", () => {
  const input = { ...OCULOID_DEFAULTS, gazeX: 7, gazeY: -Infinity, blink: NaN, lowerLid: 7,
    pupil: "-8", tempo: 500, tone: 1.5, air: "bad" };
  const c = normalizeOculoid(input);
  assert.deepEqual(Object.keys(c).sort(), Object.keys(OCULOID_DEFAULTS).sort());
  assert.equal(c.gazeX, 1);
  assert.equal(c.gazeY, OCULOID_DEFAULTS.gazeY);
  assert.equal(c.blink, OCULOID_DEFAULTS.blink);
  assert.equal(c.lowerLid, 1);
  assert.equal(c.pupil, 0);
  assert.equal(c.tempo, 200);
  assert.equal(c.tone, 1);
  assert.equal(c.air, OCULOID_DEFAULTS.air);
  assert.equal(c.eyeballStyle, "drift");
  assert.equal(c.eyelidStyle, "blink");
  assert.deepEqual(normalizeOculoid({ eyeballStyle: "invalid", eyelidStyle: "invalid" }),
    OCULOID_DEFAULTS);
  assert.deepEqual(normalizeOculoid({ motionStyle: "constructor" }), OCULOID_DEFAULTS,
    "legacy style migration must reject inherited object keys");
  for (const [key, value] of Object.entries(c)) {
    if (key === "eyeballStyle" || key === "eyelidStyle") continue;
    assert.ok(Number.isFinite(value), key);
    assert.ok(value >= OCULOID_RANGES[key][0] && value <= OCULOID_RANGES[key][1], key);
  }
  const still = eyePose(c, 6, false);
  assert.equal(still.gazeX, 1);
  assert.equal(still.blink, c.blink);
  const before = eyePose(OCULOID_DEFAULTS, 0, true);
  const after = eyePose(OCULOID_DEFAULTS, 1, true);
  assert.notEqual(before.gazeX, after.gazeX);
  assert.notEqual(before.pupil, after.pupil);
  assert.notEqual(eyePose(OCULOID_DEFAULTS, 0.74, true).blink, OCULOID_DEFAULTS.blink);
  assert.equal(OCULOID_RANGES.blink[0], -1);
  for (const blink of [-1, -0.5, 0, 0.2, 0.5, 0.8, 1]) {
    for (const lowerLid of [-1, 0, 1]) {
      for (const x of [-1, -0.72, 0, 0.72, 1]) {
        assert.ok(lidEdge(x, true, blink, lowerLid) >= lidEdge(x, false, blink, lowerLid) - 1e-10,
          `eye must have non-inverted margins at ${x}/${blink}/${lowerLid}`);
      }
    }
  }
  assert.ok(lidEdge(0, true, 0) - lidEdge(0, false, 0)
    > lidEdge(0, true, 1) - lidEdge(0, false, 1));
});

test("whole-eye turn is independent of the musical gaze and never shows the back of the iris", () => {
  assert.equal(MAX_EYE_TURN, 90);
  assert.deepEqual(boundedEyeTurn(), { yaw: 0, pitch: 0 });
  assert.deepEqual(boundedEyeTurn(-300, 300), { yaw: -90, pitch: 90 });
  assert.deepEqual(boundedEyeTurn(NaN, Infinity), { yaw: 0, pitch: 0 });
  for (const yaw of [-360, -90, -45, 0, 45, 90, 360]) {
    for (const pitch of [-360, -90, -45, 0, 45, 90, 360]) {
      const bounded = boundedEyeTurn(yaw, pitch);
      assert.ok(Math.abs(bounded.yaw) <= MAX_EYE_TURN);
      assert.ok(Math.abs(bounded.pitch) <= MAX_EYE_TURN);
      // YXZ rotation of the whole rig: its front axis never points away from
      // the viewer, including diagonally at both limits.
      const frontZ = Math.cos(bounded.yaw * Math.PI / 180)
        * Math.cos(bounded.pitch * Math.PI / 180);
      assert.ok(frontZ >= -1e-12);
    }
  }
  assert.deepEqual(normalizeOculoid({ ...OCULOID_DEFAULTS, yaw: 90, pitch: -90 }),
    OCULOID_DEFAULTS, "orbiting the view must not rewrite musical presets or audio targets");
});

test("independent eyeball and lid LFOs loop, combine, isolate, and recall legacy styles", () => {
  assert.deepEqual(OCULOID_EYEBALL_STYLES.map(style => style.id),
    ["still", "drift", "flutter", "wild", "drowse", "pupil"]);
  assert.deepEqual(OCULOID_EYELID_STYLES.map(style => style.id),
    ["still", "blink", "flutter", "wild", "drowse", "lid-flutter"]);
  const pairs = OCULOID_EYEBALL_STYLES.flatMap(eye => OCULOID_EYELID_STYLES.map(lid =>
    [eye.id, lid.id]));
  for (const [eyeballStyle, eyelidStyle] of pairs) {
    const c = { ...OCULOID_DEFAULTS, motion: 1, eyeballStyle, eyelidStyle };
    const still = eyePose(c, 0.84, false);
    assert.deepEqual(still, eyePose({ ...c, motion: 0 }, 3.15, true));
    for (let i = 0; i <= 32; i++) {
      const a = eyePose(c, i / 8, true), b = eyePose(c, i / 8 + 8, true);
      for (const key of Object.keys(a)) {
        assert.ok(Math.abs(a[key] - b[key]) < 1e-10,
          `${eyeballStyle}/${eyelidStyle}/${key}: loops exactly in eight beats`);
        assert.ok(Number.isFinite(a[key]), `${eyeballStyle}/${eyelidStyle}/${key}: finite`);
      }
      assert.ok(lidEdge(0, true, a.blink, a.lowerLid)
        >= lidEdge(0, false, a.blink, a.lowerLid), `${eyeballStyle}/${eyelidStyle}: margins cannot invert`);
    }
    assert.equal(still.lowerLid, c.lowerLid);
    assert.equal(still.blink, c.blink);
  }
  const trace = (eyeballStyle, eyelidStyle) => Array.from({ length: 641 }, (_, i) =>
    eyePose({ ...OCULOID_DEFAULTS, motion: 1, eyeballStyle, eyelidStyle }, i / 80, true));
  const flutter = trace("flutter", "flutter"), wild = trace("wild", "wild"),
    drowse = trace("drowse", "drowse");
  assert.ok(flutter.filter(pose => pose.blink > 0.65).length > 20,
    "flutter repeatedly brings the upper lid close to shut");
  assert.ok(Math.min(...flutter.map(pose => pose.lowerLid)) < -0.14,
    "flutter makes the lower lid twitch independently");
  assert.ok(Math.max(...wild.map(pose => pose.gazeX)) > 0.7);
  assert.ok(Math.min(...wild.map(pose => pose.gazeX)) < -0.7);
  assert.ok(Math.max(...wild.map(pose => pose.blink)) > 0.95);
  assert.ok(Math.min(...wild.map(pose => pose.lowerLid)) < -0.2);
  assert.ok(drowse.at(-1).blink < Math.max(...drowse.map(pose => pose.blink)) - 0.7,
    "the heavy lids open again rather than locking shut");
  const pupilOnly = trace("pupil", "still"), lidsOnly = trace("still", "lid-flutter");
  for (const pose of pupilOnly) {
    assert.equal(pose.gazeX, 0);
    assert.equal(pose.gazeY, 0);
    assert.equal(pose.blink, OCULOID_DEFAULTS.blink);
    assert.equal(pose.lowerLid, OCULOID_DEFAULTS.lowerLid);
  }
  assert.ok(Math.max(...pupilOnly.map(pose => pose.pupil))
    - Math.min(...pupilOnly.map(pose => pose.pupil)) > 0.84,
  "only the pupil should repeatedly grow and shrink");
  for (const pose of lidsOnly) {
    assert.equal(pose.gazeX, 0);
    assert.equal(pose.gazeY, 0);
    assert.equal(pose.pupil, OCULOID_DEFAULTS.pupil);
  }
  assert.ok(lidsOnly.filter(pose => pose.blink > 0.7).length > 20);
  assert.ok(Math.min(...lidsOnly.map(pose => pose.lowerLid)) < -0.14,
    "the lower lid still moves independently during forward-looking flutter");
  const frozen = trace("still", "still");
  assert.ok(frozen.every(pose => Object.entries(eyePose(OCULOID_DEFAULTS)).every(
    ([key, value]) => pose[key] === value)));
  for (const beat of [0, 0.74, 1.42, 2.6, 4.1]) {
    const pair = eyePose({ ...OCULOID_DEFAULTS, motion: 1,
      eyeballStyle: "wild", eyelidStyle: "lid-flutter" }, beat, true);
    const eyes = eyePose({ ...OCULOID_DEFAULTS, motion: 1,
      eyeballStyle: "wild", eyelidStyle: "still" }, beat, true);
    const lids = eyePose({ ...OCULOID_DEFAULTS, motion: 1,
      eyeballStyle: "still", eyelidStyle: "lid-flutter" }, beat, true);
    for (const key of ["gazeX", "gazeY", "pupil"]) assert.equal(pair[key], eyes[key]);
    for (const key of ["blink", "lowerLid"]) assert.equal(pair[key], lids[key]);
  }
  for (const [legacy, eyeballStyle, eyelidStyle] of [
    ["drift", "drift", "blink"], ["flutter", "flutter", "flutter"],
    ["wild", "wild", "wild"], ["drowse", "drowse", "drowse"],
    ["pupil", "pupil", "still"], ["lid-flutter", "still", "lid-flutter"],
  ]) {
    const migrated = normalizeOculoid({ motionStyle: legacy });
    assert.equal(migrated.eyeballStyle, eyeballStyle);
    assert.equal(migrated.eyelidStyle, eyelidStyle);
    assert.ok(!("motionStyle" in migrated));
    for (const beat of [0, 0.73, 3.14, 7.93])
      assert.deepEqual(eyePose({ motionStyle: legacy, motion: 1 }, beat, true),
        eyePose({ eyeballStyle, eyelidStyle, motion: 1 }, beat, true));
    assert.equal(normalizeOculoid({ motionStyle: legacy, eyelidStyle: "still" }).eyelidStyle, "still",
      "explicit new fields override legacy snapshots independently");
  }
});

test("the lid rhythm has a separate beat without moving the globe", () => {
  const config = { ...OCULOID_DEFAULTS, motion: 1, eyeballStyle: "wild",
    eyelidStyle: "blink", lidRate: 1.5 };
  assert.equal(normalizeOculoid({ lidRate: 99 }).lidRate, 2);
  assert.equal(normalizeOculoid({ lidRate: NaN }).lidRate, 1);
  const closed = eyePose(config, 0.42, true, 0.74);
  const resting = eyePose(config, 0.42, true, 1.3);
  assert.deepEqual([closed.gazeX, closed.gazeY, closed.pupil],
    [resting.gazeX, resting.gazeY, resting.pupil],
    "changing only the lid's phase must not steer the eyeball");
  assert.ok(closed.blink > resting.blink + 0.4);
  assert.deepEqual(eyePose(config, 0.42, false, 9.74),
    eyePose(config, 0.42, false, 0), "pausing either loop freezes both");
  assert.deepEqual(eyePose(OCULOID_DEFAULTS, 0.74, true),
    eyePose(OCULOID_DEFAULTS, 0.74, true, 0.74),
    "a 1× scene retains its original eye and lid pose");
});

test("simple asymmetric lid arches stop at the globe; lashes still sweep outward", () => {
  for (const side of [-0.7, 0, 0.7]) {
    const corner = -0.025 + 0.035 * side;
    const arch = Math.sqrt(1 - side * side);
    assert.ok(Math.abs(lidEdge(side, true, 0) - (corner + 0.6 * arch * (1 + 0.1 * side))) < 1e-12,
      "upper margin has one smooth arch instead of layered face contours");
    assert.ok(Math.abs(lidEdge(side, false, 0) - (corner - 0.39 * arch * (1 - 0.09 * side))) < 1e-12,
      "lower margin has one smooth, independent arch");
  }
  assert.ok(lidEdge(0.6, true, 0) > lidEdge(-0.6, true, 0) + 0.08);
  assert.ok(lidEdge(0.6, false, 0) > lidEdge(-0.6, false, 0) + 0.06);
  assert.ok(lidEdge(0.6, true, 0) - lidEdge(0.6, false, 0)
    !== lidEdge(-0.6, true, 0) - lidEdge(-0.6, false, 0));
  const upperTravel = lidEdge(0, true, 0) - lidEdge(0, true, 1);
  const lowerTravel = lidEdge(0, false, 1) - lidEdge(0, false, 0);
  assert.ok(upperTravel > 0.8, "the upper lid opens wider than the earlier arc");
  assert.equal(lowerTravel, 0, "upper blink does not move the lower margin");
  assert.ok(lidEdge(0, true, -1) > lidEdge(0, true, 0) + 0.25,
    "pulling the upper lid above rest exposes the globe's top without overshooting it");
  assert.equal(lidEdge(0, false, -1, 1), lidEdge(0, false, 1, 1),
    "opening the upper lid does not reposition the lower one");
  const angle = y => Math.asin(y / LID_SHELL_RADIUS) * 180 / Math.PI;
  const fullOpening = angle(lidEdge(0, true, -1, 1)) - angle(lidEdge(0, false, -1, 1));
  assert.ok(fullOpening > 98 && fullOpening < 110,
    `fully open margins must stop at the smaller globe, not the shell poles (got ${fullOpening}°)`);
  assert.equal(lidEdge(0, true, 0.4, -1), lidEdge(0, true, 0.4, 1),
    "moving the lower lid must not move the upper one");
  assert.ok(lidEdge(0, false, 0, 1) < lidEdge(0, false, 0, 0) - 0.2);
  assert.ok(lidEdge(0, false, 0, -1) > lidEdge(0, false, 0, 0) + 0.5);
  for (const upper of [true, false]) {
    const inner = lashShape(0.15, upper), outer = lashShape(0.78, upper);
    assert.ok(outer.length > inner.length * 1.3, "lashes lengthen toward the temple");
    assert.ok(outer.sweep > inner.sweep * 1.5, "the tips fan toward one side");
    for (const f of [0, 0.25, 0.5, 0.75, 1]) {
      const { length, sweep } = lashShape(f, upper);
      assert.ok(Number.isFinite(length) && length > 0);
      assert.ok(Number.isFinite(sweep) && sweep > 0);
    }
  }
  assert.ok(lashShape(0.78, true).length > lashShape(0.78, false).length);
});

test("both lash rows stay outside their lip crests instead of spearing the closed seam", () => {
  let minLipClearance = Infinity, minRowSeparation = Infinity;
  for (const blink of [-1, 0.04, 0.65, 1]) for (const lower of [-1, 0, 1]) {
    for (const fraction of [0.02, 0.15, 0.35, 0.5, 0.75, 0.97]) {
      const upperRoot = lashPoint(fraction, 0, true, blink, lower);
      const lowerRoot = lashPoint(fraction, 0, false, blink, lower);
      minRowSeparation = Math.min(minRowSeparation, upperRoot[1] - lowerRoot[1]);
      for (const upper of [true, false]) {
        let lastY = lashPoint(fraction, 0, upper, blink, lower)[1];
        for (let step = 0; step <= 6; step++) {
          const [x, y, z] = lashPoint(fraction, step / 6, upper, blink, lower);
          assert.ok(Number.isFinite(z));
          assert.ok(z - lidSurfaceDepth(x, y) > 0.01,
            "each strand stays in front of the adjacent skin shell");
          assert.ok(upper ? y >= lastY : y <= lastY,
            "lashes curl out from the opening, never through the other lip");
          lastY = y;
          for (let roll = 0; roll <= 100; roll++) {
            const [, lipY, lipZ] = lidLipPoint(x, roll / 100, upper, blink, lower);
            if (Math.abs(lipY - y) < 0.008) minLipClearance = Math.min(minLipClearance, z - lipZ);
          }
        }
      }
    }
  }
  assert.ok(minRowSeparation > 0.06,
    `upper and lower lash roots must separate at full closure: ${minRowSeparation}`);
  assert.ok(minLipClearance > 0.00625,
    `even the 0.00625-radius lash tubes must clear the lip: ${minLipClearance}`);
  // Check the actual triangular tube vertices, not just its centerline. The
  // outermost hair is the critical case: the lip curves sharply in X there.
  let minTubeClearance = Infinity;
  for (const [blink, lower] of [[1, 0], [1, -1], [1, 1], [0.04, 0]]) {
    for (const upper of [true, false]) {
      const count = upper ? 75 : 31;
      for (let hair = 0; hair < count; hair++) {
        const fraction = (hair + 0.5 + 0.14 * Math.sin(hair * 9.23)) / count;
        const variation = 0.88 + 0.24 * Math.sin(hair * 15.1) ** 2;
        for (let step = 0; step <= 6; step++) {
          const [px, py, pz] = lashPoint(fraction, step / 6, upper, blink, lower, variation);
          const width = 0.006 * (1 - step / 6) + 0.00025;
          for (let side = 0; side < 3; side++) {
            const angle = side * Math.PI * 2 / 3;
            const vx = px + width * Math.cos(angle), vz = pz + width * Math.sin(angle);
            for (let roll = 0; roll <= 100; roll++) {
              const [, lipY, lipZ] = lidLipPoint(vx, roll / 100, upper, blink, lower);
              if (Math.abs(lipY - py) < 0.008)
                minTubeClearance = Math.min(minTubeClearance, vz - lipZ);
            }
          }
        }
      }
    }
  }
  assert.ok(minTubeClearance > 0.002,
    `even at the outer canthus the entire lash tube stays off the lip: ${minTubeClearance}`);
});

test("the actual imported globe fits inside the stationary, gaze-independent lid envelope", async () => {
  const glb = await readFile(new URL("../assets/oculoid/eye.glb", import.meta.url));
  const jsonLength = glb.readUInt32LE(12);
  const model = JSON.parse(glb.subarray(20, 20 + jsonLength).toString("utf8"));
  const globe = model.accessors[model.meshes[0].primitives[0].attributes.POSITION];
  assert.ok(model.nodes.every(node => !node.rotation && !node.scale && !node.translation),
    "the normalized source must not hide a node transform outside its mesh");
  const center = globe.min.map((n, axis) => (n + globe.max[axis]) / 2);
  const radius = (globe.max[0] - globe.min[0]) / 2;
  const maxima = [];
  for (const mesh of model.meshes) {
    const accessor = model.accessors[mesh.primitives[0].attributes.POSITION];
    const view = model.bufferViews[accessor.bufferView];
    assert.equal(accessor.componentType, 5126);
    assert.equal(accessor.type, "VEC3");
    assert.equal(view.byteStride, 12);
    const start = 20 + jsonLength + 8 + (view.byteOffset || 0) + (accessor.byteOffset || 0);
    let maximum = 0;
    for (let i = 0; i < accessor.count; i++) {
      const offset = start + 12 * i;
      const distance = Math.hypot(...center.map((n, axis) => (glb.readFloatLE(offset + 4 * axis) - n) / radius));
      maximum = Math.max(maximum, distance);
    }
    maxima.push(maximum);
    assert.ok(maximum < GLOBE_HULL_RADIUS - 0.005,
      `${mesh.name} exceeds the ${GLOBE_HULL_RADIUS}-radius stationary socket`);
  }
  assert.ok(Math.abs(maxima[0] - 1.0524) < 0.0001, "the measured globe bound must not drift");
  assert.ok(maxima[1] < maxima[0], "the textured iris remains within the globe envelope");
  assert.equal(GLOBE_SQUASH, 1, "globe and skin must remain spherical in every direction");
  for (const [x, y] of [[0, 0], [0.7, 0.5], [LID_SHELL_RADIUS / 2, 0]]) {
    const z = lidSurfaceDepth(x, y);
    assert.ok(Math.abs(Math.hypot(x, y, z) - LID_SHELL_RADIUS) < 1e-10,
      "the lid shell cannot be squashed in depth");
  }
});

test("one to twelve eyes pack inside the sphere, retaining the touching pair, triangle and square", () => {
  assert.deepEqual(OCULOID_EYE_COUNTS, Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(eyeClusterLayout(13), eyeClusterLayout(1));
  assert.equal(eyeClusterLayout(NaN), eyeClusterLayout(1));
  for (const count of OCULOID_EYE_COUNTS) {
    const layout = eyeClusterLayout(count);
    assert.equal(layout.length, count);
    assert.ok(Object.isFrozen(layout));
    for (let i = 0; i < count; i++) {
      const eye = layout[i], radius = eye.scale * GLOBE_HULL_RADIUS;
      assert.ok(Object.isFrozen(eye));
      assert.ok(eye.scale > 0 && Math.hypot(eye.x, eye.y, eye.z) + radius
        < LID_SHELL_RADIUS - 0.002, `eye ${i + 1} in ${count} must clear the shell at every gaze`);
    }
    if (count === 1) continue;
    const adjacent = [];
    for (let i = 0; i < count; i++) for (let j = 0; j < i; j++) {
      const a = layout[i], b = layout[j];
      assert.equal(a.scale, b.scale, "all eyes in a cluster have the same size");
      const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      assert.ok(distance >= 2 * a.scale - 1e-10,
        `eyes ${i + 1}/${j + 1} in ${count} cannot intersect at rest`);
      if (Math.abs(distance - 2 * a.scale) < 1e-10) adjacent.push([i, j]);
    }
    if (count <= 4) assert.equal(adjacent.length, { 2: 1, 3: 3, 4: 4 }[count],
      `${count} eyes must touch along each edge of their layout`);
    else {
      assert.ok(layout.some(eye => eye.z > 0.07) && layout.some(eye => eye.z < -0.07),
        `${count} eyes must be stacked front-to-back, not laid on one plane`);
      assert.ok(new Set(layout.map(eye => Math.round(eye.y * 10))).size >= 2,
        `${count} eyes occupy multiple heights inside the lid aperture`);
      assert.ok(layout.every(eye => eye.scale >= {
        5: 0.33, 6: 0.32, 7: 0.33, 8: 0.29, 9: 0.30, 10: 0.28, 11: 0.26, 12: 0.25,
      }[count] && Math.abs(eye.z) <= 0.21),
        "no singer can be reduced to a speck or buried behind the socket");
      for (const eye of layout) assert.ok(Math.min(...layout.filter(other => other !== eye)
        .map(other => Math.hypot(eye.x - other.x, eye.y - other.y, eye.z - other.z)
          - 2 * eye.scale)) < 0.035,
      `${count} eyes should nearly touch at least one neighbor`);
      // Test visibility in the default aperture, not just containment inside
      // the sphere: a uniform Fibonacci shell hid several complete eyeballs
      // behind its front row while the count control claimed twelve.
      const cameraZ = lidCameraDistance(1.34);
      const projected = layout.map(eye => ({
        ...eye, x: eye.x * cameraZ / (cameraZ - eye.z),
        y: eye.y * cameraZ / (cameraZ - eye.z),
        radius: eye.scale * cameraZ / (cameraZ - eye.z),
      }));
      for (const eye of projected) {
        let seen = 0, total = 0;
        for (let row = -10; row <= 10; row++) for (let col = -10; col <= 10; col++) {
          const x = eye.x + col * eye.radius / 10;
          const y = eye.y + row * eye.radius / 10;
          if (col * col + row * row > 100) continue;
          total++;
          if (y <= lidEdge(x, false, 0.04, 0) || y >= lidEdge(x, true, 0.04, 0)) continue;
          if (projected.some(other => other !== eye && other.z > eye.z
            && Math.hypot(x - other.x, y - other.y) < other.radius)) continue;
          seen++;
        }
        assert.ok(seen / total >= 0.05,
          `eye ${projected.indexOf(eye) + 1} in the ${count}-eye cluster is completely hidden`);
      }
      let aperture = 0, filled = 0;
      for (let row = -36; row <= 36; row++) for (let col = -36; col <= 36; col++) {
        const x = col * 1.1 / 36, y = row * 0.9 / 36;
        if (y <= lidEdge(x, false, 0.04, 0) || y >= lidEdge(x, true, 0.04, 0)) continue;
        aperture++;
        if (projected.some(eye => Math.hypot(x - eye.x, y - eye.y) < eye.radius)) filled++;
      }
      assert.ok(filled / aperture > {
        5: 0.80, 6: 0.85, 7: 0.85, 8: 0.90, 9: 0.80, 10: 0.86, 11: 0.80, 12: 0.87,
      }[count], `${count} eyeballs leave avoidable holes inside the default aperture`);
    }
  }
  const pair = eyeClusterLayout(2);
  assert.ok(pair[0].x < 0 && pair[1].x > 0 && pair.every(eye => eye.y === 0));
  for (const eye of pair) {
    const distance = Math.hypot(eye.x, eye.y, eye.z);
    // The radial contact falls on the side *skin* cap, not in the opening.
    const contactX = LID_SHELL_RADIUS * Math.abs(eye.x) / distance;
    assert.ok(contactX >= LID_PATCH_X && contactX <= LID_SHELL_RADIUS);
    assert.ok(LID_SHELL_RADIUS - distance - eye.scale * GLOBE_HULL_RADIUS < 0.005,
      "the outside globe must meet the inside of its eyelid side cap");
  }
  const triangle = eyeClusterLayout(3);
  assert.ok(triangle[0].scale >= 0.46,
    "the three eyes fill more of the shell without breaking through it");
  assert.ok(triangle[0].x < 0 && triangle[1].x > 0 && triangle[2].x === 0);
  assert.ok(triangle[0].y === triangle[1].y && triangle[2].y > triangle[0].y,
    "one eye above a touching pair makes a visible triangle, not another row");
  const square = eyeClusterLayout(4);
  assert.ok(square[0].scale >= 0.43,
    "the four eyes grow toward the eyelid margins");
  const xs = [...new Set(square.map(eye => eye.x))];
  const ys = [...new Set(square.map(eye => eye.y))];
  assert.equal(xs.length, 2);
  assert.equal(ys.length, 2);
  assert.ok(Math.abs(Math.abs(xs[1] - xs[0]) - Math.abs(ys[1] - ys[0])) < 1e-10,
    "the four center points must form a square, not a rectangle");
  assert.equal(new Set(square.map(eye => `${eye.x},${eye.y}`)).size, 4);
  assert.deepEqual(eyeClusterLayout(1)[0], { x: 0, y: 0, z: 0, scale: 1 },
    "the original default gaze and radius must not change");
  assert.ok(!("eyeCount" in OCULOID_DEFAULTS), "the live ensemble size must not enter musical presets");
});

test("multi-eye ensemble parts repeat, rest at varied gazes, and respect Still and Pause", () => {
  assert.deepEqual(OCULOID_ENSEMBLES.map(style => style.id),
    ["together", "banter", "harmony", "rock"]);
  assert.equal(normalizeOculoidEnsemble("__proto__"), "banter");
  const config = { ...OCULOID_DEFAULTS, eyeballStyle: "drift", motion: 1 };
  for (const count of [2, 3, 4, 8, 12]) for (const { id } of OCULOID_ENSEMBLES) {
    const shared = eyePose(config, 0, true);
    const parts = Array.from({ length: count }, (_, index) =>
      eyeEnsemblePose(shared, config, 0, index, count, id, true));
    const resting = Array.from({ length: count }, (_, index) =>
      eyeEnsemblePose(shared, config, 0, index, count, id, false));
    for (let index = 0; index < count; index++) {
      assert.deepEqual(eyeEnsemblePose(shared, { ...config, eyeballStyle: "still" },
        0, index, count, id, true), resting[index],
      "Still stops the motion without snapping every iris forward");
      assert.deepEqual(eyeEnsemblePose(shared, config, 5, index, count, id, false),
        resting[index], "Pause holds each singer's resting gaze without animation");
      assert.equal(resting[index].pupil, shared.pupil);
      for (const beat of [0, 0.13, 1.4, 4.7, 7.98]) {
        const base = eyePose(config, beat, true);
        const eye = eyeEnsemblePose(base, config, beat, index, count, id, true);
        const repeated = eyeEnsemblePose(base, config, beat + 8, index, count, id, true);
        for (const key of ["gazeX", "gazeY", "pupil"]) {
          assert.ok(eye[key] >= (key === "pupil" ? 0 : -1) && eye[key] <= 1,
            `${id} keeps each ${key} bounded`);
          assert.ok(Math.abs(eye[key] - repeated[key]) < 1e-9,
            `${id} repeats its part on the eight-beat loop`);
        }
      }
    }
    if (id === "together") {
      assert.ok(parts.every(part => part === shared));
      assert.ok(resting.every(part => part === shared));
    }
    else {
      assert.ok(resting.some((part, index) =>
        index > 0 && Math.hypot(part.gazeX - resting[0].gazeX,
          part.gazeY - resting[0].gazeY) > 0.1),
      `${id}/${count} should look different even with Motion paused`);
      assert.ok(parts.some((part, index) =>
        index > 0 && Math.hypot(part.gazeX - parts[0].gazeX, part.gazeY - parts[0].gazeY) > 0.1),
      `${id}/${count} must not give everyone the same gaze`);
      assert.ok(parts.every(part => part.energy > 0 && part.energy <= 1),
        "the visible call/response also gives its note an accent");
    }
  }
  const base = eyePose(config);
  assert.equal(eyeEnsemblePose(base, config, 1.4, 0, 1, "banter", true), base,
    "the original single-eye path stays unchanged");
  const fullBand = Array.from({ length: 12 }, (_, index) =>
    eyeEnsemblePose(base, config, 0, index, 12, "harmony", true));
  assert.ok(fullBand.every(eye => eye.gazeX > -0.9 && eye.gazeX < 0.9),
    "a twelve-eye harmony spreads its gazes without pinning outer singers to either stop");
  assert.deepEqual(oculoidSonicWardrobe({ tongue: true, lipstick: "yes", cigar: true,
    hat: "top", prototype: true }), {
    tongue: true, teeth: false, mustache: false, lipstick: false, cigar: true,
    sunglasses: false, coat: false, scarf: false, catEars: false,
    humanEars: false, bowTie: false, headband: false,
    hat: "top", hair: "none",
  }, "the worklet receives only bounded accessory switches");
  const groucho = oculoidSonicWardrobe({ groucho: true });
  assert.equal(groucho.mustache, true);
  assert.equal(groucho.sunglasses, true,
    "the Groucho outfit colors the next sound like its constituent props");
});

test("a bounded local poke deforms the globe and returns exactly to its imported bind pose", () => {
  const front = oculoidPokeContact({ x: 0, y: 0, z: 2 });
  assert.deepEqual(front, { x: 0, y: 0, z: 1 });
  assert.equal(oculoidPokeContact({ x: NaN, y: 0, z: 1 }), OCULOID_POKE_HOME);
  assert.equal(oculoidPokeDisplacement(0, 0, 1, front, 1), -0.21);
  assert.equal(oculoidPokeDisplacement(0, 0, -1, front, 1), 0);
  assert.equal(oculoidPokeDisplacement(0.5, 0, 0.87, front, 1), 0);
  assert.equal(oculoidPokeDisplacement(0, 0, 1, front, Infinity), 0);
  assert.ok(oculoidPokeDisplacement(0, 0, 1, front, 0.4)
    > oculoidPokeDisplacement(0, 0, 1, front, 0.9));
  let spring = { depth: 0, velocity: 0 }, min = 0;
  for (let i = 0; i < 55; i++) spring = stepOculoidPoke(spring, 0.8, 1 / 60);
  assert.ok(Math.abs(spring.depth - 0.8) < 0.003);
  for (let i = 0; i < 90; i++) {
    spring = stepOculoidPoke(spring, 0, 1 / 60);
    min = Math.min(min, spring.depth);
  }
  assert.ok(min < -0.002, "the eye springs outward slightly after a deep release");
  assert.deepEqual(spring, { depth: 0, velocity: 0 });
  assert.deepEqual(stepOculoidPoke({ depth: NaN, velocity: Infinity }, Infinity, -10),
    { depth: 0, velocity: 0 });

  const root = new THREE.Group(), shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 40, 24), new THREE.MeshStandardMaterial());
  root.add(shell);
  const position = shell.geometry.getAttribute("position");
  const before = new Float32Array(position.array), normals = new Float32Array(shell.geometry.getAttribute("normal").array);
  const uv = new Float32Array(shell.geometry.getAttribute("uv").array);
  const dimple = createOculoidPokeDeformer(shell, root);
  dimple.update(front, 0.9);
  assert.notDeepEqual(position.array, before, "real mesh vertices, not a screen-space decoration, must move");
  assert.ok(Math.min(...position.array.filter((_, index) => index % 3 === 2)) < -0.95);
  root.rotation.y = 0.8;
  dimple.update(oculoidPokeContact({ x: 1, y: 0, z: 1 }), 0.6);
  dimple.update(front, 0);
  assert.deepEqual(position.array, before, "release restores every imported vertex without drift");
  assert.deepEqual(shell.geometry.getAttribute("normal").array, normals);
  assert.deepEqual(shell.geometry.getAttribute("uv").array, uv);
  shell.geometry.dispose(); shell.material.dispose();
});

test("live poke diameter/depth, beam width and local stretch remain bounded and reversible", () => {
  const front = oculoidPokeContact({ x: 0, y: 0, z: 1 });
  assert.deepEqual(normalizeOculoidSurface(), OCULOID_SURFACE_DEFAULTS);
  assert.deepEqual(normalizeOculoidSurface({ pokeDiameter: Infinity, pokeDepth: NaN, flashDiameter: NaN }),
    OCULOID_SURFACE_DEFAULTS);
  assert.deepEqual(normalizeOculoidSurface({ pokeDiameter: 50, pokeDepth: 99, flashDiameter: -5 }),
    { pokeDiameter: OCULOID_SURFACE_RANGES.pokeDiameter[1],
      pokeDepth: OCULOID_SURFACE_RANGES.pokeDepth[1],
      flashDiameter: OCULOID_SURFACE_RANGES.flashDiameter[0] });
  assert.deepEqual(Object.keys(normalizeOculoid({
    ...OCULOID_DEFAULTS, ...OCULOID_SURFACE_DEFAULTS, retracted: true,
  })).sort(), Object.keys(OCULOID_DEFAULTS).sort(),
  "diameters and retractor must never be serialized in a musical preset");
  assert.equal(oculoidPokeDisplacement(0.6, 0, 0.8, front, 1, 0.12), 0);
  assert.ok(oculoidPokeDisplacement(0.6, 0, 0.8, front, 1, 0.92) < -0.002,
    "the large physical contact patch reaches much farther across the globe");
  assert.equal(oculoidPokeDisplacement(0, 0, 1, front, 1, 0.12), -0.21);
  const pull = boundedOculoidStretch(1, 1);
  assert.ok(Math.abs(Math.hypot(pull.x, pull.y) - 0.25) < 1e-9,
    "the moderately deeper diagonal stretch stays locally bounded");
  assert.equal(oculoidStretchWeight(0, 0, 1, front), 1);
  assert.equal(oculoidStretchWeight(0.8, 0, 0.6, front), 0);
  assert.equal(oculoidStretchWeight(0, 0, -1, front), 0);
  let spring = { x: 0, y: 0, vx: 0, vy: 0 };
  for (let i = 0; i < 65; i++)
    spring = stepOculoidElastic(spring, { x: 50, y: -50 }, 1 / 60, 0.42);
  assert.ok(spring.x <= 0.42 && spring.x > 0.38 && spring.y >= -0.42 && spring.y < -0.38);
  for (let i = 0; i < 100; i++)
    spring = stepOculoidElastic(spring, { x: 0, y: 0 }, 1 / 60, 0.42);
  assert.deepEqual(spring, { x: 0, y: 0, vx: 0, vy: 0 });
  assert.deepEqual(stepOculoidElastic({ x: NaN, y: Infinity },
    { x: NaN, y: Infinity }, -10), { x: 0, y: 0, vx: 0, vy: 0 });

  const root = new THREE.Group(), shell = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 32), new THREE.MeshStandardMaterial());
  root.add(shell);
  const positions = shell.geometry.getAttribute("position"), before = new Float32Array(positions.array);
  const normals = new Float32Array(shell.geometry.getAttribute("normal").array);
  const deformer = createOculoidPokeDeformer(shell, root);
  deformer.update(front, 0.5, { diameter: 0.92 });
  assert.notDeepEqual(positions.array, before);
  deformer.update(front, 0, { stretch: { contact: front, x: 0.29, y: -0.13 } });
  assert.notDeepEqual(positions.array, before);
  deformer.update(front, 0);
  assert.deepEqual(positions.array, before);
  assert.deepEqual(shell.geometry.getAttribute("normal").array, normals);
  shell.geometry.dispose(); shell.material.dispose();
});

test("the temporary lid retractor opens only the performed pose, not saved lid settings", () => {
  const config = { ...OCULOID_DEFAULTS, blink: 1, lowerLid: -1 };
  const pose = eyePose(config, 0, false), open = eyePoseWithRetractor(pose, true);
  assert.equal(eyePoseWithRetractor(pose, false), pose);
  assert.deepEqual({ blink: open.blink, lowerLid: open.lowerLid }, { blink: -1, lowerLid: 1 });
  assert.ok(eyeSoundTargets(config, open).gate > eyeSoundTargets(config, pose).gate * 2,
    "the held-open eye should not keep the closed-lid audio gate");
  assert.deepEqual({ blink: config.blink, lowerLid: config.lowerLid }, { blink: 1, lowerLid: -1 });
});

test("the closer spherical lids and their uniformly rounded margins enclose the moving globe", () => {
  // Test the viewer's 112 slices, 28 front rings and ten rolled lip rings.
  // Interpolated triangle points must not cut through the source's envelope.
  const slices = 112, rings = 28, lipRings = 10, weights = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1], [0.5, 0.5, 0],
    [0, 0.5, 0.5], [0.5, 0, 0.5], [1 / 3, 1 / 3, 1 / 3],
  ];
  let clearance = Infinity, lipClearance = Infinity, covered = 0;
  for (const upper of [true, false]) for (const blink of [-1, -0.86, 0, 0.04, 0.5, 1]) {
    for (const lower of [-1, 0, 1]) for (let slice = 0; slice < slices; slice++) {
      for (let ring = 0; ring < rings + lipRings; ring++) {
        const vertex = (dx, dr) => {
          const x = -LID_PATCH_X + 2 * LID_PATCH_X * (slice + dx) / slices;
          const band = ring + dr;
          return band < lipRings
            ? lidLipPoint(x, band / lipRings, upper, blink, lower)
            : lidPatchPoint(x, (band - lipRings) / rings, upper, blink, lower);
        };
        const a = vertex(0, 0), b = vertex(1, 0), c = vertex(0, 1), d = vertex(1, 1);
        if (ring === rings + lipRings - 1) {
          for (const [x, y, z] of [c, d]) {
            assert.ok(Math.abs(z) < 1e-6, "the front must meet the back hemisphere at its equator");
            assert.ok(Math.abs(Math.hypot(x, y) - LID_SHELL_RADIUS) < 1e-6);
          }
        }
        for (const triangle of [[a, b, c], [b, c, d]]) for (const weight of weights) {
          const [x, y, z] = [0, 1, 2].map(channel =>
            triangle.reduce((value, point, index) => value + point[channel] * weight[index], 0));
          if (Math.hypot(x, y) > GLOBE_HULL_RADIUS) continue;
          covered++;
          if (ring < lipRings) lipClearance = Math.min(lipClearance, z - globeHullDepth(x, y));
          else clearance = Math.min(clearance, z - globeHullDepth(x, y));
        }
      }
    }
  }
  assert.ok(covered > 100_000);
  assert.ok(LID_SHELL_RADIUS - GLOBE_HULL_RADIUS > 0.06
    && LID_SHELL_RADIUS - GLOBE_HULL_RADIUS < 0.08,
  "the wrap sits much closer to the moving globe than the former 0.13-radius space");
  assert.ok(clearance > 0.045, `the front shell pierced the globe envelope: ${clearance}`);
  assert.ok(lipClearance > 0.025, `the inner margin pierced the globe: ${lipClearance}`);
  assert.equal(lidSurfaceDepth(0, LID_SHELL_RADIUS), 0);
  assert.ok(lidSurfaceDepth(0, 0.25) > lidSurfaceDepth(0, 0.95) + 0.3);
  const front = lidPatchPoint(0, 0, true, 0, 0);
  const inner = lidLipPoint(0, 0, true, 0, 0);
  const bead = lidLipPoint(0, 0.75, true, 0, 0);
  assert.ok(front[1] - inner[1] > 0.055 && front[1] - inner[1] < 0.065
    && inner[2] <= front[2] && inner[2] - globeHullDepth(inner[0], inner[1]) < 0.045,
  "the narrow folded edge now approaches, but cannot pierce, the rotating globe");
  assert.ok(bead[2] > front[2] + 0.055, "the round roll still projects forward");
  const rollDepth = lidLipPoint(0, 0.5, true, 0, 0)[2] - inner[2];
  assert.ok(rollDepth > 0.115 && rollDepth < 0.145,
    `the cover keeps a small rounded roll instead of a separate torus (got ${rollDepth})`);
  for (const upper of [true, false]) {
    const centerWidth = Math.abs(lidLipPoint(0, 0, upper, 0)[1] - lidPatchPoint(0, 0, upper, 0)[1]);
    for (const x of [-0.96, -0.8, 0.8, 0.96]) {
      const width = Math.abs(lidLipPoint(x, 0, upper, 0)[1] - lidPatchPoint(x, 0, upper, 0)[1]);
      assert.ok(Math.abs(width - centerWidth) < 0.002,
        `the ${upper ? "upper" : "lower"} edge keeps its thickness through x=${x}`);
    }
  }
  for (const upper of [true, false]) {
    const x = 0.4, t = 0.0001;
    const at = lidLipPoint(x, 1, upper, 0), lipNear = lidLipPoint(x, 1 - t, upper, 0);
    const shellNear = lidPatchPoint(x, t, upper, 0);
    const lipSlope = (lipNear[2] - at[2]) / (lipNear[1] - at[1]);
    const shellSlope = (shellNear[2] - at[2]) / (shellNear[1] - at[1]);
    assert.ok(Math.abs(lipSlope - shellSlope) < 0.02,
      "the edge blends into the spherical cover without a kink at its base");
  }
  const distance = lidCameraDistance(1.4);
  // The inner lips overlap the true globe silhouette by a few screen pixels:
  // no light-colored socket gap, no margin that opens beyond the eyeball.
  const silhouette = 1.0524 / Math.sqrt(distance ** 2 - (1.0524 * GLOBE_SQUASH) ** 2);
  for (const upper of [true, false]) {
    const [x, y, z] = lidLipPoint(0, 0, upper, -1, 1);
    assert.equal(x, 0);
    const projected = Math.abs(y) / (distance - z);
    assert.ok(projected >= silhouette - 0.035 && projected <= silhouette,
      `open ${upper ? "upper" : "lower"} lip must contact, not outrun, the globe`);
    assert.ok(z - globeHullDepth(x, y) < 0.05,
      "the inner lip must approach the moving globe's conservative envelope");
  }
  assert.deepEqual(lidLipPoint(0, 1, true, 0, 0), front, "rim and shell have no split seam");
  assert.ok(lidLipPoint(0, 0, true, 1, 0)[1] > lidLipPoint(0, 0, false, 1, 0)[1] - 0.01,
    "closing lids must not cross at their inner edges");
  assert.ok(lidCameraDistance(1.4) < lidCameraDistance(0.8),
    "both portrait and landscape canvases fit the shell by the shorter side");
});

test("front and rear shell use matching equator vertices and normals through every lid pose", () => {
  const back = buildBackShellGeometry(), backPositions = back.getAttribute("position");
  const backNormals = back.getAttribute("normal");
  const slices = 112, backStride = 53, frontBands = 28 + 10;
  const capSlices = (backPositions.count / backStride - 1 - slices) / 2;
  assert.equal(capSlices, 8, "the rear shell's side sections match the fused front caps");
  const skin = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
  const lining = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const rim = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const socket = new THREE.MeshBasicMaterial({ color: 0x030306, side: THREE.BackSide });
  const upper = buildSkinPatch(true, skin, lining, socket, rim);
  const lower = buildSkinPatch(false, skin, lining, socket, rim);
  try {
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [0.8, -0.7], [1, -1]]) {
      for (const patch of [upper, lower]) {
        writeSkinPatch(patch, blink, lowerLid);
        const positions = patch.mesh.geometry.getAttribute("position");
        const normals = patch.mesh.geometry.getAttribute("normal");
        const frontStride = frontBands + 1, ring = patch.upper ? 0 : backStride - 1;
        for (let slice = 0; slice <= slices; slice++) {
          const front = slice * frontStride + frontBands;
          const rear = (slice + capSlices) * backStride + ring;
          for (let axis = 0; axis < 3; axis++) {
            assert.ok(Math.abs(positions.array[3 * front + axis] - backPositions.array[3 * rear + axis]) < 1e-6,
              `equator gap at ${slice}/${blink}/${lowerLid}, axis ${axis}`);
            assert.ok(Math.abs(normals.array[3 * front + axis] - backNormals.array[3 * rear + axis]) < 1e-6,
              `equator normal break at ${slice}/${blink}/${lowerLid}, axis ${axis}`);
          }
        }
        const sample = slice => slice * frontStride + frontBands;
        assert.deepEqual([
          normals.getX(sample(56)), normals.getY(sample(56)), normals.getZ(sample(56)),
        ], lidShellNormal(0, patch.upper ? LID_SHELL_RADIUS : -LID_SHELL_RADIUS, 0));
      }
    }
    const positions = backPositions, indices = back.getIndex();
    const a = indices.getX(15999), b = indices.getX(16000), c = indices.getX(16001);
    const p = [a, b, c].map(i => new THREE.Vector3().fromBufferAttribute(positions, i));
    assert.ok(p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]))
      .dot(new THREE.Vector3().fromBufferAttribute(backNormals, a)) > 0,
    "the matching rear tessellation must face outward, not show its socket as exterior");
  } finally {
    back.dispose();
    upper.mesh.geometry.dispose();
    upper.inside.geometry.dispose();
    lower.mesh.geometry.dispose();
    lower.inside.geometry.dispose();
    skin.dispose();
    lining.dispose();
    rim.dispose();
    socket.dispose();
  }
});

test("both canthi end the movable split and join one continuous spherical side cap", () => {
  const skin = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
  const lining = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const rim = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const socket = new THREE.MeshBasicMaterial({ color: 0x030306, side: THREE.BackSide });
  const back = buildBackShellGeometry();
  const lids = [true, false].map(upper => buildSkinPatch(upper, skin, lining, socket, rim));
  const caps = [-1, 1].map(side => ({ side, ...buildLidSideCap(side, skin, socket) }));
  const backPosition = back.getAttribute("position");
  try {
    assert.equal(LID_PATCH_X, 1);
    assert.ok(LID_SHELL_RADIUS > LID_PATCH_X,
      "skin continues around the eye without extending the upper/lower cut");
    for (const { side, mesh, inside } of caps) {
      const geometry = mesh.geometry, positions = geometry.getAttribute("position");
      const normals = geometry.getAttribute("normal"), indices = geometry.getIndex();
      const capStride = 57, capSlices = 8, rings = 28, backStride = 53;
      assert.equal(inside.geometry, geometry, "the fused cap has one unbroken exterior and black interior");
      assert.equal(mesh.material, skin);
      assert.equal(inside.material, socket);
      assert.equal(positions.count, (capSlices + 1) * capStride);
      assert.equal(indices.count, capSlices * (capStride - 1) * 6);
      for (let slice = 0; slice <= capSlices; slice++) {
        const rearSlice = side < 0 ? capSlices - slice : capSlices + 112 + slice;
        for (const [capRing, backRing] of [[0, 0], [capStride - 1, backStride - 1]]) {
          const front = new THREE.Vector3().fromBufferAttribute(positions, slice * capStride + capRing);
          const rear = new THREE.Vector3().fromBufferAttribute(backPosition, rearSlice * backStride + backRing);
          assert.ok(front.distanceTo(rear) < 1e-6, `cap ${side} must join the rear equator`);
        }
        for (let ring = 0; ring < capStride; ring++) {
          const index = slice * capStride + ring;
          const vertex = new THREE.Vector3().fromBufferAttribute(positions, index);
          assert.ok(Math.abs(vertex.length() - LID_SHELL_RADIUS) < 1e-6,
            "fusing the corner cannot flatten or pinch the spherical shell");
          const normal = new THREE.Vector3().fromBufferAttribute(normals, index);
          assert.ok(normal.distanceTo(vertex.normalize()) < 1e-6);
        }
      }
      const triangle = (3 * capStride + 10) * 6;
      const [a, b, c] = [0, 1, 2].map(n =>
        new THREE.Vector3().fromBufferAttribute(positions, indices.getX(triangle + n)));
      assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).dot(a) > 0,
        `cap ${side} must face outward at oblique views`);
      for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [0.8, -0.7], [1, -1]]) {
        for (const lid of lids) {
          writeSkinPatch(lid, blink, lowerLid);
          const position = lid.mesh.geometry.getAttribute("position");
          const frontSlice = side < 0 ? 0 : 112, frontStride = 39;
          for (let radial = 0; radial <= rings; radial++) {
            const front = new THREE.Vector3().fromBufferAttribute(position,
              frontSlice * frontStride + 10 + radial);
            const capRing = lid.upper ? rings - radial : rings + radial;
            const cap = new THREE.Vector3().fromBufferAttribute(positions, capRing);
            assert.ok(front.distanceTo(cap) < 1e-6,
              `lid ${lid.upper ? "upper" : "lower"} must meet cap ${side} at ${blink}/${lowerLid}`);
          }
          for (const t of [0, 0.5, 1]) {
            const lip = lidLipPoint(side * LID_PATCH_X, t, lid.upper, blink, lowerLid);
            const cap = new THREE.Vector3().fromBufferAttribute(positions, rings);
            assert.ok(new THREE.Vector3(...lip).distanceTo(cap) < 1e-6,
              "the thick rounded edge must taper completely into the fused canthus");
          }
        }
      }
    }
  } finally {
    back.dispose();
    for (const lid of lids) { lid.mesh.geometry.dispose(); lid.inside.geometry.dispose(); }
    for (const cap of caps) cap.mesh.geometry.dispose();
    skin.dispose(); lining.dispose(); rim.dispose(); socket.dispose();
  }
});

test("front lid interiors and both animated canthi stay black without painting the exterior or rolls", () => {
  const skin = new THREE.MeshStandardMaterial({ side: THREE.FrontSide });
  const lining = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const rim = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide });
  const socket = new THREE.MeshBasicMaterial({
    color: 0x030306, side: THREE.BackSide, toneMapped: false,
  });
  const recessMaterial = socket.clone();
  recessMaterial.side = THREE.DoubleSide;
  const patches = [true, false].map(upper =>
    buildSkinPatch(upper, skin, lining, socket, rim));
  const recesses = [-1, 1].map(side => buildCanthusRecess(side, recessMaterial));
  try {
    for (const patch of patches) {
      assert.equal(patch.mesh.material[0], lining);
      assert.equal(patch.mesh.material[1], rim);
      assert.equal(patch.mesh.material[2], skin);
      assert.equal(patch.inside.material, socket);
      assert.equal(patch.inside.geometry.getIndex().count, 112 * 28 * 6,
        "only the shell's inward face is black, never the rounded lid edge");
      assert.equal(patch.inside.geometry.getAttribute("position"),
        patch.mesh.geometry.getAttribute("position"),
        "both shell faces deform together with no separate inner ring");
    }
    assert.equal(skin.side, THREE.FrontSide);
    assert.equal(rim.side, THREE.DoubleSide);
    assert.equal(lining.side, THREE.DoubleSide);
    assert.equal(socket.side, THREE.BackSide);
    assert.equal(socket.toneMapped, false);
    for (const [blink, lowerLid] of [[0.04, 0], [-1, 1], [1, 0], [1, -1]]) {
      for (const patch of patches) writeSkinPatch(patch, blink, lowerLid);
      for (const recess of recesses) {
        writeCanthusRecess(recess, blink, lowerLid);
        const positions = recess.mesh.geometry.getAttribute("position");
        assert.equal(positions.count, 21 * 9);
        for (const fraction of [0.25, 0.5, 0.75]) {
          const row = Math.round(fraction * 20) * 9;
          const [x, y, z] = canthusRecessPoint(recess.side, fraction, 0.5, blink, lowerLid);
          assert.ok(Math.abs(positions.getX(row + 4) - x) < 1e-6);
          assert.ok(Math.abs(positions.getY(row + 4) - y) < 1e-6);
          assert.ok(Math.abs(positions.getZ(row + 4) - z) < 1e-6);
          assert.ok(z < 0 && z < globeHullDepth(x, y),
            "the globe must cover the recess where they overlap, not vice versa");
          assert.ok(z > -lidSurfaceDepth(x, y),
            "the recess stays in front of the rear socket, not behind the shell");
          assert.ok(y > lidEdge(x, false, blink, lowerLid)
            && y < lidEdge(x, true, blink, lowerLid),
          "the recess stays between independently moving lids");
          assert.ok(z < lidSurfaceDepth(x, y),
            "the unlit recess stays inside the spherical skin, not on its exterior");
        }
      }
    }
  } finally {
    for (const patch of patches) { patch.mesh.geometry.dispose(); patch.inside.geometry.dispose(); }
    for (const recess of recesses) recess.mesh.geometry.dispose();
    skin.dispose(); lining.dispose(); rim.dispose(); socket.dispose(); recessMaterial.dispose();
  }
});

test("a single corner tear grows from zero then falls vertically without a streak", () => {
  assert.deepEqual(tearDropMotion(0.5, 3, false), { size: 0, fall: 0 });
  assert.deepEqual(tearDropMotion(1, 0, true), { size: 0, fall: 0 });
  assert.deepEqual(tearDropMotion(1, 4, true), { size: 0, fall: 0 });
  assert.deepEqual(tearDropMotion(1, 8, true), { size: 0, fall: 0 });
  const forming = tearDropMotion(1, 1, true), grown = tearDropMotion(1, 1.9, true);
  const falling = tearDropMotion(1, 3, true);
  assert.ok(forming.size > 0 && forming.size < grown.size);
  assert.equal(forming.fall, 0);
  assert.ok(grown.size > 0.99);
  assert.equal(grown.fall, 0);
  assert.ok(falling.size > 0.99 && falling.fall > 0.4,
    "the whole drop falls only after growing to full size");
  for (const beat of [2.4, 2.8, 3, 3.4, 3.8, 3.99]) {
    const frame = tearDropMotion(1, beat, true);
    assert.equal(frame.size, grown.size, `the falling drop cannot shrink at beat ${beat}`);
    assert.ok(frame.fall >= 0 && frame.fall <= 1);
  }
  assert.equal(tearDropMotion(1, 3.99, true).fall, 1,
    "the complete drop leaves the stage before the next cycle resets");
  assert.deepEqual(tearDropMotion(1, 3, true), tearDropMotion(1, 11, true),
    "Cry repeats every four beats independently of the eight-beat eye Motion");
  assert.deepEqual(tearDropMotion(1, 0, false), { size: 0, fall: 0 },
    "Tear size alone cannot start a drop; Tear/Cry are explicit actions");
  assert.ok(tearDropMotion(1, 1.9, true).size > 4 * tearDropMotion(0, 1.9, true).size,
    "the size knob must cover a conspicuous range without suppressing the smallest tear");
  assert.equal(TEAR_CYCLE_BEATS, 4);
  assert.equal(TEAR_RELEASE_BEAT, 2.08);
  assert.ok(TEAR_DROP_SCALE >= 1.5, "the grown tear should be substantially larger");
  assert.ok(Math.abs(TEAR_TIP_HEIGHT - 0.83351171 * 0.2 * TEAR_DROP_SCALE) < 1e-12,
    "the tip offset uses the actual GLB apex after vertical scaling");
  const frames = [0, 1, 1.9, 2.4, 3, 3.8].map(beat =>
    tearDropPose(0.04, 0, 1, beat, true));
  const x = frames[0].x;
  const lowerRim = lidLipPoint(x, 0, false, 0.04, 0);
  const outerRim = lidLipPoint(x, 0.55, false, 0.04, 0);
  const rootY = outerRim[1] - 0.003;
  assert.equal(x, -LID_PATCH_X, "the drop grows at the viewer-left lid join");
  for (const frame of frames) {
    assert.equal(frame.x, lowerRim[0], "the tear cannot drift inward along the lid");
    assert.ok(frame.z > outerRim[2], "the drop's apex is just ahead of the corner roll");
  }
  assert.ok(rootY <= outerRim[1] && rootY >= outerRim[1] - 0.005,
    "the tip starts at the lid join, not below or inside the eye");
  for (const frame of frames.slice(0, 3)) {
    assert.ok(Math.abs(frame.y + TEAR_TIP_HEIGHT * frame.size - rootY) < 1e-12,
      "the enlarged GLB grows downward while its measured tip stays on the corner");
  }
  assert.ok(frames[4].y < frames[2].y - 0.4, "the detached drop falls straight down");
  for (const aspect of [0.3, 0.46, 0.8, 1, 1.8]) {
    const screenBottom = -(lidCameraDistance(aspect) + LID_SHELL_RADIUS)
      * Math.tan(36 * Math.PI / 360);
    for (const [blink, lowerLid] of [[0.04, 0], [-1, 1], [1, -1]]) {
      const grown = tearDropPose(blink, lowerLid, 1, 1.9, true, aspect);
      const falling = tearDropPose(blink, lowerLid, 1, 2.8, true, aspect);
      const exited = tearDropPose(blink, lowerLid, 1, 3.84, true, aspect);
      assert.ok(grown.y > falling.y && falling.y > exited.y,
        "the drop falls continuously instead of jumping to the bottom");
      assert.equal(grown.size, falling.size);
      assert.equal(falling.size, exited.size);
      assert.equal(grown.x, exited.x);
      assert.equal(grown.z, exited.z);
      assert.ok(exited.y + TEAR_TIP_HEIGHT * exited.size < screenBottom - 0.15,
        `the full-size tip must leave the ${aspect}-aspect stage before wrapping`);
      const framedDistance = lidCameraDistance(aspect) * 1.65;
      const framed = tearDropPose(blink, lowerLid, 1, 3.84, true, aspect, framedDistance);
      const framedBottom = -(framedDistance + LID_SHELL_RADIUS) * Math.tan(36 * Math.PI / 360);
      assert.ok(framed.y + TEAR_TIP_HEIGHT * framed.size < framedBottom - 0.15,
        "a hat or tail cannot make a falling tear disappear before leaving the wider view");
      assert.equal(framed.x, exited.x, "camera framing does not move the corner anchor");
    }
  }
  for (const [blink, lowerLid] of [[1, 0], [1, 1], [-1, 1], [-1, -1]]) {
    const attached = tearDropPose(blink, lowerLid, 1, 1.9, true);
    const lower = lidLipPoint(x, 0, false, blink, lowerLid);
    const outer = lidLipPoint(x, 0.55, false, blink, lowerLid);
    const tipY = attached.y + TEAR_TIP_HEIGHT * attached.size;
    assert.equal(attached.x, lower[0], "moving either lid keeps the tear at the same corner");
    assert.ok(Math.abs(tipY - (outer[1] - 0.003)) < 1e-12,
      "the imported drop's tip follows the joined lips even when either lid closes");
    assert.ok(attached.z > outer[2], "the tip stays just in front of the corner roll");
  }
});

test("the drop anchor uses the imported mesh's actual pointed apex", async () => {
  const bytes = await readFile(new URL("../assets/oculoid/drop.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const apex = gltf.accessors[0].max[2];
  assert.ok(Math.abs(TEAR_TIP_HEIGHT - apex * 0.2 * TEAR_DROP_SCALE) < 1e-7);
  assert.ok(apex > 0.83 && apex < 0.84);
});

test("licensed and fallback tear bulbs clear the eyelid sphere at every size without moving the tip", async () => {
  const bytes = await readFile(new URL("../assets/oculoid/drop.glb", import.meta.url));
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const accessor = gltf.accessors[0];
  const positions = new Float32Array(accessor.count * 3);
  const offset = 20 + jsonLength + 8 + gltf.bufferViews[accessor.bufferView].byteOffset;
  for (let i = 0; i < positions.length; i++) positions[i] = bytes.readFloatLE(offset + i * 4);
  const imported = new THREE.BufferGeometry();
  imported.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const indexAccessor = gltf.accessors[2], indices = new Uint16Array(indexAccessor.count);
  const indexOffset = 20 + jsonLength + 8 + gltf.bufferViews[indexAccessor.bufferView].byteOffset;
  for (let i = 0; i < indices.length; i++) indices[i] = bytes.readUInt16LE(indexOffset + i * 2);
  imported.setIndex(new THREE.BufferAttribute(indices, 1));
  imported.rotateX(-Math.PI / 2);
  const fallback = createFallbackTearGeometry();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const lids = [true, false].map(upper =>
    buildSkinPatch(upper, material, material, material, material));
  const skinMeshes = lids.map(lid => lid.mesh);
  const raycaster = new THREE.Raycaster();
  const towardLids = new THREE.Vector3(0, 0, -1);
  for (const [geometry, scale] of [
    [imported, [0.15 * TEAR_DROP_SCALE, 0.2 * TEAR_DROP_SCALE, 0.192 * TEAR_DROP_SCALE]],
    [fallback, [0.08 * TEAR_DROP_SCALE, TEAR_TIP_HEIGHT, 0.09 * TEAR_DROP_SCALE]],
  ]) {
    try {
      const tipY = geometry === imported ? accessor.max[2] : 1;
      for (const aspect of [0.3, 0.46, 1, 1.8]) {
        bendTearAwayFromLid(geometry, tipY, ...scale, aspect);
        const attr = geometry.getAttribute("position");
        let apex = 0;
        for (let i = 1; i < attr.count; i++) if (attr.getY(i) > attr.getY(apex)) apex = i;
        assert.ok(Math.abs(attr.getY(apex) - tipY) < 1e-6);
        assert.ok(Math.abs(attr.getX(apex)) + Math.abs(attr.getZ(apex)) < 1e-5,
          "the pointed mesh tip cannot move when its bulb is leaned clear of the shell");
        for (const [blink, lowerLid] of [[0.04, 0], [-1, 1], [1, -1]]) {
          for (const lid of lids) writeSkinPatch(lid, blink, lowerLid);
          for (const wetness of [0, 0.5, 1]) {
            for (const beat of [0.5, 1.9, 2.8]) {
              const drop = tearDropPose(blink, lowerLid, wetness, beat, true, aspect);
              const tip = lidLipPoint(drop.x, 0.55, false, blink, lowerLid);
              if (beat < TEAR_RELEASE_BEAT)
                assert.ok(Math.abs(drop.y + TEAR_TIP_HEIGHT * drop.size - (tip[1] - 0.003)) < 1e-10);
              let closest = Infinity, projectedX = 0;
              const cameraZ = lidCameraDistance(aspect);
              for (let i = 0; i < attr.count; i++) {
                const worldX = drop.x + attr.getX(i) * scale[0] * drop.size;
                const worldY = drop.y + attr.getY(i) * scale[1] * drop.size;
                const worldZ = drop.z + attr.getZ(i) * scale[2] * drop.size;
                projectedX += worldX / (cameraZ - worldZ);
                closest = Math.min(closest, Math.hypot(worldX, worldY, worldZ) - LID_SHELL_RADIUS);
                if (beat === 1.9 && worldX > -LID_PATCH_X && i % 3 === 0) {
                  raycaster.set(new THREE.Vector3(worldX, worldY, 2), towardLids);
                  const lidHit = raycaster.intersectObjects(skinMeshes)[0];
                  assert.ok(!lidHit || worldZ >= lidHit.point.z - 0.005,
                    "the visible tear bulb must stay in front of the actual rounded lid lip");
                }
              }
              const focalPixels = 720 / (2 * Math.tan(36 * Math.PI / 360));
              const projectedTipX = drop.x / (cameraZ - drop.z);
              assert.ok(Math.abs(projectedX / attr.count - projectedTipX) * focalPixels < 1.5,
                `the ${aspect}-aspect tear must grow vertically under its tip at beat ${beat}`);
              assert.ok(closest > 0.007,
                `${wetness} Tear at beat ${beat} must not pierce the ${aspect}-aspect lid: ${closest}`);
            }
          }
        }
      }
    } finally { geometry.dispose(); }
  }
  for (const lid of lids) { lid.mesh.geometry.dispose(); lid.inside.geometry.dispose(); }
  material.dispose();
});

test("removable wardrobe props follow the moving lids and leave presets untouched", () => {
  const assembly = new THREE.Group(), cover = new THREE.Group(), iris = new THREE.Group();
  assembly.add(cover, iris);
  const rim = new THREE.MeshStandardMaterial();
  const patches = [0, 1].map(() => ({ mesh: new THREE.Mesh(new THREE.BufferGeometry(),
    [rim, rim, rim]) }));
  const outfit = createOculoidWardrobe(cover, iris, rim, patches, assembly);
  try {
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [1, -1]]) {
      const lenses = eyewearPose(blink, lowerLid);
      for (const lens of lenses) {
        assert.ok(lens.y - 0.13 > lidEdge(lens.x, true, blink, lowerLid) + 0.09,
          "sunglasses remain high above the upper margin even at maximum open");
        assert.ok(lens.z > lidSurfaceDepth(lens.x, lens.y - 0.13) + 0.09,
          "the frame clears the shell at its lower edge");
      }
      assert.ok(scarfPose(blink, lowerLid).y + 0.069 < lidEdge(0, false, blink, lowerLid));
      assert.ok(scarfPose(blink, lowerLid).radius > 0.1);
    }
    assert.ok(eyewearPose(-1, 1)[0].y > eyewearPose(0.04, 0)[0].y + 0.1);
    assert.ok(eyewearPose(0.04, 0)[0].y > eyewearPose(1, -1)[0].y + 0.5,
      "the glasses follow the upper lid all the way through a full blink");
    assert.deepEqual(eyewearPose(-1, 1, false), eyewearPose(1, -1, false),
      "bare-eye glasses do not follow an invisible lid");
    for (const lens of eyewearPose(1, -1, false)) {
      assert.equal(lens.y, 0.40);
      assert.ok(lens.z > globeHullDepth(lens.x, lens.y - 0.13) + 0.1,
        "bare-eye glasses rest in front of the globe");
    }
    assert.ok(Object.keys(OCULOID_WARDROBE_DEFAULTS).every(key => !(key in OCULOID_DEFAULTS)));
    assert.deepEqual(OCULOID_HATS,
      ["none", "top", "cowboy", "frosting", "cherry", "cat"]);
    assert.deepEqual(OCULOID_HAIRCUTS, ["none", "mullet", "mom-bob"]);
    assert.equal(outfit.frameRadius(), LID_SHELL_RADIUS);
    const headwear = new Map([
      ["top", "Top hat"], ["cowboy", "Cowboy hat"],
      ["frosting", "Cupcake frosting hat"], ["cherry", "Cherry hat"],
      ["cat", "Cat sitting on the head"],
    ]);
    for (const [hat, name] of headwear) {
      outfit.set({ ...OCULOID_WARDROBE_DEFAULTS, hat, hatSize: 1.5,
        catEars: true, humanEars: true, bowTie: true, tail: true }, true);
      assert.equal(assembly.getObjectByName(name).visible, true);
      assert.ok([...headwear.values()].filter(item =>
        assembly.getObjectByName(item).visible).length === 1, "one hat at a time");
      assert.equal(assembly.getObjectByName(name).scale.x, 1.5);
      assert.ok(outfit.frameRadius() > LID_SHELL_RADIUS,
        "the camera must make room for large hats and the curled tail");
      for (const accessory of ["Cat ears", "Human ears outside the shell",
        "Bow tie", "Curled cat tail"]) {
        const prop = assembly.getObjectByName(accessory);
        assert.equal(prop.parent, assembly);
        assert.equal(prop.visible, true);
      }
      const hatTop = new THREE.Box3().setFromObject(assembly.getObjectByName(name)).max.y;
      assert.ok(hatTop > LID_SHELL_RADIUS + 0.2, `${name} rises visibly above the eye`);
      outfit.set({ ...OCULOID_WARDROBE_DEFAULTS, hat, catEars: true,
        humanEars: true, bowTie: true, tail: true }, false);
      assert.equal(assembly.getObjectByName(name).visible, true,
        "headwear remains on the bare globe when the lids hide");
      assert.equal(cover.children.filter(child => child.visible).length, 0);
    }
    const dressed = { ...OCULOID_WARDROBE_DEFAULTS, lipstick: true, sunglasses: true,
      cigar: true, mustache: true, coat: true, scarf: true, lipstickColor: "#df2753" };
    outfit.set(dressed, true);
    outfit.updatePose(-1, 1);
    const cigar = cover.getObjectByName("Cigar held by the lower lid");
    const mustache = cover.getObjectByName("Mustache on the upper lashes");
    const glasses = assembly.getObjectByName("Sunglasses above the upper lid");
    const lenses = ["Left sunglass lens", "Right sunglass lens"]
      .map(name => glasses.getObjectByName(name));
    const bridges = glasses.children.filter(child => child.name === "Connected brow bridge");
    const coatBody = cover.getObjectByName("Coat shell with open lapels");
    assert.equal(outfit.lipstickMaterial.color.getHexString(), "df2753");
    assert.ok(patches.every(patch => patch.mesh.material[0] === outfit.lipstickMaterial
      && patch.mesh.material[1] === outfit.lipstickMaterial
      && patch.mesh.material[2] === rim),
    "lipstick covers both the inner lining and rounded rim, never the skin");
    assert.equal(cover.children.filter(child => child.visible).length, 4);
    assert.equal(cigar.parent, cover, "the cigar belongs to the lower eyelid, not the pupil");
    assert.equal(mustache.parent, cover, "the mustache moves with the lid, not the globe");
    assert.equal(glasses.parent, assembly, "the glasses survive hiding the lid shell");
    const [cigarX, cigarY, cigarZ] = lidLipPoint(0.24, 0.52, false, -1, 1);
    assert.ok(cigar.position.distanceTo(new THREE.Vector3(cigarX, cigarY + 0.048,
      cigarZ + 0.037)) < 1e-10);
    assert.equal(bridges.length, 2, "both frames share one continuous bridge");
    const coatPoints = coatBody.geometry.getAttribute("position");
    let coatTop = -Infinity, frontOpening = Infinity;
    for (let i = 0; i < coatPoints.count; i++) {
      const x = coatPoints.getX(i), y = coatPoints.getY(i), z = coatPoints.getZ(i);
      coatTop = Math.max(coatTop, y);
      if (y > -0.8 && y < -0.74 && z > 0.2)
        frontOpening = Math.min(frontOpening, Math.abs(x));
    }
    assert.ok(coatTop > 0 && coatTop < 0.07, "coat shoulders reach halfway up the sphere");
    assert.ok(frontOpening > 0.3, "the coat's V leaves room for the hanging tongue");
    const triangles = coatBody.geometry.getIndex();
    const sideVertices = coatPoints.count / 2;
    for (let i = 0; i < triangles.count; i += 3) {
      assert.equal(triangles.getX(i) < sideVertices, triangles.getX(i + 1) < sideVertices);
      assert.equal(triangles.getX(i) < sideVertices, triangles.getX(i + 2) < sideVertices,
        "the coat panels must not connect under the eye");
    }
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [1, -1], [1, 1]]) {
      outfit.updatePose(blink, lowerLid);
      const [x, y, z] = lidLipPoint(0.24, 0.52, false, blink, lowerLid);
      assert.ok(cigar.position.distanceTo(new THREE.Vector3(x, y + 0.048,
        z + 0.037)) < 1e-10, "cigar stays attached to the moving lower lid");
      assembly.updateMatrixWorld(true);
      const ends = bridges.map(bridge => [-0.5, 0.5].map(y =>
        bridge.localToWorld(new THREE.Vector3(0, y, 0))));
      assert.ok(ends[0].some(left => ends[1].some(right => left.distanceTo(right) < 1e-5)),
        "the bridge halves must meet during every blink");
      for (let i = 0; i < lenses.length; i++) {
        const rimMesh = lenses[i].getObjectByName("Continuous cat-eye rim");
        const points = rimMesh.geometry.getAttribute("position");
        const distance = Math.min(...ends[i].flatMap(end =>
          Array.from({ length: points.count }, (_, j) =>
            end.distanceTo(rimMesh.localToWorld(
              new THREE.Vector3().fromBufferAttribute(points, j))))));
        assert.ok(distance < 0.019, "each bridge end must actually touch its frame");
      }
      const [, lashY, lashZ] = lashPoint(0.5, 0, true, blink, lowerLid);
      const [, tipY] = lashPoint(0.5, 1, true, blink, lowerLid);
      assert.equal(mustache.position.x, 0);
      assert.equal(mustache.position.y, lashY + 0.03);
      assert.equal(mustache.position.z,
        Math.max(lidSurfaceDepth(0, lashY + 0.03) + 0.055, lashZ - 0.055));
      assert.equal(mustache.rotation.x, -0.16);
      assert.ok(mustache.position.z < lashZ && mustache.position.z
        > lidSurfaceDepth(0, mustache.position.y) + 0.04,
      "the hairs perch between the front of the lid and the lash roots");
      assert.ok(mustache.getObjectByName("Individual tapered mustache hairs").renderOrder < 8,
        "the mustache is layered behind, not in front of, the moving lashes");
      const bottom = new THREE.Box3().setFromObject(mustache).min.y;
      assert.ok(bottom > lidEdge(0, true, blink, lowerLid) + 0.04,
        "both lobes stay above the upper lid even at full blink");
      assert.ok(bottom < tipY, "the mustache rests along the upper lashes");
    }
    const perch = mustache.position.clone(), tilt = mustache.rotation.x;
    const cigarPose = cigar.position.clone();
    iris.position.x = -0.15;
    assert.ok(mustache.position.equals(perch));
    assert.equal(mustache.rotation.x, tilt, "pupil dilation and gaze do not dislodge the mustache");
    assert.ok(cigar.position.equals(cigarPose), "gaze cannot dislodge a lower-lid cigar");
    const mouth = { ...dressed, teeth: true, tongue: true };
    const teeth = cover.getObjectByName("Teeth behind the eyelid lips");
    const tongue = cover.getObjectByName("Hanging tongue from the lower lip");
    outfit.set(mouth, true);
    outfit.updatePose(0.04, 0, 0, false);
    assert.equal(teeth.children.filter(child => child.visible).length, 14);
    assert.equal(tongue.visible, true);
    assert.equal(outfit.occluders().length, 19,
      "coat, cigar and mouth block touch and flashlight rays");
    const tongueBody = tongue.getObjectByName("Tongue body");
    const groove = tongue.getObjectByName("Tongue groove");
    assert.ok(groove.geometry.getAttribute("position").count > 2, "the tongue has a central crease");
    cover.updateMatrixWorld(true);
    const tip = new THREE.Vector3().fromBufferAttribute(
      tongueBody.geometry.getAttribute("position"), 18 * 9 + 4).applyMatrix4(tongueBody.matrixWorld);
    assert.ok(tip.y < lidEdge(0, false, 0.04, 0) - 0.35,
      "the tongue hangs well below the lower lip, not inside the eye");
    assert.ok(tip.z > lidSurfaceDepth(tip.x, tip.y) + 0.12,
      "the hanging tip lies in front of the lid, not through it");
    for (const tooth of teeth.children) {
      const pose = toothPose(tooth.position.x, tooth.name === "Upper tooth", 0.04, 0);
      assert.ok(pose.open > 0);
      assert.ok(Math.abs(pose.y - tooth.position.y) < 1e-8);
      assert.ok(tooth.name === "Upper tooth"
        ? tooth.position.y < lidEdge(pose.x, true, 0.04, 0)
        : tooth.position.y > lidEdge(pose.x, false, 0.04, 0));
    }
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [0.7, 0],
      [0.825, -0.05], [0.95, 0.225], [1, 1]]) {
      outfit.updatePose(blink, lowerLid);
      for (const tooth of teeth.children) {
        if (!tooth.visible) continue;
        for (let step = 0; step <= 20; step++) {
          const across = step / 10 - 1, x = tooth.position.x + tooth.scale.x * across;
          const height = tooth.scale.y * Math.sqrt(1 - across * across);
          assert.ok(tooth.position.y + height <= lidEdge(x, true, blink, lowerLid) + 1e-4,
            "no tooth can pierce the upper lip at any point across its width");
          assert.ok(tooth.position.y - height >= lidEdge(x, false, blink, lowerLid) - 1e-4,
            "no tooth can pierce the lower lip at any point across its width");
          const lipZ = lidLipPoint(x, 0.5, tooth.name === "Upper tooth", blink, lowerLid)[2];
          assert.ok(tooth.position.z + tooth.scale.z < lipZ - 0.015,
            "the tooth front must stay behind the rolled lip");
        }
      }
    }
    const atRest = tongue.position.x;
    outfit.updatePose(-1, 1, 0.75, true);
    assert.ok(Math.abs(tongue.position.x - atRest) > 0.01, "the exposed tongue wags with Motion");
    outfit.updatePose(1, -1);
    assert.ok(teeth.children.every(child => !child.visible));
    assert.equal(tongue.visible, false, "a closed mouth must conceal the tongue");
    assert.deepEqual(outfit.occluders(), [coatBody, ...cigar.children],
      "a closed mouth still leaves the coat and lower-lid cigar in place");
    assert.equal(toothPose(0, true, 1, -1).open, 0);
    assert.equal(tonguePose(1, -1).open, 0);
    outfit.updatePose(-1, 1);
    assert.ok(teeth.children.every(child => child.visible));
    assert.equal(tongue.visible, true, "the tongue returns when the lids reopen");
    outfit.set(dressed, false);
    assert.equal(cover.children.filter(child => child.visible).length, 0);
    assert.deepEqual(outfit.occluders(), []);
    assert.equal(cigar.visible, false, "Hide lids removes its lower-lid cigar");
    assert.equal(glasses.visible, true, "Hide lids keeps the glasses on the bare eye");
    outfit.updatePose(0.04, 0);
    const bareGlasses = lenses.map(lens => lens.position.clone());
    outfit.updatePose(1, -1);
    assert.ok(lenses.every((lens, index) => lens.position.equals(bareGlasses[index])),
      "the bare-eye glasses cannot follow the hidden lid");
    assert.ok(lenses.every(lens => lens.position.y < 0.5),
      "the frames rest over the bare globe rather than above its pole");
    assert.equal(mustache.visible, false, "Hide lids removes the lash-mounted mustache");
    outfit.set(dressed, true);
    assert.equal(mustache.visible, true, "showing the lid restores its mustache");
    outfit.set(OCULOID_WARDROBE_DEFAULTS, true);
    assert.ok(patches.every(patch => patch.mesh.material[1] === rim));
    assert.equal(cover.children.filter(child => child.visible).length, 0);
    assert.equal(cigar.visible, false);
    assert.equal(mustache.visible, false);
  } finally {
    const geometries = new Set(), materials = new Set();
    assembly.traverse(child => {
      if (child.geometry && !geometries.has(child.geometry)) {
        child.geometry.dispose(); geometries.add(child.geometry);
      }
      if (child.material && child.material !== rim && !materials.has(child.material)) {
        child.material.dispose(); materials.add(child.material);
      }
    });
    outfit.lipstickMaterial.dispose(); rim.dispose();
  }
});

test("the Groucho disguise is a single glasses-nose-mustache costume above the lid", () => {
  const assembly = new THREE.Group(), cover = new THREE.Group();
  const rim = new THREE.MeshStandardMaterial();
  assembly.add(cover);
  const outfit = createOculoidWardrobe(cover, new THREE.Group(), rim, [], assembly);
  const disguise = assembly.getObjectByName("Groucho glasses, nose and mustache");
  const sunglasses = assembly.getObjectByName("Sunglasses above the upper lid");
  const standardMustache = cover.getObjectByName("Mustache on the upper lashes");
  const nose = disguise.getObjectByName("Groucho disguise nose");
  const bushy = disguise.getObjectByName("Bushy Groucho disguise mustache");
  const frames = ["Left Groucho frame", "Right Groucho frame"]
    .map(name => disguise.getObjectByName(name));
  try {
    const clothes = { ...OCULOID_WARDROBE_DEFAULTS,
      sunglasses: true, mustache: true, groucho: true };
    outfit.set(clothes, true);
    assert.ok(disguise.visible);
    assert.equal(sunglasses.visible, false);
    assert.equal(standardMustache.visible, false,
      "the disguise replaces, rather than doubles, separate props");
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [1, -1]]) {
      outfit.updatePose(blink, lowerLid);
      const poses = eyewearPose(blink, lowerLid);
      frames.forEach((frame, index) => {
        assert.ok(frame.position.y - 0.16 > lidEdge(poses[index].x, true,
          blink, lowerLid) + 0.055,
        "round disguise rims reveal where high sunglasses should sit");
        assert.ok(frame.position.distanceTo(new THREE.Vector3(
          poses[index].x, poses[index].y, poses[index].z + 0.03)) < 1e-8);
      });
      assert.ok(nose.position.y < frames[0].position.y - 0.12);
      assert.ok(nose.position.z > lidSurfaceDepth(0, nose.position.y) + 0.1);
      assert.ok(bushy.position.y > lidEdge(0, true, blink, lowerLid) + 0.02);
      assert.ok(bushy.getObjectByName("Individual tapered mustache hairs")
        .geometry.getAttribute("position").count > 2000);
    }
    outfit.set(clothes, false);
    outfit.updatePose(1, -1);
    assert.ok(disguise.visible, "the full costume stays on the bare globe");
    assert.ok(frames.every(frame => frame.position.y === 0.40));
    assert.equal(cover.children.filter(child => child.visible).length, 0);
    outfit.set({ ...clothes, groucho: false }, true);
    assert.equal(disguise.visible, false);
    assert.equal(sunglasses.visible, true);
    assert.equal(standardMustache.visible, true);
    outfit.set(OCULOID_WARDROBE_DEFAULTS);
    assert.equal(disguise.visible, false);
  } finally {
    const geometries = new Set(), materials = new Set();
    assembly.traverse(child => {
      if (child.geometry && !geometries.has(child.geometry)) {
        child.geometry.dispose(); geometries.add(child.geometry);
      }
      if (child.material && child.material !== rim && !materials.has(child.material)) {
        child.material.dispose(); materials.add(child.material);
      }
    });
    outfit.lipstickMaterial.dispose(); rim.dispose();
  }
});

test("coat, scarf, tie, sweatband, whiskers and ears clear the spherical lid", () => {
  const assembly = new THREE.Group(), cover = new THREE.Group();
  const rim = new THREE.MeshStandardMaterial();
  assembly.add(cover);
  const outfit = createOculoidWardrobe(cover, new THREE.Group(), rim, [], assembly);
  const accessory = name => {
    const object = assembly.getObjectByName(name);
    assert.ok(object, name);
    return object;
  };
  try {
    const clothes = { ...OCULOID_WARDROBE_DEFAULTS,
      coat: true, scarf: true, bowTie: true, bowTieColor: "#ed862a",
      catEars: true, humanEars: true, tail: true, mustache: true,
      headband: true, hair: "mullet", hat: "frosting",
    };
    outfit.set(clothes);
    assert.equal(accessory("Bow tie").children[0].material.color.getHexString(), "ed862a");
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [1, -1]]) {
      outfit.updatePose(blink, lowerLid);
      assembly.updateMatrixWorld(true);
      for (const name of ["Coat shell with open lapels", "Sculpted fur ear",
        "Sweatband across the forehead", "Woven scarf wrapped around the neck",
        "Bow tie", "Individual tapered mustache hairs"]) {
        const item = accessory(name), vertex = new THREE.Vector3();
        let checked = 0;
        item.traverse(mesh => {
          if (!mesh.isMesh) return;
          const points = mesh.geometry.getAttribute("position");
          for (let i = 0; i < points.count; i++) {
            vertex.fromBufferAttribute(points, i).applyMatrix4(mesh.matrixWorld);
            if (vertex.z <= 0 || vertex.x ** 2 + vertex.y ** 2 >= LID_SHELL_RADIUS ** 2) continue;
            checked++;
            assert.ok(vertex.z > lidSurfaceDepth(vertex.x, vertex.y) + 0.025,
              `${name} pierces the lid at ${blink}/${lowerLid}, vertex ${i}`);
          }
        });
        assert.ok(checked > 3, `${name} is dimensional and visible over the skin`);
      }
    }
    const wrap = accessory("Woven scarf wrapped around the neck");
    assert.ok(wrap.geometry.getIndex().count > 3000);
    assert.ok(wrap.geometry.getAttribute("color").count > 500,
      "the scarf is a woven surface, not a single pink line");
    assert.ok(accessory("Long draped scarf end").getObjectByName("Folded scarf fabric"));
    assert.ok(accessory("Short draped scarf end").children.length > 4,
      "the wrapped scarf has layered fabric ends and fringes");
    assert.equal(accessory("Human ears outside the shell").children.length, 2);
    assert.equal(accessory("Cat ears").children.length, 2);
    assert.ok(accessory("Curled cat tail").getObjectByName("Short fur along tapered tail"));
    assert.ok(accessory("Tail arch behind the eye").geometry.getAttribute("color"));
    outfit.set({ ...clothes, hair: "mom-bob", hat: "cat", hatSize: 5 });
    assert.equal(accessory("Cupcake frosting hat").visible, false);
    assert.equal(accessory("Mom bob haircut").visible, true);
    assert.equal(accessory("Uneven mullet haircut").visible, false);
    assert.equal(accessory("Cat sitting on the head").scale.x, 1.5,
      "oversized hats are bounded even for invalid input");
    outfit.set({ ...clothes, hat: "cherry", hatSize: -2 }, false);
    assert.equal(accessory("Cherry hat").scale.x, 0.75);
    assert.equal(accessory("Woven scarf wrapped around the neck").parent.visible, false);
    assert.equal(accessory("Sweatband across the forehead").visible, false);
    assert.equal(accessory("Human ears outside the shell").visible, true);
  } finally {
    const geometries = new Set(), materials = new Set();
    assembly.traverse(item => {
      if (item.geometry && !geometries.has(item.geometry)) {
        item.geometry.dispose(); geometries.add(item.geometry);
      }
      for (const material of Array.isArray(item.material) ? item.material : [item.material]) {
        if (material && material !== rim && !materials.has(material)) {
          material.dispose(); materials.add(material);
        }
      }
    });
    outfit.lipstickMaterial.dispose(); rim.dispose();
  }
});

test("tailored cloth and both layered haircuts stay clear of the moving lash fans", () => {
  const assembly = new THREE.Group(), cover = new THREE.Group();
  const rim = new THREE.MeshStandardMaterial();
  assembly.add(cover);
  const outfit = createOculoidWardrobe(cover, new THREE.Group(), rim, [], assembly);
  const coat = cover.getObjectByName("Trench coat halfway up the shell");
  const jacket = coat.getObjectByName("Coat shell with open lapels");
  const vertex = new THREE.Vector3();
  try {
    assert.ok(jacket.geometry.getAttribute("position").count > 3000);
    assert.ok(jacket.geometry.getAttribute("color"),
      "fabric has subtle per-vertex variations rather than a rigid solid sleeve");
    for (const name of ["Left folded trench lapel", "Right folded trench lapel"])
      assert.ok(coat.getObjectByName(name).geometry.getAttribute("position").count > 100,
        "the lapel follows the garment's curved surface instead of a flat quad");
    for (const style of ["mullet", "mom-bob"]) {
      outfit.set({ ...OCULOID_WARDROBE_DEFAULTS, coat: true, hair: style });
      const wig = assembly.getObjectByName(style === "mullet"
        ? "Uneven mullet haircut" : "Mom bob haircut");
      assert.ok(wig.getObjectByName("Layered tapered hair locks")
        .geometry.getAttribute("position").count > 2000);
      assert.equal(wig.children.length, 2,
        "one fine lock mesh replaces detached straight-cylinder bangs");
      for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [0.65, 0.4], [1, -1], [1, 1]]) {
        outfit.updatePose(blink, lowerLid);
        assembly.updateMatrixWorld(true);
        for (const [garment, upper, count, clearance] of [
          [coat, false, 31, 0.004], [wig, true, 75, 0.04],
        ]) {
          const lashes = [];
          for (let hair = 0; hair < count; hair++) {
            const fraction = (hair + 0.5 + 0.14 * Math.sin(hair * 9.23)) / count;
            const variation = 0.88 + 0.24 * Math.sin(hair * 15.1) ** 2;
            for (let step = 0; step <= 6; step++)
              lashes.push(lashPoint(fraction, step / 6, upper,
                blink, lowerLid, variation));
          }
          let checked = 0;
          garment.traverse(mesh => {
            if (!mesh.isMesh) return;
            const points = mesh.geometry.getAttribute("position");
            for (let i = 0; i < points.count; i++) {
              vertex.fromBufferAttribute(points, i).applyMatrix4(mesh.matrixWorld);
              if (vertex.z <= 0 || Math.abs(vertex.x) >= 1
                || vertex.x ** 2 + vertex.y ** 2 >= LID_SHELL_RADIUS ** 2) continue;
              let tip = upper ? -Infinity : Infinity;
              for (const [x, y] of lashes) if (Math.abs(x - vertex.x) < 0.04)
                tip = upper ? Math.max(tip, y) : Math.min(tip, y);
              if (!Number.isFinite(tip)) continue;
              checked++;
              assert.ok(upper ? vertex.y >= tip + clearance : vertex.y <= tip - clearance,
                `${style}: ${mesh.name} overlaps ${upper ? "upper" : "lower"} lashes `
                + `at blink ${blink}/${lowerLid}, vertex ${i}`);
            }
          });
          assert.ok(checked > 20, `${style} and the coat have dimensional visible fabric`);
        }
      }
    }
  } finally {
    const geometries = new Set(), materials = new Set();
    assembly.traverse(item => {
      if (item.geometry && !geometries.has(item.geometry)) {
        item.geometry.dispose(); geometries.add(item.geometry);
      }
      if (item.material && item.material !== rim && !materials.has(item.material)) {
        item.material.dispose(); materials.add(item.material);
      }
    });
    outfit.lipstickMaterial.dispose(); rim.dispose();
  }
});

test("the entire tongue clears the lower lid as it drapes over the moving lip", () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const lower = buildSkinPatch(false, material, material, material, material);
  const cover = new THREE.Group();
  const outfit = createOculoidWardrobe(cover, new THREE.Group(), material, []);
  const tongue = cover.getObjectByName("Hanging tongue from the lower lip");
  const body = tongue.getObjectByName("Tongue body");
  const points = body.geometry.getAttribute("position");
  const ray = new THREE.Raycaster();
  assert.ok(body.renderOrder > 8, "the hanging tongue draws after the lash strands");
  const vertex = index => new THREE.Vector3().fromBufferAttribute(points, index)
    .applyMatrix4(body.matrixWorld);
  const assertClear = (point, label) => {
    ray.set(new THREE.Vector3(point.x, point.y, 3), new THREE.Vector3(0, 0, -1));
    const lid = ray.intersectObject(lower.mesh)[0];
    if (lid) assert.ok(point.z > lid.point.z + 0.005,
      `${label}: tongue pierced lower lip by ${(lid.point.z - point.z).toFixed(3)}`);
  };
  try {
    outfit.set({ ...OCULOID_WARDROBE_DEFAULTS, tongue: true });
    for (const [blink, lowerLid] of [[-1, 1], [0.04, 0], [0.55, 0],
      [0.7, 0], [0.74, -0.08], [0.8, 0.1], [1, 1], [-1, -1]]) {
      writeSkinPatch(lower, blink, lowerLid);
      for (const beat of [0, 0.75, 1.4]) {
        outfit.updatePose(blink, lowerLid, beat, true);
        if (!tongue.visible) continue;
        cover.updateMatrixWorld(true);
        for (let row = 0; row <= 18; row++) {
          for (const col of [0, 2, 4, 6, 8]) {
            // Both sides of the thick ribbon must clear the *actual* animated
            // lip triangles. Checking only the hanging tip missed a segment
            // that surfaced through the lower lid during a partial blink.
            for (const layer of [0, points.count / 2]) {
              assertClear(vertex(layer + row * 9 + col),
                `${blink}/${lowerLid}, beat ${beat}, row ${row}, col ${col}`);
            }
          }
        }
        // A rasterized triangle can cut through a curved lip even when its
        // endpoints clear it. Check the faces spanning the fold as well.
        for (let row = 0; row < 6; row++) for (let col = 0; col < 8; col++) {
          for (const layer of [0, points.count / 2]) {
            const a = vertex(layer + row * 9 + col);
            const b = vertex(layer + (row + 1) * 9 + col);
            const c = vertex(layer + row * 9 + col + 1);
            const d = vertex(layer + (row + 1) * 9 + col + 1);
            for (const [first, second, third] of [[a, b, c], [c, b, d]]) {
              assertClear(first.clone().add(second).add(third).divideScalar(3),
                `${blink}/${lowerLid}, beat ${beat}, triangle ${row}/${col}`);
            }
          }
        }
        if (beat === 0) {
          let overlapping = 0;
          for (let hair = 0; hair < 31; hair++) {
            const fraction = (hair + 0.5 + 0.14 * Math.sin(hair * 9.23)) / 31;
            const variation = 0.88 + 0.24 * Math.sin(hair * 15.1) ** 2;
            for (let step = 2; step <= 12; step++) {
              const [x, y, z] = lashPoint(fraction, step / 12,
                false, blink, lowerLid, variation);
              if (y > lidEdge(x, false, blink, lowerLid) - 0.01) continue;
              ray.set(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1));
              const hit = ray.intersectObject(body)[0];
              if (!hit) continue;
              overlapping++;
              assert.ok(hit.point.z > z + 0.01,
                `the tongue must cover the lower eyelashes at ${blink}/${lowerLid}`);
            }
          }
          if (tonguePose(blink, lowerLid).open > 0.9)
            assert.ok(overlapping > 5, "the tongue really crosses the visible lash fan");
        }
      }
    }
  } finally {
    lower.mesh.geometry.dispose();
    lower.inside.geometry.dispose();
    cover.traverse(item => { item.geometry?.dispose(); item.material?.dispose(); });
    outfit.lipstickMaterial.dispose();
    material.dispose();
  }
});

test("each prominent visual control has its declared DSP destination", () => {
  const defaults = normalizeOculoid(OCULOID_DEFAULTS);
  const target = c => eyeSoundTargets(c, eyePose(c));
  assert.ok(target({ ...defaults, gazeX: 1 }).pan > target({ ...defaults, gazeX: -1 }).pan);
  assert.ok(target({ ...defaults, gazeY: 1 }).hz > target({ ...defaults, gazeY: -1 }).hz);
  assert.ok(target({ ...defaults, blink: 1 }).gate < target({ ...defaults, blink: 0 }).gate);
  assert.ok(target({ ...defaults, blink: 1, lowerLid: 1 }).gate
    > target({ ...defaults, blink: 1, lowerLid: 0 }).gate,
  "opening the bottom lid must reopen the sound while the top is closed");
  assert.ok(target({ ...defaults, lowerLid: -1 }).gate < target(defaults).gate);
  assert.ok(target({ ...defaults, pupil: 1 }).cutoff > target({ ...defaults, pupil: 0 }).cutoff);
  assert.ok(target({ ...defaults, pupil: 1 }).brightness > target({ ...defaults, pupil: 0 }).brightness);
  assert.ok(target({ ...defaults, wetness: 1 }).shimmer > target({ ...defaults, wetness: 0 }).shimmer);
  assert.ok(target({ ...defaults, veins: 1 }).grain > target({ ...defaults, veins: 0 }).grain);
  assert.ok(target({ ...defaults, air: 1 }).grain > target({ ...defaults, air: 0 }).grain);
  assert.ok(target({ ...defaults, irisTint: 1 }).color > target({ ...defaults, irisTint: 0 }).color);
  assert.ok(target({ ...defaults, tone: 1 }).color > target({ ...defaults, tone: 0 }).color);
  assert.ok(target({ ...defaults, rootHz: 330 }).hz > target({ ...defaults, rootHz: 55 }).hz);
  assert.equal(target({ ...defaults, midiHz: 440 }).hz, 440);
});

test("36 full presets and injectable dice preserve all sixteen musical fields", () => {
  assert.equal(OCULOID_PRESETS.length, 36);
  assert.deepEqual(OCULOID_PRESETS.map(preset => preset.id),
    Array.from({ length: 36 }, (_, index) => `eye-${index + 1}`));
  assert.equal(new Set(OCULOID_PRESETS.map(preset => JSON.stringify(preset.snapshot))).size, 36);
  for (const preset of OCULOID_PRESETS) {
    assert.deepEqual(Object.keys(preset.snapshot).sort(), Object.keys(OCULOID_DEFAULTS).sort());
    assert.deepEqual(normalizeOculoid(preset.snapshot), preset.snapshot);
  }
  const additions = OCULOID_PRESETS.slice(12).map(preset => preset.snapshot);
  assert.equal(additions.filter(scene => scene.eyeballStyle === "pupil" && scene.eyelidStyle === "still").length, 8);
  assert.equal(additions.filter(scene => scene.eyeballStyle === "still" && scene.eyelidStyle === "lid-flutter").length, 8);
  assert.ok(additions.filter(scene => scene.pupil <= 0.14).length >= 12,
    "the extra bank should feature many visibly tiny pupils");
  for (const scene of additions.filter(scene =>
    scene.eyeballStyle === "pupil" || scene.eyelidStyle === "lid-flutter")) {
    assert.equal(scene.gazeX, 0, "isolated motion scenes look straight ahead");
    assert.equal(scene.gazeY, 0);
  }
  for (const scene of additions.filter(scene => scene.eyelidStyle === "lid-flutter")) {
    const poses = [0, 0.73, 1.4, 2.6, 4.1].map(beat => eyePose(scene, beat, true));
    assert.ok(poses.every(pose => pose.pupil === scene.pupil),
      "only the lids animate in the forward-looking flutter presets");
  }
  const before = { ...OCULOID_DEFAULTS };
  const values = [0.07, 0.16, 0.23, 0.32, 0.41, 0.53, 0.62, 0.58, 0.7,
    0.78, 0.83, 0.91, 0.98, 0.67, 0.6, 0.55];
  let index = 0;
  const result = randomizeOculoid(before, () => values[index++]);
  assert.equal(index, Object.keys(OCULOID_DEFAULTS).length);
  assert.deepEqual(before, OCULOID_DEFAULTS, "dice must not mutate the held state");
  for (const key of Object.keys(OCULOID_DEFAULTS)) {
    assert.notEqual(result[key], before[key], `${key} must not be a frozen dice field`);
  }
  assert.deepEqual(normalizeOculoid(result), result);
  assert.deepEqual(randomizeOculoid(before, () => 0), randomizeOculoid(before, () => 0));
});

test("each animation dice chooses a different moving style without rewriting the other part", () => {
  for (const styles of [OCULOID_EYEBALL_STYLES, OCULOID_EYELID_STYLES]) {
    for (const { id } of styles) {
      for (const value of [0, 0.35, 0.999999, 1, -1, Infinity, NaN]) {
        const chosen = randomOculoidStyle(styles, id, () => value);
        assert.ok(styles.some(style => style.id === chosen), chosen);
        assert.notEqual(chosen, id);
        assert.notEqual(chosen, "still", "dice must animate; Still is an explicit selection");
      }
      assert.equal(randomOculoidStyle(styles, id, () => 0.35),
        randomOculoidStyle(styles, id, () => 0.35));
    }
  }
});

test("MIDI's latest held note, velocity, sustain, bend and scoped panic recover the manual eye", () => {
  const midi = new OculoidMidiState(), base = normalizeOculoid(OCULOID_DEFAULTS);
  assert.deepEqual(midi.performance(base), base);
  assert.equal(midi.handle(note("noteOn", 69, 127, "a")), true);
  const first = midi.performance(base);
  assert.equal(first.midiHz, 440);
  assert.ok(first.pupil > base.pupil);
  assert.notEqual(first.gazeX, base.gazeX);
  assert.deepEqual(base, OCULOID_DEFAULTS, "MIDI expression must not rewrite a preset");
  midi.handle({ type: "pitchBend", sourceId: "a", channel: 0, normalized: 1 });
  assert.ok(Math.abs(midi.performance(base).midiHz - 440 * 2 ** (2 / 12)) < 1e-6);
  midi.handle(note("noteOn", 60, 30, "b", 2));
  assert.ok(Math.abs(midi.performance(base).midiHz - 261.6255653) < 0.01);
  midi.handle(note("noteOff", 60, 0, "b", 2));
  assert.ok(midi.performance(base).midiHz > 490, "the previous note returns");
  midi.handle(cc(64, 127, "a"));
  midi.handle(note("noteOff", 69, 0, "a"));
  assert.ok(midi.performance(base).midiHz > 490, "CC64 retains the released note");
  midi.handle(cc(64, 0, "a"));
  assert.deepEqual(midi.performance(base), base, "pedal release restores the manual eye");
  assert.equal(midi.handle(note("noteOn", 200)), false);
  midi.handle(note("noteOn", 55, 90, "a", 3));
  midi.handle(note("noteOn", 57, 90, "b", 5));
  midi.handle({ ...cc(120, 0, "a"), synthetic: true });
  assert.equal(midi.performance(base).midiHz, 220);
  midi.handle({ ...cc(120, 0, "web-midi:manager"), synthetic: true });
  assert.deepEqual(midi.performance(base), base);
  for (let n = 0; n < 50; n++) midi.handle(note("noteOn", n));
  assert.equal(midi.notes.size, 24);
  midi.clear();
  assert.equal(midi.notes.size, 0);
});

test("armed but motionless is silent; manual gaze and lid gestures excite short bounded sounds", () => {
  const idle = renderVoice(OCULOID_DEFAULTS);
  assert.ok(idle.left.every(sample => sample === 0), "Audio on must not create a drone");
  assert.ok(idle.right.every(sample => sample === 0));
  assert.equal(renderVoice({ ...OCULOID_DEFAULTS, motion: 0 }, { playing: true }).peak, 0);
  const neutral = renderVoice(OCULOID_DEFAULTS, { gesture: true });
  assert.ok(neutral.peak > 0.03 && neutral.peak < 0.6);
  assert.ok(neutral.leftRms > 0.005 && neutral.rightRms > 0.005);
  assert.ok(Math.abs(neutral.left.at(-1)) < 0.001, "the gesture fades toward silence");
  const left = renderVoice({ ...OCULOID_DEFAULTS, gazeX: -1 }, { gesture: true });
  const right = renderVoice({ ...OCULOID_DEFAULTS, gazeX: 1 }, { gesture: true });
  assert.ok(left.leftRms > left.rightRms * 1.5);
  assert.ok(right.rightRms > right.leftRms * 1.5);
  const closed = renderVoice({ ...OCULOID_DEFAULTS, blink: 1 }, { gesture: true });
  assert.ok(closed.leftRms < neutral.leftRms * 0.5);
  const lifted = renderVoice({ ...OCULOID_DEFAULTS, lowerLid: -1 }, { gesture: true });
  assert.ok(lifted.leftRms < neutral.leftRms * 0.65);
  const blink = renderVoice(OCULOID_DEFAULTS, { gesture: { blink: 1 } });
  const lower = renderVoice(OCULOID_DEFAULTS, { gesture: { lowerLid: -0.4 } });
  const pupil = renderVoice(OCULOID_DEFAULTS, { gesture: { pupil: 0.9 } });
  assert.ok(blink.peak > 0.02 && lower.peak > 0.01,
    "each lid can sound independently without a held note");
  assert.ok(pupil.peak > 0.01 && pupil.peak < 0.6,
    "a manual pupil movement also excites a brief sound");
  assert.ok([...neutral.left, ...left.right, ...right.left, ...blink.right].every(Number.isFinite));

  const synth = new OculoidDsp(48000);
  synth.setConfig(OCULOID_DEFAULTS);
  synth.enabled = true;
  const l = new Float32Array(4800), r = new Float32Array(4800);
  synth.render(l, r, 0);
  synth.setConfig({ ...OCULOID_DEFAULTS, gazeX: 0.6 });
  synth.render(l, r, 0.1);
  assert.ok(l.some(sample => Math.abs(sample) > 0.005));
  synth.enabled = false;
  synth.render(l, r, 0.2);
  assert.ok(l.some(sample => Math.abs(sample) > 0), "mute releases rather than cutting an active event");
  synth.render(l, r, 0.3);
  synth.render(l, r, 0.4);
  assert.ok(l.every(sample => sample === 0));
  synth.enabled = true;
  synth.render(l, r, 0.5);
  assert.ok(l.every(sample => sample === 0), "re-arming an idle eye must stay silent");
  synth.setConfig({ ...OCULOID_DEFAULTS, gazeX: -0.6 });
  synth.render(l, r, 0.6);
  assert.ok(l.some(sample => Math.abs(sample) > 0.005), "the next look can sound after re-arm");
});

test("pokes make short pressure-dependent stereo squelches without a held drone", () => {
  const strike = (pressure, pan = -0.65) => {
    const voice = new OculoidDsp(48000);
    voice.enabled = true;
    const l = new Float32Array(4800), r = new Float32Array(4800);
    voice.render(l, r, 0);
    voice.poke({ pressure, pan });
    voice.render(l, r, 0.1);
    return { voice, l, r, peak: voice.peak, rms: voice.rms };
  };
  const soft = strike(0.24), deep = strike(0.95);
  assert.ok(soft.peak > 0.01 && deep.peak > soft.peak * 1.15 && deep.peak < 0.6);
  assert.ok(soft.rms > 0.005 && deep.rms > soft.rms);
  assert.ok(deep.l.reduce((sum, x) => sum + x * x, 0)
    > deep.r.reduce((sum, x) => sum + x * x, 0) * 1.2);
  const { voice, l, r } = deep;
  for (let n = 2; n < 14; n++) voice.render(l, r, n * 0.1);
  assert.ok(l.every(sample => Math.abs(sample) < 0.0001),
    "holding pressure fades to silence instead of becoming a drone");
  voice.poke({ pressure: 0.95, travel: 0.5, pan: 0.65 });
  voice.render(l, r, 1.4);
  assert.ok(voice.peak > 0.01, "scrubbing a held eye produces another short event");
  assert.ok(r.reduce((sum, x) => sum + x * x, 0)
    > l.reduce((sum, x) => sum + x * x, 0));
  voice.poke({ pressure: 0, pan: 0.65 });
  voice.render(l, r, 1.5);
  assert.ok(voice.peak > 0.01, "release has its own small spring pop");
  for (let n = 16; n < 27; n++) voice.render(l, r, n * 0.1);
  assert.ok(l.every(sample => Math.abs(sample) < 0.0001));
  voice.poke({ pressure: 0.8, pan: Infinity, travel: Infinity });
  voice.poke({ pressure: 0, cancel: true });
  voice.render(l, r, 2.7);
  assert.ok(voice.peak < 0.001, "cancelling a gesture never makes a late release pop");
  voice.enabled = false;
  voice.poke({ pressure: 1 });
  voice.render(l, r, 2.8);
  for (let n = 29; n < 35; n++) voice.render(l, r, n * 0.1);
  assert.ok(l.every(sample => sample === 0));
  assert.ok([...deep.l, ...deep.r, ...l, ...r].every(Number.isFinite));
});

test("Stretch makes short, bounded hits; release decays and cancel is quiet", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
  voice.enabled = true;
  voice.render(l, r, 0);
  voice.surface({ kind: "stretch", strength: 0.86, pan: -0.7 });
  voice.render(l, r, 0.1);
  assert.ok(voice.peak > 0.007 && voice.peak < 0.6, "stretch is a safe, audible event");
  assert.ok(l.every(Number.isFinite) && r.every(Number.isFinite));
  assert.ok(l.reduce((sum, value) => sum + value * value, 0)
    > r.reduce((sum, value) => sum + value * value, 0), "stretch follows contact pan");
  for (let tail = 1; tail < 11; tail++) voice.render(l, r, 0.1 + tail * 0.1);
  assert.ok(voice.peak < 0.001, "stretch fades even if the pointer remains held");
  voice.surface({ kind: "stretch", strength: 1, pan: 0.8 });
  voice.render(l, r, 5);
  assert.ok(voice.peak > 0.01);
  voice.surface({ kind: "stretch", strength: 0.5, release: true, pan: 0.8 });
  voice.render(l, r, 5.1);
  assert.ok(voice.peak > 0.006, "spring release has its own small sound");
  voice.surface({ kind: "stretch", cancel: true });
  for (let tail = 2; tail < 14; tail++) voice.render(l, r, 5 + tail * 0.1);
  assert.ok(voice.peak < 0.001, "a stolen gesture cannot leave a drone");
  voice.enabled = false;
  voice.surface({ kind: "stretch", strength: 1 });
  voice.render(l, r, 6.5);
  voice.render(l, r, 6.6);
  assert.ok(l.every(sample => sample === 0), "touch must not arm Audio");
});

test("Tear emits one bounded stereo drop on the audio clock, even with Motion stopped", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
  voice.setCryTempo(120);
  voice.enabled = true;
  voice.render(l, r, 0);
  assert.equal(voice.playing, false);
  assert.equal(voice.peak, 0);
  voice.tear({ size: 1 });
  // Starting at 0.1s, the 2.08-beat release at 120 BPM lands at 1.14s,
  // exactly 1,920 samples into this block, not at a RAF/display timestamp.
  voice.render(l, r, 1.1);
  assert.ok(l.subarray(0, 1919).every(sample => sample === 0));
  assert.ok(voice.peak > 0.008 && voice.peak < 0.6);
  assert.ok(l.subarray(1920).every(Number.isFinite) && r.every(Number.isFinite));
  assert.ok(l.reduce((sum, sample) => sum + sample ** 2, 0)
    > r.reduce((sum, sample) => sum + sample ** 2, 0), "the medial drop pans left");
  for (let block = 12; block < 39; block++) voice.render(l, r, block / 10);
  assert.ok(voice.peak < 0.001 && l.every(sample => sample === 0));
  assert.equal(voice.tearMode, "off", "Tear cannot repeat or drone");
  voice.surface({ kind: "film", strength: 1 });
  voice.surface({ kind: "ripple", strength: 1 });
  voice.surface({ kind: "twist", strength: 1 });
  voice.render(l, r, 3.9);
  assert.equal(voice.peak, 0, "removed tools cannot produce hidden sounds");
});

test("a Tear release on a 128-sample block boundary is neither lost nor doubled", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(128), r = new Float32Array(128);
  voice.setCryTempo(200);
  voice.enabled = true;
  voice.render(l, r, 0);
  voice.tear({ size: 1 });
  let first = -1, latePeak = 0;
  for (let block = 1; block < 700; block++) {
    voice.render(l, r, block * 128 / 48000);
    if (first < 0 && voice.peak > 0.006) first = block;
    if (block > 500) latePeak = Math.max(latePeak, voice.peak);
  }
  assert.ok(first >= 234 && first <= 237, `the first release must land on its worklet boundary: ${first}`);
  assert.equal(voice.lastTearCycle, 0);
  assert.ok(latePeak < 0.001, "the one-shot should sound once, then stay quiet");
});

test("Cry loops every four beats independently of Motion; only Cry tempo edits affect its phase", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
  voice.setConfig({ ...OCULOID_DEFAULTS, tempo: 120, wetness: 0.9 });
  voice.setCryTempo(120);
  voice.enabled = true;
  voice.render(l, r, 0);
  voice.setCry({ active: true, beat: 0 });
  for (let block = 1; block < 6; block++) {
    voice.render(l, r, block / 10);
    assert.equal(voice.peak, 0);
  }
  voice.setCryTempo(60);
  assert.ok(Math.abs(voice.tearingBeatAt(0.6) - 1) < 1e-9);
  voice.setConfig({ ...OCULOID_DEFAULTS, tempo: 200, wetness: 0.9 });
  assert.ok(Math.abs(voice.tearingBeatAt(0.6) - 1) < 1e-9,
    "Motion BPM and preset changes must not restart or accelerate Cry");
  let hits = 0, midCycleQuiet = true, maxPeak = 0;
  for (let block = 6; block < 70; block++) {
    voice.render(l, r, block / 10);
    maxPeak = Math.max(maxPeak, voice.peak);
    if ([16, 56].includes(block)) {
      assert.ok(voice.peak > 0.008, `drop ${block} follows the preserved phase`);
      hits++;
    }
    if (block >= 27 && block <= 36 && voice.peak > 0.001) midCycleQuiet = false;
  }
  assert.equal(voice.playing, false);
  assert.equal(hits, 2);
  assert.ok(maxPeak < 0.6);
  assert.equal(midCycleQuiet, true, "the four-beat spaces between drops are silent");
  voice.setCry({ active: false });
  for (let block = 70; block < 120; block++) voice.render(l, r, block / 10);
  assert.equal(voice.peak, 0, "stopping Cry releases its scheduled events");
});

test("800 BPM Cry sounds four bounded drops per 1.2 seconds without speeding up Eye motion", () => {
  assert.deepEqual(OCULOID_CRY_TEMPO_RANGE, [35, 800]);
  const sampleRate = 48000, blockSize = 128;
  const voice = new OculoidDsp(sampleRate);
  const left = new Float32Array(blockSize), right = new Float32Array(blockSize);
  voice.setConfig({ ...OCULOID_DEFAULTS, tempo: 800, wetness: 1 });
  assert.equal(voice.config.tempo, 200, "Eye motion keeps its own 200 BPM maximum");
  voice.setCryTempo(800);
  assert.equal(voice.tearTempo, 800);
  voice.enabled = true;
  voice.setCry({ active: true, beat: 0 });
  const releases = [];
  let maxPeak = 0;
  for (let block = 0; block < Math.ceil(sampleRate * 1.12 / blockSize); block++) {
    const previousCycle = voice.lastTearCycle;
    const startTime = block * blockSize / sampleRate;
    voice.render(left, right, startTime);
    if (voice.lastTearCycle !== previousCycle)
      releases.push({ cycle: voice.lastTearCycle, time: startTime });
    maxPeak = Math.max(maxPeak, voice.peak);
    assert.ok(left.every(Number.isFinite) && right.every(Number.isFinite));
  }
  assert.deepEqual(releases.map(release => release.cycle), [0, 1, 2, 3]);
  for (const [index, release] of releases.entries())
    assert.ok(Math.abs(release.time - (0.156 + index * 0.3)) <= blockSize / sampleRate,
      `release ${index} should land on its audio-worklet block at 800 BPM`);
  assert.ok(maxPeak > 0.008 && maxPeak < 0.6, "rapid Cry remains audible and bounded");
  assert.equal(voice.playing, false);
  const beat = voice.tearingBeatAt(voice.audioTime);
  voice.setCryTempo(35);
  assert.ok(Math.abs(voice.tearingBeatAt(voice.audioTime) - beat) < 1e-9,
    "changing Cry tempo preserves its phase without restarting a tear");
  voice.setCryTempo(999);
  assert.equal(voice.tearTempo, 800, "out-of-range Cry tempo remains bounded");
});

test("Cry never plays a missed drop on late Audio arming or resumes a muted one-shot", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
  voice.tear({ size: 0.7 });
  voice.render(l, r, 1.1);
  assert.equal(voice.peak, 0, "Tear cannot silently arm Audio");
  voice.setCry({ active: false });
  voice.enabled = true;
  voice.render(l, r, 1.2);
  assert.equal(voice.peak, 0, "arming after a one-shot must not replay it");
  voice.setCryTempo(120);
  voice.setCry({ active: true, beat: 2.5 });
  voice.render(l, r, 1.3);
  assert.equal(voice.peak, 0, "joining an already-falling Cry cycle cannot trigger it late");
  for (let block = 14; block < 29; block++) voice.render(l, r, block / 10);
  assert.ok(voice.peak < 0.001);
  for (let block = 29; block < 32; block++) voice.render(l, r, block / 10);
  assert.ok(voice.peak > 0.008, "the next full Cry cycle still triggers");
});

test("different poke diameters change the next squelch without adding sustained sound", () => {
  const strike = diameter => {
    const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
    voice.enabled = true;
    voice.render(l, r, 0);
    voice.poke({ pressure: 0.8, diameter, pan: 0 });
    voice.render(l, r, 0.1);
    return { peak: voice.peak, samples: [...l.slice(0, 160)] };
  };
  const narrow = strike(0.12), broad = strike(0.92);
  assert.ok(narrow.peak > 0.01 && broad.peak > 0.01);
  assert.notDeepEqual(narrow.samples, broad.samples);
});

test("retracting the lids holds open the audio gate without changing the musical state", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
  voice.setConfig({ ...OCULOID_DEFAULTS, blink: 1, lowerLid: -1 });
  voice.enabled = true;
  voice.render(l, r, 0);
  voice.setRetractor(true);
  voice.render(l, r, 0.1);
  assert.ok(voice.peak > 0.005, "locking the lids makes one percussive click");
  for (let i = 2; i < 13; i++) voice.render(l, r, i * 0.1);
  assert.ok(voice.peak < 0.001);
  voice.setConfig({ ...OCULOID_DEFAULTS, blink: -0.5, lowerLid: 0.4 });
  voice.render(l, r, 1.3);
  assert.ok(voice.peak < 0.001, "hidden lid movement cannot keep sounding");
  assert.equal(voice.config.blink, -0.5);
  voice.setRetractor(false);
  voice.render(l, r, 1.4);
  assert.ok(voice.peak > 0.005);
  assert.equal(voice.config.lowerLid, 0.4, "release restores the stored configuration");
});

test("shining the flashlight on and off the iris excites short pupil sounds, not a tone", () => {
  const voice = new OculoidDsp(48000), l = new Float32Array(4800), r = new Float32Array(4800);
  voice.enabled = true;
  voice.render(l, r, 0);
  assert.equal(voice.peak, 0);
  voice.setFlashlight(0.8);
  voice.render(l, r, 0.1);
  assert.ok(voice.peak > 0.01 && voice.peak < 0.6);
  assert.ok([...l, ...r].every(Number.isFinite));
  for (let i = 2; i <= 15; i++) voice.render(l, r, i * 0.1);
  assert.ok(voice.peak < 0.001, "a held beam must fade to silence");
  voice.setFlashlight(0);
  voice.render(l, r, 1.6);
  assert.ok(voice.peak > 0.01, "moving the light away should release the pupil");
  for (let i = 17; i <= 28; i++) voice.render(l, r, i * 0.1);
  assert.ok(voice.peak < 0.001);
  voice.enabled = false;
  voice.setFlashlight(1);
  voice.render(l, r, 2.9);
  voice.render(l, r, 3);
  assert.ok(l.every(sample => sample === 0), "shining a light must never arm Audio");
  assert.equal(voice.config.pupil, OCULOID_DEFAULTS.pupil);
});

test("repeating the same MIDI note excites a new short event, without a held tone", () => {
  const synth = new OculoidDsp(48000);
  synth.setConfig({ ...OCULOID_DEFAULTS, midiHz: 440 });
  synth.enabled = true;
  const l = new Float32Array(4800), r = new Float32Array(4800);
  synth.render(l, r, 0);
  assert.ok(l.every(sample => sample === 0));
  synth.excite(0.9);
  synth.render(l, r, 0.1);
  assert.ok(l.some(sample => Math.abs(sample) > 0.01));
  for (let i = 2; i < 8; i++) synth.render(l, r, i * 0.1);
  assert.ok(l.every(sample => Math.abs(sample) < 0.0001));
  synth.excite(0.9);
  synth.render(l, r, 0.8);
  assert.ok(l.some(sample => Math.abs(sample) > 0.01));
});

test("independent eye and lid animations excite audio-clock events without a drone", () => {
  const paired = [
    ...OCULOID_EYEBALL_STYLES.filter(style => style.id !== "still")
      .map(style => [style.id, "still"]),
    ...OCULOID_EYELID_STYLES.filter(style => style.id !== "still")
      .map(style => ["still", style.id]),
    ["wild", "flutter"],
  ];
  for (const [eyeballStyle, eyelidStyle] of paired) {
    const settings = { ...OCULOID_DEFAULTS, eyeballStyle, eyelidStyle, tempo: 160, motion: 1 };
    const take = renderVoice(settings, { playing: true, seconds: 2 });
    assert.ok(take.peak > 0.01 && take.peak < 0.6, `${eyeballStyle}/${eyelidStyle}`);
    assert.ok(take.left.every(Number.isFinite) && take.right.every(Number.isFinite));
  }
  const held = renderVoice({ ...OCULOID_DEFAULTS, eyeballStyle: "still",
    eyelidStyle: "still", motion: 1 }, { playing: true, seconds: 2 });
  assert.ok(held.left.every(sample => sample === 0) && held.right.every(sample => sample === 0),
    "two Still selectors stay quiet even when Play is on");
});

test("independent gaze voices take turns, harmonize and stay bounded beside the lid rhythm", () => {
  const settings = { ...OCULOID_DEFAULTS, eyeballStyle: "wild",
    eyelidStyle: "still", tempo: 154, motion: 1 };
  const together = renderVoice(settings, {
    seconds: 2.2, playing: true, ensemble: { count: 4, style: "together" },
  });
  for (const style of ["banter", "harmony", "rock"]) {
    const take = renderVoice(settings, {
      seconds: 2.2, playing: true, ensemble: { count: 4, style },
    });
    assert.ok(take.peak > 0.005 && take.peak < 0.85,
      `${style}: four eyes must be audible but safely below clipping`);
    assert.ok(take.synth.eyeVoices.slice(0, 4).some(voice => voice.lastGazeEvent > 0),
      `${style}: independent moves excite the corresponding voices`);
    assert.ok(take.left.every(Number.isFinite) && take.right.every(Number.isFinite));
    assert.ok(take.synth.eyeVoices[3].pan - take.synth.eyeVoices[0].pan > 0.6,
    `${style}: separate left and right eyes follow their own stereo positions`);
    assert.ok(take.left.some((sample, index) => Math.abs(sample - take.right[index]) > 0.001),
      `${style}: the two output channels really differ`);
    assert.notDeepEqual(take.left.subarray(4000, 5000), together.left.subarray(4000, 5000),
      "choosing an ensemble changes sound, not just the animation");
  }
  const silent = renderVoice({ ...settings, eyeballStyle: "still" }, {
    playing: true, seconds: 0.5, ensemble: { count: 3, style: "banter" },
  });
  assert.equal(silent.peak, 0, "Motion with Still eyes and lids must not be a drone");
  const lidOnly = renderVoice({ ...settings, eyeballStyle: "still",
    eyelidStyle: "flutter", lidRate: 2 }, {
    playing: true, seconds: 1, ensemble: { count: 4, style: "banter" },
  });
  assert.ok(lidOnly.peak > 0.01 && lidOnly.synth.eyeVoices.every(voice =>
    voice.lastGazeEvent === -Infinity), "the lid plays its own fast rhythmic part");
  const naked = renderVoice({ ...settings, eyeballStyle: "still",
    eyelidStyle: "flutter", lidRate: 2 }, {
    playing: true, seconds: 1, ensemble: { count: 4, style: "banter" },
    lidsVisible: false,
  });
  assert.equal(naked.peak, 0, "hiding the lids removes their rhythm without silencing the eyes");
  const switcher = new OculoidDsp(48000);
  switcher.setConfig({ ...settings, eyeballStyle: "still" });
  switcher.setEnsemble({ count: 4, style: "harmony" });
  switcher.enabled = true;
  const left = new Float32Array(128), right = new Float32Array(128);
  switcher.render(left, right, 0);
  switcher.excite(1);
  switcher.render(left, right, 128 / 48000);
  assert.ok(left.some(value => Math.abs(value) > 0.01));
  switcher.setEnsemble({ count: 1, style: "banter" });
  switcher.setEnsemble({ count: 4, style: "harmony" });
  switcher.render(left, right, 256 / 48000);
  assert.ok(left.every(value => value === 0) && right.every(value => value === 0),
    "returning to a multi-eye layout cannot resurrect a discarded voice tail");
});

test("mouth props and eye clothing change the next event without creating a held tone", () => {
  const lidSettings = { ...OCULOID_DEFAULTS, eyeballStyle: "still", eyelidStyle: "still" };
  const plainLid = renderVoice(lidSettings, { gesture: { blink: 0.8 } });
  const dressedLid = renderVoice(lidSettings, {
    gesture: { blink: 0.8 },
    wardrobe: { tongue: true, teeth: true, mustache: true, lipstick: true },
  });
  const eye = renderVoice(lidSettings, { gesture: true });
  const clothedEye = renderVoice(lidSettings, {
    gesture: true,
    wardrobe: { cigar: true, sunglasses: true, coat: true,
      scarf: true, hat: "top", catEars: true, bowTie: true },
  });
  const difference = (a, b) => Math.sqrt(a.reduce((sum, sample, index) =>
    sum + (sample - b[index]) ** 2, 0) / a.length);
  assert.ok(plainLid.peak > 0.01 && dressedLid.peak > 0.01);
  assert.ok(difference(plainLid.left, dressedLid.left) > 0.01,
    "a tongue and teeth make lid strikes fuller; mustache and lipstick soften the edge");
  assert.ok(difference(eye.left, clothedEye.left) > 0.005,
    "cigar, shades and clothes shape subsequent eye squishes");
  assert.equal(renderVoice(lidSettings, { seconds: 0.4,
    wardrobe: { tongue: true, teeth: true, cigar: true } }).peak, 0,
  "clothes change the next note, but touching a toggle cannot start a drone");
});

test("every eye texture control changes a gesture sound and all 36 scenes stay bounded", () => {
  for (const key of ["pupil", "tone", "air", "wetness", "veins", "irisTint"]) {
    const low = renderVoice({ ...OCULOID_DEFAULTS, [key]: 0 }, { gesture: true });
    const high = renderVoice({ ...OCULOID_DEFAULTS, [key]: 1 }, { gesture: true });
    let energy = 0;
    // Compare a shared gesture's audible window, not silence after it dies out.
    for (let i = 4400; i < 16000; i++) {
      energy += (low.left[i] - high.left[i]) ** 2 + (low.right[i] - high.right[i]) ** 2;
    }
    assert.ok(Math.sqrt(energy / (2 * (16000 - 4400))) > 0.002,
      `${key} must change the actual stereo sound`);
  }
  for (const preset of OCULOID_PRESETS) {
    const voice = renderVoice(preset.snapshot, { gesture: true });
    assert.ok(voice.peak > 0.01 && voice.peak < 0.6, preset.id);
    assert.ok(voice.left.every(Number.isFinite) && voice.right.every(Number.isFinite), preset.id);
  }
});

test("the compact attributed drop preserves its pointed shape without embedding source textures", async () => {
  const drop = await readFile(new URL("../assets/oculoid/drop.glb", import.meta.url));
  const license = await readFile(new URL("../assets/oculoid/SOURCE.LICENSE.txt", import.meta.url), "utf8");
  const notices = await readFile(new URL("../docs/THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  assert.equal(drop.toString("ascii", 0, 4), "glTF");
  assert.ok(drop.length < 25_000, "the optional drop must not carry a 2.6 MB texture atlas");
  const checksum = createHash("sha256").update(drop).digest("hex");
  assert.equal(checksum, "94a1e1ce9d70cde8fdeb7805ad23d3279142e5e82cc01b6bbaa6ad8d3c999f05");
  assert.ok(license.includes(checksum));
  const jsonLength = drop.readUInt32LE(12);
  const model = JSON.parse(drop.subarray(20, 20 + jsonLength).toString("utf8"));
  assert.equal(model.asset.extras.author, "plaggy (https://sketchfab.com/plaggy)");
  assert.match(model.asset.extras.license, /^CC-BY-4\.0/);
  assert.match(model.asset.extras.source, /sketchfab\.com\/3d-models\/cc0-drops-/);
  assert.equal(model.asset.extras.morphazoid.source_sha256,
    "db1a15a107dcd74404110a802ad58910c72080cb81466e223d81d9edcd255076");
  assert.match(license, /NOT CC0 \/ public domain/);
  assert.match(notices, /GLB's embedded license is \*\*CC BY 4\.0\*\*, not CC0/);
  assert.equal(model.images, undefined);
  assert.equal(model.textures, undefined);
  assert.equal(model.materials, undefined);
  assert.equal(model.animations, undefined);
  assert.equal(model.accessors[0].count, 526);
  assert.equal(model.accessors[2].count, 2880);
  assert.equal(model.meshes[0].name, "Drops_Drops_0");
  const binStart = 20 + jsonLength + 8;
  const positionsStart = binStart + model.bufferViews[0].byteOffset;
  const tip = [], bulb = [];
  for (let v = 0; v < model.accessors[0].count; v++) {
    const offset = positionsStart + v * 12;
    const radius = Math.hypot(drop.readFloatLE(offset), drop.readFloatLE(offset + 4));
    const z = drop.readFloatLE(offset + 8);
    if (z > 0.65) tip.push(radius);
    if (z > -0.55 && z < -0.25) bulb.push(radius);
  }
  assert.ok(tip.length > 0 && bulb.length > 0);
  assert.ok(Math.max(...tip) < Math.max(...bulb) * 0.25,
    "the asset should have an actual tapered tip, unlike the fallback sphere");
});

test("the source page, attributed GLBs and non-placeholder WebP are release inputs", async () => {
  const page = await readFile(new URL("../src/pages/oculoid.html", import.meta.url), "utf8");
  const model = await readFile(new URL("../assets/oculoid/eye.glb", import.meta.url));
  const aviators = await readFile(new URL("../assets/oculoid/aviator-sunglasses.glb", import.meta.url));
  const icon = await readFile(new URL("../assets/instruments/oculoid.webp", import.meta.url));
  const license = await readFile(new URL("../assets/oculoid/SOURCE.LICENSE.txt", import.meta.url), "utf8");
  const notices = await readFile(new URL("../docs/THIRD_PARTY_NOTICES.md", import.meta.url), "utf8");
  const manifest = await readFile(new URL("../scripts/site/runtime-files.tsv", import.meta.url), "utf8");
  assert.match(page, /data-primary-transport/);
  assert.match(page, /id="audioButton"/);
  assert.match(page, /id="eyeCanvas"[^>]*aria-label=/);
  assert.match(page, /src\/instruments\/oculoid\/oculoid-app\.js/);
  assert.doesNotMatch(page, /wax-host-bootstrap/);
  assert.ok((await stat(new URL("../docs/oculoid.md", import.meta.url))).size > 2000);
  assert.ok(model.length > 1_000_000);
  assert.equal(model.toString("ascii", 0, 4), "glTF");
  assert.equal(aviators.toString("ascii", 0, 4), "glTF");
  assert.ok(aviators.length > 1_600_000, "the full model is local, not a remote-only placeholder");
  assert.equal(createHash("sha256").update(aviators).digest("hex"),
    "0b451ae77d125dfff18b4b25734d7bdaca5d2bfbcc15b63c3617f54d1e4c483f");
  const jsonLength = aviators.readUInt32LE(12);
  const scene = JSON.parse(aviators.subarray(20, 20 + jsonLength).toString("utf8"));
  assert.match(scene.asset.extras.author, /Kimppo/);
  assert.match(scene.asset.extras.license, /CC-BY-4\.0/);
  assert.match(scene.asset.extras.source, /00d1cb5aa82745228a3b764c97f867de/);
  assert.equal(scene.meshes.length, 5, "the original aviator frames and lenses are present");
  assert.ok(scene.materials.some(material => material.name === "Glass_tinted"));
  assert.equal(icon.toString("ascii", 0, 4), "RIFF");
  assert.equal(icon.toString("ascii", 8, 12), "WEBP");
  assert.ok(icon.length > 10_000);
  assert.match(license, /CC BY 4\.0/);
  assert.match(license, /DEGUIDER/);
  assert.match(license, /aviator-sunglasses\.glb SHA-256/);
  assert.match(notices, /Kimppo/);
  assert.match(page, /Kimppo/);
  for (const path of ["assets/oculoid/eye.glb", "assets/oculoid/drop.glb",
    "assets/oculoid/aviator-sunglasses.glb",
    "assets/oculoid/SOURCE.LICENSE.txt",
    "assets/instruments/oculoid.webp", "docs/oculoid.md",
    "src/instruments/oculoid/oculoid-midi.js"]) {
    assert.ok(manifest.includes(`copy+require\t${path}\n`), path);
  }
  assert.ok(!manifest.includes("\toculoid.html\n"), "canonical routes are copied from src/pages");
});
