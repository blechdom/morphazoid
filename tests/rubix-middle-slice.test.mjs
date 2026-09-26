import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

for (const owner of ['rubix', 'rubixoids/rubix']) {
  const { createSolvedRubixCube, turnRubixLayer, extractRubixFace, RUBIX_FACE_ORDER } = await import(`../src/instruments/${owner}/rubix.js`);
  for (const size of [3, 5, 7]) for (const axis of ['x', 'y', 'z']) for (const direction of [-1, 1]) {
    test(`${owner}: ${size}×${size} ${axis} middle slice ${direction} carries all four centers and reverses exactly`, () => {
      const solved = createSolvedRubixCube(size);
      const move = { axis, layer: 0, direction };
      const turned = turnRubixLayer(solved, move);
      let movedCenters = 0;
      for (const [index, original] of solved.stickers.entries()) {
        const sticker = turned.stickers[index];
        if (original.position[axis] !== 0) {
          assert.equal(sticker, original, 'stickers outside the slice stay untouched');
          continue;
        }
        assert.notDeepEqual(sticker.position, original.position, 'every sticker in the slice travels');
        assert.notDeepEqual(sticker.normal, original.normal, 'every sticker in the slice changes face');
        for (const key of ['id', 'color', 'homeFace', 'homeRow', 'homeColumn', 'isCenter']) assert.equal(sticker[key], original[key]);
        assert.ok(Object.isFrozen(sticker));
        if (original.isCenter) movedCenters++;
      }
      assert.equal(movedCenters, 4);
      for (const face of RUBIX_FACE_ORDER) assert.equal(extractRubixFace(turned, face).length, size ** 2);
      assert.deepEqual(turnRubixLayer(turned, { ...move, direction: -direction }), solved);
      let cycled = turned;
      for (let i = 1; i < 4; i++) cycled = turnRubixLayer(cycled, move);
      assert.deepEqual(cycled, solved);
    });
  }
  test(`${owner}: compound middle and outer turns undo without losing center identities`, () => {
    const solved = createSolvedRubixCube();
    const moves = [
      { axis: 'x', layer: 0, direction: 1 }, { axis: 'y', layer: 1, direction: -1 },
      { axis: 'z', layer: 0, direction: -1 }, { axis: 'y', layer: 0, direction: 1 },
      { axis: 'z', layer: -1, direction: 1 },
    ];
    let cube = moves.reduce((state, move) => turnRubixLayer(state, move), solved);
    for (const move of moves.toReversed()) cube = turnRubixLayer(cube, { ...move, direction: -move.direction });
    assert.deepEqual(cube, solved);
  });
  test(`${owner}: factory scores retain their pre-fix notes and arrangements`, async () => {
    const { RUBIX_FULL_PRESETS } = await import(`../src/instruments/${owner}/full-presets.js`);
    const scores = JSON.stringify(RUBIX_FULL_PRESETS.map(preset => [preset.id, preset.snapshot.cube]));
    // Captured before correcting live middle-slice movement, including Sweet Stella.
    assert.equal(createHash('sha256').update(scores).digest('hex'), 'ef5348163e46a54916d6bbbbb54264aacb22eefa54fb8680db4faef2a07ec06c');
  });
}
