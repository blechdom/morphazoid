import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const trackazoidSiteChanges = JSON.parse(readFileSync(
  new URL('../fixtures/trackazoid-site-amendments.json', import.meta.url), 'utf8',
));

/** Reverse only the Trackazoid registration before comparing historical bytes. */
export function restoreTrackazoidSite(source, file, { allowRestored = false } = {}) {
  if (typeof source !== 'string') return source;
  for (const change of trackazoidSiteChanges.changes.filter(change => change.file === file)) {
    for (const { before, after } of [...change.replacements].reverse()) {
      const count = source.split(after).length - 1;
      if (allowRestored && count === 0) continue;
      assert.equal(count, 1, `${file}: exact Trackazoid site amendment`);
      source = source.replace(after, before);
    }
  }
  return source;
}

/** Keep historical tests operating on their original evidence and mutations. */
export async function readTrackazoidSiteReference(file, encoding) {
  const { readFile } = await import('node:fs/promises');
  const { fileURLToPath } = await import('node:url');
  const { relative } = await import('node:path');
  const source = await readFile(file, encoding);
  if (typeof source !== 'string') return source;
  const root = fileURLToPath(new URL('../../', import.meta.url));
  return restoreTrackazoidSite(source, relative(root, file instanceof URL ? fileURLToPath(file) : file), { allowRestored: true });
}
