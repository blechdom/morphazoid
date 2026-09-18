import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { dispatchBrowserMidiEvent } from "../src/browser-midi-adapter.js";
import { PpqMidiOutputScheduler } from "../src/wax-midi-routing.js";
import { installUniversalWaxAdapter, routeIdForLocation } from "../scripts/wax/wax-universal-adapter.js";
import { TOOL_GROUPS } from "../src/site/instrument-registry.js";

const plan = JSON.parse(await readFile(new URL("../docs/catalogue-update-decisions.json", import.meta.url)));
const before = JSON.parse(await readFile(new URL("./fixtures/catalogue-before-20260918.json", import.meta.url)));
const renamed = plan.rows.filter(row => row.id !== row.oldId);

test("renamed public and historical routes resolve to one catalogue identity", () => {
  for (const row of renamed) {
    const tool = TOOL_GROUPS.flatMap(group => group.tools).find(tool => tool.id === row.id);
    for (const href of [tool.href, ...(tool.legacyHrefs ?? [])]) {
      assert.equal(routeIdForLocation({ pathname: `/dist-wax/${href}` }), row.id, href);
    }
  }
});

test("browser MIDI retains old listener IDs, message identity and cancellation", () => {
  for (const row of renamed) {
    const message = Object.freeze({ type: "noteon", note: 67, velocity: 101 });
    let received;
    const runtime = {
      CustomEvent,
      dispatchEvent(event) {
        received = event;
        event.preventDefault();
        return false;
      },
    };
    assert.equal(dispatchBrowserMidiEvent(runtime, message, row.id), true);
    assert.equal(received.type, "morphazoid:midi-input");
    assert.equal(received.detail.routeId, row.oldId);
    assert.equal(received.detail.message, message);
    assert.equal(received.detail.source, "browser");
    assert.equal(Object.isFrozen(received.detail), true);
  }
});

// Minimal DOM for exercising the real adapter/manager registration and state
// callbacks. Browser tests separately exercise actual controls and Audio.
function hostHarness(href) {
  let registration;
  const element = () => ({
    dataset: {},
    setAttribute() {},
    querySelector() { return null; },
  });
  const document = {
    head: { append() {} },
    body: { append() {} },
    documentElement: { dataset: {}, removeAttribute() {} },
    createElement: element,
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const runtime = {
    document,
    location: { pathname: `/dist-wax/${href}` },
    MorphazoidWAX: {
      register(value) {
        registration = value;
        return () => {};
      },
    },
  };
  return { runtime, get registration() { return registration; } };
}

test("WAX renames preserve old project state keys, client IDs and companion note seeds", () => {
  for (const row of renamed) {
    const previous = before.WAX_INSTRUMENT_SUPPORT.find(item => item.id === row.oldId);
    if (!previous) continue; // Labs deliberately have no invented WAX policy.
    const tool = TOOL_GROUPS.flatMap(group => group.tools).find(tool => tool.id === row.id);
    const host = hostHarness(tool.href);
    const adapter = installUniversalWaxAdapter(host.runtime);
    try {
      assert.equal(adapter.routeId, row.id);
      assert.equal(host.registration.id, `${row.oldId}:midi-routing`);
      assert.equal(host.registration.stateVersion, 1);
      assert.deepEqual(adapter.manager.status().clientIds, [`wax-universal:${row.oldId}`]);
      const oldProject = {
        outputMode: previous.roles.includes("midi-fx") ? "both" : "audio",
        rootNote: 57, channel: 4, division: "1/8", gate: 0.6, hostSync: true,
      };
      host.registration.applyState(oldProject);
      assert.equal(adapter.state.rootNote, oldProject.rootNote);
      assert.equal(adapter.state.channel, oldProject.channel);
      assert.equal(adapter.state.division, oldProject.division);
      assert.equal(adapter.state.gate, oldProject.gate);
      assert.deepEqual(host.registration.getState(), adapter.state);

      const reference = new PpqMidiOutputScheduler({ send() {}, now: () => 1000 });
      reference.configure(oldProject, previous);
      assert.equal(adapter.scheduler.routeSeed, reference.routeSeed, `${row.id}: old seed`);
      adapter.scheduler.now = () => 1000;
      adapter.scheduler.setEnabled(true);
      reference.setEnabled(true);
      for (const ppqPosition of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) {
        const playhead = { isPlaying: true, ppqPosition, bpm: 120 };
        assert.deepEqual(adapter.scheduler.update(playhead), reference.update(playhead), row.id);
      }
    } finally {
      adapter.cleanup();
    }
    assert.equal(adapter.manager.status().clientCount, 0);
  }
});
