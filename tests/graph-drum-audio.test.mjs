import assert from "node:assert/strict";
import test from "node:test";
import {
  GRAPH_DRUM_PERCUSSION_STYLES,
  MAX_GRAPH_FM_ATTACKS_PER_SECOND,
  MAX_GRAPH_KARPLUS_ATTACKS_PER_SECOND,
  MAX_GRAPH_RATTLESNAKE_ATTACKS_PER_SECOND,
  GraphDrumAudio,
  graphDrumPercussionVoice,
  graphDrumStyleIsKarplus,
  graphDrumStyleUsesContinuousPitch,
  graphDrumStyleUsesPhysicalEngine,
  graphDrumTriggerPlan,
  sanitizeGraphDrumPercussionStyle,
  translateGraphDrumStartAt,
} from "../src/graph-drum-audio.js";
import { styledLSystemDrumVoice } from "../src/l-system-drums.js";

const baseVoice = Object.freeze({
  id: "test-drum",
  name: "Test drum",
  key: "q",
  family: "tom",
  color: "#abc",
  voiceIndex: 9,
  frequency: 220,
  attack: 0.003,
  decay: 0.4,
  modRatio: 2,
  modIndex: 6,
  pitchBend: 0.3,
  noise: 0.24,
  tone: 0.68,
  level: 0.32,
});

test("Graph drums expose FM, real Rattlesnake, and three bounded Karplus banks", () => {
  assert.deepEqual(
    GRAPH_DRUM_PERCUSSION_STYLES.map(({ id }) => id),
    [
      "drum-bank",
      "circuit",
      "rattlesnake",
      "resonant-metal",
      "rattlesnake-physical",
      "karplus-strong",
      "karplus-tines",
      "karplus-objects",
    ],
  );
  assert.equal(sanitizeGraphDrumPercussionStyle("missing"), "drum-bank");
  assert.equal(graphDrumStyleUsesPhysicalEngine("rattlesnake"), false);
  assert.equal(graphDrumStyleUsesPhysicalEngine("rattlesnake-physical"), true);
  assert.equal(graphDrumStyleUsesContinuousPitch("rattlesnake"), true);
  assert.equal(graphDrumStyleUsesContinuousPitch("rattlesnake-physical"), true);
  assert.equal(graphDrumStyleUsesContinuousPitch("circuit"), false);
  assert.equal(graphDrumStyleIsKarplus("karplus-tines"), true);

  const original = { ...baseVoice };
  const fmVoice = graphDrumPercussionVoice(baseVoice, { style: "circuit" });
  const compactCircuitVoice = styledLSystemDrumVoice(baseVoice, { style: "circuit" });
  const fmPlan = graphDrumTriggerPlan(fmVoice);
  assert.equal(fmPlan.engine, "fm");
  assert.equal(fmPlan.percussionStyle, "circuit");
  assert.ok(fmVoice.decay > compactCircuitVoice.decay * 2);
  assert.ok(fmVoice.decay >= 0.12 && fmVoice.decay <= 0.6);

  const rattlesnake = graphDrumPercussionVoice(baseVoice, {
    style: "rattlesnake-physical",
  });
  const rattlePlan = graphDrumTriggerPlan(rattlesnake);
  assert.equal(rattlePlan.engine, "rattlesnake");
  assert.equal(rattlePlan.settings.model, "hybrid");
  assert.equal(rattlePlan.frequency, baseVoice.frequency);
  assert.match(rattlesnake.name, /^Physical Rattle/);

  const fmRattlesnake = graphDrumPercussionVoice(baseVoice, { style: "rattlesnake" });
  const fmRattlePlan = graphDrumTriggerPlan(fmRattlesnake);
  assert.equal(fmRattlePlan.engine, "fm");
  assert.equal(fmRattlePlan.frequency, baseVoice.frequency);

  for (const style of ["karplus-strong", "karplus-tines", "karplus-objects"]) {
    const voice = graphDrumPercussionVoice(baseVoice, { style });
    const plan = graphDrumTriggerPlan(voice);
    assert.equal(voice.family, "karplus");
    assert.equal(plan.engine, "karplus-strong");
    assert.equal(plan.settings.model, "karplus-strong");
    assert.equal(plan.settings.karplusMorphOrder.length, 4);
    assert.deepEqual(
      [...new Set(plan.settings.karplusMorphOrder)],
      [voice.karplusPresetId],
      "the displayed material must be the material sent to the renderer",
    );
    assert.ok(plan.frequency >= 20 && plan.frequency <= 16_000);
    assert.ok(plan.velocity >= 0.001 && plan.velocity <= 1);
    assert.ok(plan.settings.decay >= 0.04 && plan.settings.decay <= 0.1);
    assert.ok(plan.settings.brightness >= 0 && plan.settings.brightness <= 1);
    assert.ok(plan.settings.hardness >= 0 && plan.settings.hardness <= 1);
  }
  assert.deepEqual(baseVoice, original, "style planning must not mutate the drum bank");
});

test("Graph drum audio translates clocks and bounds Karplus rendering", async () => {
  class StubAudio {
    constructor(currentTime) {
      this.context = { currentTime, state: "running" };
      this.analyser = {};
      this.starts = 0;
      this.triggers = [];
      this.silences = 0;
      this.closes = 0;
      this.output = 0;
    }

    async start() {
      this.starts += 1;
      if (this.context.state === "closed") {
        this.context = { currentTime: 0, state: "running" };
      } else {
        this.context.state = "running";
      }
      return this.context;
    }
    setOutput(value) { this.output = value; }
    async trigger(...args) { this.triggers.push(args); return args; }
    silence() { this.silences += 1; }
    async close() { this.closes += 1; this.context.state = "closed"; }
  }

  const fmAudio = new StubAudio(10);
  const physicalAudio = new StubAudio(100);
  const audio = new GraphDrumAudio({}, { fmAudio, physicalAudio });
  const [firstContext, secondContext] = await Promise.all([audio.start(), audio.start()]);
  assert.equal(firstContext, fmAudio.context);
  assert.equal(secondContext, fmAudio.context);
  assert.equal(fmAudio.starts, 1);
  assert.equal(physicalAudio.starts, 1);
  assert.equal(translateGraphDrumStartAt(10.25, fmAudio.context, physicalAudio.context), 100.25);

  audio.setOutput(0.42);
  assert.equal(fmAudio.output, 0.42);
  assert.equal(physicalAudio.output, 0.42);

  const fmVoice = graphDrumPercussionVoice(baseVoice, { style: "drum-bank" });
  await audio.trigger(fmVoice, { startAt: 10.3 });
  assert.equal(fmAudio.triggers.length, 1);
  assert.equal(fmAudio.triggers[0][1].startAt, 10.3);

  fmAudio.context.currentTime = 12;
  const fmResults = [];
  for (let index = 0; index < MAX_GRAPH_FM_ATTACKS_PER_SECOND + 1; index += 1) {
    fmResults.push(await audio.trigger(fmVoice, { startAt: 12 }));
  }
  assert.equal(fmResults.filter((result) => result?.skipped).length, 1);
  assert.equal(fmResults.at(-1).scheduled, false);
  assert.equal(fmResults.at(-1).skipReason, "attack-rate-budget");
  assert.equal(fmAudio.triggers.length, MAX_GRAPH_FM_ATTACKS_PER_SECOND + 1);

  const physicalVoice = graphDrumPercussionVoice(baseVoice, {
    style: "rattlesnake-physical",
  });
  await audio.trigger(physicalVoice, { startAt: 12.4 });
  assert.equal(physicalAudio.triggers[0][2].engine, "rattlesnake");
  assert.equal(physicalAudio.triggers[0][2].startAt, 100.4);
  assert.equal(physicalAudio.triggers[0][2].minimumVelocity, 0.001);
  assert.equal(physicalAudio.triggers[0][2].preserveDuration, true);

  const rattleResults = [];
  for (let index = 0; index < MAX_GRAPH_RATTLESNAKE_ATTACKS_PER_SECOND + 1; index += 1) {
    rattleResults.push(await audio.trigger(physicalVoice, { startAt: 14 }));
  }
  assert.equal(rattleResults.filter((result) => result?.skipped).length, 1);
  assert.equal(rattleResults.at(-1).scheduled, false);
  assert.equal(rattleResults.at(-1).skipReason, "attack-rate-budget");

  const karplusVoice = graphDrumPercussionVoice(baseVoice, { style: "karplus-tines" });
  const results = [];
  for (let index = 0; index < MAX_GRAPH_KARPLUS_ATTACKS_PER_SECOND + 1; index += 1) {
    results.push(await audio.trigger(karplusVoice, { startAt: 10.5 }));
  }
  assert.equal(results.filter((result) => result?.skipped).length, 1);
  assert.equal(results.at(-1).scheduled, false);
  assert.equal(results.at(-1).skipReason, "attack-rate-budget");
  assert.equal(
    physicalAudio.triggers.filter(([, , options]) => options.engine === "karplus-strong").length,
    MAX_GRAPH_KARPLUS_ATTACKS_PER_SECOND,
  );

  fmAudio.context.state = "suspended";
  physicalAudio.context.state = "interrupted";
  await audio.start();
  assert.equal(fmAudio.context.state, "running");
  assert.equal(physicalAudio.context.state, "running");
  assert.equal(fmAudio.starts, 2);
  assert.equal(physicalAudio.starts, 2);

  fmAudio.context.state = "closed";
  await audio.start();
  assert.equal(audio.context, fmAudio.context);
  assert.equal(audio.fmAttackTimes.length, 0);
  assert.equal(audio.karplusAttackTimes.length, 0);
  assert.equal(audio.rattlesnakeAttackTimes.length, 0);

  audio.silence();
  assert.equal(fmAudio.silences, 1);
  assert.equal(physicalAudio.silences, 1);
  await audio.close();
  assert.equal(fmAudio.closes, 1);
  assert.equal(physicalAudio.closes, 1);
  assert.equal(audio.context, null);
});

test("a stale Graph drum close cannot erase a successful restart", async () => {
  let releaseClose;
  const closeGate = new Promise((resolve) => { releaseClose = resolve; });

  class DelayedCloseAudio {
    constructor(currentTime) {
      this.nextTime = currentTime;
      this.context = null;
      this.analyser = {};
    }

    async start() {
      if (!this.context || this.context.state === "closed") {
        this.context = { currentTime: this.nextTime, state: "running" };
        this.nextTime += 10;
      }
      return this.context;
    }
    setOutput() {}
    silence() {}
    async close() {
      const closingContext = this.context;
      this.context = null;
      if (closingContext) closingContext.state = "closed";
      await closeGate;
    }
  }

  const fmAudio = new DelayedCloseAudio(10);
  const physicalAudio = new DelayedCloseAudio(100);
  const audio = new GraphDrumAudio({}, { fmAudio, physicalAudio });
  const firstClock = await audio.start();
  const closing = audio.close();
  assert.equal(audio.context, null, "close clears the wrapper clock synchronously");

  const restartedClock = await audio.start();
  assert.notEqual(restartedClock, firstClock);
  assert.equal(audio.context, restartedClock);
  assert.equal(audio.context, fmAudio.context);

  releaseClose();
  await closing;
  assert.equal(audio.context, restartedClock, "the older close must not clobber the restart");
  assert.equal(audio.context, fmAudio.context);
});
