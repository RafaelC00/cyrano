import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildWeeklyBrief, explainWhy } from '../src/brief/brief.ts';
import type { BriefInput } from '../src/brief/brief.ts';
import { renderBrief } from '../src/brief/render.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { ericPreferences } from '../src/agent/preferences.ts';
import { makeSys } from './helpers.ts';
import { makeCalendar, NOW, TODAY } from './week-helpers.ts';

async function week() {
  const sys = makeSys({ prefs: ericPreferences() });
  await sys.funnel.run();
  const { calendar, itinerary } = makeCalendar();
  const scheduler = new Scheduler(calendar, () => NOW);
  const gate = sys.gate.pending();
  assert.ok(gate.length >= 3, 'the fixture needs a few candidates at the gate');
  const plans = [];
  for (const t of gate) {
    const plan = await scheduler.propose(t.candidate, { count: 3 });
    if (plan.slots.length) plans.push(plan);
  }
  assert.ok(plans.length >= 2);
  const input = (over: Partial<BriefInput> = {}): BriefInput => ({ now: NOW, tracked: sys.state.all(), plans: scheduler.list(), prefs: sys.prefs(), itinerary, ...over });
  return { sys, scheduler, calendar, itinerary, input, plans };
}

test('every date in the brief says who, when, where and why her, from the ranking and the profile', async () => {
  const { scheduler, input, plans } = await week();
  const first = plans[0]!;
  await scheduler.confirm(first.candidateId, first.slots[0]!.id, { place: 'Corner bar' });
  const brief = buildWeeklyBrief(input());
  assert.ok(brief.dates.length >= 2 && brief.dates.length <= 4, `${brief.dates.length} dates`);
  for (const d of brief.dates) {
    assert.ok(d.name.length > 0);
    assert.match(d.when.local, /\d{2}:\d{2}/);
    assert.ok(d.when.timezone.includes('/'));
    assert.ok(d.where.city.length > 0);
    assert.ok(d.why.headline.length > 20);
    assert.ok(d.why.evidence.length >= 2, `${d.name}: ${d.why.evidence}`);
    assert.ok(d.why.evidence.some((e) => /Position \d+ of \d+/.test(e)), 'the reason cites the ranking');
    assert.equal(d.age !== null, true);
  }
  assert.equal(brief.dates[0]!.status, 'confirmed', 'confirmed dates come first');
  assert.equal(brief.dates[0]!.where.place, 'Corner bar');
  assert.equal(brief.dates[0]!.alternatives.length, 0);
  assert.ok(brief.dates.slice(1).every((d) => d.status === 'proposed' && d.alternatives.length >= 1));
});

test('the "why" is specific to her: different people get different reasons, built from real fields', async () => {
  const { sys, input } = await week();
  const brief = buildWeeklyBrief(input());
  const headlines = new Set(brief.dates.map((d) => d.why.headline));
  assert.equal(headlines.size, brief.dates.length, 'no two dates share a reason');
  const prefs = sys.prefs();
  for (const d of brief.dates) {
    const t = sys.state.get(d.candidateId)!;
    const shared = t.candidate.declared.interests.filter((i) => prefs.viewer.interests.includes(i));
    if (shared.length) for (const i of shared) assert.match(d.why.headline, new RegExp(i));
    else assert.doesNotMatch(d.why.evidence.join(' '), /Declared interests in common/);
    assert.match(d.why.evidence.join(' '), new RegExp(`Position ${t.rank} of`));
  }
});

test('a person who matched before the funnel ran is explained from the profile, and says there is no ranking', async () => {
  const { sys } = await week();
  const t = sys.state.all().find((x) => x.status === 'pending')!;
  const why = explainWhy(undefined, sys.prefs(), 7, { candidateId: t.candidate.id, name: 'x', city: 'Amsterdam', status: 'proposed', slots: [], holds: [], proposedAt: '', declared: t.candidate.declared });
  assert.ok(why.evidence.some((e) => /no ranking/.test(e)));
  const none = explainWhy(undefined, sys.prefs(), 7);
  assert.match(none.headline, /No ranking and no profile/);
});

test('unbooked travel is flagged on the date and again under what is still pending', async () => {
  const { input } = await week();
  const brief = buildWeeklyBrief(input({ horizonDays: 40 }));
  const tentative = brief.dates.filter((d) => d.travelNote);
  assert.ok(tentative.length > 0, 'at least one date is in a city Eric has not booked yet');
  assert.ok(tentative.every((d) => /not booked yet/.test(d.travelNote!)));
  assert.ok(brief.pending.some((p) => p.kind === 'travel'));
  const firm = brief.dates.filter((d) => !d.travelNote);
  for (const d of firm) assert.equal(d.where.city, 'Amsterdam');
});

test('what is still his to decide: the gate, drafts awaiting a send, and proposals with no reply', async () => {
  const { input } = await week();
  const brief = buildWeeklyBrief(
    input({ pendingDrafts: [{ draftId: 'd1', candidateName: 'Testa', language: 'de', citation: 'Interests: jazz, ceramics' }] }),
  );
  const kinds = brief.pending.map((p) => p.kind);
  assert.ok(kinds.includes('gate'));
  assert.ok(kinds.includes('draft'));
  assert.ok(kinds.includes('awaiting-reply'));
  assert.match(brief.pending.find((p) => p.kind === 'draft')!.text, /press send/);
  assert.match(brief.pending.find((p) => p.kind === 'draft')!.text, /Interests: jazz, ceramics/);
  assert.ok(brief.atTheGate.length >= 1 && brief.atTheGate.length <= 4);
  assert.ok(brief.atTheGate.every((g) => g.why.headline.length > 0));
});

test('the dropped candidates he should look at first: lowest confidence first, with a reason and a way back', async () => {
  const { sys, input } = await week();
  const brief = buildWeeklyBrief(input());
  assert.ok(brief.leastSure.length > 0 && brief.leastSure.length <= 3);
  const confidences = brief.leastSure.map((d) => d.confidence);
  assert.deepEqual([...confidences], [...confidences].sort((a, b) => a - b));
  for (const d of brief.leastSure) {
    const t = sys.state.get(d.candidateId)!;
    assert.equal(t.status, 'dropped');
    assert.equal(d.rule, t.drop!.rule);
    assert.ok(d.confidence >= 0 && d.confidence <= 1);
    assert.ok(d.whyUnsure.length > 20);
    assert.equal(d.undo, `POST /candidates/${d.candidateId}/overturn`);
  }
  // Orientation is not something to relitigate; it never outranks a softer drop.
  assert.ok(!brief.leastSure.some((d) => d.rule === 'orientation.mutual' && d.confidence < 0.9));
});

test('a drop he overturned is no longer listed as doubtful', async () => {
  const { sys, input } = await week();
  const before = buildWeeklyBrief(input());
  const id = before.leastSure[0]!.candidateId;
  await sys.reversal.overturn(id, 'looks fine to me');
  const after = buildWeeklyBrief(input());
  assert.ok(!after.leastSure.some((d) => d.candidateId === id));
});

test('a city drop is doubtful when his own itinerary has him there soon', () => {
  const sys = makeSys({ prefs: { ...ericPreferences(), cities: ['Amsterdam'] } });
  return sys.funnel.run().then(() => {
    const { itinerary } = makeCalendar();
    const brief = buildWeeklyBrief({ now: NOW, tracked: sys.state.all(), plans: [], prefs: sys.prefs(), itinerary, maxDrops: 50 });
    const city = brief.leastSure.filter((d) => d.rule === 'city.allowed');
    const berlinOrLisbon = city.filter((d) => /Berlin|Lisbon|Madrid/.test(d.reason));
    assert.ok(berlinOrLisbon.length > 0);
    assert.ok(berlinOrLisbon.every((d) => d.confidence <= 0.2 && /itinerary/.test(d.whyUnsure)));
    const milan = city.filter((d) => /Milan|Paris|Porto/.test(d.reason));
    assert.ok(milan.every((d) => d.confidence > 0.2));
  });
});

test('scope: only near dates, at most four, released plans never appear', async () => {
  const { scheduler, input, plans } = await week();
  assert.ok(buildWeeklyBrief(input({ maxDates: 1 })).dates.length === 1);
  assert.ok(buildWeeklyBrief(input({ horizonDays: 0 })).dates.length === 0);
  const gone = plans[0]!;
  await scheduler.release(gone.candidateId);
  const brief = buildWeeklyBrief(input({ horizonDays: 90, maxDates: 20 }));
  assert.ok(brief.dates.every((d) => d.candidateId !== gone.candidateId));
  assert.ok(brief.dates.length <= 20);
  assert.equal(buildWeeklyBrief(input()).dates.length <= 4, true);
  assert.equal(brief.weekOf, '2026-09-28', 'the Monday of the week containing 2 Oct 2026');
  assert.equal(brief.generatedAt, NOW.toISOString());
});

test('the brief is deterministic and renders to readable text with every section', async () => {
  const { input } = await week();
  const a = buildWeeklyBrief(input());
  const b = buildWeeklyBrief(input());
  assert.deepEqual(a, b);
  const text = renderBrief(a);
  assert.match(text, /^CYRANO weekly brief, week of 2026-09-28/);
  for (const section of ['DATES', 'STILL YOURS TO DECIDE', 'DROPPED, AND LEAST SURE ABOUT']) assert.match(text, new RegExp(section));
  assert.match(text, /Why her:/);
  assert.match(text, /To bring her back: POST \/candidates\//);
  for (const line of text.split('\n')) assert.ok(line.length <= 110, line);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  void TODAY;
});

test('an empty week still renders honestly', () => {
  const { itinerary } = makeCalendar();
  const brief = buildWeeklyBrief({ now: NOW, tracked: [], plans: [], prefs: ericPreferences(), itinerary });
  assert.deepEqual([brief.dates, brief.pending, brief.leastSure, brief.atTheGate], [[], [], [], []]);
  const text = renderBrief(brief);
  assert.match(text, /Nothing arranged yet/);
  assert.match(text, /Nothing waiting/);
  assert.match(text, /Nothing dropped/);
});
