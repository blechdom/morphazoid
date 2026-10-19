import * as THREE from '../../../vendor/three/three.module.min.js';
import { OCTOPUS_SKINS } from './demo-model.js';

// The credited skinned GLB has UVs, but no images. These are procedural 2D
// albedo, grain and (for the fantasy Abyss look) glow maps on its ORIGINAL mesh.
// They are artistic finishes, not a claim about real octopus skin or anatomy.
const palettes = Object.freeze({
  reef: { shadow: [72, 39, 38], base: [160, 79, 57], light: [242, 174, 122],
    roughness: 0.76, sheen: 0.19 },
  abyss: { shadow: [10, 24, 42], base: [28, 74, 96], light: [73, 179, 185],
    roughness: 0.65, sheen: 0.11 },
  pearl: { shadow: [78, 73, 112], base: [156, 142, 173], light: [240, 214, 207],
    roughness: 0.54, sheen: 0.58 },
  kelp: { shadow: [31, 51, 49], base: [80, 109, 72], light: [175, 184, 108],
    roughness: 0.86, sheen: 0.13 },
});
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const fract = (value) => value - Math.floor(value);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const smooth = (a, b, value) => {
  const t = clamp((value - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function texture(data, size, color = false) {
  const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  map.generateMipmaps = true;
  if (color) map.colorSpace = THREE.SRGBColorSpace;
  map.needsUpdate = true;
  return map;
}

function makeMaps(skin, size = 256) {
  const { shadow, base, light } = palettes[skin];
  const color = new Uint8Array(size * size * 4);
  const glow = skin === 'abyss' ? new Uint8Array(color.length) : null;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const u = x / size, v = y / size;
    // Jitter the small chromatophore-like spots; layer broad irregular
    // mottling below them so the mantle and moving tentacles are not flat.
    const gx = Math.floor(u * 20), gy = Math.floor(v * 16);
    const ox = fract(u * 20) - 0.5 + (hash(gx, gy) - 0.5) * 0.5;
    const oy = fract(v * 16) - 0.5 + (hash(gx + 51, gy - 23) - 0.5) * 0.5;
    const radius = Math.hypot(ox, oy);
    const spot = 1 - smooth(0.12, 0.26, radius);
    const halo = smooth(0.15, 0.23, radius) * (1 - smooth(0.26, 0.34, radius));
    const swirl = Math.sin(u * 43 + 2.2 * Math.sin(v * 23)) *
      Math.cos(v * 48 + 2.1 * Math.sin(u * 29));
    const coarse = Math.sin(u * 17 + Math.cos(v * 13) * 2.7) *
      Math.cos(v * 20 + Math.sin(u * 15) * 2);
    const noise = hash(x, y);
    const mix = clamp(0.42 + 0.24 * coarse + 0.16 * swirl + (noise - 0.5) * 0.13, 0, 1);
    const offset = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const body = base[channel] + (mix - 0.45) * (light[channel] - shadow[channel]);
      const target = skin === 'pearl' || skin === 'abyss' ? light[channel] : shadow[channel];
      color[offset + channel] = clamp(
        body * (1 - spot * 0.5 - halo * 0.12) +
          target * (spot * 0.5 + halo * 0.12), 0, 255);
      if (glow) glow[offset + channel] = Math.round(spot * 225);
    }
    color[offset + 3] = 255;
    if (glow) glow[offset + 3] = 255;
  }
  return { color: texture(color, size, true), glow: glow && texture(glow, size, true) };
}

function makeGrain(size = 128) {
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const pores = Math.sin(x * 0.42 + Math.cos(y * 0.17)) *
      Math.sin(y * 0.47 + Math.sin(x * 0.14));
    const tone = Math.round(150 + pores * 19 + (hash(x, y) - 0.5) * 17);
    const offset = (y * size + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = tone;
    pixels[offset + 3] = 255;
  }
  return texture(pixels, size);
}

export function createOctopusSkins(sourceMaterial) {
  const grain = makeGrain();
  const materials = new Map(), maps = [grain];
  for (const skin of OCTOPUS_SKINS) {
    const images = makeMaps(skin);
    maps.push(images.color);
    if (images.glow) maps.push(images.glow);
    const material = new THREE.MeshPhysicalMaterial({
      name: `Dirk.z octopus · ${skin} runtime skin`,
      color: 0xffffff,
      map: images.color,
      bumpMap: grain,
      bumpScale: 0.025,
      roughness: palettes[skin].roughness,
      metalness: 0,
      sheen: palettes[skin].sheen,
      sheenColor: skin === 'pearl' ? 0xe5b7d9 : 0xdfb2a0,
      iridescence: skin === 'pearl' ? 0.36 : 0,
      iridescenceIOR: 1.27,
      clearcoatRoughness: 0.22,
      side: sourceMaterial.side,
    });
    if (images.glow) {
      material.emissive.set(0x45e4d9);
      material.emissiveMap = images.glow;
      material.emissiveIntensity = 0.29;
    }
    materials.set(skin, material);
  }
  let active = OCTOPUS_SKINS[0], wetness = 0;
  return {
    update(mesh, skin, moisture) {
      active = materials.has(skin) ? skin : OCTOPUS_SKINS[0];
      wetness = clamp(Number(moisture) || 0, 0, 1);
      const material = materials.get(active);
      material.roughness = clamp(palettes[active].roughness - wetness * 0.38, 0.12, 1);
      material.clearcoat = 0.06 + wetness * 0.8;
      mesh.material = material;
    },
    getState(mesh) {
      const material = mesh.material;
      return {
        skin: active, wetness, material: material.name,
        texture: Boolean(material.map?.isTexture),
        uv: Boolean(mesh.geometry.getAttribute('uv')),
        mapSize: material.map.image.width,
        roughness: material.roughness,
        clearcoat: material.clearcoat,
        emissive: material.emissiveMap ? material.emissiveIntensity : 0,
        geometry: mesh.geometry.uuid,
        bones: mesh.skeleton.bones.length,
      };
    },
    dispose() {
      for (const material of materials.values()) material.dispose();
      for (const map of maps) map.dispose();
    },
  };
}
