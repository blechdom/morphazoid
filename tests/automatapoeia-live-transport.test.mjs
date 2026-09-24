import assert from "node:assert/strict";
import test from "node:test";
import { AutomatapoeiaClock } from "../src/instruments/cellular-automata/automatapoeia-clock.js";

test("live revision reuses the next row deadline and rewinds to the presented seed", () => {
  let now = 0, generation = 0, rule = 30, current = null;
  const timers = new Map();
  const clock = new AutomatapoeiaClock({
    now: () => now,
    advance: (when) => ({ interval: 0.1, view: { generation: ++generation, rule, when } }),
    present: view => { current = view; },
    setTimer: callback => { timers.set(1, callback); return 1; },
    clearTimer: id => timers.delete(id),
  });
  clock.start();
  now = 0.09; clock.drain();
  assert.equal(current.generation, 1);
  const boundary = clock.queue[0].time;
  const currentBefore = structuredClone(current);
  for (rule of [90, 110, 0]) {
    clock.revise(when => { assert.equal(when, boundary); generation = current.generation; });
    assert.deepEqual(current, currentBefore);
    assert.equal(clock.queue[0].view.generation, 2);
    assert.equal(clock.queue[0].view.rule, rule);
    assert.equal(clock.queue[0].time, boundary);
    assert.equal(timers.size, 1);
  }
  now = boundary; clock.drain();
  assert.equal(current.generation, 2);
  assert.equal(current.rule, 0);
  clock.stop();
  let revised = false;
  clock.revise(() => { revised = true; });
  assert.equal(revised, false);
  assert.equal(timers.size, 0);
});

import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { parse } from "acorn";
const source = await readFile(new URL("../src/families/experiments/experiments-app.js", import.meta.url), "utf8");
const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
const declaration = ast.body.find(node => node.type === "ClassDeclaration" && node.id.name === "ExperimentAudio");

test("next-row cleanup preserves sounding buffer tails, cancels future attacks and retains panic ownership", () => {
  const audio = vm.runInNewContext(`new (${source.slice(declaration.start, declaration.end)})()`);
  audio.context = { currentTime: 3 };
  const node = () => ({ stops: [], stop(when) { this.stops.push(when); } });
  const tail = node(), futureRow = node(), held = node(), futureColumn = node();
  audio.rowScanSources.add(tail).add(futureRow);
  audio.rowScanStartTimes.set(tail, 2.9).set(futureRow, 3.2);
  const log = [];
  function envelope(name) {
    return { gain: { value: 0.5,
      cancelAndHoldAtTime: when => log.push([name, "hold", when]),
      cancelScheduledValues: when => log.push([name, "cancel", when]),
      setValueAtTime: (value, when) => log.push([name, "set", value, when]),
      linearRampToValueAtTime: (value, when) => log.push([name, "ramp", value, when]),
    } };
  }
  for (const [oscillator, start, name] of [[held, 2, "held"], [futureColumn, 3.2, "future"]]) {
    const env = envelope(name);
    audio.columnSources.add(oscillator);
    audio.columnSourceStartTimes.set(oscillator, start);
    audio.columnSourceEnvelopes.set(oscillator, env);
    audio.columnVoices.set(name, { oscillator, envelope: env });
  }
  audio.cancelAutomataFrom(3.1);
  assert.deepEqual(tail.stops, [], "do not truncate the current row's finite tail");
  assert.deepEqual(futureRow.stops, [3.1]);
  assert.deepEqual(held.stops, [3.1 + 0.012]);
  assert.deepEqual(futureColumn.stops, [3.1], "future sine must stop before it can begin");
  assert.ok(log.some(([name, action, value]) => name === "future" && action === "set" && value === 0));
  assert.equal(audio.columnVoices.size, 0);
  assert.equal(audio.columnSources.size, 2, "keep old nodes owned until ended");
  audio.silence();
  for (const source of [tail, futureRow, held, futureColumn]) assert.equal(source.stops.at(-1), 3);
  for (const key of ["columnSources", "columnSourceEnvelopes", "columnSourceRetireTimes", "columnSourceStartTimes", "rowScanSources", "rowScanStartTimes"]) assert.equal(audio[key].size, 0, key);
});

test("low-rate edits keep their next deadline even outside the scheduling horizon", () => {
  let now = 0, generation = 0, current;
  const clock = new AutomatapoeiaClock({
    now: () => now,
    advance: () => ({ interval: 1, view: ++generation }),
    present: view => { current = view; },
    setTimer: () => 1, clearTimer() {},
  });
  clock.start(); now = 0.1; clock.drain();
  assert.equal(current, 1);
  assert.equal(clock.queue.length, 0);
  const deadline = clock.nextTime;
  clock.revise(when => { assert.equal(when, deadline); generation = current; });
  assert.equal(clock.queue.length, 0);
  assert.equal(clock.nextTime, deadline);
  now = 0.8; clock.pump();
  assert.equal(clock.queue[0].time, deadline);
  assert.equal(clock.queue[0].view, 2);
  clock.stop();
});
