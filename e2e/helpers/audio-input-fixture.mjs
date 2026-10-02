export async function installAudioInputFixture(page, delayed = false) {
  await page.addInitScript(({ delayed }) => {
    window.__familyInput = { requests: 0, tracks: [], contexts: [], releases: [] };
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      async getUserMedia() {
        const data = window.__familyInput;
        data.requests++;
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        const merge = context.createChannelMerger(2);
        for (const [index, frequency] of [220, 440].entries()) {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = frequency; gain.gain.value = .08;
          oscillator.connect(gain); gain.connect(merge, 0, index); oscillator.start();
        }
        merge.connect(destination);
        await context.resume();
        data.contexts.push(context);
        data.tracks.push(...destination.stream.getTracks());
        if (delayed) await new Promise(resolve => data.releases.push(resolve));
        return destination.stream;
      },
      addEventListener() {}, removeEventListener() {}, async enumerateDevices() { return []; },
    } });
  }, { delayed });
}
