import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fingerprintHiccupHead } from "../scripts/fingerprint-hiccup-head.mjs";

const platePathname = "./assets/audio/hiccup-head-emt140-warm-plate.wav";
const cathedralPathname = "./assets/audio/hiccup-head-york-minster-warm-hall.wav";

function contentVersion(source) {
  return createHash("sha256").update(source).digest("hex").slice(0, 12);
}

test("Hiccup Head publish fingerprints follow both warm room impulse contents", async (t) => {
  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "hiccup-fingerprint-"));
  t.after(() => rm(outputDirectory, { recursive: true, force: true }));
  await Promise.all([
    mkdir(path.join(outputDirectory, "src"), { recursive: true }),
    mkdir(path.join(outputDirectory, "assets", "audio"), { recursive: true }),
  ]);

  const firstPlate = Buffer.from("first warm plate impulse");
  const cathedral = Buffer.from("stable warm cathedral impulse");
  await Promise.all([
    writeFile(path.join(outputDirectory, "src", "hiccup-head.js"), "export const model = true;\n"),
    writeFile(
      path.join(outputDirectory, "src", "hiccup-head-processor.js"),
      'import "./hiccup-head.js?v=stale-model";\n',
    ),
    writeFile(
      path.join(outputDirectory, "hiccup-head-app.js"),
      [
        'import "./src/hiccup-head.js?v=stale-model";',
        'const processor = new URL("./src/hiccup-head-processor.js?v=stale-processor", import.meta.url);',
        `const plate = new URL("${platePathname}?v=stale-plate", import.meta.url);`,
        `const cathedral = new URL("${cathedralPathname}", import.meta.url);`,
        "void processor; void plate; void cathedral;",
        "",
      ].join("\n"),
    ),
    writeFile(path.join(outputDirectory, "hiccup-head.css"), ".face { display: block; }\n"),
    writeFile(
      path.join(outputDirectory, "hiccup-head.html"),
      [
        '<link rel="preload" href="assets/audio/hiccup-head-emt140-warm-plate.wav?v=stale-plate">',
        '<link rel="preload" href="assets/audio/hiccup-head-york-minster-warm-hall.wav">',
        '<link rel="stylesheet" href="hiccup-head.css?v=stale-css">',
        '<script type="module" src="hiccup-head-app.js?v=stale-app"></script>',
        "",
      ].join("\n"),
    ),
    writeFile(path.join(outputDirectory, platePathname), firstPlate),
    writeFile(path.join(outputDirectory, cathedralPathname), cathedral),
  ]);

  const first = await fingerprintHiccupHead(outputDirectory);
  const firstApp = await readFile(path.join(outputDirectory, "hiccup-head-app.js"), "utf8");
  const firstHtml = await readFile(path.join(outputDirectory, "hiccup-head.html"), "utf8");
  const firstPlateVersion = contentVersion(firstPlate);
  const cathedralVersion = contentVersion(cathedral);
  assert.equal(first.roomImpulseVersions[platePathname], firstPlateVersion);
  assert.equal(first.roomImpulseVersions[cathedralPathname], cathedralVersion);
  assert.match(firstApp, new RegExp(`${platePathname.replaceAll(".", "\\.")}\\?v=${firstPlateVersion}`));
  assert.match(
    firstApp,
    new RegExp(`${cathedralPathname.replaceAll(".", "\\.")}\\?v=${cathedralVersion}`),
  );
  assert.match(firstHtml, new RegExp(`hiccup-head-app\\.js\\?v=${first.appVersion}`));
  assert.match(firstHtml, new RegExp(`hiccup-head-emt140-warm-plate\\.wav\\?v=${firstPlateVersion}`));
  assert.match(firstHtml, new RegExp(`hiccup-head-york-minster-warm-hall\\.wav\\?v=${cathedralVersion}`));

  const secondPlate = Buffer.from("changed and reprocessed warm plate impulse");
  await writeFile(path.join(outputDirectory, platePathname), secondPlate);
  const second = await fingerprintHiccupHead(outputDirectory);
  const secondApp = await readFile(path.join(outputDirectory, "hiccup-head-app.js"), "utf8");
  const secondHtml = await readFile(path.join(outputDirectory, "hiccup-head.html"), "utf8");
  const secondPlateVersion = contentVersion(secondPlate);
  assert.notEqual(secondPlateVersion, firstPlateVersion);
  assert.notEqual(second.appVersion, first.appVersion);
  assert.equal(second.roomImpulseVersions[platePathname], secondPlateVersion);
  assert.equal(second.roomImpulseVersions[cathedralPathname], cathedralVersion);
  assert.match(secondApp, new RegExp(`${platePathname.replaceAll(".", "\\.")}\\?v=${secondPlateVersion}`));
  assert.doesNotMatch(secondApp, new RegExp(`stale-|${firstPlateVersion}`));
  assert.match(secondHtml, new RegExp(`hiccup-head-app\\.js\\?v=${second.appVersion}`));
  assert.match(secondHtml, new RegExp(`hiccup-head-emt140-warm-plate\\.wav\\?v=${secondPlateVersion}`));

  const secondCathedral = Buffer.from("changed and reprocessed warm cathedral impulse");
  await writeFile(path.join(outputDirectory, cathedralPathname), secondCathedral);
  const third = await fingerprintHiccupHead(outputDirectory);
  const thirdApp = await readFile(path.join(outputDirectory, "hiccup-head-app.js"), "utf8");
  const thirdCathedralVersion = contentVersion(secondCathedral);
  assert.notEqual(third.appVersion, second.appVersion);
  assert.equal(third.roomImpulseVersions[platePathname], secondPlateVersion);
  assert.equal(third.roomImpulseVersions[cathedralPathname], thirdCathedralVersion);
  assert.match(
    thirdApp,
    new RegExp(`${cathedralPathname.replaceAll(".", "\\.")}\\?v=${thirdCathedralVersion}`),
  );
  assert.doesNotMatch(thirdApp, new RegExp(cathedralVersion));

  const fourth = await fingerprintHiccupHead(outputDirectory);
  assert.deepEqual(fourth, third, "fingerprinting the same artifact twice must be idempotent");
  assert.equal(
    await readFile(path.join(outputDirectory, "hiccup-head-app.js"), "utf8"),
    thirdApp,
  );
});
