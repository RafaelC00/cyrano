import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { defaultPreferences, ericPreferences } from '../src/agent/preferences.ts';
import type { CalendarState, DateProposal, DraftMeta, BriefView, LearnedScore } from '../src/agent/views.ts';
import type { TrainingReport } from '../src/calibration/trainingReport.ts';
import { call, makeSys } from './helpers.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

type Sys = ReturnType<typeof makeSys>;
type DraftRow = { id: string; body: string; author: string; generator: string };

/** Eric's rules leave 5 of the default 500 people; the larger pool leaves enough to accept and draft for. */
const bigSys = () => makeSys({ seed: { size: 4000 } });

async function matchesAfterGate(sys: Sys) {
  const before = new Set((await sys.adapter.listMatches()).map((m) => m.id));
  await sys.funnel.run();
  for (const t of sys.gate.pending()) await sys.gate.accept(t.candidate.id);
  return (await sys.adapter.listMatches()).filter((m) => !before.has(m.id));
}

async function draftAll(sys: Sys) {
  const out: Array<{ matchId: string; draft: DraftRow }> = [];
  for (const m of await matchesAfterGate(sys)) {
    const r = await call<DraftRow>(sys.app, 'POST', `/matches/${m.id}/drafts`);
    if (r.status === 201) out.push({ matchId: m.id, draft: r.body });
  }
  return out;
}

// ---- the viewer is Eric ------------------------------------------------------------------

test('the default viewer is Eric: a man interested in women, with his persona\'s hard constraints', async () => {
  const p = defaultPreferences();
  assert.equal(p, defaultPreferences() && p); // a plain value, not shared state
  assert.deepEqual(p, ericPreferences());
  assert.equal(p.viewer.gender, 'man');
  assert.deepEqual(p.viewer.interestedIn, ['woman']);
  assert.deepEqual(p.ageRange, { min: 26, max: 34 });
  for (const l of ['en', 'de', 'es', 'nl']) assert.ok(p.viewer.languages.includes(l), l);
  assert.deepEqual(p.viewer.intents, ['long-term', 'open']);
  assert.deepEqual(p.excludedSmoking, ['sometimes', 'regularly']);
  assert.deepEqual(p.excludedChildren, ['want']);
});

test('the gate fills with women, because the viewer is a man interested in women', async () => {
  const sys = bigSys();
  await sys.funnel.run();
  const gate = (await call<{ items: Array<{ declared: { gender: string; age: number } }> }>(sys.app, 'GET', '/gate')).body.items;
  assert.ok(gate.length > 0);
  for (const g of gate) {
    assert.equal(g.declared.gender, 'woman');
    assert.ok(g.declared.age >= 26 && g.declared.age <= 34);
  }
});

// ---- one drafting path -------------------------------------------------------------------

test('there is one drafting path: the phase-1 template drafter is gone and only the Drafter writes agent drafts', () => {
  assert.equal(existsSync(join(ROOT, 'src/agent/opener.ts')), false);
  const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.ts') ? [join(dir, f)] : []));
  const agentWriters = files(join(ROOT, 'src'))
    .filter((f) => /\.draft\([^)]*'agent'/.test(readFileSync(f, 'utf8')))
    .map((f) => f.slice(ROOT.length).replaceAll('\\', '/'));
  assert.deepEqual(agentWriters, ['src/drafting/drafter.ts']);
});

test('POST /matches/:id/drafts writes through the Drafter: in her language, checked, never opening with a greeting', async () => {
  const sys = bigSys();
  const drafts = await draftAll(sys);
  assert.ok(drafts.length >= 3, `expected several drafts, got ${drafts.length}`);
  const languages = new Set<string>();
  for (const { draft } of drafts) {
    assert.equal(draft.author, 'agent');
    assert.equal(draft.generator, sys.drafter.generatorName);
    assert.doesNotMatch(draft.body, /^\s*(hi|hey|hello|hallo|hola|hoi)\b/i, draft.body);
    const meta = (await call<DraftMeta>(sys.app, 'GET', `/drafts/${draft.id}/meta`)).body;
    languages.add(meta.language);
    assert.ok(meta.detail && meta.detail.value.length > 0);
    assert.equal(meta.voiceChecks.length, 9, 'every rule of the prohibited-content check is reported');
    assert.ok(meta.voiceChecks.every((c) => c.ok));
  }
  assert.ok(languages.size >= 2, `drafts should span languages, got ${[...languages]}`);
  assert.equal(sys.outbox.list('pending').length, drafts.length);
  assert.equal(sys.platform.store.viewerMessageCount(), 0);
});

test('a draft the Drafter will not write is refused with the reason, and nothing is queued', async () => {
  const sys = bigSys();
  // The seeded matches all have her message first, so an opener would be a reply: held.
  const seeded = (await sys.adapter.listMatches())[0]!;
  const r = await call<{ error: { code: string; message: string } }>(sys.app, 'POST', `/matches/${seeded.id}/drafts`);
  assert.equal(r.status, 409);
  assert.equal(r.body.error.code, 'held_thread_state');
  assert.match(r.body.error.message, /reply, not an opener/);
  assert.equal(sys.outbox.list('pending').length, 0);
});

test('a hand-written draft has no drafting record', async () => {
  const sys = bigSys();
  const m = (await sys.adapter.listMatches())[0]!;
  const d = (await call<DraftRow>(sys.app, 'POST', `/matches/${m.id}/drafts`, { body: 'Coffee on Thursday?' })).body;
  const meta = await call<{ error: { code: string } }>(sys.app, 'GET', `/drafts/${d.id}/meta`);
  assert.equal(meta.status, 404);
  assert.equal(meta.body.error.code, 'no_meta');
});

// ---- the scheduler and the calendar ------------------------------------------------------

test('drafting proposes slots on his calendar; confirming one releases the rest; moving and dropping work; none of it sends', async () => {
  const sys = bigSys();
  const [first] = await draftAll(sys);
  assert.ok(first);
  let cal = (await call<CalendarState>(sys.app, 'GET', '/calendar')).body;
  assert.equal(cal.today, '2026-10-02');
  assert.ok(cal.stays.length >= 5);
  const mine = (c: CalendarState) => c.proposals.filter((p) => p.person.id === sys.scheduler.list().find((x) => x.matchId === first.matchId)!.candidateId);
  const proposed = mine(cal);
  assert.ok(proposed.length >= 1 && proposed.every((p) => p.status === 'proposed'));
  for (const p of cal.proposals) {
    assert.match(p.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    assert.ok(['coffee', 'drinks', 'dinner'].includes(p.kind));
    assert.ok(cal.stays.some((s) => s.city === p.city && p.start.slice(0, 10) > s.from && p.start.slice(0, 10) < s.to), 'every slot is inside a stay in its own city');
  }

  // Moving to a time he is asleep is refused; the proposal is untouched.
  const target = proposed[0]!;
  const asleep = await call<{ error: { code: string } }>(sys.app, 'POST', `/calendar/${target.id}/move`, { start: `${target.start.slice(0, 10)}T03:00` });
  assert.equal(asleep.status, 409);
  assert.equal(mine((await call<CalendarState>(sys.app, 'GET', '/calendar')).body).find((p) => p.id === target.id)!.start, target.start);

  // A move to another evening in the same stay is accepted and stays a proposal.
  const day = target.start.slice(0, 10);
  const stay = cal.stays.find((s) => s.city === target.city)!;
  const other = [-2, -1, 1, 2, 3].map((n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)).find((d) => d > stay.from && d < stay.to && d !== day && !proposed.some((p) => p.start.startsWith(d)));
  if (other) {
    const moved = await call<CalendarState>(sys.app, 'POST', `/calendar/${target.id}/move`, { start: `${other}T${target.start.slice(11, 16)}` });
    assert.equal(moved.status, 200);
    assert.equal(mine(moved.body).find((p) => p.id === target.id)!.start.slice(0, 10), other);
  }

  // Confirming one gives the others back.
  cal = (await call<CalendarState>(sys.app, 'POST', `/calendar/${target.id}/confirm`)).body;
  const after = mine(cal);
  assert.equal(after.filter((p) => p.status === 'confirmed').length, 1);
  assert.ok(after.filter((p) => p.id !== target.id).every((p) => p.status === 'declined'));

  const ics = await sys.app.request('/calendar.ics');
  assert.match(ics.headers.get('content-type') ?? '', /text\/calendar/);
  const text = await ics.text();
  assert.equal(text.match(/BEGIN:VEVENT/g)?.length, 1);
  assert.match(text, /STATUS:CONFIRMED/);

  // Dropping it gives the confirmed event back too.
  cal = (await call<CalendarState>(sys.app, 'POST', `/calendar/${target.id}/drop`)).body;
  assert.ok(mine(cal).every((p: DateProposal) => p.status === 'declined'));
  assert.equal((await (await sys.app.request('/calendar.ics')).text()).includes('BEGIN:VEVENT'), false);

  assert.equal((await call(sys.app, 'POST', '/calendar/nobody.0/confirm')).status, 404);
  assert.equal(sys.platform.store.viewerMessageCount(), 0, 'scheduling sends nothing');
});

test('the weekly brief is served in the shape the web client declares', async () => {
  const sys = bigSys();
  await draftAll(sys);
  const b = (await call<BriefView>(sys.app, 'GET', '/brief')).body;
  assert.match(b.weekOf, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(new Date(`${b.weekOf}T00:00:00Z`).getUTCDay(), 1, 'weekOf is a Monday');
  assert.ok(b.entries.length >= 1 && b.entries.length <= 4);
  for (const e of b.entries) {
    assert.ok(e.person.displayName && e.when && e.where && e.city && e.why);
    assert.ok(e.proposalId);
  }
  assert.ok(b.pending.some((p) => p.kind === 'draft'), 'the drafts waiting for him appear under what is still his to decide');
  assert.ok(b.basis.length > 20);
});

// ---- the model's result is the real one --------------------------------------------------

test('/model/report serves the numbers EVAL.md reports, to the same precision', async () => {
  const sys = makeSys();
  const r = (await call<TrainingReport>(sys.app, 'GET', '/model/report')).body;
  const md = readFileSync(join(ROOT, 'data/calibration/EVAL.md'), 'utf8');
  const row = (label: string) => {
    const m = new RegExp(`\\| ${label.replace(/[().]/g, '\\$&')}[^|]*\\| ([\\d.]+) \\(`).exec(md);
    assert.ok(m, `no EVAL.md row for ${label}`);
    return m[1];
  };
  const f3 = (x: number) => x.toFixed(3);
  assert.equal(f3(r.scorers.find((s) => s.key === 'learned')!.accuracy.mean), row('learned (pairwise logistic)'));
  assert.equal(f3(r.scorers.find((s) => s.key === 'stated')!.accuracy.mean), row('stated-preference-v1 (in the repo)'));
  assert.equal(f3(r.scorers.find((s) => s.key === 'mobility')!.accuracy.mean), row('stated-mobility-v1 (literal reading of the pitch)'));
  assert.equal(f3(r.scorers.find((s) => s.key === 'oracle')!.accuracy.mean), row('oracle: the latent function itself'));
  assert.equal(r.synthetic, true);
  assert.equal(r.gain.wins, r.gain.of);
  assert.equal(r.setup.trials, 30);
  assert.ok(r.features.length === 23);
});

test('/model/comparisons pages through his labels and can filter to the ones that went against what he said', async () => {
  const sys = makeSys();
  const all = (await call<{ total: number; of: number; items: Array<{ a: string; b: string; chosen: 'a' | 'b'; fitsPitch: 'a' | 'b' | null }>; people: Record<string, unknown> }>(sys.app, 'GET', '/model/comparisons?n=5')).body;
  assert.equal(all.of, 600);
  assert.equal(all.items.length, 5);
  for (const i of all.items) assert.ok(all.people[i.a] && all.people[i.b]);
  const against = (await call<typeof all>(sys.app, 'GET', '/model/comparisons?against=1&n=50')).body;
  assert.ok(against.total > 0 && against.total < all.of);
  for (const i of against.items) assert.ok(i.fitsPitch !== null && i.fitsPitch !== i.chosen);
});

test('/scores gives the learned and the stated score for the shortlist, with reasons', async () => {
  const sys = bigSys();
  await sys.funnel.run();
  const ids = sys.gate.pending().slice(0, 3).map((t) => t.candidate.id);
  const scores = (await call<LearnedScore[]>(sys.app, 'GET', `/scores?ids=${ids.join(',')}`)).body;
  assert.equal(scores.length, ids.length);
  for (const s of scores) {
    assert.ok(s.learned >= 0 && s.learned <= 1 && s.stated >= 0 && s.stated <= 1);
    assert.ok(s.factors.length > 0 && s.factors.length <= 3);
  }
});
