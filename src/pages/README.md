# Authored HTML pages

Each canonical public HTML page is authored here. The route inventory in
`manifest.js` is the source of truth: a source file named `example.html` is
published as `/example.html`, not `/src/pages/example.html`.

Use `node scripts/site/page-source-routes.mjs` to validate this directory and
`npm run build:site` to emit the public pages. Do not add root-level HTML
sources, aliases, or redirect placeholders.
