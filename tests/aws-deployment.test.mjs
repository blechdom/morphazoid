import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const root = new URL("../", import.meta.url);

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

test("site builder publishes runtime files without development material", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "morphazoid-site-"));
  const output = join(temporary, "public");
  try {
    await execFileAsync("bash", ["scripts/build-site.sh", output], {
      cwd: root,
    });

    for (const path of [
      "index.html",
      "shape.html",
      "about.html",
      "about.css",
      "THIRD_PARTY_NOTICES.md",
      "music-rooms.html",
      "music-rooms.css",
      "vocal-effects-room.html",
      "instrument-share-room.html",
      "morphazoid-roulette.html",
      "assets/instruments/drum-roll-please.webp",
      "assets/instruments/image-to-instrument-3.webp",
      "image-to-instrument-3.html",
      "image-to-instrument-app.js",
      "wheel-of-organs-app.js",
      "image-to-instrument.css",
      "src/image-to-instrument.js",
      "src/wheel-of-organs.js",
      "src/wheel-of-organs-audio.js",
      "spelling-synthesizer.html",
      "spelling-synthesizer.css",
      "spelling-synthesizer-app.js",
      "src/spelling-synthesizer.js",
      "src/spelling-synthesizer-audio.js",
      "src/spelling-diphone-atlas.js",
      "src/spelling-pronunciation.js",
      "src/spelling-vocoder-processor.js",
      "assets/audio/spelling-diphone-kal16.wav",
      "assets/instruments/spelling-synthesizer.webp",
      "vendor/cmudict/cmudict-en-us.dict",
      "vendor/cmudict/LICENSE",
      "plugins.html",
      "plugins.css",
      "plugins-app.js",
      "src/plugin-catalog.js",
      "src/midi-manager.js",
      "src/shape-midi.js",
      "src/fm-drums-midi.js",
      "sample-drums.html",
      "sample-drums.css",
      "sample-drums-app.js",
      "src/sample-drums.js",
      "downloads/plugins/chaotic-fm/0.2.1/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "downloads/plugins/chaotic-fm/0.2.2/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "downloads/plugins/chaotic-fm/0.2.3/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "downloads/plugins/chaotic-fm/0.3.0/reaper-jsfx/Morphazoid_Chaotic_FM.jsfx",
      "app.js",
      "src/audio.js",
      "src/contour-synth-processor.js",
      "l-mic.html",
      "micmic.html",
      "micmic-app.js",
      "micmic.css",
      "shepard-risset.html",
      "shepard-risset-app.js",
      "src/shepard-risset.js",
      "drum-roll-please.html",
      "drum-roll-please.css",
      "drum-roll-please-app.js",
      "src/drum-roll-please.js",
      "candy-coil-delay.html",
      "striped-sludge-delay.html",
      "sandy-syrup-delay.html",
      "barber-delay.css",
      "barber-delay-app.js",
      "src/barber-delay.js",
      "recursive-fm.html",
      "recursive-fm-app.js",
      "src/recursive-fm.js",
      "recursive-pm.html",
      "recursive-pm.css",
      "recursive-pm-app.js",
      "src/recursive-pm.js",
      "src/recursive-pm-midi.js",
      "chaotic-fm.html",
      "chaotic-fm.css",
      "chaotic-fm-app.js",
      "src/chaotic-fm.js",
      "src/chaotic-fm-flow.js",
      "chaotic-pm.html",
      "chaotic-pm.css",
      "chaotic-pm-app.js",
      "src/chaotic-pm.js",
      "webgpu-303.html",
      "webgpu-303.css",
      "webgpu-303-app.js",
      "src/webgpu-303.js",
      "weierstrass.html",
      "weierstrass.css",
      "weierstrass-app.js",
      "src/weierstrass.js",
      "algorithmic-sequencers.html",
      "algorithmic-sequencers.css",
      "algorithmic-sequencers-app.js",
      "src/algorithmic-sequencers.js",
      "algorithmic-scores.html",
      "algorithmic-scores.css",
      "algorithmic-scores-app.js",
      "src/algorithmic-scores.js",
      "dijkstra.html",
      "hanoi.html",
      "minimax.html",
      "nqueens.html",
      "euclid.html",
      "gravity-walk.html",
      "ricochet.html",
      "rigidity.html",
      "rolling-measure.html",
      "falling-forms.html",
      "charge-garden.html",
      "packing-pressure.html",
      "geodesic-drift.html",
      "kinetic-hull.html",
      "physics.css",
      "physics-app.js",
      "src/physics-common.js",
      "src/physics-scenes-shape.js",
      "src/physics-scenes-advanced.js",
      "src/physics-scenes.js",
      "quantum-synths.css",
      "order-tones.html",
      "order-tones-app.js",
      "src/order-tones.js",
      "bell-square.html",
      "bell-square-app.js",
      "src/bell-square.js",
      "annealogue.html",
      "annealogue-app.js",
      "src/annealogue.js",
      "plasma-ball.html",
      "plasma-ball.css",
      "plasma-ball-app.js",
      "src/plasma-ball.js",
      "assets/instruments/plasma-ball.webp",
      "moire-organ.html",
      "chladni-plate.html",
      "spring-choir.html",
      "gear-ratio-drums.html",
      "cellular-automata.html",
      "prime-sieve.html",
      "lissajous-orbits.html",
      "pendulum-wave.html",
      "double-pendulum.html",
      "reaction-diffusion.html",
      "atomic-orbitals.html",
      "dna-translator.html",
      "neural-pulse.html",
      "fourier-epicycles.html",
      "gravity-lens.html",
      "experiments.css",
      "experiments-app.js",
      "shape-drums.html",
      "shape-drums.css",
      "shape-drums-app.js",
      "src/shape-drums.js",
      "escher-tessellation.html",
      "escher-tessellation.css",
      "escher-tessellation-app.js",
      "src/escher-tessellation.js",
      "src/escher-contours.js",
      "src/escher-performance-audio.js",
      "assets/instruments/escher-tessellation.webp",
      "solid-drums.html",
      "solid-drums.css",
      "solid-drums-app.js",
      "src/solid-drums.js",
      "rubix.html",
      "rubix.css",
      "rubix-app.js",
      "src/rubix.js",
      "src/rubix-visibility.js",
      "assets/instruments/rubix.webp",
      "hyper-drums.html",
      "hyper-drums.css",
      "hyper-drums-app.js",
      "src/hyper-drums.js",
      "l-system-drums.html",
      "l-system-drums.css",
      "l-system-drums-app.js",
      "src/l-system-drums.js",
      "linear-drums.html",
      "linear-drums.css",
      "linear-drums-app.js",
      "src/linear-drums.js",
      "linear-drums-machine.html",
      "linear-drums-machine.css",
      "linear-drums-machine-app.js",
      "src/linear-drums-machine.js",
      "assets/lumber-loops-wood-loop.webp",
      "morphazoidical/index.html",
      "morphazoidical/PLAN.md",
      "vendor/signalsmith-stretch/LICENSE",
      "vendor/signalsmith-stretch/SignalsmithStretch.mjs",
      "vendor/tactile/tactile.js",
    ]) {
      assert.equal(await exists(join(output, path)), true, `missing ${path}`);
    }

    const publishedNavigation = await readFile(join(output, "nav.js"), "utf8");
    assert.match(
      publishedNavigation,
      /from "\.\/src\/midi-manager\.js"/,
      "the published navigation must resolve its shared MIDI manager import",
    );

    const publishedNotices = await readFile(
      join(output, "THIRD_PARTY_NOTICES.md"),
      "utf8",
    );
    assert.match(
      publishedNotices,
      /CMU Flite \/ KAL16 diphone voice/,
      "the packaged sample atlas must travel with its full third-party notice",
    );
    assert.match(
      publishedNotices,
      /PocketSphinx English pronunciation dictionary/,
      "the packaged pronunciation dictionary must travel with its full third-party notice",
    );

    for (const path of [
      "tests",
      ".github",
      "scripts",
      "package.json",
      "README.md",
      ".preview-cdp.ps1",
      ".throatazoid-preview.png",
      "audio-engine-lab.html",
      "src/audio-engine-lab.js",
      "analyzer.html",
      "analyzer-app.js",
      "src/analyzer.js",
      "assets/instruments/image-to-instrument-1.webp",
      "assets/instruments/image-to-instrument-2.webp",
      "image-to-instrument-1.html",
      "image-to-instrument-2.html",
    ]) {
      assert.equal(await exists(join(output, path)), false, `published ${path}`);
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("CloudFormation keeps the origin private and CI permissions narrow", async () => {
  const template = await readFile(new URL("../infra/site.yml", import.meta.url), "utf8");

  assert.match(template, /BlockPublicAcls:\s+true/);
  assert.match(template, /ObjectOwnership:\s+BucketOwnerEnforced/);
  assert.match(template, /SigningBehavior:\s+always/);
  assert.match(template, /OriginAccessControlId:/);
  assert.match(template, /ValidationMethod:\s+DNS/);
  assert.match(template, /HostedZoneId:\s+Z2FDTNDATAQYW2/);
  assert.match(template, /Type:\s+AAAA/);
  assert.match(template, /Runtime:\s+cloudfront-js-2\.0/);
  assert.match(template, /request\.uri\.endsWith\('\/'\)/);
  assert.match(template, /token\.actions\.githubusercontent\.com:sub:\s+!Ref GitHubOidcSubject/);
  assert.match(template, /Header:\s+Permissions-Policy/);
  assert.match(template, /Sid:\s+DenyInsecureTransport/);
  assert.match(template, /cloudfront:CreateInvalidation/);
  assert.doesNotMatch(template, /PolicyName:[\s\S]*?route53:\*/);
  assert.doesNotMatch(template, /PolicyName:[\s\S]*?iam:\*/);
});

test("AWS workflow verifies before OIDC deployment and uses repository variables", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-aws.yml", import.meta.url), "utf8");

  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /push:\s*\n\s+branches:\s+\[main\]/);
  assert.match(workflow, /npm run verify/);
  assert.match(workflow, /actions\/upload-artifact@v7/);
  assert.match(workflow, /actions\/download-artifact@v8/);
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v6\.2\.3/);
  assert.match(workflow, /id-token:\s+write/);
  assert.match(workflow, /environment:\s*\n\s+name:\s+production/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /vars\.AWS_ACCOUNT_ID/);
  assert.match(workflow, /allowed-account-ids:\s+\$\{\{\s+vars\.AWS_ACCOUNT_ID\s+\}\}/);
  assert.match(workflow, /vars\.AWS_DEPLOY_ROLE_ARN/);
  assert.match(workflow, /vars\.AWS_SITE_BUCKET/);
  assert.match(workflow, /vars\.AWS_CLOUDFRONT_DISTRIBUTION_ID/);
  assert.match(workflow, /cloudfront wait invalidation-completed/);
  assert.match(workflow, /https:\/\/morphazoid\.com\/morphazoidical\//);
  assert.doesNotMatch(workflow, /AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY/);
});
