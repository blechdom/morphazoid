import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sources = [
  ["thrush-nightingale.ogg", "f2d649e708e2d7ef48000b95d15f7318e37dc9c500683f06600f38cd88f16ba3", "OggS"],
  ["common-blackbird.ogg", "2e713300a07d50b9cad26bb0f7b5d5bdce148ab062b56922ee3dd95fab54ec9f", "OggS"],
  ["chaffinch.ogg", "8fa1fcfabb37d1e19b4868fdd24642433b89e7f984f43ab2a48613d320944d6b", "OggS"],
  ["house-cricket.ogg", "dd444923577c13278e940fce9d70f40d098801d25730ce8698001a073c7c4576", "OggS"],
  ["field-cricket.ogg", "aad6ef2a0d99ca0c2ed247147ff8ec4ac9372a37d1156d176634d13b31f5004e", "OggS"],
  ["european-field-cricket.ogg", "7774774bdc468b07e3d19fabcb4064e9453aaaa3c64998a50f7788688e788b8c", "OggS"],
  ["coyote-chorus.ogg", "3fb5173136261c18a4c2026cef56c2563ee7088ebd47b3f42288c1e1d88dd8c0", "OggS"],
  ["frog-soundscape.ogg", "fa4751ebba9b3cf87f13aac1640a653bdbacacdcbf4ce91c16152f83c861ee44", "OggS"],
  ["dolphin-vocalizations.wav", "bb98f461869b359b30d51146b8bf164bd77bf216e8c4d1e76e24ea896bb8e62b", "RIFF"],
  ["humpback-whale-song.ogg", "cf05e8aa82b3e0296a6fa83a464ee179a8c0e462270493d35af4019c545d5f04", "OggS"],
  ["killer-whale-call.ogg", "aa5ced7ff51d77057df43a60f376078cd481a846c8cb7422fb319437efddefbb", "OggS"],
  ["blue-whale-south-pacific.ogg", "c2998bfd0bb5f00d4a3da98b2e9e5e9facd59640cf7b1de93830b2aa153fe31b", "OggS"],
];

test("the bundled bioacoustic recordings are the documented unchanged media files", async () => {
  for (const [filename, expectedHash, signature] of sources) {
    const bytes = await readFile(new URL(`../assets/bioacoustics/${filename}`, import.meta.url));
    assert.equal(bytes.subarray(0, 4).toString("ascii"), signature, `${filename} has the wrong container`);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), expectedHash, `${filename} changed`);
  }
});

test("recording provenance and Creative Commons obligations remain visible", async () => {
  const sourceNotice = await readFile(
    new URL("../assets/bioacoustics/SOURCES.md", import.meta.url),
    "utf8",
  );
  const thirdPartyNotice = await readFile(
    new URL("../THIRD_PARTY_NOTICES.md", import.meta.url),
    "utf8",
  );

  for (const filename of sources.map(([name]) => name)) assert.match(sourceNotice, new RegExp(filename));
  for (const credit of [
    "Oona\\s+Räisänen",
    "Morray",
    "Thatcher",
    "Baudewijn\\s+Odé",
    "Rybkovich",
    "Hughesdarren",
    "Félix\\s+Blume",
    "Spyrogumas",
    "National\\s+Park\\s+Service",
    "NOAA",
  ]) {
    assert.match(sourceNotice, new RegExp(credit));
    assert.match(thirdPartyNotice, new RegExp(credit));
  }
  for (const license of ["CC0 1.0", "CC BY 3.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "public domain"]) {
    assert.match(sourceNotice, new RegExp(license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.match(thirdPartyNotice, new RegExp(license.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(sourceNotice, /bundled unchanged/i);
  assert.match(sourceNotice, /No Indigenous or other human song recording is bundled/i);
});
