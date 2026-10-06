import assert from 'node:assert/strict';
import { restoreLSystemLabSite } from './l-system-labs-site-reference.mjs';

// Additive Blobs records, peeled before historical catalogue preservation checks.
export const blobsSiteChanges = [
  {
    "file": "src/site/instrument-registry.js",
    "addition": "    { id: \"blobs\", label: \"Blobs\", href: \"blobs.html\", imageHref: \"assets/instruments/blobs.webp\" },\n",
    "sha256": "5d4d19e058502075b5fa1cbeef1888f9d6142357269c05040b6855a9626cb0df"
  },
  {
    "file": "src/site/instrument-catalog.js",
    "addition": "  blobs: define(\n    \"Drawn-path synthesizer\",\n    \"Draw open pencil strokes, curved pen paths and straight lines, or return to the first point to close a loop. Playheads follow each path, mapping height to continuous pitch and width to stereo.\",\n    \"Enable Audio and Play the demo, or draw a path. Finish keeps it open; click its first point to close it. Use Pen for curves, Lines for corners and Edit to reshape it.\",\n    [\"Built-in synth\", \"Pointer\", \"Open / closed paths\", \"Playheads\"],\n  ),\n",
    "sha256": "d7ab425e0a8e41a92f45cf0db6b85c283b84fef52e796ea0683338d170b64f9e"
  },
  {
    "file": "src/site/catalogue-taxonomy.js",
    "addition": "  blobs: [\"graphic-ui\", \"2d\", \"synthesizer\"],\n",
    "sha256": "3679eacc0422ddf623f44e79238eda5127754ff763e31db27520817ab08bded4"
  },
  {
    "file": "src/site/instrument-midi-capabilities.js",
    "addition": "    \"blobs\",\n",
    "sha256": "3d1da0810012474f0272f38a9c19bdbb266bad3ec9940e0fd932297604426b28"
  }
];

export function restoreBlobsSite(source, file) {
  source = restoreLSystemLabSite(source, file);
  for (const { addition } of blobsSiteChanges.filter(change => change.file === file)) {
    assert.equal(source.split(addition).length - 1, 1, `${file}: exact Blobs addition`);
    source = source.replace(addition, '');
  }
  return source;
}
