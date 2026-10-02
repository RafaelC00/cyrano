import { mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderBrief } from '../src/brief/render.ts';
import { buildWeeklyBrief } from '../src/brief/brief.ts';
import { LocalCalendar } from '../src/calendar/local.ts';
import { formatLocal } from '../src/calendar/time.ts';
import type { Candidate } from '../src/domain/types.ts';
import { Drafter } from '../src/drafting/drafter.ts';
import { chooseLanguage, TemplateGenerator } from '../src/drafting/generator.ts';
import type { DraftContext, DraftGenerator, GeneratedDraft } from '../src/drafting/types.ts';
import { Scheduler } from '../src/schedule/scheduler.ts';
import { ericItinerary, ericPreferences } from '../src/schedule/persona.ts';
import { createSystem } from '../src/system.ts';

/**
 * Phases 4 and 5 end to end: drafting in Eric's voice, slot proposal against where he is,
 * a confirmed date with an .ics file, and the weekly brief. All synthetic, all in-process,
 * nothing sent: the only message that would leave is one a person approves.
 */
const NOW = new Date('2026-10-02T09:00:00.000Z');
const today = NOW.toISOString().slice(0, 10);
const sys = createSystem({ clock: () => NOW, prefs: ericPreferences() });
const itinerary = ericItinerary(today);
const dir = mkdtempSync(join(tmpdir(), 'cyrano-demo-'));
const calendar = new LocalCalendar({ itinerary, clock: () => NOW, storagePath: join(dir, 'calendar.json') });
const scheduler = new Scheduler(calendar, () => NOW);
const drafter = new Drafter();

const hr = (t: string) => console.log(`\n=== ${t} ===`);

hr('Where Eric is');
for (const s of itinerary.stays()) console.log(`  ${s.city.padEnd(10)} ${s.from} to ${s.to}`);

// A call in Amsterdam the evening before he lands, to show a clash being avoided.
calendar.addBusy({ start: '2026-10-14T17:00:00.000Z', end: '2026-10-14T19:30:00.000Z', label: 'fund call' });

hr('Funnel with Eric\'s stated preferences');
const report = await sys.funnel.run();
for (const s of report.stages) console.log(`  ${s.stage.padEnd(6)} in ${String(s.in).padStart(4)}  out ${String(s.out).padStart(4)}`);

// ---- Phase 4: drafting -----------------------------------------------------------------------
async function ctxFor(c: Candidate, extra: Partial<DraftContext> = {}): Promise<DraftContext> {
  const slots = await calendar.proposeSlots({ city: c.declared.city, count: 2 });
  return { kind: 'opener', candidate: c, now: NOW, itinerary, slots, thread: [], ...extra };
}

hr('Drafts across languages (pool profiles, composed only, nothing queued)');
const all: Candidate[] = [];
let cursor: string | undefined;
do {
  const page = await sys.adapter.listCandidates({ cursor, limit: 100 });
  all.push(...page.items);
  cursor = page.nextCursor ?? undefined;
} while (cursor);
const visited = new Set(itinerary.stays().map((s) => s.city));
const wanted = ['de', 'en', 'es', 'nl'] as const;
for (const lang of wanted) {
  const c = all.find((x) => visited.has(x.declared.city) && chooseLanguage(x.declared.languages).language === lang && chooseLanguage(x.declared.languages).matched);
  if (!c) {
    console.log(`\n[${lang}] no pool candidate whose best language is ${lang} in a city Eric visits`);
    continue;
  }
  const out = await drafter.compose(await ctxFor(c));
  console.log(`\n[${lang}] ${c.displayName}, ${c.declared.city}, declares ${c.declared.languages.join('/')}`);
  if (out.status === 'ready') {
    console.log(`  "${out.draft.body}"`);
    console.log(`  cites: ${out.draft.citation.summary}  (${out.draft.citation.path})`);
    console.log(`  claims: ${out.draft.claims.map((x) => `${x.city} ${x.from}..${x.to}${x.tentative ? ' (tentative)' : ''}`).join('; ')}  slips: ${out.draft.slips}`);
  } else console.log(`  held: ${out.reason}: ${out.message}`);
}

hr('The prohibited-content check on a failing draft');
// A generator that misbehaves on its first two tries, to show rejection and retry.
const real = new TemplateGenerator();
const bad: DraftGenerator = {
  name: 'misbehaving-demo',
  generate(ctx: DraftContext, attempt: number) {
    const ok = real.generate(ctx, attempt) as GeneratedDraft;
    if (attempt === 0) return { ...ok, body: `Hey! Beautiful smile. ${ok.body}` };
    if (attempt === 1) return { ...ok, body: ok.body.replace(/\?$/, '? I promise I will definitely be there.') };
    return ok;
  },
};
const sample = all.find((x) => x.declared.city === 'Amsterdam' && chooseLanguage(x.declared.languages).language === 'en')!;
const retried = await new Drafter({ generator: bad }).compose(await ctxFor(sample));
for (const a of retried.rejected) console.log(`  attempt ${a.attempt} REJECTED by "${a.rejection.rule}": ${a.rejection.reason}  [${a.rejection.excerpt}]`);
if (retried.status === 'ready') console.log(`  attempt ${retried.rejected.length} passed: "${retried.draft.body}"`);

// ---- The real flow: gate, matches, proposals, drafts in the outbox ---------------------------
hr('Human gate and matches (the demo plays the human, accepting the top of the gate)');
for (const t of sys.gate.pending().slice(0, 10)) await sys.gate.accept(t.candidate.id);
const matches = await sys.adapter.listMatches();
console.log(`  matches now: ${matches.length}`);

hr('Slots proposed per match, drafts queued for approval');
const planned: string[] = [];
for (const m of matches) {
  const c = await sys.adapter.getProfile(m.candidateId);
  const thread = await sys.adapter.readThread(m.id);
  if (thread.length) {
    const held = await drafter.compose({ kind: 'opener', candidate: c, now: NOW, itinerary, slots: [], thread });
    console.log(`  ${c.displayName} (${c.declared.city}): ${held.status === 'held' ? `held (${held.reason}): ${held.message}` : 'unexpected'}`);
    continue;
  }
  const plan = await scheduler.propose(c, { matchId: m.id, count: 3 });
  if (!plan.slots.length) {
    console.log(`  ${c.displayName} (${c.declared.city}): Eric is not in ${c.declared.city} in the window; no slots, no draft`);
    continue;
  }
  const offered = await drafter.offer(sys.outbox, m.id, { kind: 'opener', candidate: c, now: NOW, itinerary, slots: plan.slots, thread });
  if (offered.status === 'offered') {
    planned.push(c.id);
    console.log(`\n  ${c.displayName}, ${c.declared.city}: slots ${plan.slots.map((s) => formatLocal(new Date(s.start), s.timezone)).join(' | ')}`);
    console.log(`    [${offered.language}] "${offered.draft.body}"`);
    console.log(`    cites ${offered.citation.summary}; draft ${offered.draft.id} is ${sys.outbox.get(offered.draft.id).status}`);
  } else console.log(`  ${c.displayName}: held (${offered.reason})`);
}
console.log(`\n  messages sent by Eric so far: ${sys.platform.store.viewerMessageCount()}`);

hr('One reply comes back: a slot is confirmed, an .ics file is written');
const target = scheduler.list().filter((p) => p.status === 'proposed').sort((x, y) => x.slots[0]!.start.localeCompare(y.slots[0]!.start))[0];
if (target) {
  const slot = target.slots[0]!;
  const event = await scheduler.confirm(target.candidateId, slot.id);
  const path = await scheduler.exportIcs(target.candidateId, dir, event);
  console.log(`  confirmed ${target.name}: ${formatLocal(new Date(slot.start), slot.timezone)} in ${slot.city}; other holds released`);
  console.log(`  wrote ${path}\n`);
  console.log(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
}

hr('Follow-up and reschedule once she has replied (synthetic thread: she answered, nothing was sent)');
if (target) {
  const c = await sys.adapter.getProfile(target.candidateId);
  const reply = [
    { id: 'm1', matchId: target.matchId!, from: 'viewer' as const, body: '(opener, approved earlier)', sentAt: NOW.toISOString() },
    { id: 'm2', matchId: target.matchId!, from: 'candidate' as const, body: '(her reply)', sentAt: NOW.toISOString() },
  ];
  const confirmed = target.chosen!;
  const fu = await drafter.compose({ kind: 'follow-up', candidate: c, now: NOW, itinerary, slots: [confirmed], thread: reply });
  if (fu.status === 'ready') console.log(`  follow-up [${fu.draft.language}]: "${fu.draft.body}"  cites ${fu.draft.citation.summary}`);
  const later = (await calendar.proposeSlots({ city: confirmed.city, from: confirmed.day, count: 2 })).filter((x) => x.day > confirmed.day);
  const rs = await drafter.compose({ kind: 'reschedule', candidate: c, now: NOW, itinerary, slots: later.slice(0, 1), previous: confirmed, thread: reply });
  if (rs.status === 'ready') console.log(`  reschedule [${rs.draft.language}]: "${rs.draft.body}"  cites ${rs.draft.citation.summary}`);
  const noReply = await drafter.compose({ kind: 'follow-up', candidate: c, now: NOW, itinerary, slots: [confirmed], thread: [reply[0]!] });
  if (noReply.status === 'held') console.log(`  follow-up before she replies: held (${noReply.reason}): ${noReply.message}`);
}

// ---- Phase 5: the brief ----------------------------------------------------------------------
hr('Weekly brief');
const pendingDrafts = sys.outbox.list('pending').map((r) => {
  const o = drafter.offeredDraft(r.draft.id);
  return { draftId: r.draft.id, candidateName: scheduler.list().find((p) => p.matchId === r.draft.matchId)?.name ?? r.draft.matchId, language: o?.language, citation: o?.citation.summary };
});
const brief = buildWeeklyBrief({ now: NOW, tracked: sys.state.all(), plans: scheduler.list(), prefs: sys.prefs(), itinerary, pendingDrafts });
console.log(renderBrief(brief));
