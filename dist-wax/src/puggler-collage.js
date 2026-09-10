// Decoded once per renderer. Authored crops follow the actual photo silhouettes;
// the generated sheet is not perfectly aligned to its nominal grid.
// Drawing never scans or copies pixels. Provenance: assets/puggler/CREDITS.md.
import { SKIN_ATLASES } from './puggler-skins.js';
import { CROWD_EXTRA_ATLAS } from './puggler-crowd-extra.js';
const PROP_IDS = ['ball','can','club','bowling','bottle','boot','duck','fish','apple','bell','brick','balloon','guitar','cassette','skateboard','vinyl','mic','cone','glowstick','plushrat'];
export const COLLAGE_ATLASES = Object.freeze({
  props: Object.freeze({
    url: new URL('../assets/puggler/props-collage.webp', import.meta.url),
    columns: 7, rows: 3, ids: Object.freeze(PROP_IDS),
    rects: Object.freeze({
      ball:[61,87,205,204], can:[353,56,173,241], club:[630,35,145,271],
      bowling:[861,75,221,222], bottle:[1187,35,89,270], boot:[1366,62,241,239],
      duck:[1673,86,199,211], fish:[20,388,296,112], apple:[341,324,203,211],
      bell:[607,304,151,246], brick:[831,354,258,167], balloon:[1143,313,179,242],
      guitar:[1371,310,246,245], cassette:[1650,346,246,170], skateboard:[28,550,280,227],
      vinyl:[320,551,240,238], mic:[568,566,248,220], cone:[867,532,198,253],
      glowstick:[1134,550,196,231], plushrat:[1624,579,283,187],
    }),
  }),
  venue: Object.freeze({
    url: new URL('../assets/puggler/venue-collage.webp', import.meta.url),
    columns: 4, rows: 2,
    ids: Object.freeze(['amp','speaker','drum','trashbag','head1','head2','hand1','hand2']),
    rects: Object.freeze({
      amp:[37,82,392,342], speaker:[511,9,280,437], drum:[915,77,395,342],
      trashbag:[1379,54,357,372], head1:[46,446,368,437], head2:[502,446,349,428],
      hand1:[1021,458,206,414], hand2:[1409,462,254,410],
    }),
  }),
  crowd: Object.freeze({
    url: new URL('../assets/puggler/crowd-collage.webp', import.meta.url),
    columns: 5, rows: 2,
    ids: Object.freeze(['dread','kid','hat','curls','punk','lighter','phone','palm','peace','horns']),
    rects: Object.freeze({
      dread:[3,40,406,374], kid:[420,126,326,288], hat:[814,3,342,411],
      curls:[1207,78,401,336], punk:[1619,68,364,346], lighter:[119,431,189,362],
      phone:[523,437,171,356], palm:[862,420,240,373], peace:[1344,438,136,355],
      horns:[1714,437,178,356],
    }),
  }),
  extra: Object.freeze({
    url: new URL('../assets/puggler/props-extra-collage.webp', import.meta.url),
    columns: 5, rows: 3,
    ids: Object.freeze(['icecream','axe','deadcat','hydrant','pickle','violin','skull','banana','snake','plant','plunger','cd','vhs']),
    rects: Object.freeze({
      icecream:[85,35,154,282], axe:[368,45,246,269], deadcat:[630,119,352,151],
      hydrant:[1066,30,180,288], pickle:[1349,69,208,223], violin:[46,342,271,304],
      skull:[382,374,220,249], banana:[681,378,263,224], snake:[1040,366,219,270],
      plant:[1331,354,250,273], plunger:[54,661,259,285], cd:[375,676,247,245],
      vhs:[674,711,269,168],
    }),
  }),
  ...SKIN_ATLASES,
  crowdExtra: CROWD_EXTRA_ATLAS,
});

export class PugglerCollage {
  constructor({ imageFactory = () => new Image(), atlases = COLLAGE_ATLASES } = {}) {
    this.disposed = false;
    this.entries = new Map();
    for (const [key, atlas] of Object.entries(atlases)) {
      const entry = { state: 'loading', image: null, sprites: new Map(), timer: null };
      this.entries.set(key, entry);
      let image;
      const finish = state => {
        if (this.disposed || entry.state !== 'loading') return;
        clearTimeout(entry.timer); entry.timer = null;
        if (image) image.onload = image.onerror = null;
        entry.state = state;
        if (state === 'failed') { image?.removeAttribute?.('src'); entry.image = null; entry.sprites.clear(); }
      };
      try {
        image = imageFactory();
        entry.image = image;
        image.decoding = 'async';
        let decoding = false;
        image.onload = async () => {
          if (decoding || this.disposed || entry.state !== 'loading') return;
          decoding = true;
          try {
            if (typeof image.decode === 'function') await image.decode();
            if (this.disposed || entry.state !== 'loading') return;
            const width = image.naturalWidth, height = image.naturalHeight;
            if (!(width > 0 && height > 0)) throw new Error('Empty collage atlas');
            const cellWidth = width / atlas.columns, cellHeight = height / atlas.rows;
            atlas.ids.forEach((id, index) => {
              // Optional source rectangles are absolute pixels, [x, y, w, h].
              const rect = atlas.rects?.[id] ?? [index % atlas.columns * cellWidth, Math.floor(index / atlas.columns) * cellHeight, cellWidth, cellHeight];
              if (rect.length !== 4 || !rect.every(Number.isFinite) || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0 || rect[0] + rect[2] > width + .01 || rect[1] + rect[3] > height + .01) throw new Error('Invalid collage crop');
              entry.sprites.set(id, rect);
            });
            finish('ready');
          } catch { finish('failed'); }
        };
        image.onerror = () => finish('failed');
        entry.timer = setTimeout(() => finish('failed'), 20000);
        entry.timer.unref?.();
        image.src = atlas.url.href ?? String(atlas.url);
      } catch { finish('failed'); }
    }
  }

  get status() {
    const entries = [...this.entries.values()];
    const loaded = entries.filter(entry => entry.state === 'ready').length;
    return { ready: !this.disposed && loaded === entries.length, failed: entries.filter(entry => entry.state === 'failed').length, loaded, total: entries.length };
  }

  // A false return leaves the existing vector renderer in charge. Fit the crop
  // uniformly within the target box, then rotate around the actual physics point.
  draw(c, atlas, id, x, y, width, height = width, spin = 0, shadow = 1) {
    const entry = this.entries.get(atlas), rect = entry?.sprites.get(id);
    if (this.disposed || entry?.state !== 'ready' || !rect || !(width > 0 && height > 0)) return false;
    const scale = Math.min(width / rect[2], height / rect[3]);
    const dw = rect[2] * scale, dh = rect[3] * scale;
    c.save(); c.translate(x, y); c.rotate(spin);
    c.imageSmoothingEnabled = true;
    if (shadow) {
      c.shadowColor = '#09050cc7';
      c.shadowBlur = Math.min(7, Math.max(1, Math.min(dw, dh) * .055)) * shadow;
      c.shadowOffsetX = 2 * shadow; c.shadowOffsetY = 3 * shadow;
    }
    c.drawImage(entry.image, ...rect, -dw / 2, -dh / 2, dw, dh);
    c.restore();
    return true;
  }

  drawProp(c, prop, x, y, spin = 0, size = 1, shadow = 1) {
    // Preserve an exaggerated physical silhouette without stretching the photo.
    const extent = (prop.radius || 26) * 1.6 * size;
    if(prop.skin&&prop.skin!=='punk')return this.draw(c,prop.skin,prop.id,x,y,extent,extent,spin,shadow);
    return this.draw(c, 'props', prop.id, x, y, extent, extent, spin, shadow)
      || this.draw(c, 'extra', prop.id, x, y, extent, extent, spin, shadow);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      clearTimeout(entry.timer); entry.timer = null;
      if (entry.image) {
        entry.image.onload = entry.image.onerror = null;
        // Stop a pending request without initiating a request for the document.
        entry.image.removeAttribute?.('src');
      }
      entry.image = null; entry.sprites.clear(); entry.state = 'disposed';
    }
  }
}
