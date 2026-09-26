import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installFakeMidi, sendMidi, fakeMidiSnapshot } from "./helpers/fake-midi.mjs";

async function openDisclosure(page, id) {
  const disclosure = page.locator(`#${id}`);
  if (!await disclosure.evaluate((node) => node.open)) {
    await disclosure.locator(":scope > summary").click();
  }
  await expect(disclosure).toHaveJSProperty("open", true);
}

async function installAudioDevices(page, { denied = false, delayed = false, unsupported = false, stereo = false } = {}) {
  await page.addInitScript(({ denied, delayed, unsupported, stereo }) => {
    const NativeContext = window.AudioContext;
    const probe = window.__ioProbe = { contexts: [], buffers: [], streams: [], requests: 0, sinkCalls: [] };
    class Context extends NativeContext {
      constructor(options) {
        super(options);
        probe.contexts.push(this);
      }
      setSinkId(id) {
        probe.sinkCalls.push(id);
        if (id === "bad-output") return Promise.reject(new DOMException("unavailable", "NotFoundError"));
        return Promise.resolve();
      }
      createBufferSource() {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          probe.buffers.push({
            channels: source.buffer.numberOfChannels, length: source.buffer.length,
            rate: source.buffer.sampleRate, duration: source.buffer.duration,
            peaks: Array.from({ length: source.buffer.numberOfChannels }, (_, c) => {
              let peak = 0;
              for (const sample of source.buffer.getChannelData(c)) peak = Math.max(peak, Math.abs(sample));
              return peak;
            }),
          });
          return start(...args);
        };
        return source;
      }
    }
    if (unsupported) {
      Object.defineProperty(Context.prototype, "setSinkId", { value: undefined });
      Object.defineProperty(navigator, "requestMIDIAccess", { configurable: true, value: undefined });
    }
    window.AudioContext = Context;
    const media = navigator.mediaDevices;
    Object.defineProperty(media, "selectAudioOutput", { configurable: true, value: async () => ({ deviceId: "test-speakers" }) });
    Object.defineProperty(media, "enumerateDevices", { configurable: true, value: async () => [
      { kind: "audioinput", deviceId: "test-mic", label: "Test microphone" },
      { kind: "audiooutput", deviceId: "test-speakers", label: "Test speakers" },
      { kind: "audiooutput", deviceId: "bad-output", label: "Disconnected output" },
    ] });
    Object.defineProperty(media, "getUserMedia", { configurable: true, value: async (constraints) => {
      probe.requests++;
      probe.constraints = constraints;
      if (denied) throw new DOMException("denied", "NotAllowedError");
      const makeStream = () => {
        const context = probe.contexts.find((c) => c.state !== "closed");
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        gain.gain.value = 0.12;
        const destination = context.createMediaStreamDestination();
        oscillator.connect(gain);
        if (stereo) {
          const invert = context.createGain();
          invert.gain.value = -0.5;
          const merger = context.createChannelMerger(2);
          gain.connect(merger, 0, 0);
          gain.connect(invert).connect(merger, 0, 1);
          merger.connect(destination);
        } else gain.connect(destination);
        oscillator.start();
        const stream = destination.stream;
        probe.streams.push(stream);
        return stream;
      };
      if (delayed) return new Promise((resolve) => {
        // Build the stream before cancellation closes the capture context.
        const stream = makeStream();
        probe.resolveMic = () => resolve(stream);
      });
      return makeStream();
    } });
  }, { denied, delayed, unsupported, stereo });
}

test("safe startup, actual speaker buffers, sample playback, persisted output and Stop all", async ({ page }) => {
  await installAudioDevices(page);
  await page.goto("/settings.html");
  await expect(page.locator("h1")).toHaveText("Sound check.");
  expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(0);
  expect(await page.evaluate(() => __ioProbe.requests)).toBe(0);
  await expect(page.locator(".io-test[open]")).toHaveCount(0);
  await expect(page.locator("#testAll")).toBeDisabled();
  await page.locator("#audioToggle").click();
  await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "true");
  await openDisclosure(page, "speakerTest");
  await page.locator("#testAll").click();
  expect(await page.evaluate(() => __ioProbe.buffers.map((b) => b.peaks))).toEqual([
    [expect.closeTo(0.6, 2), 0], [0, expect.closeTo(0.6, 2)],
  ]);
  await openDisclosure(page, "midiTest");
  await page.locator("#previewVoice").click();
  await expect.poll(() => page.evaluate(() => __ioProbe.buffers.length)).toBe(3);
  expect(await page.evaluate(() => __ioProbe.buffers.at(-1).peaks[0])).toBeGreaterThan(0.5);
  await openDisclosure(page, "speakerTest");
  await openDisclosure(page, "speakerOptions");
  await page.locator("#chooseOutput").click();
  await expect(page.locator("#outputDevice")).toHaveValue("test-speakers");
  await page.locator("#outputDevice").selectOption("bad-output");
  await expect(page.locator("#setupError")).toContainText("Could not select");
  await expect(page.locator("#outputDevice")).toHaveValue("test-speakers");
  await page.keyboard.press("Escape");
  await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => __ioProbe.contexts.every((c) => c.state === "closed"))).toBe(true);
  await page.reload();
  await expect(page.locator("#outputDevice")).toHaveValue("test-speakers");
  expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(0);
});

test("real input meters respond to gain; monitoring is opt-in and tracks close", async ({ page }) => {
  await installAudioDevices(page);
  await page.goto("/settings.html");
  await page.locator("#audioToggle").click();
  await openDisclosure(page, "inputTest");
  await page.locator("#micToggle").click();
  await expect(page.locator("#micToggle")).toHaveText("Stop input");
  await expect(page.locator("#monitorInput")).not.toBeChecked();
  await expect.poll(() => page.locator("#rawMeter").evaluate((el) => el.value)).toBeGreaterThan(-25);
  const before = await page.locator("#adjustedMeter").evaluate((el) => el.value);
  await page.locator("#inputGain").fill("-12");
  await page.locator("#inputGain").dispatchEvent("input");
  await expect.poll(() => page.locator("#adjustedMeter").evaluate((el) => el.value)).toBeLessThan(before - 10);
  await openDisclosure(page, "inputOptions");
  await page.locator("#monitorInput").check();
  await expect(page.locator("#monitorInput")).toBeChecked();
  await openDisclosure(page, "speakerTest");
  await expect(page.locator("#monitorInput")).not.toBeChecked();
  await expect(page.locator("#inputBadge")).toHaveText("Connected");
  await openDisclosure(page, "speakerOptions");
  await page.locator("#speakerLayout").selectOption("mono");
  await expect(page.locator("#monitorInput")).not.toBeChecked();
  expect(await page.evaluate(() => __ioProbe.constraints.audio.autoGainControl.ideal)).toBe(false);
  expect(await page.evaluate(() => __ioProbe.constraints.video)).toBe(false);
  await page.locator("#stopAll").click();
  expect(await page.evaluate(() => __ioProbe.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")))).toBe(true);
  await expect(page.locator("#rawLevel")).toHaveText("−∞ dBFS");
});

test("stereo interface capture meters L/R separately and shares device/channel settings with delays", async ({ page }) => {
  await installAudioDevices(page, { stereo: true });
  await page.goto("/settings.html");
  await openDisclosure(page, "inputTest");
  await page.locator("#inputDevice").selectOption("test-mic");
  await page.locator("#inputChannels").selectOption("2");
  await page.locator("#audioToggle").click();
  await page.locator("#micToggle").click();
  await expect.poll(() => page.locator("#rawMeter").evaluate((el) => el.value)).toBeGreaterThan(-25);
  await expect.poll(() => page.locator("#rawRightMeter").evaluate((el) => el.value)).toBeGreaterThan(-30);
  const left = await page.locator("#rawMeter").evaluate((el) => el.value);
  const right = await page.locator("#rawRightMeter").evaluate((el) => el.value);
  expect(left - right).toBeCloseTo(6.02, 0);
  expect(await page.evaluate(() => __ioProbe.constraints.audio.channelCount)).toEqual({ ideal: 2 });
  await expect(page.locator("#adjustedRightMeter")).toBeVisible();
  await expect(page.locator("#inputInfo")).toContainText("stereo capture");
  await page.locator("#stopAll").click();
  for (const route of ["graph-delay.html", "l-mic.html", "candy-coil-delay.html", "sandy-syrup-delay.html"]) {
    await page.goto(`/${route}`);
    await expect(page.locator('a[href="settings.html"]').first()).toBeAttached();
    const settings = await page.evaluate(async () => (await import("/src/audio-input-settings.js")).audioInputConstraints());
    expect(settings.audio.deviceId).toEqual({ exact: "test-mic" });
    expect(settings.audio.channelCount).toEqual({ ideal: 2 });
    await page.locator("#audioButton").click();
    await expect.poll(() => page.evaluate(() => __ioProbe.requests)).toBe(1);
    await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => __ioProbe.constraints.audio.channelCount)).toEqual({ ideal: 2 });
    expect(await page.evaluate(() => __ioProbe.constraints.audio.deviceId)).toEqual({ exact: "test-mic" });
    await page.locator("#audioButton").click();
    await expect.poll(() => page.evaluate(() => __ioProbe.streams.every((stream) => stream.getTracks().every((t) => t.readyState === "ended")))).toBe(true);
  }
});

test("permission denial is recoverable and a late microphone grant cannot rearm", async ({ page }) => {
  await installAudioDevices(page, { denied: true });
  await page.goto("/settings.html");
  await page.locator("#audioToggle").click();
  await openDisclosure(page, "inputTest");
  await page.locator("#micToggle").click();
  await expect(page.locator("#setupError")).toContainText("Permission was denied");
  await expect(page.locator("#micToggle")).toHaveText("Test input");
});

test("Stop all cancels a pending microphone grant", async ({ page }) => {
  await installAudioDevices(page, { delayed: true });
  await page.goto("/settings.html");
  await page.locator("#audioToggle").click();
  await openDisclosure(page, "inputTest");
  await page.locator("#micToggle").click();
  await expect(page.locator("#micToggle")).toHaveText("Cancel request");
  await page.locator("#stopAll").click();
  await page.evaluate(() => __ioProbe.resolveMic());
  await expect(page.locator("#micToggle")).toHaveText("Test input");
  expect(await page.evaluate(() => __ioProbe.streams.every((s) => s.getTracks().every((t) => t.readyState === "ended")))).toBe(true);
  await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
});

test("MIDI diagnostic filters, announces without queues, limits log, sends/releases and reconnects", async ({ page }) => {
  await installAudioDevices(page);
  await installFakeMidi(page, {
    inputs: [{ id: "one", name: "Keyboard one" }, { id: "two", name: "Keyboard two" }],
    outputs: [{ id: "synth", name: "External synth" }],
  });
  await page.goto("/settings.html");
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
  await openDisclosure(page, "midiTest");
  await page.locator("#midiToggle").click();
  await sendMidi(page, [0x90, 60, 100]);
  await expect(page.locator("#midiLog")).toContainText("C4");
  await expect(page.locator("#midiLastMessage")).toBeVisible();
  await expect(page.locator("#midiLastMessage")).toContainText("C4");
  await expect(page.locator("#midiLog")).not.toBeVisible();
  await expect(page.locator("#midiBadge")).toContainText("received");
  expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(0);
  await page.locator("#audioToggle").click();
  await sendMidi(page, [0x90, 64, 100]);
  await expect.poll(() => page.evaluate(() => __ioProbe.buffers.length)).toBe(1);
  await page.evaluate(() => { for (let i = 0; i < 80; i++) __morphazoidFakeMidi.send([0xb0, 1, i]); });
  await expect(page.locator("#midiLog li")).toHaveCount(40);
  expect(await page.evaluate(() => __ioProbe.buffers.length)).toBe(1);
  await page.locator("#midiInput").selectOption("two");
  await openDisclosure(page, "midiOptions");
  await page.locator("#midiChannel").selectOption("3");
  await page.locator("#clearMidi").click();
  await sendMidi(page, [0x90, 60, 100], { inputId: "two" });
  await sendMidi(page, [0x92, 60, 100], { inputId: "one" });
  await expect(page.locator("#midiLog li")).toHaveCount(0);
  await sendMidi(page, [0x92, 67, 100], { inputId: "two" });
  await expect(page.locator("#midiLog")).toContainText("CH 3");
  await page.locator("#midiOutput").selectOption("synth");
  expect((await fakeMidiSnapshot(page)).outputs[0].sent).toHaveLength(0);
  await page.locator("#sendChannel").selectOption("5");
  await page.locator("#sendNote").click();
  const sent = (await fakeMidiSnapshot(page)).outputs[0].sent;
  expect(sent[0].data).toEqual([0x94, 60, 64]);
  expect(sent[1].data).toEqual([0x84, 60, 0]);
  expect(sent[1].timestamp).toBeGreaterThan(0);
  await page.evaluate(() => __morphazoidFakeMidi.disconnectInput("two"));
  await expect(page.locator("#midiStatus")).toContainText("disconnected");
  await page.evaluate(() => __morphazoidFakeMidi.connectInput({ id: "two" }));
  await expect(page.locator("#midiStatus")).toContainText("Listening");
  await page.locator("#stopAll").click();
  expect((await fakeMidiSnapshot(page)).inputs.every((p) => p.listenerCount === 0 && p.connection === "closed")).toBe(true);
});

test("discrete offline renders isolate all supported layout channels and finish silent", async ({ page }) => {
  await page.goto("/settings.html");
  const results = await page.evaluate(async () => {
    const { IOAudioTest, OUTPUT_LAYOUTS } = await import("/src/site/io-settings.js");
    const results = [];
    for (const [layout, channels] of Object.entries(OUTPUT_LAYOUTS)) {
      const rate = 16000;
      const duration = channels.length * 0.85 + 0.4;
      const context = new OfflineAudioContext(channels.length, Math.ceil(rate * duration), rate);
      class OfflineTest extends IOAudioTest { get active() { return true; } }
      const audio = new OfflineTest();
      audio.context = context;
      audio.master = context.createGain();
      audio.master.channelCountMode = "explicit";
      audio.master.channelInterpretation = "discrete";
      audio.master.connect(context.destination);
      audio.setLayout(layout);
      audio.setOutputDb(-12);
      audio.testChannels(channels.map((_, i) => i));
      const buffer = await context.startRendering();
      let crossTalk = 0, maxPeak = 0, minPeak = 1, tail = 0;
      for (let c = 0; c < channels.length; c++) {
        const samples = buffer.getChannelData(c);
        let channelPeak = 0;
        for (let i = 0; i < samples.length; i++) {
          const t = i / rate, abs = Math.abs(samples[i]);
          if (t >= 0.04 + c * 0.85 && t <= 0.64 + c * 0.85) channelPeak = Math.max(channelPeak, abs);
          else crossTalk = Math.max(crossTalk, abs);
          if (t > duration - 0.1) tail = Math.max(tail, abs);
        }
        maxPeak = Math.max(maxPeak, channelPeak);
        minPeak = Math.min(minPeak, channelPeak);
      }
      results.push({ layout, crossTalk, maxPeak, minPeak, tail, remaining: audio.sources.size });
    }
    return results;
  });
  expect(results).toHaveLength(5);
  for (const result of results) {
    expect(result.crossTalk, result.layout).toBeLessThan(0.0001);
    expect(result.maxPeak, result.layout).toBeLessThan(0.16);
    expect(result.minPeak, result.layout).toBeGreaterThan(0.1);
    expect(result.tail, result.layout).toBe(0);
    expect(result.remaining, result.layout).toBe(0);
  }
});

test("fallbacks, navigation link, responsive reachability and accessible controls", async ({ page }) => {
  await installAudioDevices(page, { unsupported: true });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/settings.html");
  await expect(page.locator("#outputSupport")).toContainText("system output");
  await expect(page.locator("#midiToggle")).toBeDisabled();
  await expect(page.locator("#chooseOutput")).toBeDisabled();
  await openDisclosure(page, "midiTest");
  await openDisclosure(page, "midiOptions");
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#sendChannel").scrollIntoViewIfNeeded();
    await expect(page.locator("#sendChannel")).toBeVisible();
  }
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/recursive-fm.html");
  await page.locator(".header-settings-trigger").click();
  await expect(page.locator(".io-setup-link")).toHaveAttribute("href", /settings\.html$/);
  const [setupPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator(".io-setup-link").click(),
  ]);
  await expect(setupPage).toHaveURL(/settings\.html$/);
  await expect(page).toHaveURL(/recursive-fm\.html$/);
  await setupPage.close();
  expect(errors).toEqual([]);
});

test("quick menu fits the first screen and opens one test at a time without starting devices", async ({ page }) => {
  await installAudioDevices(page);
  await installFakeMidi(page);
  await page.goto("/settings.html");
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size);
    await expect(page.locator(".io-test-heading")).toHaveCount(3);
    await expect(page.locator(".io-test[open]")).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const heading of await page.locator(".io-test-heading").all()) await expect(heading).toBeInViewport();
    await expect(page.locator("#stopAll")).toBeInViewport();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [id, action, options, lastControl] of [
    ["speakerTest", "testAll", "speakerOptions", "testSignal"],
    ["inputTest", "micToggle", "inputOptions", "echoCancellation"],
    ["midiTest", "midiToggle", "midiOptions", "sendChannel"],
  ]) {
    const summary = page.locator(`#${id} > summary`);
    await summary.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(`#${id}`)).toHaveJSProperty("open", true);
    await expect(page.locator(".io-test[open]")).toHaveCount(1);
    await expect(page.locator(`#${action}`)).toBeVisible();
    await expect(page.locator(`#${id} .io-options`)).toHaveJSProperty("open", false);
    await expect(page.locator("#midiLog")).not.toBeVisible();
    await expect(page.locator("#speakerMap")).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(a11y.violations, id).toEqual([]);
    await openDisclosure(page, options);
    await page.locator(`#${lastControl}`).scrollIntoViewIfNeeded();
    await expect(page.locator(`#${lastControl}`)).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const optionsA11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(optionsA11y.violations, options).toEqual([]);
    await page.locator(`#${options} > summary`).click();
  }
  await openDisclosure(page, "inputTest");
  await expect(page.locator("#adjustedRightMeter")).not.toBeVisible();
  await page.locator("#inputChannels").selectOption("2");
  await expect(page.locator("#adjustedRightMeter")).toBeVisible();
  await page.locator("#inputChannels").selectOption("1");
  await expect(page.locator("#adjustedRightMeter")).not.toBeVisible();
  expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(0);
  expect(await page.evaluate(() => __ioProbe.requests)).toBe(0);
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
});

test("top-right gear requires a click and links directly to unarmed tests", async ({ page }) => {
  await installAudioDevices(page);
  await installFakeMidi(page);
  await page.goto("/index.html");
  const gear = page.locator(".header-settings-trigger");
  const menu = page.locator(".header-settings-menu");
  const links = page.locator(".header-settings-link");
  await expect(gear).toHaveCount(1);
  const position = await gear.boundingBox();
  expect(position.x).toBeGreaterThan(1300);
  await gear.hover();
  await page.waitForTimeout(300);
  await expect(menu).toHaveJSProperty("open", false);
  await expect(gear).toHaveAttribute("aria-expanded", "false");
  await gear.click();
  await expect(gear).toHaveAttribute("aria-expanded", "true");
  await expect(links).toHaveText(["Speakers", "Audio input", "MIDI"]);
  await links.nth(1).hover();
  await expect(menu).toHaveJSProperty("open", true);
  await page.mouse.move(600, 250);
  await expect(menu).toHaveJSProperty("open", true);
  await gear.click();
  await expect(menu).toHaveJSProperty("open", false);
  await gear.click();
  await page.mouse.move(600, 250);
  await expect(menu).toHaveJSProperty("open", true);
  await page.locator("h1").click();
  await expect(menu).toHaveJSProperty("open", false);
  await gear.focus();
  await page.keyboard.press("ArrowDown");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(gear).toBeFocused();
  await expect(menu).toHaveJSProperty("open", false);
  await page.keyboard.press("Enter");
  await expect(menu).toHaveJSProperty("open", true);
  await links.first().click();
  await expect(page).toHaveURL(/settings\.html#speakerTest$/);
  await expect(page.locator("#speakerTest")).toHaveJSProperty("open", true);
  await expect(page.locator(".io-test[open]")).toHaveCount(1);
  expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(0);
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
  // Hash shortcuts also work in place, including the same collapsed target.
  await page.locator("#speakerTest > summary").click();
  await gear.click();
  await links.first().click();
  await expect(page.locator("#speakerTest")).toHaveJSProperty("open", true);
  await gear.click();
  await links.nth(1).click();
  await expect(page.locator("#inputTest")).toHaveJSProperty("open", true);
  await expect(page.locator(".io-test[open]")).toHaveCount(1);
  expect(await page.evaluate(() => __ioProbe.requests)).toBe(0);
  await page.locator("#audioToggle").click();
  await gear.click();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveJSProperty("open", false);
  await expect(page.locator("#audioToggle")).toHaveAttribute("aria-pressed", "false");
});

test("instrument gear exposes settings in place, with full setup at the bottom", async ({ page }) => {
  for (const route of ["recursive-fm.html", "graph-delay.html", "morphazoidical/index.html"]) {
    await page.goto(`/${route}`);
    await expect(page.locator(".header-settings-trigger")).toHaveCount(1);
    await page.locator(".header-settings-trigger").hover();
    await expect(page.locator(".header-settings-menu")).toHaveJSProperty("open", false);
    await page.locator(".header-settings-trigger").click();
    await expect(page.locator(".header-settings-link")).toHaveCount(0);
    await expect(page.locator(".header-settings-controls")).toBeVisible();
    await expect(page.locator(".header-settings-controls")).toHaveAttribute("role", "group");
    await expect(page.locator(".audio-output-select")).toBeVisible();
    await expect(page.locator(".midi-profile-select")).toBeVisible();
    await expect(page.locator(".header-settings-panel > :last-child")).toHaveClass(/io-setup-link/);
    await expect(page.locator(".io-setup-link")).toHaveAttribute("target", "_blank");
    await expect(page.locator("#audioButton, #audioToggle").first()).toHaveAttribute("aria-pressed", "false");
  }
});

test("editing in-menu output and MIDI map preserves the live instrument; full setup opens separately", async ({ page }) => {
  await installAudioDevices(page);
  await installFakeMidi(page);
  await page.goto("/graph-synth.html");
  await page.evaluate(() => { window.__keptInstrument = { edits: 17 }; });
  await page.locator("#audioButton").click();
  await page.locator("#playButton").click();
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  const contextCount = await page.evaluate(() => __ioProbe.contexts.length);
  await page.locator(".header-settings-trigger").click();
  await page.locator(".audio-output-select").selectOption("test-speakers");
  await page.locator(".midi-profile-select").selectOption("arturia-minilab-3");
  await expect(page.locator(".header-settings-menu")).toHaveJSProperty("open", true);
  await expect(page).toHaveURL(/graph-synth\.html$/);
  await expect(page.locator("#audioButton")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#playButton")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => __ioProbe.sinkCalls)).toContain("test-speakers");
  expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(contextCount);
  expect(await page.evaluate(() => __ioProbe.contexts.every((context) => context.state === "running"))).toBe(true);
  expect(await page.evaluate(() => __ioProbe.requests)).toBe(0);
  expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
  const [setupPage] = await Promise.all([
    page.waitForEvent("popup"),
    page.locator(".io-setup-link").click(),
  ]);
  await expect(setupPage).toHaveURL(/settings\.html$/);
  await expect(page).toHaveURL(/graph-synth\.html$/);
  expect(await page.evaluate(() => __keptInstrument.edits)).toBe(17);
  expect(await setupPage.evaluate(() => window.opener)).toBeNull();
  await setupPage.close();
  await page.locator(".header-settings-trigger").click();
  await expect(page.locator(".audio-output-select")).toHaveValue("test-speakers");
  await expect(page.locator(".midi-profile-select")).toHaveValue("arturia-minilab-3");
  await page.locator("#audioButton").click();
});

test.describe("touch settings gear", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("tap opens and dismisses the gear, with reachable links and no device activation", async ({ page }) => {
    await installAudioDevices(page);
    await installFakeMidi(page);
    for (const route of ["index.html", "settings.html", "recursive-fm.html"]) {
      await page.goto(`/${route}`);
      const gear = page.locator(".header-settings-trigger");
      const menu = page.locator(".header-settings-menu");
      await expect(gear).toBeInViewport();
      const size = await gear.boundingBox();
      expect(size.width).toBeGreaterThanOrEqual(48);
      expect(size.height).toBeGreaterThanOrEqual(48);
      await gear.tap();
      await expect(menu).toHaveJSProperty("open", true);
      for (const link of await page.locator(".header-settings-link").all()) await expect(link).toBeInViewport();
      if (route === "recursive-fm.html") {
        const selects = page.locator(".header-settings-controls select:not([hidden])");
        await expect(selects).toHaveCount(4);
        for (const select of await selects.all()) await expect(select).toBeInViewport();
        await expect(page.locator(".header-settings-controls .midi-toggle")).toBeInViewport();
        await expect(page.locator(".midi-input-select")).toBeHidden();
      }
      await expect(page.locator(".io-setup-link")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await gear.tap();
      await expect(menu).toHaveJSProperty("open", false);
    }
    await page.goto("/settings.html");
    await page.locator(".header-settings-trigger").tap();
    const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(a11y.violations).toEqual([]);
    await page.locator(".header-settings-link").nth(2).tap();
    await expect(page).toHaveURL(/settings\.html#midiTest$/);
    await expect(page.locator("#midiTest")).toHaveJSProperty("open", true);
    expect(await page.evaluate(() => __ioProbe.contexts.length)).toBe(0);
    expect(await page.evaluate(() => __ioProbe.requests)).toBe(0);
    expect((await fakeMidiSnapshot(page)).requests).toHaveLength(0);
  });
});
