import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StatedPreferenceScorer } from '../src/agent/scoring.ts';
import type { Scorer } from '../src/agent/scoring.ts';
import { call, makeSys } from './helpers.ts';

test('the funnel accounts for every candidate: in = dropped + out at each stage', async () => {
  const sys = makeSys();
  const report = await sys.funnel.run();
  assert.equal(report.fetched, sys.platform.store.size - 8);
  assert.equal(report.entered, report.fetched);
  for (const s of report.stages) assert.equal(s.in, s.dropped + s.out, s.stage);
  const [broad, rules, rank, gate] = report.stages;
  assert.equal(broad!.in, report.entered);
  assert.equal(rules!.in, broad!.out);
  assert.equal(rank!.in, rules!.out);
  assert.equal(gate!.in, rank!.out);
  assert.equal(report.reachedGate, gate!.out);
  assert.ok(report.reachedGate > 0 && report.reachedGate <= sys.prefs().gateSize);
  const dropped = Object.values(report.droppedByRule).reduce((a, b) => a + b, 0);
  assert.equal(dropped + report.reachedGate, report.entered);
});

test('stage 1 only sets aside dormant accounts', async () => {
  const sys = makeSys();
  await sys.funnel.run();
  for (const t of sys.state.all().filter((x) => x.drop?.stage === 'broad')) {
    assert.equal(t.drop!.rule, 'broad.dormant');
    assert.ok(t.candidate.activity.daysSinceActive > sys.prefs().dormantAfterDays);
  }
});

test('survivors satisfy every hard rule; rule-dropped candidates fail at least one', async () => {
  const sys = makeSys();
  await sys.funnel.run();
  const p = sys.prefs();
  for (const t of sys.state.byStatus('pending')) {
    const d = t.candidate.declared;
    assert.ok(d.age >= p.ageRange.min && d.age <= p.ageRange.max);
    assert.ok(p.cities.includes(d.city));
    assert.ok(!p.excludedSmoking.includes(d.smoking));
  }
  for (const t of sys.state.all().filter((x) => x.drop?.stage === 'rules')) {
    assert.ok(sys.audit.query({ candidateId: t.candidate.id, outcome: 'fail' }).length >= 1);
  }
});

test('the funnel decides nothing on the platform: no likes, no passes, no messages', async () => {
  const sys = makeSys();
  const before = sys.platform.store.swipeCount();
  await sys.funnel.run();
  assert.equal(sys.platform.store.swipeCount(), before);
  assert.equal(sys.platform.store.viewerMessageCount(), 0);
});

test('human gate: nothing proceeds without a decision, and only pending candidates can be decided', async () => {
  const sys = makeSys();
  await sys.funnel.run();
  const pending = sys.gate.pending();
  const id = pending[0]!.candidate.id;
  const droppedId = sys.state.byStatus('dropped')[0]!.candidate.id;

  const r = await call(sys.app, 'POST', `/gate/${droppedId}/accept`);
  assert.equal(r.status, 409);
  assert.equal(sys.platform.store.swipeCount('like'), 8, 'only the seeded matches');

  assert.equal((await call(sys.app, 'POST', `/gate/${id}/accept`)).status, 200);
  assert.equal(sys.platform.store.swipeCount('like'), 9);
  assert.equal((await call(sys.app, 'POST', `/gate/${id}/accept`)).status, 409);

  const id2 = pending[1]!.candidate.id;
  assert.equal((await call(sys.app, 'POST', `/gate/${id2}/reject`)).status, 200);
  assert.equal(sys.platform.store.swipeCount('pass'), 1);
});

test('the gate queue is ordered by score, highest first', async () => {
  const sys = makeSys();
  await sys.funnel.run();
  const scores = sys.gate.pending().map((t) => t.score!.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
});

test('running again does not reprocess tracked candidates', async () => {
  const sys = makeSys();
  const first = await sys.funnel.run();
  const second = await sys.funnel.run();
  assert.equal(second.entered, 0);
  assert.equal(second.alreadyTracked, first.fetched);
});

test('the scorer is a seam: an injected scorer decides the ranking', async () => {
  const byAge: Scorer = {
    name: 'youngest-first',
    score: (c) => ({ score: 1 - c.declared.age / 100, components: {}, explanation: 'test', scorer: 'youngest-first' }),
  };
  const sys = makeSys({ scorer: byAge });
  await sys.funnel.run();
  const ages = sys.gate.pending().map((t) => t.candidate.declared.age);
  assert.deepEqual(ages, [...ages].sort((a, b) => a - b));
  assert.equal(sys.gate.pending()[0]!.score!.scorer, 'youngest-first');
});

test('baseline scorer components sum to the score and stay in 0..1', async () => {
  const sys = makeSys();
  const scorer = new StatedPreferenceScorer();
  const page = sys.platform.store.listCandidates(undefined, 100).items;
  for (const c of page) {
    const r = scorer.score(c, sys.prefs());
    const sum = Object.values(r.components).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - r.score) < 0.01);
    assert.ok(r.score >= 0 && r.score <= 1);
  }
});

test('rank cutoff drops are recorded with score and position', async () => {
  // Eric's rules leave 5 of the default 500, fewer than a gate holds; a larger pool leaves enough to cut.
  const sys = makeSys({ seed: { size: 4000 } });
  const report = await sys.funnel.run();
  assert.ok(report.stages[2]!.dropped > 0, 'default gate size should cut something from this pool');
  const cut = sys.state.all().find((t) => t.drop?.rule === 'rank.cutoff')!;
  assert.match(cut.drop!.reason, /score [\d.]+ ranked \d+ of \d+/);
  assert.ok(cut.score);
});

test('the HTTP API runs the funnel and serves the gate', async () => {
  const sys = makeSys();
  const run = await call<{ reachedGate: number }>(sys.app, 'POST', '/runs');
  assert.equal(run.status, 201);
  const gate = await call<{ items: unknown[] }>(sys.app, 'GET', '/gate');
  assert.equal(gate.body.items.length, run.body.reachedGate);
});
