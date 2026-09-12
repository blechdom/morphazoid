import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const versionedReference = /(spider-synth(?:-[\w-]+)?\.(?:js|css)|spider-mobile\.glb|rig-manifest\.json)\?v=[a-f0-9]{12}/g;
const reference = /(["'])([^"'\s?]*\b(?:spider-synth(?:-[\w-]+)?\.(?:js|css)|spider-mobile\.glb|rig-manifest\.json))\1/g;
const unversion = source => source.replace(versionedReference, '$1');

// The page and worklet must use one release of their shared motion/voice graph.
// A group hash also covers newly introduced sources without a hand-kept edge list.
export async function fingerprintSpiderSynth(outputDirectory) {
  const modules = (await readdir(path.join(outputDirectory, 'src')))
    .filter(name => /^spider-synth(?:-[\w-]+)?\.js$/.test(name)).sort();
  const filenames = ['spider-synth-app.js', 'spider-synth.css', ...modules.map(name => `src/${name}`)];
  const sources = await Promise.all(filenames.map(async name => [name, unversion(await readFile(path.join(outputDirectory, name), 'utf8'))]));
  const hash = createHash('sha256');
  for (const [name, source] of sources) hash.update(name).update('\0').update(source).update('\0');
  const modelName = 'assets/spider-synth/spider-mobile.glb';
  const modelBytes = await readFile(path.join(outputDirectory, modelName));
  const modelVersion = createHash('sha256').update(modelBytes).digest('hex').slice(0, 12);
  hash.update(modelName).update('\0').update(modelBytes).update('\0');
  const rigBytes = await readFile(path.join(outputDirectory, 'assets/spider-synth/rig-manifest.json'));
  const rigVersion = createHash('sha256').update(rigBytes).digest('hex').slice(0, 12);
  hash.update('rig-manifest.json').update('\0').update(rigBytes).update('\0');
  const version = hash.digest('hex').slice(0, 12);
  sources.push(['spider-synth.html', unversion(await readFile(path.join(outputDirectory, 'spider-synth.html'), 'utf8'))]);
  for (const [name, source] of sources) {
    // Keep the large model cached through sound/UI-only releases.
    await writeFile(path.join(outputDirectory, name), source.replace(reference, (_, quote, pathname) =>
      `${quote}${pathname}?v=${pathname.endsWith('spider-mobile.glb') ? modelVersion : pathname.endsWith('rig-manifest.json') ? rigVersion : version}${quote}`));
  }
  return { version, modelVersion, rigVersion, modules: modules.length };
}
