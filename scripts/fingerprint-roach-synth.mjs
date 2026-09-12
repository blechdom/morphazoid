import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const versionedReference = /(roach-synth(?:-[\w-]+)?\.(?:js|css)|cockroach-mobile\.glb)\?v=[a-f0-9]{12}/g;
const reference = /(["'])([^"'\s?]*\b(?:roach-synth(?:-[\w-]+)?\.(?:js|css)|cockroach-mobile\.glb))\1/g;
const unversion = source => source.replace(versionedReference, '$1');

// The page and worklet must use one release of their shared motion/voice graph.
// A group hash also covers newly introduced sources without a hand-kept edge list.
export async function fingerprintRoachSynth(outputDirectory) {
  const modules = (await readdir(path.join(outputDirectory, 'src')))
    .filter(name => /^roach-synth(?:-[\w-]+)?\.js$/.test(name)).sort();
  const filenames = ['roach-synth-app.js', 'roach-synth.css', ...modules.map(name => `src/${name}`)];
  const sources = await Promise.all(filenames.map(async name => [name, unversion(await readFile(path.join(outputDirectory, name), 'utf8'))]));
  const hash = createHash('sha256');
  for (const [name, source] of sources) hash.update(name).update('\0').update(source).update('\0');
  const modelName = 'assets/roach-synth/cockroach-mobile.glb';
  const modelBytes = await readFile(path.join(outputDirectory, modelName));
  const modelVersion = createHash('sha256').update(modelBytes).digest('hex').slice(0, 12);
  hash.update(modelName).update('\0').update(modelBytes).update('\0');
  const version = hash.digest('hex').slice(0, 12);
  sources.push(['roach-synth.html', unversion(await readFile(path.join(outputDirectory, 'roach-synth.html'), 'utf8'))]);
  for (const [name, source] of sources) {
    // Keep the large model cached through sound/UI-only releases.
    await writeFile(path.join(outputDirectory, name), source.replace(reference, (_, quote, pathname) =>
      `${quote}${pathname}?v=${pathname.endsWith('cockroach-mobile.glb') ? modelVersion : version}${quote}`));
  }
  return { version, modelVersion, modules: modules.length };
}
