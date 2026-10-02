import { test, expect } from "@playwright/test";

const routes = [
  "graph-delay.html", "l-mic.html", "moire-drone.html", "sandy-syrup-delay.html",
  "candy-coil-delay.html", "throatazoid.html", "alien-larynx.html", "morphynx.html",
];

async function installInput(page, { channels = 2, delayed = false, denied = false } = {}) {
  await page.addInitScript(({ channels, delayed, denied }) => {
    localStorage.setItem("morphazoid.audio-input.v1", JSON.stringify({ inputChannels: channels }));
    const Native = AudioContext;
    const probe = window.__liveInput = { contexts: [], gains: [], gainCommands: [], streams: [], requests: 0, delayed, denied };
    const postMessage = MessagePort.prototype.postMessage;
    MessagePort.prototype.postMessage = function(message, ...rest) {
      const gain = message?.type === "input-gain" ? message.value : message?.parameters?.inputGain;
      if (Number.isFinite(gain)) probe.gainCommands.push(gain);
      return postMessage.call(this, message, ...rest);
    };
    window.AudioContext = class extends Native {
      constructor(options) { super(options); probe.contexts.push(this); }
      createGain() { const node = super.createGain(); probe.gains.push(node); return node; }
    };
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      probe.requests += 1;
      probe.constraints = constraints;
      if (probe.denied) throw new DOMException("denied", "NotAllowedError");
      const context = probe.contexts.find(candidate => candidate.state !== "closed");
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.value = .12;
      const destination = context.createMediaStreamDestination();
      destination.channelCount = channels;
      oscillator.connect(gain);
      if (channels === 2) {
        const invert = context.createGain(); invert.gain.value = -.5;
        const merger = context.createChannelMerger(2);
        gain.connect(merger, 0, 0);
        gain.connect(invert).connect(merger, 0, 1);
        merger.connect(destination);
      } else gain.connect(destination);
      oscillator.start();
      const stream = destination.stream;
      for (const track of stream.getAudioTracks()) Object.defineProperty(track, "getSettings", { value: () => ({ channelCount: channels }) });
      probe.streams.push(stream);
      return probe.delayed ? new Promise(resolve => { probe.resolve = () => resolve(stream); }) : stream;
    };
  }, { channels, delayed, denied });
}

async function inputLevels(page) {
  return page.locator(".mz-input-meter meter").evaluateAll(meters => meters.map(meter => meter.value));
}

for (const route of routes) {
  test(`${route}: explicit input, stereo gain and device release preserve master Audio`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await installInput(page);
    await page.goto(`/${route}`);
    const input = page.locator(".mz-input-toggle");
    await expect(input).toHaveCount(1);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    expect(await page.evaluate(() => __liveInput.requests)).toBe(0);
    await input.click();
    await expect(input).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator(".mz-input-meter")).toHaveAttribute("data-channels", "2");
    await expect.poll(async () => (await inputLevels(page))[0]).toBeGreaterThan(.05);
    const levels = await inputLevels(page);
    expect(levels[1]).toBeGreaterThan(.02);
    expect(levels[0]).toBeGreaterThan(levels[1] * 1.6);
    const gain = page.locator(".mz-audio-input-strip input[type=range]");
    await gain.evaluate(node => { node.value = "0"; node.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect.poll(async () => Math.max(...await inputLevels(page))).toBeLessThan(.001);
    await gain.evaluate(node => { node.value = ".5"; node.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect.poll(async () => (await inputLevels(page))[0]).toBeGreaterThan(.03);
    const workletGain = ["moire-drone.html", "sandy-syrup-delay.html", "candy-coil-delay.html"].includes(route);
    if (!workletGain) {
      await expect.poll(() => page.evaluate(() => {
        __liveInput.halfGainNodes = __liveInput.gains.filter(node => Math.abs(node.gain.value - .5) < .001);
        return __liveInput.halfGainNodes.length;
      })).toBeGreaterThan(0);
    }
    await gain.evaluate(node => { node.value = "1.5"; node.dispatchEvent(new Event("input", { bubbles: true })); });
    await expect(gain).toHaveValue("1.5");
    if (workletGain) {
      await expect.poll(() => page.evaluate(() => __liveInput.gainCommands.at(-1))).toBe(1.5);
    } else {
      await expect.poll(() => page.evaluate(() => __liveInput.halfGainNodes.some(node => Math.abs(node.gain.value - 1.5) < .001))).toBe(true);
    }
    await expect.poll(async () => (await inputLevels(page))[0]).toBeGreaterThan(.15);
    await expect.poll(async () => (await inputLevels(page))[1]).toBeGreaterThan(.075);
    if (!["moire-drone.html", "morphynx.html"].includes(route)) {
      await expect(page.locator(".mz-input-gain output")).toHaveText("150%");
    }
    await page.locator("#audioButton").click();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => __liveInput.requests)).toBe(1);
    await input.click();
    await expect(input).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => __liveInput.streams.every(stream => stream.getTracks().every(track => track.readyState === "ended")))).toBe(true);
    expect(errors).toEqual([]);
  });

  test(`${route}: a cancelled permission request retires its late grant and can retry`, async ({ page }) => {
    await installInput(page, { channels: 1, delayed: true });
    await page.goto(`/${route}`);
    const input = page.locator(".mz-input-toggle");
    await input.click();
    await expect.poll(() => page.evaluate(() => __liveInput.requests)).toBe(1);
    await expect(input).toBeEnabled();
    await expect(input).toHaveAttribute("aria-busy", "true");
    await input.click();
    await expect(input).toHaveAttribute("aria-busy", "false");
    await page.evaluate(() => { __liveInput.delayed = false; __liveInput.resolve(); });
    await expect.poll(() => page.evaluate(() => __liveInput.streams[0].getTracks().every(track => track.readyState === "ended"))).toBe(true);
    await input.click();
    await expect(input).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".mz-input-meter")).toHaveAttribute("data-channels", "1");
    await expect(page.locator(".mz-input-meter .mz-stereo-meter__channel").nth(1)).toBeHidden();
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
  });
}

test("denied input can retry without arming master Audio", async ({ page }) => {
  await installInput(page, { denied: true });
  await page.goto("/graph-delay.html");
  const input = page.locator(".mz-input-toggle");
  await input.click();
  await expect.poll(() => page.evaluate(() => __liveInput.requests)).toBe(1);
  await expect(input).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => { __liveInput.denied = false; });
  await input.click();
  await expect(input).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
});

function waveFile() {
  const samples = 4800;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(48000, 24); buffer.writeUInt32LE(96000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++) buffer.writeInt16LE(Math.round(Math.sin(index / 48000 * 440 * Math.PI * 2) * 8000), 44 + index * 2);
  return buffer;
}

for (const route of ["sandy-syrup-delay.html", "candy-coil-delay.html"]) {
  test(`${route}: file input uses its native player and no microphone permission`, async ({ page }) => {
    await installInput(page);
    await page.goto(`/${route}`);
    await page.locator(".mz-input-source").selectOption("file");
    await page.locator("#filePicker").setInputFiles({ name: "tone.wav", mimeType: "audio/wav", buffer: waveFile() });
    await page.locator(".mz-input-toggle").click();
    await expect(page.locator(".mz-input-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => page.locator("#fileAudio").evaluate(audio => audio.paused)).toBe(false);
    expect(await page.evaluate(() => __liveInput.requests)).toBe(0);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "false");
    await page.locator(".mz-input-toggle").click();
    await expect.poll(() => page.locator("#fileAudio").evaluate(audio => audio.paused)).toBe(true);
  });
}
