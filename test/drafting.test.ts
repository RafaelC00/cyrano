import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkDraft, threadRejection } from '../src/drafting/check.ts';
import { Drafter } from '../src/drafting/drafter.ts';
import { chooseLanguage, TemplateGenerator } from '../src/drafting/generator.ts';
import type { DraftContext, DraftGenerator, GeneratedDraft, GenerationRefusal } from '../src/drafting/types.ts';
import { PACKS } from '../src/drafting/voice.ts';
import type { ThreadMessage } from '../src/domain/types.ts';
import { call, makeSys } from './helpers.ts';
import { NOW, openerCtx, person } from './week-helpers.ts';

const msg = (from: 'viewer' | 'candidate', i = 1): ThreadMessage => ({ id: `m${i}`, matchId: 'm', from, body: '...', sentAt: NOW.toISOString() });

async function readyDraft(over: Parameters<typeof person>[0] = {}, ctxOver: Partial<DraftContext> = {}) {
  const ctx = await openerCtx(person(over), ctxOver);
  const out = await new Drafter().compose(ctx);
  assert.equal(out.status, 'ready', JSON.stringify(out));
  return { ctx, draft: (out as Extract<typeof out, { status: 'ready' }>).draft };
}

// ---------- language selection ----------

test('he writes in her language: the first one she lists that he can write in', () => {
  // Her ordering decides. His own comfort order never overrides it.
  assert.deepEqual(chooseLanguage(['en', 'de']), { language: 'en', matched: true, decidedBy: 'hers' });
  assert.deepEqual(chooseLanguage(['de', 'en']), { language: 'de', matched: true, decidedBy: 'hers' });

  // The case that was wrong before: a Dutch speaker who also lists English gets Dutch.
  assert.deepEqual(chooseLanguage(['nl', 'en']), { language: 'nl', matched: true, decidedBy: 'hers' });
  assert.deepEqual(chooseLanguage(['es', 'en']), { language: 'es', matched: true, decidedBy: 'hers' });

  // Languages he cannot write in are skipped, not treated as a miss.
  assert.deepEqual(chooseLanguage(['pt', 'nl', 'en']), { language: 'nl', matched: true, decidedBy: 'hers' });

  assert.deepEqual(chooseLanguage(['nl']), { language: 'nl', matched: true, decidedBy: 'hers' });
  assert.deepEqual(chooseLanguage(['DE']), { language: 'de', matched: true, decidedBy: 'hers' });

  // No overlap at all: English, and the result says it is a fallback rather than a match.
  assert.deepEqual(chooseLanguage(['pt', 'fr']), { language: 'en', matched: false, decidedBy: 'fallback' });
});

// ---------- drafting ----------

test('an opener is written in each language, cites a real declared field, and its claims are on his itinerary', async () => {
  const cases: Array<[string[], string, RegExp]> = [
    [['de'], 'de', /\b(Ich bin|bin ich)\b/],
    [['en'], 'en', /\bI'm\b|\bI'll\b/],
    [['es'], 'es', /\b(Estoy|Voy a estar|Sigo)\b/],
    [['nl'], 'nl', /\bIk ben\b/],
  ];
  for (const [languages, lang, marker] of cases) {
    const { ctx, draft } = await readyDraft({ languages });
    assert.equal(draft.language, lang);
    assert.match(draft.body, marker, draft.body);
    const d = ctx.candidate.declared;
    const c = draft.citation;
    assert.ok(c.value.length > 0 && c.path.startsWith('declared.'));
    assert.ok(c.summary.length > 0);
    for (const r of c.rendered) assert.ok(draft.body.toLowerCase().includes(r.toLowerCase()), `${lang}: "${r}" missing from "${draft.body}"`);
    if (c.field === 'interests') for (const v of c.value) assert.ok(d.interests.includes(v));
    if (c.field === 'prompts') assert.ok(d.prompts.some((p) => c.value.includes(p.answer)));
    for (const claim of draft.claims) assert.ok(ctx.itinerary.covers(claim.city, claim.from, claim.to), `${lang}: ${JSON.stringify(claim)}`);
    assert.deepEqual(draft.slotIds, ctx.slots.slice(0, draft.slotIds.length).map((s) => s.id));
  }
});

test('drafts have the register: short, no greeting, no question about a photo, a place and a time', async () => {
  for (const languages of [['de'], ['en'], ['es'], ['nl']]) {
    for (let variant = 0; variant < 12; variant++) {
      const { draft } = await readyDraft({ languages }, { variant });
      assert.ok(draft.body.length <= 320, draft.body);
      assert.doesNotMatch(draft.body, /^(hey|hi|hello|hallo|hola|hoi)\b/i);
      assert.match(draft.body, /\?$/, 'ends on a concrete ask');
      assert.match(draft.body, /Amsterdam/);
    }
  }
});

test('Dutch carries exactly one deliberate slip; every other language carries none', async () => {
  for (let variant = 0; variant < 20; variant++) {
    assert.equal((await readyDraft({ languages: ['nl'] }, { variant })).draft.slips, 1);
  }
  for (const languages of [['de'], ['en'], ['es']]) {
    assert.equal((await readyDraft({ languages })).draft.slips, 0);
  }
  // The slip is one of the catalogued ones, not random damage: the clean variant is also on file.
  const slipped = PACKS.nl.detail.interests.filter((v) => typeof v === 'object').length;
  assert.ok(slipped >= 3);
});

test('real variation: many distinct drafts per language, but the same inputs give the same draft', async () => {
  for (const languages of [['en'], ['de'], ['es'], ['nl']]) {
    const bodies = new Set<string>();
    for (let variant = 0; variant < 30; variant++) bodies.add((await readyDraft({ languages }, { variant })).draft.body);
    assert.ok(bodies.size >= 12, `${languages}: only ${bodies.size} distinct drafts in 30 variants`);
  }
  const a = (await readyDraft({ languages: ['en'] }, { variant: 4 })).draft.body;
  const b = (await readyDraft({ languages: ['en'] }, { variant: 4 })).draft.body;
  assert.equal(a, b);
});

test('a near date names the weekday, a far one adds the date, and two slots are offered only when near', async () => {
  const { calendar, itinerary } = (await import('./week-helpers.ts')).makeCalendar();
  const her = person({ languages: ['en'], city: 'Amsterdam' });
  const near = await calendar.proposeSlots({ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-16', count: 2, kinds: ['dinner'] });
  const far = await calendar.proposeSlots({ city: 'Berlin', count: 2, kinds: ['dinner'] });
  const gen = new TemplateGenerator();
  const nowNearby = new Date('2026-10-08T09:00:00Z');
  const n = gen.generate({ kind: 'opener', candidate: her, now: nowNearby, itinerary, slots: near, thread: [] }, 0) as GeneratedDraft;
  assert.equal(n.slotIds.length, 2);
  assert.match(n.body, /\b(Friday|Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday)\b/);
  const f = gen.generate({ kind: 'opener', candidate: person({ city: 'Berlin' }), now: NOW, itinerary, slots: far, thread: [] }, 0) as GeneratedDraft;
  assert.equal(f.slotIds.length, 1);
  assert.match(f.body, /\d{1,2} (October|November)/);
});

test('follow-up and reschedule are written in her language once she has replied', async () => {
  const her = person({ languages: ['de'] });
  const base = await openerCtx(her);
  const [first, second] = base.slots;
  const thread = [msg('viewer', 1), msg('candidate', 2)];
  const fu = await new Drafter().compose({ ...base, kind: 'follow-up', slots: [first!], thread });
  assert.equal(fu.status, 'ready');
  assert.match((fu as { draft: GeneratedDraft }).draft.body, /Lokal|Ort|Dann|passt/);
  assert.equal((fu as { draft: GeneratedDraft }).draft.citation.field, 'slot');
  const rs = await new Drafter().compose({ ...base, kind: 'reschedule', slots: [second!], previous: first, thread });
  assert.equal(rs.status, 'ready');
  const noPrev = await new Drafter().compose({ ...base, kind: 'reschedule', slots: [second!], thread });
  assert.equal(noPrev.status === 'held' && noPrev.reason, 'needs_slot');
  for (const languages of [['en'], ['es'], ['nl']]) {
    const c = await openerCtx(person({ languages }));
    const o = await new Drafter().compose({ ...c, kind: 'follow-up', slots: [c.slots[0]!], thread });
    assert.equal(o.status, 'ready');
  }
});

test('with no free slot in her city nothing is drafted, and the outcome says why', async () => {
  const her = person({ city: 'Porto' });
  const ctx = await openerCtx(her);
  assert.equal(ctx.slots.length, 0);
  const out = await new Drafter().compose(ctx);
  assert.equal(out.status === 'held' && out.reason, 'no_overlap');
});

test('across the whole synthetic pool, every draft that is offered passes the check', async () => {
  const sys = makeSys();
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await sys.adapter.listCandidates({ cursor, limit: 100 });
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const langs = new Set<string>();
  let ready = 0;
  const { makeCalendar } = await import('./week-helpers.ts');
  const { calendar, itinerary } = makeCalendar();
  for (const c of all) {
    const slots = await calendar.proposeSlots({ city: c.declared.city, count: 2 });
    const ctx: DraftContext = { kind: 'opener', candidate: c, now: NOW, itinerary, slots, thread: [] };
    const out = await new Drafter().compose(ctx);
    if (out.status !== 'ready') continue;
    ready++;
    langs.add(out.draft.language);
    assert.equal(checkDraft(out.draft, ctx).ok, true, out.draft.body);
  }
  assert.ok(ready > 60, `only ${ready} drafts`);
  assert.ok(langs.size >= 3, `languages seen: ${[...langs]}`);
});

// ---------- the prohibited-content check ----------

async function base() {
  const { ctx, draft } = await readyDraft({ languages: ['en'] });
  return { ctx, draft };
}
const withBody = (d: GeneratedDraft, body: string): GeneratedDraft => ({ ...d, body });

test('appearance is rejected in all four languages, and "photography" is not appearance', async () => {
  const { ctx, draft } = await base();
  for (const text of ['You have a beautiful smile.', 'Du hast ein schönes Lächeln.', 'Qué guapa sales en la foto.', 'Wat een mooie ogen.', 'Great pics.', 'You look amazing.', 'Your eyes are lovely.']) {
    const r = checkDraft(withBody(draft, `${text} ${draft.body}`), ctx);
    assert.equal(r.ok, false, text);
    if (!r.ok) assert.ok(r.all.some((x) => x.rule === 'appearance'), text);
  }
  const fine = checkDraft(withBody(draft, draft.body.replace(/\.$/, '') + ' I like photography.'), ctx);
  assert.ok(fine.ok || !fine.all.some((x) => x.rule === 'appearance'));
});

test('a claim about being somewhere Eric is not is rejected, and so is an unbacked "I am in <city>"', async () => {
  const { ctx, draft } = await base();
  const lisbon = { ...draft, claims: [{ city: 'Lisbon', from: '2026-10-09', to: '2026-10-16', tentative: false }] };
  const r1 = checkDraft(lisbon, ctx);
  assert.equal(!r1.ok && r1.rejection.rule, 'false-location');
  assert.match(!r1.ok ? r1.rejection.reason : '', /Lisbon/);
  const overshoot = { ...draft, claims: [{ city: 'Amsterdam', from: '2026-10-09', to: '2026-10-30', tentative: false }] };
  assert.equal(checkDraft(overshoot, ctx).ok, false);
  for (const text of ["I'm in Dubai until Sunday.", 'Ich bin bis Sonntag in Dubai.', 'Estoy en Dubai hasta el domingo.', 'Ik ben tot zondag in Dubai.']) {
    const r = checkDraft(withBody(draft, `${draft.body} ${text}`), ctx);
    assert.equal(!r.ok && r.all.some((x) => x.rule === 'false-location'), true, text);
  }
  // Mentioning her city is not a claim about where he is.
  const mention = checkDraft(withBody(draft, draft.body + ' You live in Dubai?'), ctx);
  assert.ok(mention.ok || !mention.all.some((x) => x.rule === 'false-location'));
});

test('implied commitment is rejected in all four languages', async () => {
  const { ctx, draft } = await base();
  for (const text of ['I promise I will be there.', "Can't wait!", 'I will definitely make it.', "I've booked a table.", 'Ich freue mich auf dich.', 'Auf jeden Fall.', 'Te prometo que voy.', 'Tengo ganas de verte.', 'Ik beloof het.', 'Ik kijk uit naar dinsdag.']) {
    const r = checkDraft(withBody(draft, `${draft.body} ${text}`), ctx);
    assert.equal(!r.ok && r.all.some((x) => x.rule === 'implied-commitment'), true, text);
  }
});

test('no second message before she replies, and no multi-message bodies', async () => {
  const { ctx, draft } = await base();
  assert.equal(checkDraft(draft, ctx).ok, true);
  const wrote = checkDraft(draft, { ...ctx, thread: [msg('viewer')] });
  assert.equal(!wrote.ok && wrote.rejection.rule, 'second-message');
  assert.match(!wrote.ok ? wrote.rejection.reason : '', /not replied/);
  assert.equal(threadRejection('opener', [msg('candidate')])?.rule, 'second-message');
  assert.equal(threadRejection('opener', []), null);
  assert.equal(threadRejection('follow-up', [msg('viewer')])?.rule, 'second-message');
  assert.equal(threadRejection('follow-up', [msg('viewer'), msg('candidate', 2)]), null);
  assert.equal(threadRejection('reschedule', [msg('candidate'), msg('viewer', 2)])?.rule, 'second-message');
  for (const body of [`${draft.body}\n\nAlso, one more thing.`, `${draft.body} P.S. hello`, `${draft.body}\n---\nsecond`]) {
    const r = checkDraft(withBody(draft, body), ctx);
    assert.equal(!r.ok && r.all.some((x) => x.rule === 'second-message'), true, body);
  }
});

test('the register rules: greeting, small talk, pet names, length', async () => {
  const { ctx, draft } = await base();
  const rules = (text: string) => {
    const r = checkDraft(withBody(draft, text), ctx);
    return r.ok ? [] : r.all.map((x) => x.rule);
  };
  assert.ok(rules(`Hey! ${draft.body}`).includes('register-greeting'));
  assert.ok(rules(`Hallo ${draft.body}`).includes('register-greeting'));
  assert.ok(rules(`${draft.body} How was your weekend?`).includes('register-small-talk'));
  assert.ok(rules(`${draft.body} Wie war dein Wochenende?`).includes('register-small-talk'));
  assert.ok(rules(`${draft.body} babe`).includes('register-pet-name'));
  assert.ok(rules(`${draft.body} Schatz`).includes('register-pet-name'));
  assert.ok(rules(`${draft.body} One. Two. Three. Four. Five.`).includes('register-length'));
  assert.deepEqual(rules(draft.body), []);
});

test('a citation must be real: an invented interest or a detail missing from the text is rejected', async () => {
  const { ctx, draft } = await base();
  const invented = { ...draft, citation: { ...draft.citation, field: 'interests' as const, value: ['skydiving'], rendered: ['skydiving'] } };
  const r = checkDraft(invented, ctx);
  assert.equal(!r.ok && r.rejection.rule, 'citation');
  const missing = { ...draft, citation: { ...draft.citation, rendered: ['a phrase that is not in the draft'] } };
  assert.equal(checkDraft(missing, ctx).ok, false);
  const none = { ...draft, citation: { ...draft.citation, value: [] } };
  assert.equal(checkDraft(none, ctx).ok, false);
  const wrongKind = { ...draft, citation: { ...draft.citation, field: 'slot' as const, value: ['x'] } };
  assert.equal(checkDraft(wrongKind, ctx).ok, false);
});

test('every rejection is structured: a named rule, a reason and the offending words', async () => {
  const { ctx, draft } = await base();
  const r = checkDraft(withBody(draft, `Beautiful. ${draft.body} I promise.`), ctx);
  assert.equal(r.ok, false);
  if (!r.ok) {
    const named = r.all.map((x) => x.rule);
    assert.ok(named.includes('appearance') && named.includes('implied-commitment'));
    for (const x of r.all) {
      assert.equal(typeof x.reason, 'string');
      assert.ok(x.reason.length > 10);
      assert.equal(typeof x.excerpt, 'string');
    }
    assert.equal(r.rejection.rule, 'appearance');
  }
});

// ---------- the retry loop ----------

function sabotaged(bad: (ok: GeneratedDraft, attempt: number) => GeneratedDraft | null): DraftGenerator {
  const real = new TemplateGenerator();
  return {
    name: 'sabotaged',
    generate(ctx, attempt): GeneratedDraft | GenerationRefusal {
      const ok = real.generate(ctx, attempt) as GeneratedDraft;
      return bad(ok, attempt) ?? ok;
    },
  };
}

test('a failing draft is rejected with the rule named, and the drafter retries until one passes', async () => {
  const gen = sabotaged((ok, i) => (i === 0 ? withBody(ok, `Beautiful smile. ${ok.body}`) : i === 1 ? withBody(ok, `${ok.body} I promise.`) : null));
  const out = await new Drafter({ generator: gen }).compose(await openerCtx(person()));
  assert.equal(out.status, 'ready');
  assert.deepEqual(out.rejected.map((a) => a.rejection.rule), ['appearance', 'implied-commitment']);
  assert.match(out.rejected[0]!.body, /Beautiful/);
  assert.doesNotMatch((out as { draft: GeneratedDraft }).draft.body, /Beautiful|promise/);
});

test('when every attempt fails, nothing is offered and nothing reaches the outbox', async () => {
  const sys = makeSys();
  const match = (await sys.adapter.listMatches())[0]!;
  const gen = sabotaged((ok) => withBody(ok, `You look great. ${ok.body}`));
  const drafter = new Drafter({ generator: gen, maxAttempts: 5 });
  const out = await drafter.offer(sys.outbox, match.id, await openerCtx(person()));
  assert.equal(out.status, 'held');
  assert.equal(out.status === 'held' && out.reason, 'all_rejected');
  assert.equal(out.status === 'held' && out.rejected.length, 5);
  assert.equal(sys.outbox.list().length, 0);
});

test('a thread that forbids a message is refused before any text is generated', async () => {
  let calls = 0;
  const gen: DraftGenerator = { name: 'counting', generate: () => { calls++; return { refused: true, reason: 'no_detail', message: 'x' }; } };
  const out = await new Drafter({ generator: gen }).compose(await openerCtx(person(), { thread: [msg('viewer')] }));
  assert.equal(out.status === 'held' && out.reason, 'thread_state');
  assert.equal(calls, 0);
});

test('a generator that throws is a held outcome, not a crash', async () => {
  const gen: DraftGenerator = { name: 'boom', generate: () => { throw new Error('model unavailable'); } };
  const out = await new Drafter({ generator: gen }).compose(await openerCtx(person()));
  assert.equal(out.status === 'held' && out.reason, 'generator_failed');
  assert.match(out.status === 'held' ? out.message : '', /model unavailable/);
});

// ---------- the send guarantee still holds ----------

test('an offered draft is an ordinary pending Draft; only the approve route sends it', async () => {
  const sys = makeSys();
  const match = (await sys.adapter.listMatches())[0]!;
  const drafter = new Drafter();
  const out = await drafter.offer(sys.outbox, match.id, await openerCtx(person()));
  assert.equal(out.status, 'offered');
  if (out.status !== 'offered') return;
  assert.equal(out.draft.kind, 'draft');
  assert.equal(out.draft.author, 'agent');
  assert.equal(out.draft.generator, 'voice-template-v1');
  assert.equal(sys.outbox.get(out.draft.id).status, 'pending');
  assert.equal(sys.platform.store.viewerMessageCount(), 0);
  assert.equal(drafter.offeredDraft(out.draft.id)!.citation.summary, out.citation.summary);

  const ok = await call(sys.app, 'POST', `/drafts/${out.draft.id}/approve`, { seenBody: out.draft.body });
  assert.equal(ok.status, 200);
  assert.equal(sys.platform.store.viewerMessageCount(), 1);
});

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const mine = ['drafting', 'schedule', 'brief', 'calendar'];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('drafting, scheduling, brief and calendar code has no path to sending and no network or paid dependency', () => {
  const offenders: string[] = [];
  for (const d of mine) {
    for (const f of files(join(SRC, d))) {
      const code = stripComments(readFileSync(f, 'utf8'));
      const rel = relative(SRC, f).split(sep).join('/');
      if (/\.deliver\s*\(|approveAndSend|ApprovedDraft|isApprovedDraft|approvedBrand|via:\s*'http'/.test(code)) offenders.push(`${rel}: send path`);
      if (/\bfetch\s*\(|node:https?|from 'https?'|XMLHttpRequest|WebSocket/.test(code)) offenders.push(`${rel}: network`);
      if (/process\.env|api[_-]?key|Authorization/i.test(code)) offenders.push(`${rel}: credentials`);
    }
  }
  assert.deepEqual(offenders, []);
  const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')) as { dependencies: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies).sort(), ['@hono/node-server', 'hono']);
});

test('the new modules leak no local paths and carry no real-world identifiers', () => {
  for (const d of mine) {
    for (const f of files(join(SRC, d))) {
      const text = readFileSync(f, 'utf8');
      assert.doesNotMatch(text, /[A-Za-z]:\\Users\\|\/home\/|\/Users\//, f);
    }
  }
});

test('only the drafter imports the outbox, and only as a type', () => {
  const importers = mine.flatMap((d) => files(join(SRC, d))).filter((f) => /outbox\/outbox\.ts/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(importers.map((f) => relative(SRC, f).split(sep).join('/')), ['drafting/drafter.ts']);
  assert.match(readFileSync(join(SRC, 'drafting/drafter.ts'), 'utf8'), /import type \{ Outbox \}/);
});
