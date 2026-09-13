import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const versionedReference = /(spider-synth(?:-[\w-]+)?\.(?:js|css)|spider-mobile\.glb|rig-manifest\.json|peacock-[\w-]+\.wav)\?v=[a-f0-9]{12}/g;
const reference = /(["'])([^"'\s?]*\b(?:spider-synth(?:-[\w-]+)?\.(?:js|css)|spider-mobile\.glb|rig-manifest\.json|peacock-[\w-]+\.wav))\1/g;
const specimenReference = /(["'])([^"'\s?]*(?:spider-mobile\.glb|rig-manifest\.json|peacock-[\w-]+\.wav))\1/g;
const unversion = source => source.replace(versionedReference, '$1');
const relativeAsset = (source, reference) => path.posix.normalize(path.posix.join(path.posix.dirname(source), reference));

// The page and worklet must use one release of their shared motion/voice graph.
// A group hash also covers newly introduced sources without a hand-kept edge list.
export async function fingerprintSpiderSynth(outputDirectory) {
  const modules = (await readdir(path.join(outputDirectory, 'src')))
    .filter(name => /^spider-synth(?:-[\w-]+)?\.js$/.test(name)).sort();
  const filenames = ['spider-synth-app.js', 'spider-synth.css', ...modules.map(name => `src/${name}`)];
  const sources = await Promise.all(filenames.map(async name => [name, unversion(await readFile(path.join(outputDirectory, name), 'utf8'))]));
  const hash = createHash('sha256');
  for (const [name, source] of sources) hash.update(name).update('\0').update(source).update('\0');
  const assets = new Set();
  for (const [name, source] of sources) for (const match of source.matchAll(specimenReference)) assets.add(relativeAsset(name, match[2]));
  const assetVersions = new Map();
  for (const name of [...assets].sort()) {
    if (!name.startsWith('assets/spider-synth/') && !name.startsWith('assets/audio/spider-synth/')) throw new Error(`Unexpected spider asset reference: ${name}`);
    const bytes = await readFile(path.join(outputDirectory, name));
    assetVersions.set(name, createHash('sha256').update(bytes).digest('hex').slice(0, 12));
    hash.update(name).update('\0').update(bytes).update('\0');
  }
  const modelVersion = assetVersions.get('assets/spider-synth/spider-mobile.glb');
  const rigVersion = assetVersions.get('assets/spider-synth/rig-manifest.json');
  const version = hash.digest('hex').slice(0, 12);
  sources.push(['spider-synth.html', unversion(await readFile(path.join(outputDirectory, 'spider-synth.html'), 'utf8'))]);
  for (const [name, source] of sources) {
    // Keep the large model cached through sound/UI-only releases.
    await writeFile(path.join(outputDirectory, name), source.replace(reference, (_, quote, pathname) =>
      `${quote}${pathname}?v=${assetVersions.get(relativeAsset(name, pathname)) ?? version}${quote}`));
  }
  return { version, modelVersion, rigVersion, modules: modules.length };
}
