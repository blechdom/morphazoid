import assert from "node:assert/strict";
import test from "node:test";

import { buildShape } from "../../src/geometry.js";
import {
  DEFAULT_STATE,
  accumulateEventPulse,
  audioVoiceCounts,
  contactsForReader,
  eventFeaturesFromAnalysis,
  eventPresentation,
  isFeatureValueUnavailable,
  mappingSignalForValue,
  metricSectionForDescriptor,
  readerGeometry,
  shouldHandleGlobalShortcut,
  topologyPresentation,
  unionVoiceTrajectories,
} from "../app.js";
import { getFeatureDescriptor } from "../feature-registry.js";

test("every default audio route names a registered feature", () => {
  for (const key of ["pitchSource", "gainSource", "panSource", "timbreSource"]) {
    assert.ok(getFeatureDescriptor(DEFAULT_STATE[key]), `${key} must resolve through the registry`);
  }
});

test("reader geometry is deterministic in every supported mode", () => {
  const path = buildShape({ sides: 5, curvature: 0.2, samplesPerEdge: 24 });
  const vertical = readerGeometry(path, "vertical", 0.25);
  assert.equal(vertical.type, "vertical");
  assert.equal(vertical.x, path.bounds.minX + path.bounds.width * 0.25);

  const horizontal = readerGeometry(path, "horizontal", 0.75);
  assert.equal(horizontal.type, "horizontal");
  assert.equal(horizontal.y, path.bounds.minY + path.bounds.height * 0.75);

  const ray = readerGeometry(path, "ray", 0.5);
  assert.equal(ray.type, "ray");
  assert.equal(ray.angle, Math.PI / 2);

  const trace = readerGeometry(path, "path", 1.25);
  assert.equal(trace.type, "path");
  assert.equal(trace.phase, 0.25);
});

test("all readers return the same sampled contacts consumed by analysis and sound", () => {
  const path = buildShape({ sides: 1, samplesPerEdge: 96 });
  assert.equal(contactsForReader(path, readerGeometry(path, "vertical", 0.5)).length, 2);
  assert.equal(contactsForReader(path, readerGeometry(path, "horizontal", 0.5)).length, 2);
  assert.equal(contactsForReader(path, readerGeometry(path, "ray", 0.25)).length, 1);
  assert.equal(contactsForReader(path, readerGeometry(path, "path", 0.25)).length, 1);
});

test("voice trajectories retain births and deaths through lookahead", () => {
  const current = [
    { key: "a", frequency: 110, gain: 0.3 },
    { key: "ending", frequency: 220, gain: 0.2 },
  ];
  const future = [
    { key: "a", frequency: 130, gain: 0.4 },
    { key: "born", frequency: 330, gain: 0.25 },
  ];
  const trajectory = unionVoiceTrajectories(current, future);
  assert.deepEqual(trajectory.current.map(({ key }) => key), ["a", "ending", "born"]);
  assert.deepEqual(trajectory.future.map(({ key }) => key), ["a", "ending", "born"]);
  assert.equal(trajectory.current.find(({ key }) => key === "born").gain, 0);
  assert.equal(trajectory.future.find(({ key }) => key === "ending").gain, 0);
});

test("the live explorer groups stable feature IDs by user question", () => {
  const expected = new Map([
    ["contact.contourPhase", "Location on form"],
    ["contact.turn", "Local shape"],
    ["contact.polarAngle", "Direction & stage origin"],
    ["contact.reader.transversality", "Reader relationship"],
    ["contact.motion.speed", "Motion & identity"],
    ["reader.insideFraction", "Occupancy"],
    ["reader.transversality.minimum", "Tangency risk"],
    ["geometry.perimeter", "Size & pose"],
    ["geometry.compactness", "Shape character"],
    ["geometry.radius.mean", "Stage-origin profile"],
    ["geometry.samples", "Sampling diagnostics"],
    ["geometry.selfIntersections", "Contour topology"],
    ["events.births", "Contact lifecycle"],
    ["events.splits", "Structural · planned"],
  ]);
  for (const [id, section] of expected) {
    assert.equal(metricSectionForDescriptor(getFeatureDescriptor(id)), section, id);
  }
});

test("planned split and merge events remain unavailable instead of becoming false zeroes", () => {
  const features = eventFeaturesFromAnalysis({
    eventCounts: {
      births: 2,
      deaths: 0,
      splits: null,
      merges: null,
      entries: 1,
      exits: 0,
    },
  });
  assert.equal(features["events.births"], 2);
  assert.equal(features["events.entries"], 1);
  assert.equal(features["events.splits"], null);
  assert.equal(features["events.merges"], null);

  const missing = eventFeaturesFromAnalysis(null);
  assert.equal(missing["events.births"], 0);
  assert.equal(missing["events.splits"], null);
  assert.equal(missing["events.merges"], null);
});

test("fallback event counters use the same records displayed in the event log", () => {
  const features = eventFeaturesFromAnalysis(null, [
    { type: "contact_birth", contactId: "a" },
    { type: "contact_birth", contactId: "b" },
    { type: "reader_entry", contactId: "a" },
  ]);
  assert.equal(features["events.births"], 2);
  assert.equal(features["events.entries"], 1);

  const grouped = eventFeaturesFromAnalysis(null, [
    { type: "contact_pair_death", count: 3 },
  ]);
  assert.equal(grouped["events.deaths"], 3);
});

test("unavailable category sentinels never normalize or map as category zero", () => {
  const descriptor = getFeatureDescriptor("contact.corner.class");
  assert.equal(isFeatureValueUnavailable("unavailable"), true);
  assert.deepEqual(mappingSignalForValue(descriptor, "unavailable"), {
    raw: null,
    normalized: null,
    available: false,
  });
  assert.equal(mappingSignalForValue(descriptor, "smooth").available, true);
});

test("event pulses accumulate between display updates without inventing structural values", () => {
  let pulse = accumulateEventPulse(null, {
    features: {
      "events.births": 1,
      "events.deaths": 0,
      "events.splits": null,
      "events.merges": null,
      "events.entries": 1,
      "events.exits": 0,
    },
    events: [{ type: "contact_birth" }, { type: "reader_entry" }],
  });
  pulse = accumulateEventPulse(pulse, {
    features: {
      "events.births": 0,
      "events.deaths": 2,
      "events.splits": null,
      "events.merges": null,
      "events.entries": 0,
      "events.exits": 1,
    },
    events: [{ type: "contact_pair_death", count: 2 }],
  });
  assert.equal(pulse.features["events.births"], 1);
  assert.equal(pulse.features["events.deaths"], 2);
  assert.equal(pulse.features["events.splits"], null);
  assert.equal(pulse.eventCount, 3);
  assert.equal(pulse.frameCount, 2);
});

test("global shortcuts yield to handled events and native interactive controls", () => {
  const pageTarget = { closest: () => null };
  const buttonTarget = { closest: () => ({ tagName: "BUTTON" }) };
  assert.equal(shouldHandleGlobalShortcut({ target: pageTarget }), true);
  assert.equal(shouldHandleGlobalShortcut({ target: pageTarget, defaultPrevented: true }), false);
  assert.equal(shouldHandleGlobalShortcut({ target: buttonTarget }), false);
  assert.equal(shouldHandleGlobalShortcut({ target: pageTarget, metaKey: true }), false);
});

test("pair deaths remain structural and show their aggregate contact count", () => {
  const presentation = eventPresentation({
    type: "contact_pair_death",
    contactId: "contact-1",
    count: 2,
  });
  assert.equal(presentation.className, "event-structural");
  assert.equal(presentation.marker, "2×");
  assert.equal(presentation.subject, "2 contacts");
});

test("missing topology is unavailable rather than implicitly complex", () => {
  assert.equal(topologyPresentation(true, null), "Topology unavailable");
  assert.equal(topologyPresentation(true, { simpleClosed: false }), "Complex or degenerate contour");
  assert.equal(topologyPresentation(false, null), "Open contour");
});

test("voice telemetry separates mapping demand from live engine output", () => {
  assert.deepEqual(audioVoiceCounts({
    audioEnabled: false,
    engineRunning: false,
    geometricContacts: 5,
    mappableVoices: 4,
    submittedVoices: 4,
  }), {
    contacts: 5,
    mappable: 4,
    scheduled: 0,
    rendered: 0,
    overCapacity: 0,
  });
  const live = audioVoiceCounts({
    audioEnabled: true,
    engineRunning: true,
    geometricContacts: 40,
    mappableVoices: 36,
    submittedVoices: 32,
  });
  assert.equal(live.scheduled, 32);
  assert.equal(live.rendered, 32);
  assert.equal(live.overCapacity, 4);
});
