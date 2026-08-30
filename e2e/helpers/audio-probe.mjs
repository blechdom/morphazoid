export async function readAudioStatus(page) {
  return page.evaluate(async () => {
    const moduleUrl = new URL("src/audio-output-manager.js", `${location.origin}/`).href;
    const { getSharedAudioOutputManager } = await import(moduleUrl);
    const status = getSharedAudioOutputManager(globalThis).getStatus();
    return {
      active: Boolean(status.active),
      clipped: Boolean(status.clipped),
      peak: Number(status.peak) || 0,
      rms: Number(status.rms) || 0,
      leftPeak: Number(status.leftPeak) || 0,
      rightPeak: Number(status.rightPeak) || 0,
      connectionCount: Number(status.connectionCount) || 0,
      outputMode: status.output?.mode ?? null,
    };
  });
}

export async function sampleAudioEnvelope(page, {
  durationMs = 900,
  intervalMs = 50,
} = {}) {
  const samples = [];
  const startedAt = Date.now();
  while (Date.now() - startedAt < durationMs) {
    samples.push({ elapsedMs: Date.now() - startedAt, ...await readAudioStatus(page) });
    await page.waitForTimeout(intervalMs);
  }
  const values = samples.filter(({ peak, rms }) => Number.isFinite(peak) && Number.isFinite(rms));
  return {
    samples,
    summary: {
      sampleCount: samples.length,
      finite: values.length === samples.length,
      activeSamples: samples.filter(({ active }) => active).length,
      clippedSamples: samples.filter(({ clipped }) => clipped).length,
      maxPeak: Math.max(0, ...samples.map(({ peak }) => peak)),
      maxRms: Math.max(0, ...samples.map(({ rms }) => rms)),
      meanRms: samples.length
        ? samples.reduce((sum, { rms }) => sum + rms, 0) / samples.length
        : 0,
    },
  };
}

export async function waitForAudioState(page, active, timeout = 5000) {
  await page.waitForFunction(async ({ expected }) => {
    const moduleUrl = new URL("src/audio-output-manager.js", `${location.origin}/`).href;
    const { getSharedAudioOutputManager } = await import(moduleUrl);
    return Boolean(getSharedAudioOutputManager(globalThis).getStatus().active) === expected;
  }, { expected: Boolean(active) }, { timeout });
}

export async function waitForStableAudioState(page, active, {
  stableMs = 250,
  timeout = 5000,
} = {}) {
  await page.evaluate(async ({ expected, requiredStableMs, timeoutMs }) => {
    const moduleUrl = new URL("src/audio-output-manager.js", `${location.origin}/`).href;
    const { getSharedAudioOutputManager } = await import(moduleUrl);
    const manager = getSharedAudioOutputManager(globalThis);
    const deadline = performance.now() + timeoutMs;
    let stableSince = null;

    while (performance.now() < deadline) {
      const matches = Boolean(manager.getStatus().active) === expected;
      if (matches) {
        stableSince ??= performance.now();
        if (performance.now() - stableSince >= requiredStableMs) return;
      } else {
        stableSince = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }

    throw new Error(`Audio active=${expected} was not stable for ${requiredStableMs}ms`);
  }, {
    expected: Boolean(active),
    requiredStableMs: stableMs,
    timeoutMs: timeout,
  });
}
