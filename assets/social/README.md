# Link-preview artwork

The share image is the existing Morphazoid wireframe logo from `favicon.svg`,
not an author portrait or an instrument's face.

- `morphazoid-card-20260917.png`: opaque RGB PNG, 1200 × 630; Open Graph,
  Twitter Card, and legacy `image_src` image.
- `morphazoid-mark-20260917.png`: transparent PNG, 512 × 512; also the first
  visible image in the homepage's initial HTML, ahead of the author credit.

Regenerate from the repository root:

```sh
python3 scripts/render-social-preview.py
```

This uses librsvg, Cairo, Pillow, and the locally installed DejaVu Sans font.
There is no generated portrait, third-party stock artwork, or image API call.
The release consumes the committed PNG files without a Python build dependency.

`scripts/social-preview.mjs` owns the static metadata. The homepage and its
About/catalogue aliases include it in authored HTML; the shared
`scripts/build-site.sh` applies it to every built HTML page, including WAX and
nested instrument routes. Per-page titles and descriptions remain intact.

The author credit photo remains on the homepage, but is never assigned as a
social image. No page script is needed for preview selection.

Preview choice and caching ultimately belong to the receiving chat service.
Existing messages may retain an older cached thumbnail after deployment;
changing this site's metadata cannot edit messages already sent elsewhere.
The date-versioned PNG URL avoids reusing a previously cached image resource.

Reference: Open Graph image fields are described at `https://ogp.me/`.
