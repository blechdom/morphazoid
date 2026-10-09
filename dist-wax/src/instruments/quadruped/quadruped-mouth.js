const point = (x, y) => ({ x, y });

// Head-local coordinates: +x faces forward, +y points down, one unit is the
// animal's head size. These are expressive drawing profiles, not anatomical
// reconstructions. Each lower jaw rotates as one piece about its cheek hinge.
const PROFILES = Object.freeze({
  elephant: { hinge: [-0.12, 0.25], lip: [0.3, 0.33], chin: [0.16, 0.49], back: [-0.24, 0.4], angle: 0.48 },
  amphibian: { hinge: [-0.32, 0.13], lip: [0.73, 0.11], chin: [0.45, 0.31], back: [-0.34, 0.28], angle: 0.33 },
  lizard: { hinge: [-0.17, 0.13], lip: [0.81, 0.12], chin: [0.46, 0.3], back: [-0.22, 0.27], angle: 0.34 },
  rodent: { hinge: [0.12, 0.28], lip: [0.85, 0.28], chin: [0.42, 0.43], back: [0.02, 0.41], angle: 0.41 },
  ceratopsian: { hinge: [0.02, 0.29], lip: [0.85, 0.3], chin: [0.5, 0.47], back: [-0.1, 0.44], angle: 0.37 },
  equid: { hinge: [0.15, 0.28], lip: [0.79, 0.28], chin: [0.6, 0.44], back: [0.05, 0.43], angle: 0.43 },
  canid: { hinge: [0.08, 0.23], lip: [0.84, 0.25], chin: [0.6, 0.42], back: [-0.04, 0.42], angle: 0.5 },
  camel: { hinge: [0.13, 0.31], lip: [0.99, 0.32], chin: [0.67, 0.48], back: [0.02, 0.46], angle: 0.4 },
  bovid: { hinge: [0.08, 0.29], lip: [0.66, 0.3], chin: [0.46, 0.45], back: [-0.04, 0.43], angle: 0.42 },
  goat: { hinge: [0.08, 0.29], lip: [0.67, 0.3], chin: [0.44, 0.46], back: [-0.05, 0.43], angle: 0.44 },
  giraffe: { hinge: [0.08, 0.27], lip: [0.68, 0.28], chin: [0.45, 0.43], back: [-0.03, 0.42], angle: 0.43 },
  feline: { hinge: [0.08, 0.25], lip: [0.6, 0.26], chin: [0.37, 0.42], back: [-0.04, 0.4], angle: 0.49 },
  rabbit: { hinge: [0.08, 0.28], lip: [0.65, 0.29], chin: [0.42, 0.44], back: [-0.03, 0.42], angle: 0.42 },
});

/** A closed profile slit at rest; the lower jaw pivots down during the voice. */
export function quadrupedProfileMouth(family, strength = 0) {
  const profile = PROFILES[family] ?? PROFILES.feline;
  const amount = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0;
  const hinge = point(...profile.hinge), upperLip = point(...profile.lip);
  const angle = amount * profile.angle;
  const rotate = ([x, y]) => {
    const dx = x - hinge.x, dy = y - hinge.y;
    return point(hinge.x + dx * Math.cos(angle) - dy * Math.sin(angle), hinge.y + dx * Math.sin(angle) + dy * Math.cos(angle));
  };
  const lowerLip = rotate(profile.lip), chin = rotate(profile.chin), back = rotate(profile.back);
  return { strength: amount, angle, hinge, upperLip, lowerLip, chin, back,
    opening: [hinge, upperLip, lowerLip], jaw: [hinge, lowerLip, chin, back] };
}
