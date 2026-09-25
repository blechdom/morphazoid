// Visual finishes affect materials and lighting only; the hand's weighted rig
// and texture resources remain owned by the viewer.
const SKINS = Object.freeze({
  porcelain: { color: 0xe8e4db, roughness: .30, metalness: .02 },
  copper: { color: 0xcc7043, roughness: .33, metalness: .58 },
  jade: { color: 0x409a79, roughness: .31, metalness: .10 },
  violet: { color: 0x9661d1, roughness: .36, metalness: .16 },
  cyan: { color: 0x3fc9df, roughness: .28, metalness: .20 },
});

// [sky, ground, hemisphere strength], then [color, strength, x, y, z]
// for the key, fill and rim. All rigs remain static until another is selected.
const LIGHTING = Object.freeze({
  warm: {
    ambient: [0xffe5bb, 0x432326, 1.6],
    key: [0xffbd80, 3.8, -3, 5, 5],
    fill: [0xffd5bc, 1.1, 4, 1, -3],
    rim: [0xff9457, 2.2, -2, 3, -4],
  },
  cool: {
    ambient: [0xc6e3ff, 0x172842, 1.8],
    key: [0xd6f0ff, 3.4, -3, 5, 5],
    fill: [0x668fff, 1.7, 4, 1, -3],
    rim: [0x96f5ff, 2.4, -2, 3, -4],
  },
  noir: {
    ambient: [0xb8c2d0, 0x10121c, .48],
    key: [0xf1e9dd, 4.6, -5, 4, 3],
    fill: [0x6981a1, .28, 4, 1, -3],
    rim: [0xe0edff, 3.4, 3, 4, -4],
  },
  neon: {
    ambient: [0xb4b3ec, 0x261530, 1.0],
    key: [0xff71c8, 3.2, -4, 3, 4],
    fill: [0x56e3ff, 3.2, 4, 1, 3],
    rim: [0x8e6bff, 3.0, -1, 4, -4],
  },
  soft: {
    ambient: [0xf0eced, 0x4d4447, 2.9],
    key: [0xfff0df, 1.6, -3, 5, 5],
    fill: [0xdce6ff, 1.3, 4, 2, 3],
    rim: [0xffffff, .8, -2, 3, -4],
  },
});

/** Create after the GLTF materials have received the viewer's defaults.
 * Call dispose before disposing the scene, so temporarily hidden original maps
 * are once again attached to their materials for normal texture cleanup. */
export function createHandLook({ meshes, ambient, keyLight, fill, rim }) {
  const materials = [...new Set(meshes.flatMap(mesh =>
    Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  ).filter(material => material?.color))].map(material => ({
    material,
    color: material.color.clone(),
    map: material.map,
    roughness: material.roughness,
    metalness: material.metalness,
  }));
  const lights = [ambient, keyLight, fill, rim];
  const originalLights = lights.map(light => ({
    color: light.color.clone(),
    groundColor: light.groundColor?.clone(),
    intensity: light.intensity,
    position: light.position.clone(),
  }));
  let skin = 'natural', lighting = 'studio', disposed = false;

  function restoreMaterials() {
    for (const original of materials) {
      const material = original.material;
      const changedMapPresence = Boolean(material.map) !== Boolean(original.map);
      material.color.copy(original.color);
      material.map = original.map;
      material.roughness = original.roughness;
      material.metalness = original.metalness;
      if (changedMapPresence) material.needsUpdate = true;
    }
  }
  function restoreLights() {
    lights.forEach((light, index) => {
      const original = originalLights[index];
      light.color.copy(original.color);
      if (original.groundColor) light.groundColor.copy(original.groundColor);
      light.intensity = original.intensity;
      light.position.copy(original.position);
    });
  }
  function apply({ skin: requestedSkin = 'natural', lighting: requestedLighting = 'studio' } = {}) {
    if (disposed) return false;
    const nextSkin = Object.hasOwn(SKINS, requestedSkin) ? requestedSkin : 'natural';
    const nextLighting = Object.hasOwn(LIGHTING, requestedLighting) ? requestedLighting : 'studio';
    let changed = false;
    if (nextSkin !== skin) {
      if (nextSkin === 'natural') restoreMaterials();
      else {
        const finish = SKINS[nextSkin];
        for (const { material } of materials) {
          // Keep the artist's normal and roughness textures for surface detail.
          // The skin's albedo tint would muddy porcelain and colored finishes.
          const hadMap = Boolean(material.map);
          material.map = null;
          material.color.setHex(finish.color);
          material.roughness = finish.roughness;
          material.metalness = finish.metalness;
          if (hadMap) material.needsUpdate = true;
        }
      }
      skin = nextSkin;
      changed = true;
    }
    if (nextLighting !== lighting) {
      if (nextLighting === 'studio') restoreLights();
      else {
        const rig = LIGHTING[nextLighting];
        ambient.color.setHex(rig.ambient[0]);
        ambient.groundColor.setHex(rig.ambient[1]);
        ambient.intensity = rig.ambient[2];
        [keyLight, fill, rim].forEach((light, index) => {
          const values = [rig.key, rig.fill, rig.rim][index];
          light.color.setHex(values[0]);
          light.intensity = values[1];
          light.position.set(values[2], values[3], values[4]);
        });
      }
      lighting = nextLighting;
      changed = true;
    }
    return changed;
  }
  function dispose() {
    if (disposed) return;
    restoreMaterials();
    restoreLights();
    disposed = true;
  }
  return { apply, dispose };
}
