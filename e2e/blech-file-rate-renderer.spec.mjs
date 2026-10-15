import { test, expect } from '@playwright/test';

for (const forceCanvas of [true, false]) test(`${forceCanvas ? 'Canvas' : 'GPU'} scales future and past by the actual 1/32 file rate`, async ({ page }) => {
  await page.route('**/__blech-slow-file.html', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><title>Slow file geometry</title></head><body style="margin:0"><div id="stage" style="width:700px;height:500px"></div></body></html>' }));
  await page.goto('/__blech-slow-file.html');
  const result = await page.evaluate(async forceCanvas => {
    const [{ createBlackMidiVisualizer, blackMidiKeyLayout }, { parseBlackMidiScore }] = await Promise.all([
      import('/src/instruments/blech-midi/blech-midi-black-renderer.js'), import('/src/instruments/blech-midi/blech-midi-black-score.js'),
    ]);
    // At 120 BPM the first note spans .1–.125 source seconds, the second .3–.325.
    // Master 30 BPM × ratio 1/8 = .03125× playback: first note is 3.2–4 seconds away.
    const events = [96, 144, 60, 100, 24, 128, 60, 0, 129, 40, 144, 72, 100, 24, 128, 72, 0, 0, 255, 47, 0];
    const bytes = Uint8Array.from([77,84,104,100,0,0,0,6,0,0,0,1,1,224,77,84,114,107,0,0,0,events.length,...events]);
    const transport = { position: 0, rate: .03125 };
    const view = createBlackMidiVisualizer({ mount: document.querySelector('#stage'), forceCanvas, getTransport: () => transport });
    view.setScore(parseBlackMidiScore(bytes.buffer)); view.setOptions({ trackColors: { 0: '#ff0000' } });
    const canvas = document.querySelector('canvas'), key = blackMidiKeyLayout()[60], x = key.x + key.width / 2;
    const pixel = y => {
      if (forceCanvas) return [...canvas.getContext('2d').getImageData(Math.floor(x * canvas.width), Math.floor(y * canvas.height), 1, 1).data];
      const gl = canvas.getContext('webgl2'), color = new Uint8Array(4);
      gl.readPixels(Math.floor(x * canvas.width), canvas.height - 1 - Math.floor(y * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, color);
      return [...color];
    };
    const future = { ...view.render() };
    const futurePixel = pixel(future.keyboardTop - 3.6 * future.keyboardTop / 6);
    // .15 source seconds: first note ended .8 wall seconds ago, began 1.6 ago.
    transport.position = .15;
    const past = { ...view.render() }, pastPixel = pixel(past.keyboardBottom + 1.2 * past.keyboardTop / 6);
    const renderer = view.renderer; view.dispose();
    return { future, past, futurePixel, pastPixel, renderer };
  }, forceCanvas);
  expect(result.renderer).toBe(forceCanvas ? 'Canvas2D' : 'WebGL2');
  expect(result.future.visible).toBe(1); // The second note is beyond the six-second window.
  expect(result.futurePixel.slice(0, 3)).toEqual([255, 0, 0]);
  expect(result.past.filePastVisible).toBe(1);
  expect(result.pastPixel[0]).toBeGreaterThan(100);
  expect(result.pastPixel.slice(1, 3)).toEqual([0, 0]);
});
