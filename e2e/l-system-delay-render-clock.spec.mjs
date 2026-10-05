import { test, expect } from '@playwright/test';

const ENGINE = '/src/instruments/micmic/native/browser-engine.js';

test.use({ reducedMotion: 'no-preference' });

for (const renderer of ['canvas', 'webgl2']) {
  test(`${renderer} waves follow the Rust audio clock when status delivery stalls`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__renderClockQa = { nodes: [], frames: [], delayed: 0 };
      const NativeNode = AudioWorkletNode;
      window.AudioWorkletNode = new Proxy(NativeNode, { construct(Target, args) {
        const node = new Target(...args);
        if (args[1] !== 'morphazoid-l-system-delay') return node;
        __renderClockQa.nodes.push(node);
        const kinds = new Map(), port = node.port, post = port.postMessage.bind(port);
        port.postMessage = (data, ...rest) => { if (data.id) kinds.set(data.id, data.type); post(data, ...rest); };
        const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
        let statuses = 0;
        Object.defineProperty(port, 'onmessage', {
          get() { return descriptor.get.call(this); },
          set(handler) {
            descriptor.set.call(this, handler && function (event) {
              if (kinds.get(event.data.id) === 'status' && ++statuses % 3 === 0) {
                __renderClockQa.delayed++;
                setTimeout(() => handler.call(this, event), 180);
              } else handler.call(this, event);
            });
          },
        });
        return node;
      } });
    });
    await page.route('**/src/instruments/micmic/native/app.js', async route => {
      const response = await route.fetch(), source = await response.text();
      const marker = '  const rootNode = geometry.root;';
      expect(source).toContain(marker);
      await route.fulfill({ response, body: source.replace(marker,
        `  if (state.audio && browserEngine.getSampleTime?.() != null) __renderClockQa.frames.push({ now, seconds, nodes: nodes.length, fps: budget.fps });\n${marker}`) });
    });
    await page.goto(`/l-mic-rust.html?renderer=${renderer}`);
    await expect(page.locator('#audioButton')).toBeEnabled({ timeout: 30000 });
    // Keep this timing test light; density and all-branch parity have their own
    // renderer suite. Input remains the real bundled drum PCM and Rust DSP.
    await page.locator('#generations').evaluate(input => {
      input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await page.locator('#source').selectOption('samples', { force: true });
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'true');
    await page.waitForFunction(() => __renderClockQa.delayed >= 4 && __renderClockQa.frames.length >= 80);
    const result = await page.evaluate(async module => {
      const engine = (await import(module)).getBrowserDelayEngine(), diagnostics = engine.getDiagnostics();
      const frames = __renderClockQa.frames.filter(frame => frame.seconds > .5);
      const steps = frames.slice(1).map((frame, index) => frame.seconds - frames[index].seconds);
      return { frames: frames.length, minimumStep: Math.min(...steps), maximumStep: Math.max(...steps),
        delayed: __renderClockQa.delayed, sampleTime: engine.getSampleTime(), diagnostics,
        instances: __renderClockQa.nodes.length, renderer: document.getElementById('stage').dataset.renderer };
    }, ENGINE);
    await test.info().attach(`${renderer}-delayed-clock`, { body: JSON.stringify(result), contentType: 'application/json' });
    expect(result.frames).toBeGreaterThan(40);
    expect(result.minimumStep).toBeGreaterThanOrEqual(-1e-6);
    expect(result.delayed).toBeGreaterThanOrEqual(4);
    expect(result.renderer).toBe(renderer);
    expect(result.diagnostics.audio).toBe(true);
    expect(result.diagnostics.input.playing).toBe(true);
    expect(result.diagnostics.status.outputPeak).toBeGreaterThan(1e-5);
    expect(result.instances).toBe(1);
    expect(errors).toEqual([]);
    await page.locator('#audioButton').click();
    await expect(page.locator('#audioButton')).toHaveAttribute('aria-pressed', 'false');
  });
}
