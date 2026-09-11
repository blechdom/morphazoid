import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const versionedReference = /(roach-synth(?:-[\w-]+)?\.(?:js|css))\?v=[a-f0-9]{12}/g;
const reference = /(["'])([^"'\s?]*\broach-synth(?:-[\w-]+)?\.(?:js|css))\1/g;
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
  const version = hash.digest('hex').slice(0, 12);
  sources.push(['roach-synth.html', unversion(await readFile(path.join(outputDirectory, 'roach-synth.html'), 'utf8'))]);
  for (const [name, source] of sources) {
    await writeFile(path.join(outputDirectory, name), source.replace(reference, (_, quote, pathname) => `${quote}${pathname}?v=${version}${quote}`));
  }
  return { version, modules: modules.length };
}
