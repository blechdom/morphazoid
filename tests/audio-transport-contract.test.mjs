import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);
const SOURCE_HTML_DIRECTORIES = [ROOT, new URL("../morphazoidical/", import.meta.url)];

async function sourceHtmlFiles() {
  const files = [];
  for (const directory of SOURCE_HTML_DIRECTORIES) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".html")) {
        files.push(new URL(entry.name, directory));
      }
    }
  }
  return files;
}

function authoredOpen(detailsTag) {
  return /\sopen(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=\s|\/?>)/i.test(detailsTag);
}

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

test("primary transports are visible outside closed authored disclosures", async () => {
  let transportCount = 0;

  for (const file of await sourceHtmlFiles()) {
    const markup = await readFile(file, "utf8");
    const disclosureStack = [];
    const tags = markup.matchAll(/<!--[\s\S]*?-->|<\/?[^>]+>/g);

    for (const match of tags) {
      const tag = match[0];
      if (tag.startsWith("<!--")) continue;
      if (/^<details\b/i.test(tag)) {
        disclosureStack.push({ open: authoredOpen(tag), line: lineNumber(markup, match.index) });
        continue;
      }
      if (/^<\/details\s*>/i.test(tag)) {
        disclosureStack.pop();
        continue;
      }

      const isPrimaryTransport = /\sid\s*=\s*(?:"playButton"|'playButton'|playButton)(?=\s|\/?>)/i.test(tag)
        || /\sdata-primary-transport(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=\s|\/?>)/i.test(tag);
      if (!isPrimaryTransport) continue;

      transportCount += 1;
      const closedAncestor = [...disclosureStack].reverse().find(({ open }) => !open);
      assert.equal(
        closedAncestor,
        undefined,
        `${file.pathname}:${lineNumber(markup, match.index)} primary transport is hidden by closed <details> from line ${closedAncestor?.line}`,
      );
    }
  }

  assert.ok(transportCount >= 20, `expected broad primary-transport coverage, found ${transportCount}`);
});

test("authored Audio buttons have an icon-only CSS fallback before the shared module loads", async () => {
  const css = await readFile(
    new URL("../src/ui/primitives/button.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.audio-button > :not\(\.audio-speaker-icon\),\s*\.audio-speaker-copy\s*\{[^}]*position:\s*absolute !important;[^}]*width:\s*1px !important;[^}]*clip-path:\s*inset\(50%\) !important;/s,
    "authored Audio text is visually hidden without being removed from the accessibility tree",
  );
  assert.doesNotMatch(css, /\.audio-button > :not\(\.audio-speaker-icon\)[^}]*display:\s*none/s);
  assert.match(
    css,
    /\.audio-button::before,\s*\.audio-speaker-icon\s*\{[^}]*content:\s*"";[^}]*mask:\s*url\("data:image\/svg\+xml/s,
    "the button itself supplies the initial speaker-off icon",
  );
  assert.match(css, /m16 9 6 6M22 9l-6 6/, "the off icon includes an unmistakable X");
  assert.match(
    css,
    /\.audio-button\[aria-pressed="true"\]::before,[\s\S]*?\.audio-button\[aria-pressed="true"\] \.audio-speaker-icon[\s\S]*?mask: url\("data:image\/svg\+xml/s,
    "aria-pressed alone switches the fallback and normalized icons to speaker waves",
  );
  assert.match(
    css,
    /\.audio-button\[aria-pressed="true"\]\s*\{[^}]*background:\s*var\(--accent,[^)]+\)\);[^}]*box-shadow:/s,
    "Audio on uses a filled, glowing treatment as well as a different icon",
  );

  const workbenchCss = await readFile(
    new URL("../morphazoidical/style.css", import.meta.url),
    "utf8",
  );
  assert.match(workbenchCss, /\.audio-toggle > \*\s*\{[^}]*position:\s*absolute !important;[^}]*width:\s*1px !important;[^}]*clip-path:\s*inset\(50%\) !important;/s);
  assert.doesNotMatch(workbenchCss, /\.audio-toggle > \*[^}]*display:\s*none/s);
  assert.match(workbenchCss, /\.audio-toggle::before\s*\{[^}]*mask:\s*url\("data:image\/svg\+xml/s);
  assert.match(workbenchCss, /\.audio-toggle\[aria-pressed="true"\]::before,[\s\S]*?mask:\s*url\("data:image\/svg\+xml/s);
});
