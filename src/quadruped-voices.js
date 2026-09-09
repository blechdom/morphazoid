// Authored melodic character voices, not recordings or species-identification models.
const call = (label, notes, type, filter, gesture, beats = 0.75, pulse = 0) =>
  Object.freeze({ label, notes: Object.freeze(notes), type, filter, gesture, beats, pulse });
export const QUADRUPED_CALLS = Object.freeze({
  elephant: [call("Trumpet", [62, 67, 72, 69], "sawtooth", 1900, "trunk-lift"), call("Rumble", [31, 33, 29], "triangle", 420, "neck-sway", 1.25, 12), call("Squeal", [77, 84, 79], "sawtooth", 3200, "trunk-lift", 0.45)],
  unicorn: [call("Sparkle", [74, 78, 81, 86, 93], "sine", 6500, "horn-neigh"), call("Neigh", [72, 81, 78, 74], "sawtooth", 2400, "horn-neigh", 0.8, 8), call("Prism", [81, 88, 85, 93], "triangle", 5200, "horn-neigh", 1.1)],
  gazelle: [call("Marimba", [62, 69, 66, 74], "sine", 2800, "head-toss"), call("Strings", [62, 69, 74], "sawtooth", 1500, "neck-sway", 1.2), call("Bleat", [69, 72, 67], "square", 1600, "head-toss", 0.65, 9)],
  cat: [call("Meow", [62, 72, 69, 62], "sawtooth", 1700, "whisker-meow"), call("Purr", [43, 46, 43], "triangle", 700, "neck-sway", 1.2, 24), call("Trill", [74, 77, 74, 79], "sine", 3200, "whisker-meow", 0.5, 14)],
  cheetah: [call("Chirp", [79, 86, 81], "sine", 4500, "spine-chirp", 0.4), call("Growl", [38, 41, 36], "sawtooth", 650, "neck-sway", 0.9, 19), call("Chatter", [74, 77, 81, 77], "square", 2400, "spine-chirp", 0.65, 16)],
  giraffe: [call("Hum", [43, 50, 48], "triangle", 720, "neck-sway", 1.3), call("Snort", [55, 50, 43], "sawtooth", 1300, "head-toss", 0.4, 17), call("Neck harp", [62, 69, 74, 81], "sine", 3800, "neck-sway", 0.9)],
  lizard: [call("Chirrup", [79, 81, 77], "sine", 4200, "tongue-flick", 0.4), call("Click song", [86, 79, 88, 81], "square", 5200, "head-toss", 0.55), call("Hiss reed", [62, 63, 69], "sawtooth", 2400, "tongue-flick", 0.9, 18)],
  horse: [call("Neigh", [62, 74, 69, 62], "sawtooth", 2100, "head-toss", 0.9, 7), call("Whinny", [74, 77, 72, 69], "square", 2300, "neck-sway", 0.75, 11), call("Snort", [55, 50, 48], "triangle", 1300, "head-toss", 0.35, 22)],
  dog: [call("Woof", [50, 55, 43], "square", 1000, "head-toss", 0.35), call("Howl", [55, 62, 67, 62], "sawtooth", 1500, "neck-sway", 1.4), call("Whimper", [74, 77, 72], "sine", 2900, "whisker-meow", 0.6, 8)],
  goat: [call("Baa", [62, 65, 62, 60], "sawtooth", 1700, "head-toss", 0.85, 9), call("Bleat", [74, 72, 69], "square", 2400, "neck-sway", 0.5, 13), call("Yodel", [62, 74, 65, 77], "triangle", 2200, "head-toss", 0.9)],
  rabbit: [call("Squeak", [81, 86, 81], "sine", 4400, "whisker-meow", 0.35), call("Grunt", [50, 48, 43], "triangle", 780, "head-toss", 0.5, 16), call("Whuffle", [67, 69, 65], "triangle", 1600, "neck-sway", 0.7, 12)],
  camel: [call("Grumble", [38, 41, 36], "sawtooth", 650, "neck-sway", 1.2, 15), call("Bellow", [43, 55, 50, 46], "square", 1100, "head-toss", 1.1), call("Bubble", [55, 62, 58, 65], "triangle", 1500, "neck-sway", 0.8, 9)],
  mouse: [call("Squeak", [93, 98, 93], "sine", 6800, "whisker-meow", 0.3), call("Chirp", [86, 93, 89], "triangle", 5000, "head-toss", 0.4), call("Peep", [98, 101, 98], "sine", 7800, "whisker-meow", 0.55, 10)],
  dinosaur: [call("Roar", [31, 43, 38, 29], "sawtooth", 950, "head-toss", 1.3, 18), call("Chuff", [43, 38, 31], "square", 700, "neck-sway", 0.45, 24), call("Bellow", [38, 45, 50, 43], "triangle", 1200, "head-toss", 1.5)],
  frog: [call("Croak", [43, 50, 46, 43], "sawtooth", 850, "throat-pulse", 0.9, 27), call("Ribbit", [62, 55, 65, 58], "square", 1800, "throat-pulse", 0.6, 12), call("Peep", [86, 89, 86], "sine", 4000, "throat-pulse", 0.45)],
});
export const quadrupedCalls = id => QUADRUPED_CALLS[id] ?? QUADRUPED_CALLS.elephant;
export const emptyQuadrupedCalls = () => Array.from({ length: 3 }, () => Array(16).fill(0));
export function sanitizeQuadrupedCalls(pattern) {
  return Array.from({ length: 3 }, (_, row) => Array.from({ length: 16 }, (_, step) => {
    const value = Number(pattern?.[row]?.[step]);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }));
}
export function quadrupedCallEvents(score, position) {
  const step = ((Math.floor(Number(position) || 0) % 16) + 16) % 16;
  return quadrupedCalls(score.animalId).flatMap((voice, row) => {
    const intensity = Math.max(0, Math.min(1, Number(score.callPattern?.[row]?.[step]) || 0));
    return intensity ? [{ ...voice, row, intensity, duration: Math.max(0.09, Math.min(1.8, voice.beats * 60 / score.tempoBpm)) }] : [];
  });
}
