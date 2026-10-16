import { restoreGraphonicCalculatorDrumsSite } from './graphonic-calculator-drums-site-reference.mjs';
import { restoreGraphonicCalculatorMathSite } from './graphonic-calculator-math-site-reference.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
export const spellingAmendments=JSON.parse(readFileSync(new URL('../../docs/spelling-runtime-changes.json',import.meta.url),'utf8'));
export function restoreSpelling(source,file) {
  source = restoreGraphonicCalculatorDrumsSite(source, file, { allowRestored: true });
  source = restoreGraphonicCalculatorMathSite(source, file, { allowRestored: true });
  for(const change of spellingAmendments.changes.filter(change=>change.file===file)) {
    for(const replacement of [...change.replacements].reverse()) {
      assert.equal(source.split(replacement.after).length-1,1,`${file}: exact Spelling amendment`);
      source=source.replace(replacement.after,replacement.before);
    }
  }
  return source;
}
