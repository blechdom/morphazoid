import assert from "node:assert/strict";

// Reverse the exact 7.1 source edits before older, byte-exact publication
// proofs. The feature's behavior also has focused routing and browser tests;
// do not revise the historical hashes to accommodate these additions.
export const surround71SourceChanges = [
  {
    file: "README.md",
    beforeSha256: "636231bbbaefce45c8b87cec730668563c1748220196aa36c24677302a8bf3cc",
    afterSha256: "e4ad111cae23ceeade44f897a35d4412737c4ab5a49c958e65007de19666284c",
    markers: ["7.1 (seven bed, one LFE)"],
    replacements: [{
      before: "7:4:1 (seven bed, four height, one LFE), 4:1",
      after: "7.1 (seven bed, one LFE), 7:4:1 (seven bed, four height, one LFE), 4:1",
    }],
  },
  {
    file: "src/pages/spartial.html",
    beforeSha256: "911622bb1027ddf7484809f570a16cd281cd0d97388701ad016df545ffdb5b65",
    afterSha256: "56e635009aff8646029c164db84f0af7b2f9e0d50e6fef22d4d844d7fe69fddd",
    markers: ["spartial-preset-host", '<option value="7-1">'],
    replacements: [
      {
        before: '<aside class="panel spartial-panel" data-instrument-preset-host aria-label="SPARTIAL controls">',
        after: '<aside class="panel spartial-panel" aria-label="SPARTIAL controls">',
      },
      {
        before: "",
        after: '      <div class="spartial-preset-host" data-instrument-preset-host></div>\n',
      },
      {
        before: '<option value="4-1">4:1 surround</option><option value="7-4-1">',
        after: '<option value="4-1">4:1 surround</option><option value="7-1">7.1 surround</option><option value="7-4-1">',
      },
    ],
  },
  {
    file: "src/pages/surround-field.html",
    beforeSha256: "eeeffdb20f72e65cd62735bac6d5bc4a5895f047205976e333fdf033b063bcc8",
    afterSha256: "9b8bb1e708903629976a45c1faf6b7cae7d877cae2219e6b04dc4ea2c4fc128d",
    markers: ['data-layout="7-1"', '<b>7.1</b> places sides'],
    replacements: [
      {
        before: "sound inside 7:4:1, 4:1, eight-speaker circle",
        after: "sound inside 7.1, 7:4:1, 4:1, eight-speaker circle",
      },
      {
        before: "",
        after: '              <button type="button" data-layout="7-1" aria-pressed="false"><b>7.1</b><small>7 BED · 1 LFE</small><i class="layout-glyph glyph-71"></i></button>\n',
      },
      {
        before: '<p class="array-convention"><b>7:4:1</b> follows bed : height : LFE order; the same array is commonly written 7.1.4.</p>',
        after: '<p class="array-convention"><b>7.1</b> places sides at channels 5–6 and rears at 7–8. The existing <b>7:4:1</b> patch keeps rears at 5–6 and sides at 7–8; its bed : height : LFE name is commonly written 7.1.4.</p>',
      },
    ],
  },
  {
    file: "src/pages/simd-resonator-rust.html",
    beforeSha256: "0f8d6f9f1eb27307647c4293578a26b3d38c648d50d403634cb0c1694e576314",
    afterSha256: "df66b8509cf60f303fdc69b289901abeb576361a62334460df0644accfb31645",
    markers: ['<option value="7-1">7.1</option>'],
    replacements: [{
      before: '<option value="4-1">4.1</option><option value="7-4-1">',
      after: '<option value="4-1">4.1</option><option value="7-1">7.1</option><option value="7-4-1">',
    }],
  },
  {
    file: "src/instruments/spartial/spartial.css",
    beforeSha256: "4b6bddbc8d8c6fb68e311ea486237423a1e484f22d1a533983ffa3a5167545e5",
    afterSha256: "b8add4a25863eb4e5ff51629e7bf7583b0c846f8f73436f9527e751ffaccb279",
    markers: [".spartial-preset-host"],
    replacements: [{
      before: "",
      after: ".spartial-preset-host { display: contents; }\n",
    }],
  },
  {
    file: "src/instruments/surround-field/surround-field.css",
    beforeSha256: "89ef55c130233fb794ecb702bb73a5cf2b7902eb1d2aa2cc40826c4c7dcedf2d",
    afterSha256: "6a72d2e84c697f7d7d8207cff58a62a91f1a26c6a1748a521a0c7db6214a6ba6",
    markers: [".glyph-71"],
    replacements: [{
      before: "",
      after: ".glyph-71 {\n  box-shadow: inset 0 0 0 5px #0a0d0b, inset 0 0 0 6px currentColor;\n}\n\n",
    }],
  },
  {
    file: "src/instruments/simd-resonator-rust/surround-output.js",
    beforeSha256: "8341fb9083dc5cbdbd789c00de316566cf2d677eac35f16bb8e56d3b6f4be246",
    afterSha256: "b472daab66d261c60e003c9d22e2cde7f49d0d0c9d27551578c16d4b7f9ae9bf",
    markers: ["'7-1', '7-4-1'"],
    replacements: [{
      before: "'4-1', '7-4-1', '8-cube'",
      after: "'4-1', '7-1', '7-4-1', '8-cube'",
    }],
  },
  {
    file: "docs/spartial.md",
    beforeSha256: "58d01210568bea80e8e1de80abcaf407715af86c212bcbd29e791a62b6f2cc17",
    afterSha256: "4cdc169fc39a668209f28f7d4180e681d8be3fe200e60b04eb922fdc1e09cd89",
    markers: ["The eight-channel **7.1** layout", "For 7.1 and 7:4:1", "The 7.1 and 7:4:1 patches"],
    replacements: [
      {
        before: "SPARTIAL's 7:4:1 patch uses channels 5–6 for LS/RS (sides) and channels 7–8\nfor LRS/RRS (rears). The front, LFE and height channel assignments stay the same.\n",
        after: "The eight-channel **7.1** layout uses L/R/C/LFE at channels 1–4, LS/RS (sides)\nat 5–6 and LRS/RRS (rears) at 7–8, with no height speakers. SPARTIAL's 7:4:1\npatch retains the same bed order and adds four height channels at 9–12.\n",
      },
      {
        before: "Speaker setup includes **Omit LFE channel**, on by default. For 7:4:1 it leaves\nchannel 4 silent; for 4:1 it leaves channel 5 silent. Other physical output",
        after: "Speaker setup includes **Omit LFE channel**, on by default. For 7.1 and 7:4:1\nit leaves channel 4 silent; for 4:1 it leaves channel 5 silent. Other physical output",
      },
      {
        before: "The 7:4:1 patch keeps LS/RS at 5–6 and LRS/RRS at 7–8.",
        after: "The 7.1 and 7:4:1 patches keep LS/RS at 5–6 and LRS/RRS at 7–8.",
      },
    ],
  },
  {
    file: "docs/simd-resonator-rust.md",
    beforeSha256: "e5d4d5857cd4670c2ebf73944cece8e1657284afcd411238d94413c74a8c1355",
    afterSha256: "148f83667749499a1bdd5df5d89f01edca8aae5ae1bce4d26e92d836f72b49c6",
    markers: ["In 7.1, channels 1–4"],
    replacements: [{
      before: "sixteen-speaker ring, 4:1 surround, 7:4:1 surround and eight-speaker cube. LFE channels remain in\nthe physical layout but are silent.",
      after: "sixteen-speaker ring, 4:1 surround, 7.1 surround, 7:4:1 surround and eight-speaker cube.\nIn 7.1, channels 1–4 are L/R/C/LFE, sides are 5–6 and rears are 7–8.\nLFE channels remain in the physical layout but are silent.",
    }],
  },
  {
    file: "src/instruments/surround-field/surround-field.js",
    beforeSha256: "bda86f2611b4977b2cd3f04a8e3eaacd0445d031b40ece15383456b4e8ecdd24",
    afterSha256: "feefad21886860910444ba7258f944eb018f558e2671544bd556b9d931aceb80",
    markers: ["const sevenOneChannels", '"7-1": Object.freeze({'],
    replacements: [
      {
        before: "",
        after: [
          "  // SPARTIAL's existing bed patch places sides at 5–6 and rears at 7–8.",
          "  // Keep the older 7:4:1 patch unchanged for saved projects and recordings.",
          '  const sevenOneChannels = { "left-side": 5, "right-side": 6, "left-rear": 7, "right-rear": 8 };',
          "  const sevenOne = sevenFourOne.slice(0, 8)",
          "    .map(item => Object.freeze({ ...item, channel: sevenOneChannels[item.id] ?? item.channel }))",
          "    .sort((a, b) => a.channel - b.channel);",
          "",
        ].join("\n") + "\n",
      },
      {
        before: "",
        after: [
          '    "7-1": Object.freeze({',
          '      id: "7-1",',
          '      name: "7.1",',
          '      descriptor: "7 bed · 1 LFE",',
          '      view: "plan",',
          "      speakers: Object.freeze(sevenOne),",
          "    }),",
        ].join("\n") + "\n",
      },
    ],
  },
];

/** Peel only these exact additions, leaving any unrelated drift visible. */
export function restoreSurround71Source(source, file, { allowRestored = false } = {}) {
  if (typeof source !== "string") return source;
  const change = surround71SourceChanges.find(item => item.file === file);
  if (!change) return source;
  const error = `${file}: exact 7.1 surround source amendment`;
  const counts = change.replacements.map(({ after }) => source.split(after).length - 1);
  if (allowRestored && counts.every(count => count === 0)) {
    for (const marker of change.markers) assert.equal(source.includes(marker), false, error);
    return source;
  }
  for (const count of counts) assert.equal(count, 1, error);
  for (const { before, after } of [...change.replacements].reverse()) source = source.replace(after, () => before);
  return source;
}
