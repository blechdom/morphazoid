import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addSocialPreviews,
  BRAND_MARK_PATH,
  SOCIAL_IMAGE_PATH,
  SOCIAL_IMAGE_URL,
  withSocialPreview,
} from "../scripts/social-preview.mjs";

const root = new URL("../", import.meta.url);
const sample = `<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>MIDI &amp; "WAX" — Morphazoid</title>
  <meta content='A &quot;playable&quot; &amp; safe &lt;instrument&gt;.' name='description'>
  <link rel="canonical" href="./shape.html">
</head><body><img src="assets/authors/portrait.png"><script src="app.js"></script></body></html>`;

test("static preview metadata always selects the logo rather than a page portrait", () => {
  const transformed = withSocialPreview(sample, "shape.html");
  assert.match(transformed, /property="og:title" content="MIDI &amp; &quot;WAX&quot; — Morphazoid"/);
  assert.match(transformed, /property="og:description" content="A &quot;playable&quot; &amp; safe &lt;instrument&gt;\."/);
  assert.ok(transformed.includes(`property="og:image" content="${SOCIAL_IMAGE_URL}"`));
  assert.ok(transformed.includes(`name="twitter:image" content="${SOCIAL_IMAGE_URL}"`));
  assert.ok(transformed.includes(`rel="image_src" href="${SOCIAL_IMAGE_URL}"`));
  assert.match(transformed, /property="og:image:width" content="1200"/);
  assert.match(transformed, /property="og:image:height" content="630"/);
  assert.match(transformed, /property="og:image:type" content="image\/png"/);
  assert.match(transformed, /property="og:image:alt" content="Morphazoid geometric wireframe logo/);
  assert.match(transformed, /name="twitter:card" content="summary_large_image"/);
  assert.match(transformed, /property="og:url" content="https:\/\/morphazoid\.com\/shape\.html"/);
  assert.equal(transformed.slice(transformed.indexOf("<body")), sample.slice(sample.indexOf("<body")));
  assert.ok(transformed.includes('<link rel="canonical" href="./shape.html">'));
  assert.doesNotMatch(transformed.slice(0, transformed.indexOf("</head>")), /authors\/|portrait/);
  assert.equal(withSocialPreview(transformed, "shape.html"), transformed);
});

test("a stale portrait declaration cannot precede or override the safe image", () => {
  const stale = sample.replace("</head>", `
    <meta content="https://example.test/portrait.jpg" property="og:image">
    <meta name='twitter:image' content='https://example.test/face.png'>
    <link href="https://example.test/headshot.png" rel="image_src">
    <meta property="og:image:width" content="112">
  </head>`);
  const transformed = withSocialPreview(stale, "shape.html");
  assert.equal((transformed.match(/property="og:image"/g) ?? []).length, 1);
  assert.equal((transformed.match(/name="twitter:image"/g) ?? []).length, 1);
  assert.equal((transformed.match(/rel="image_src"/g) ?? []).length, 1);
  assert.doesNotMatch(transformed, /example\.test/);
  assert.equal(withSocialPreview(transformed, "shape.html"), transformed);
});

test("nested pages and homepage aliases receive correct public URLs before redirect scripts", () => {
  for (const file of ["index.html", "about.html", "instruments.html"]) {
    const transformed = withSocialPreview('<html><head><meta charset="utf-8"><script>location.replace("./")</script></head><body></body></html>', file);
    assert.match(transformed, /property="og:url" content="https:\/\/morphazoid\.com\/"/);
    assert.ok(transformed.indexOf('property="og:image"') < transformed.indexOf("<script>"));
  }
  assert.match(withSocialPreview(sample, "morphazoidical/index.html"),
    /property="og:url" content="https:\/\/morphazoid\.com\/morphazoidical\/"/);
  assert.match(withSocialPreview(sample, "morphazoidical\\atlas.html"),
    /property="og:url" content="https:\/\/morphazoid\.com\/morphazoidical\/atlas\.html"/);
  const noCharset = withSocialPreview("<html><head><title>Plain</title></head><body></body></html>");
  assert.match(noCharset, /property="og:title" content="Plain"/);
  assert.equal(withSocialPreview(noCharset), noCharset);
  assert.throws(() => withSocialPreview("<body>Missing head</body>"), /Missing HTML head/);
});

test("the public/WAX build step includes PNGs and covers newly added and nested HTML", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "morphazoid-social-preview-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "morphazoidical"));
  for (const file of ["index.html", "new-instrument.html", "morphazoidical/atlas.html"]) {
    await writeFile(path.join(dir, file), sample);
  }
  const result = await addSocialPreviews(dir);
  assert.equal(result.htmlCount, 3);
  for (const asset of [SOCIAL_IMAGE_PATH, BRAND_MARK_PATH]) {
    assert.deepEqual(await readFile(path.join(dir, asset)), await readFile(new URL(asset, root)));
  }
  for (const file of ["index.html", "new-instrument.html", "morphazoidical/atlas.html"]) {
    const first = await readFile(path.join(dir, file), "utf8");
    assert.equal(first, withSocialPreview(sample, file));
  }
  await addSocialPreviews(dir);
  assert.equal(await readFile(path.join(dir, "index.html"), "utf8"), withSocialPreview(sample));
  const buildScript = await readFile(new URL("scripts/build-site.sh", root), "utf8");
  assert.match(buildScript, /node "\$repo_root\/scripts\/social-preview\.mjs" "\$output_dir"/);
});

test("homepage and aliases work without JavaScript and the first homepage image is not a face", async () => {
  for (const file of ["index.html", "about.html", "instruments.html"]) {
    const html = await readFile(new URL(file, root), "utf8");
    assert.equal(html, withSocialPreview(html, file), `Stale authored metadata: ${file}`);
  }
  const home = await readFile(new URL("index.html", root), "utf8");
  const firstImage = home.match(/<img\b[\s\S]*?>/i)?.[0];
  assert.ok(firstImage?.includes(`src="${BRAND_MARK_PATH}"`));
  assert.ok(home.includes('src="assets/authors/kristin-galvin.png"'), "Keep on-page creator credit");
  assert.ok(home.indexOf(BRAND_MARK_PATH) < home.indexOf('src="assets/authors/'));
});

test("preview assets have the advertised raster dimensions and avoid SVG-only crawler support", async () => {
  for (const [asset, width, height] of [
    [SOCIAL_IMAGE_PATH, 1200, 630],
    [BRAND_MARK_PATH, 512, 512],
  ]) {
    const bytes = await readFile(new URL(asset, root));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
    assert.ok(bytes.length > 1000 && bytes.length < 1_000_000);
  }
});
