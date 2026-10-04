import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SEQUENCE_KINDS,
  SEQUENCE_STUDIES,
  SEQUENCE_STUDY_COUNT,
  getSequenceStudy,
  studiesForEra,
  studiesForKind,
} from '../src/instruments/synthesis/sequence-catalog.js';
import {
  SEQUENCE_CHRONOLOGY,
  SEQUENCE_ERAS,
  SEQUENCE_SOURCES,
  getSequenceEra,
  getSequenceSource,
} from '../src/instruments/synthesis/sequence-chronology.js';

test('sequence compendium spans five historical eras with original, neutral studies', () => {
  assert.equal(SEQUENCE_ERAS.length, 5);
  assert.equal(SEQUENCE_STUDY_COUNT, 62);
  assert.equal(SEQUENCE_STUDIES.length, SEQUENCE_STUDY_COUNT);
  assert.equal(new Set(SEQUENCE_STUDIES.map(study => study.id)).size, SEQUENCE_STUDY_COUNT);
  assert.equal(new Set(SEQUENCE_STUDIES.map(study => study.label)).size, SEQUENCE_STUDY_COUNT);

  const brands = /\b(?:Buchla|Moog|Roland|Jupiter|Oberheim|Sequential Circuits|Korg|WAVESTATION|Elektron|Bitwig|SuperCollider|TidalCycles|Strudel|Koan|Nord Modular|Music Mouse)\b/i;
  for (const era of SEQUENCE_ERAS) {
    const studies = studiesForEra(era.id);
    assert.ok(studies.length >= 10, `${era.id} should be a substantial chapter`);
    assert.deepEqual(
      studies.map(study => study.id),
      [...studies].sort((a, b) => a.placementYear - b.placementYear || a.label.localeCompare(b.label)).map(study => study.id),
      `${era.id} helper order should be chronological`,
    );
    assert.equal(getSequenceEra(era.id), era);
    assert.equal(SEQUENCE_CHRONOLOGY[era.id], era);
  }

  for (const study of SEQUENCE_STUDIES) {
    assert.match(study.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(SEQUENCE_KINDS.includes(study.kind), `${study.id}: accurate kind vocabulary`);
    assert.ok(study.era.range.includes('–'));
    assert.equal(study.group, study.eraLabel);
    const era = SEQUENCE_CHRONOLOGY[study.eraId];
    assert.ok(study.placementYear >= era.startYear);
    assert.ok(era.endYear == null || study.placementYear <= era.endYear);
    assert.equal(brands.test(study.label), false, `${study.id}: UI label stays mechanism-led`);
    assert.equal(brands.test(study.description), false, `${study.id}: description stays neutral`);
    assert.equal(brands.test(study.cue), false, `${study.id}: cue stays neutral`);
    assert.ok(study.lineage.length > 20);
    assert.ok(study.cue.length > 20);
    assert.equal(study.shortDateLabel, `~${Math.floor(study.placementYear / 10) * 10}s`);
    assert.match(study.shortDateLabel, /^~(?:19|20)\d0s$/);
    assert.match(study.dateLabel, /^(?:\d{4} documented milestone|after \d{4} documented milestone|based on \d{4}(?: \/ \d{4})+ documented sources)$/);
    assert.equal(/lineage|invention/i.test(study.dateLabel), false);
    assert.ok(study.dateKind.length > 3);
    assert.ok(study.dateNote.length > 80);
    assert.ok(study.limitations.length > 50);
    assert.ok(study.testFocus.length >= 3);
    assert.equal(study.provenance.originalStudy, true);
    assert.equal(study.provenance.authorship.status, 'original educational study');
    assert.ok(study.provenance.authorship.reviewedBy.length > 10);
    assert.match(study.provenance.authorship.reviewedOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(study.provenance.sources.length >= 1);
    const citedYears = [...new Set(study.provenance.sources.flatMap(source => source.milestoneYears))].sort((a, b) => a - b);
    assert.deepEqual(study.milestoneYears, citedYears);
    assert.equal(study.year, citedYears.at(-1));
    assert.ok(study.placementYear >= citedYears.at(-1), `${study.id}: placement cannot predate a cited mechanism`);
    assert.deepEqual([...study.dateLabel.matchAll(/\d{4}/g)].map(match => Number(match[0])), citedYears);
    for (const source of study.provenance.sources) {
      assert.equal(source, SEQUENCE_SOURCES[source.id]);
      assert.match(new URL(source.url).protocol, /^https?:$/);
      if (source.milestoneYears.length === 0) assert.equal(source.supportingOnly, true, `${source.id}: undated evidence is explicitly supporting-only`);
      else assert.notEqual(source.supportingOnly, true, `${source.id}: dated milestones are not supporting-only`);
      assert.ok(source.milestoneYears.every(year => Number.isInteger(year) && year >= 1900 && year <= 2100));
      assert.equal(Object.hasOwn(source, 'year'), false, `${source.id}: ambiguous source year field is forbidden`);
      assert.ok(source.dateKind.length > 3);
      assert.ok(source.limitation.length > 30);
    }
  }
});

test('all sequence kinds and required playable archetypes are represented', () => {
  for (const kind of SEQUENCE_KINDS) assert.ok(studiesForKind(kind).length >= 2, kind);
  const required = [
    'ordered-chord', 'ratio-canon', 'drawn-rows', 'parameter-rows', 'cv-rows',
    'gesture', 'phrase-bank', 'accent-pattern', 'tracker', 'groove', 'markov',
    'euclidean', 'polymeter', 'mutating-loop', 'conditional-steps', 'phrase-arp',
  ];
  const present = new Set(SEQUENCE_STUDIES.map(study => study.archetype));
  for (const archetype of required) assert.ok(present.has(archetype), archetype);
});

test('catalog, chronology, sources and nested study data are immutable', () => {
  assert.ok(Object.isFrozen(SEQUENCE_STUDIES));
  assert.ok(Object.isFrozen(SEQUENCE_ERAS));
  assert.ok(Object.isFrozen(SEQUENCE_SOURCES));
  const study = SEQUENCE_STUDIES[0];
  for (const value of [study, study.defaults, study.config, study.testFocus, study.provenance, study.provenance.sources, study.provenance.sources[0], study.era]) {
    assert.ok(Object.isFrozen(value));
  }
  assert.throws(() => { study.label = 'Changed'; }, TypeError);
  assert.throws(() => { study.config.voices[0].period = 99; }, TypeError);
  assert.throws(() => { SEQUENCE_ERAS.push({}); }, TypeError);
});

test('lookup helpers return null for unknown IDs rather than silently changing studies', () => {
  const chosen = getSequenceStudy('euclidean-pulse-rotation');
  assert.equal(chosen.id, 'euclidean-pulse-rotation');
  assert.equal(getSequenceStudy('missing'), null);
  assert.equal(getSequenceSource('euclidean').id, 'euclidean');
  assert.equal(getSequenceSource('missing'), null);
  assert.equal(getSequenceEra('missing'), null);
});

test('all chronology sources are used and audited replacement URLs stay stable', () => {
  const used = new Set(SEQUENCE_STUDIES.flatMap(study => study.provenance.sourceIds));
  assert.deepEqual([...used].sort(), Object.keys(SEQUENCE_SOURCES).sort());
  assert.equal(SEQUENCE_SOURCES.groove.url, 'https://doi.org/10.1145/362814.362817');
  assert.equal(SEQUENCE_SOURCES.sh101.url, 'https://cdn.roland.com/assets/media/pdf/SH-101_OM.pdf');
  assert.equal(SEQUENCE_SOURCES.tr808.url, 'https://cdn.roland.com/assets/media/pdf/TR-808_OM.pdf');
  assert.equal(SEQUENCE_SOURCES.wavestation.url, 'https://www.korg.com/us/products/software/kc_wavestation/index.php');
  assert.equal(SEQUENCE_SOURCES.nordModular.url, 'https://www.nordkeyboards.com/legacy-products/nord-modular/');
  assert.equal(SEQUENCE_SOURCES.elektron.url, 'https://www.elektron.se/wp-content/uploads/2025/07/Digitakt-User-Manual_ENG_OS1.52A_250708.pdf');
  assert.equal(SEQUENCE_SOURCES.oberheim.url, 'https://www.tomoberheim.com/historical-products');
  assert.equal(SEQUENCE_SOURCES.ableton.url, 'https://www.ableton.com/en/press/press-archive/press-archive-release-8/');
  assert.equal(SEQUENCE_SOURCES.bitwig.url, 'https://downloads.bitwig.com/stable/4.0/Release-Notes-4.0.html');
  assert.equal(SEQUENCE_SOURCES.strudel.url, 'https://strudel.cc/learn/getting-started/');
  assert.equal(SEQUENCE_SOURCES.supercolliderHistory.url, 'https://supercollider.github.io/');
  assert.equal(SEQUENCE_SOURCES.moog960History.url, 'https://archives.library.cornell.edu/repositories/2/resources/2099');
  assert.deepEqual(SEQUENCE_SOURCES.moog960History.milestoneYears, [1968]);
  assert.deepEqual(SEQUENCE_SOURCES.moog960.milestoneYears, []);
  assert.equal(SEQUENCE_SOURCES.moog960.supportingOnly, true);
  assert.equal(SEQUENCE_SOURCES.musicMouse.url, 'https://www.eventideaudio.com/software/music-mouse/');
  assert.equal(SEQUENCE_SOURCES.korgM1.url, 'https://www.korg.com/us/products/software/kc_m1/');
  assert.deepEqual(SEQUENCE_SOURCES.supercollider.milestoneYears, []);
  assert.deepEqual(SEQUENCE_SOURCES.supercolliderMarkov.milestoneYears, []);
  assert.deepEqual(SEQUENCE_SOURCES.tracker.milestoneYears, []);
  assert.deepEqual(SEQUENCE_SOURCES.ableton.milestoneYears, [2009]);
});

test('specific lineage corrections do not overclaim unsupported historical mechanisms', () => {
  const byId = id => getSequenceStudy(id);
  assert.equal(byId('clocked-uncertain-voltage').archetype, 'cv-rows');
  assert.equal(byId('held-chord-random-pick').archetype, 'ordered-chord');
  assert.equal(byId('markov-note-continuation').archetype, 'gesture');
  assert.notEqual(byId('captured-order-latch').config.order, 'played');
  assert.notEqual(byId('octave-spread-cycle').config.order, 'inside-out');
  assert.equal(byId('vector-control-lane').year, 1990);
  assert.equal(byId('layered-wave-lanes').year, 1990);
  assert.equal(byId('modular-logic-gates').year, 1997);
  assert.equal(byId('phrase-bank-switching').year, 1975);
  assert.equal(byId('locked-parameter-line').year, 2017);
  assert.deepEqual(byId('bounded-random-walk').provenance.sourceIds, ['supercolliderHistory', 'supercolliderMarkov', 'strudel']);
  for (const id of ['polyphonic-step-stack', 'syncopated-key-cycle', 'velocity-window-traverse', 'clocked-phrase-chain']) {
    assert.match(byId(id).lineage, /original/i, `${id}: MIDI source scope is explicit`);
  }
});
