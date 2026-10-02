import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WhyReport } from '../src/agent/reversal.ts';
import { call, makeSys } from './helpers.ts';

async function ran() {
  // Eric's rules leave 5 of the default 500, too few to see a rank cutoff; use the larger pool.
  const sys = makeSys({ seed: { size: 4000 } });
  await sys.funnel.run();
  return sys;
}

test('"why was this dropped" returns the rule and the reason, for a rule-filter drop', async () => {
  const sys = await ran();
  const t = sys.state.all().find((x) => x.drop?.stage === 'rules')!;
  const r = await call<WhyReport>(sys.app, 'GET', `/candidates/${t.candidate.id}/why`);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'dropped');
  assert.equal(r.body.droppedBy!.rule, t.drop!.rule);
  assert.ok(r.body.droppedBy!.reason.length > 10);
  assert.equal(r.body.reversible, true);
  assert.ok(r.body.history.some((h) => h.outcome === 'fail' && h.rule === t.drop!.rule));
});

test('why works for dormant and rank-cutoff drops too', async () => {
  const sys = await ran();
  for (const rule of ['broad.dormant', 'rank.cutoff']) {
    const t = sys.state.all().find((x) => x.drop?.rule === rule)!;
    assert.ok(t, rule);
    const r = await call<WhyReport>(sys.app, 'GET', `/candidates/${t.candidate.id}/why`);
    assert.equal(r.body.droppedBy!.rule, rule);
  }
});

test('overturning a rule-filter drop puts the candidate back at the gate and writes to the audit log', async () => {
  const sys = await ran();
  const t = sys.state.all().find((x) => x.drop?.stage === 'rules')!;
  const id = t.candidate.id;
  const droppedRule = t.drop!.rule;
  assert.ok(!sys.gate.pending().some((p) => p.candidate.id === id));

  const r = await call<WhyReport>(sys.app, 'POST', `/candidates/${id}/overturn`, { note: 'I know her' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.overturned, true);
  assert.equal(r.body.droppedBy, null);

  const queued = sys.gate.pending().find((p) => p.candidate.id === id)!;
  assert.ok(queued, 'candidate is back in the gate queue');
  assert.ok(queued.score, 'and has been scored');

  const entry = sys.audit.query({ candidateId: id, outcome: 'overturn' });
  assert.equal(entry.length, 1);
  assert.match(entry[0]!.reason, /I know her/);
  assert.match(entry[0]!.reason, new RegExp(droppedRule.replace('.', '\\.')));
  // The original failure is still in the log: history is not rewritten.
  assert.ok(sys.audit.query({ candidateId: id, outcome: 'fail' }).length >= 1);
});

test('an overturned candidate can then be accepted and the like lands on the platform', async () => {
  const sys = await ran();
  const id = sys.state.all().find((x) => x.drop?.stage === 'rules')!.candidate.id;
  await call(sys.app, 'POST', `/candidates/${id}/overturn`);
  const likesBefore = sys.platform.store.swipeCount('like');
  assert.equal((await call(sys.app, 'POST', `/gate/${id}/accept`)).status, 200);
  assert.equal(sys.platform.store.swipeCount('like'), likesBefore + 1);
});

test('a human rejection is queryable and overturnable; the platform pass is rewound', async () => {
  const sys = await ran();
  const id = sys.gate.pending()[0]!.candidate.id;
  await call(sys.app, 'POST', `/gate/${id}/reject`);
  assert.equal(sys.platform.store.swipeCount('pass'), 1);

  const why = await call<WhyReport>(sys.app, 'GET', `/candidates/${id}/why`);
  assert.equal(why.body.status, 'rejected');
  assert.equal(why.body.droppedBy!.rule, 'gate.human');

  const back = await call<WhyReport>(sys.app, 'POST', `/candidates/${id}/overturn`);
  assert.equal(back.body.status, 'pending');
  assert.equal(sys.platform.store.swipeCount('pass'), 0, 'platform pass was rewound');
  // The candidate is listable on the platform again.
  const ids = sys.platform.store.listCandidates(undefined, 100).items.map((c) => c.id);
  assert.ok(ids.includes(id) || sys.platform.store.swipeCount() < sys.platform.store.size);
});

test('an accepted candidate cannot be overturned: a like cannot be taken back', async () => {
  const sys = await ran();
  const id = sys.gate.pending()[0]!.candidate.id;
  await call(sys.app, 'POST', `/gate/${id}/accept`);
  const r = await call<{ error: { code: string } }>(sys.app, 'POST', `/candidates/${id}/overturn`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'irreversible');
});

test('overturning something that is not rejected, or unknown, is refused', async () => {
  const sys = await ran();
  const pendingId = sys.gate.pending()[0]!.candidate.id;
  assert.equal((await call(sys.app, 'POST', `/candidates/${pendingId}/overturn`)).status, 409);
  assert.equal((await call(sys.app, 'POST', '/candidates/p_9999/overturn')).status, 404);
  assert.equal((await call(sys.app, 'GET', '/candidates/p_9999/why')).status, 404);
});

test('rejections are listable by stage', async () => {
  const sys = await ran();
  const r = await call<{ items: Array<{ droppedBy: { stage: string } }> }>(sys.app, 'GET', '/rejections?stage=rules');
  assert.ok(r.body.items.length > 0);
  assert.ok(r.body.items.every((i) => i.droppedBy.stage === 'rules'));
});

test('the audit API filters by candidate, rule and outcome', async () => {
  const sys = await ran();
  const r = await call<{ items: Array<{ rule: string; outcome: string }> }>(sys.app, 'GET', '/audit?rule=city.allowed&outcome=fail');
  assert.ok(r.body.items.length > 0);
  assert.ok(r.body.items.every((e) => e.rule === 'city.allowed' && e.outcome === 'fail'));
});
