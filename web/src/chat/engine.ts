import { agent, ApiError } from '../api/phase1.ts';
import { ENDPOINTS, fromSeam } from '../contracts.ts';
import type { ModelReport } from '../contracts.ts';
import { fixtureModelReport, kindWord } from '../fixtures.ts';
import { loadCalendar, moveProposal, stayOn, validateMove } from '../lib/calendar.ts';
import { gateMemory, loadPool, loadSnapshot, firstName } from '../lib/data.ts';
import { addDays, day, dayLong, plural, ruleLabel, time } from '../lib/format.ts';
import { invalidateAll } from '../lib/resource.ts';
import type { ScreenId } from '../lib/router.ts';
import { getProvider } from './provider.ts';
import type { DayRef, Intent, MoveTarget, ParseContext, PersonKey } from './parser.ts';

export type Action =
  | { kind: 'overturn'; id: string; name: string }
  | { kind: 'move'; id: string; start: string }
  | { kind: 'go'; screen: ScreenId; param?: string }
  | { kind: 'ask'; text: string }
  | { kind: 'dismiss' };

export type Block =
  | { t: 'p'; text: string; tone?: 'ok' | 'bad' | 'dim' }
  | { t: 'people'; rows: Array<{ id: string; name: string; line: string; photoRef: string | null; score?: number }> }
  | { t: 'facts'; rows: Array<[string, string]> }
  | { t: 'actions'; items: Array<{ label: string; action: Action; primary?: boolean }> };

export interface Memory {
  lastPersonId?: string;
}

export interface Answer {
  blocks: Block[];
  intent: Intent['kind'];
  parser: string;
}

const EXAMPLES = ['Why did you drop her?', 'Show me the top five', 'Move Friday', 'How many made it?', "What's on this week?", 'Where is Eric next week?', 'What have you learned about me?'];

async function context(mem: Memory): Promise<ParseContext> {
  const pool = await loadPool().catch(() => []);
  const cal = await loadCalendar().catch(() => null);
  const seen = new Map<string, PersonKey>(pool.map((c) => [c.id, { id: c.id, name: c.displayName }]));
  for (const p of cal?.data.proposals ?? []) seen.set(p.person.id, { id: p.person.id, name: p.person.displayName });
  return { people: [...seen.values()], lastPersonId: mem.lastPersonId, today: cal?.data.today ?? new Date().toISOString().slice(0, 10) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export async function answer(text: string, mem: Memory): Promise<Answer> {
  const provider = getProvider();
  const ctx = await context(mem);
  const { intent } = await provider.parse(text, ctx);
  let blocks: Block[];
  try {
    blocks = await respond(intent, ctx, mem);
  } catch (e) {
    const down = e instanceof ApiError && e.code === 'unreachable';
    blocks = [{ t: 'p', tone: 'bad', text: down ? 'I cannot reach the backend. Start it with "npm run dev" in the repo root and ask again.' : `That did not work: ${(e as Error).message}` }];
  }
  return { blocks, intent: intent.kind, parser: provider.name };
}

async function respond(i: Intent, ctx: ParseContext, mem: Memory): Promise<Block[]> {
  switch (i.kind) {
    case 'greeting':
      return [{ t: 'p', text: 'Hello. Ask me why someone was dropped, who is on the shortlist, or to move a date.' }, suggestions()];
    case 'help':
      return [
        { t: 'p', text: 'I read your funnel, audit log and calendar and answer from them. I do not send messages and I do not call any model, so asking is free.' },
        { t: 'facts', rows: [['Why', '"why did you drop her", "what happened to Marta"'], ['Ranking', '"show me the top five"'], ['Calendar', '"move Friday", "move Friday to Saturday at 9pm", "where is Eric next week"'], ['Reversal', '"bring her back"'], ['Numbers', '"how many made it", "who got dropped by the language rule"']] },
        suggestions(),
      ];
    case 'why_dropped':
      return whyDropped(i.who, i.ambiguous, mem);
    case 'overturn':
      return overturn(i.who, i.ambiguous, mem);
    case 'top':
      return top(i.n);
    case 'move':
      return move(i.which, i.to, i.who, ctx);
    case 'funnel':
      return funnel();
    case 'dropped_by':
      return droppedBy(i.rule);
    case 'calendar':
      return calendar();
    case 'where':
      return where();
    case 'brief':
      return [{ t: 'p', text: 'The brief is a one-page digest of who, when, where and why. It is prepared, never sent.' }, { t: 'actions', items: [{ label: 'Open the brief', action: { kind: 'go', screen: 'brief' }, primary: true }] }];
    case 'model':
      return model();
    case 'send':
      return send(i.who, mem);
    case 'unknown':
      return [{ t: 'p', text: 'I did not catch that.' + (i.guesses.length ? ' It sounded a little like a question about ' + i.guesses.map((g) => g.replace('_', ' ')).join(' or ') + ', but not enough to act on.' : '') }, suggestions()];
  }
}

const suggestions = (): Block => ({ t: 'actions', items: EXAMPLES.slice(0, 4).map((t) => ({ label: t, action: { kind: 'ask', text: t } })) });

// ---------------------------------------------------------------------------------------------

function needPerson(verb: string, ambiguous: PersonKey[] | undefined, phrase: (n: string) => string): Block[] {
  if (ambiguous?.length)
    return [{ t: 'p', text: `More than one person fits. Which one?` }, { t: 'actions', items: ambiguous.map((p) => ({ label: p.name, action: { kind: 'ask' as const, text: phrase(p.name) } })) }];
  return [{ t: 'p', text: `Who should I ${verb}? Give me a name, or an id like p_0149.` }];
}

async function whyDropped(who: PersonKey | null, ambiguous: PersonKey[] | undefined, mem: Memory): Promise<Block[]> {
  if (!who) return needPerson('look up', ambiguous, (n) => `why was ${n} dropped`);
  mem.lastPersonId = who.id;
  try {
    const w = await agent.why(who.id);
    const fails = w.history.filter((h) => h.outcome === 'fail');
    const out: Block[] = [];
    if (w.status === 'dropped' && w.droppedBy) {
      const d = w.droppedBy;
      out.push({ t: 'p', text: `${w.displayName} was stopped at ${d.stage === 'rules' ? 'the rule filter' : d.stage === 'broad' ? 'the broad pass' : 'the rank cutoff'}: ${ruleLabel(d.rule).toLowerCase()}. ${cap(d.reason)}.` });
      if (d.alsoFailed.length) out.push({ t: 'p', tone: 'dim', text: `Also failed ${plural(d.alsoFailed.length, 'other rule')}: ${d.alsoFailed.map((f) => ruleLabel(f.rule).toLowerCase()).join(', ')}.` });
    } else if (w.status === 'rejected') {
      out.push({ t: 'p', text: `You passed on ${w.displayName} at the gate.` });
    } else if (w.status === 'pending') {
      out.push({ t: 'p', text: `${w.displayName} was not dropped. ${w.overturned ? 'You overturned an earlier drop, and they are' : 'They are'} waiting at your gate.` });
    } else {
      out.push({ t: 'p', text: `${w.displayName} was not dropped: you accepted them.` });
    }
    out.push({ t: 'p', tone: 'dim', text: `${plural(w.history.length, 'rule')} evaluated them${fails.length ? `; ${fails.length} failed` : ', none failed'}.` });
    const items: Array<{ label: string; action: Action; primary?: boolean }> = [{ label: 'Full audit trail', action: { kind: 'go', screen: 'why', param: who.id } }];
    if (w.reversible) items.unshift({ label: `Bring ${firstName(w)} back`, action: { kind: 'overturn', id: who.id, name: w.displayName }, primary: true });
    out.push({ t: 'actions', items });
    return out;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [{ t: 'p', text: `I have no record of ${who.name}. They have not been through the funnel yet.` }, { t: 'actions', items: [{ label: 'Open the funnel', action: { kind: 'go', screen: 'funnel' } }] }];
    throw e;
  }
}

async function overturn(who: PersonKey | null, ambiguous: PersonKey[] | undefined, mem: Memory): Promise<Block[]> {
  if (!who) return needPerson('bring back', ambiguous, (n) => `bring ${n} back`);
  mem.lastPersonId = who.id;
  try {
    const w = await agent.why(who.id);
    if (!w.reversible) {
      return [{ t: 'p', text: w.status === 'accepted' ? `${w.displayName} is accepted. A like cannot be taken back.` : `${w.displayName} is already at your gate.` }];
    }
    const was = w.droppedBy ? `${ruleLabel(w.droppedBy.rule).toLowerCase()}: ${w.droppedBy.reason}` : 'your pass';
    return [
      { t: 'p', text: `${w.displayName} was stopped by ${was}.` },
      { t: 'p', text: 'Overturning puts them back at your gate. The original failure stays in the log and nothing is sent to them.' },
      { t: 'actions', items: [{ label: 'Yes, overturn', action: { kind: 'overturn', id: who.id, name: w.displayName }, primary: true }, { label: 'Leave it', action: { kind: 'dismiss' } }] },
    ];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [{ t: 'p', text: `I have no record of ${who.name} yet.` }];
    throw e;
  }
}

async function top(n: number): Promise<Block[]> {
  await loadSnapshot();
  const pending = await agent.gate();
  const items = pending.slice(0, n);
  if (!items.length) {
    return [{ t: 'p', text: gateMemory.size ? 'Nobody is waiting at the gate; you have decided on everyone surfaced so far.' : 'There is no shortlist yet. Run the funnel first.' }, { t: 'actions', items: [{ label: gateMemory.size ? 'See the shortlist' : 'Run the funnel', action: { kind: 'go', screen: gateMemory.size ? 'shortlist' : 'funnel' }, primary: true }] }];
  }
  return [
    { t: 'p', text: `${items.length < n ? `Only ${items.length} are waiting. ` : ''}Top ${items.length}, by the stated-preference score:` },
    { t: 'people', rows: items.map((g) => ({ id: g.candidateId, name: g.displayName, photoRef: g.photoRef, score: g.score?.score, line: `${g.declared.age}, ${g.declared.city}. ${g.score ? cap(g.score.explanation) : ''}` })) },
    { t: 'actions', items: [{ label: 'Open the gate', action: { kind: 'go', screen: 'swipe' }, primary: true }, { label: 'Full shortlist', action: { kind: 'go', screen: 'shortlist' } }] },
  ];
}

async function funnel(): Promise<Block[]> {
  const snap = await loadSnapshot();
  const f = snap.funnel;
  if (!f) return [{ t: 'p', text: 'The funnel has not run yet.' }, { t: 'actions', items: [{ label: 'Run it', action: { kind: 'go', screen: 'funnel' }, primary: true }] }];
  const [b, r, k, g] = f.stages;
  const top = f.reasons.rules[0];
  return [
    { t: 'p', text: `${f.entered} people came in and ${g!.out} reached you.` },
    { t: 'facts', rows: [['Broad pass', `${b!.out} of ${b!.in} stay (${b!.dropped} dormant)`], ['Rule filter', `${r!.out} of ${r!.in} stay (${r!.dropped} dropped)`], ['Rank', `${k!.out} of ${k!.in} make the cut`], ['At your gate', `${f.pending} waiting, ${f.accepted} accepted, ${f.humanRejected} passed`]] },
    ...(top ? [{ t: 'p' as const, tone: 'dim' as const, text: `The rule that cut the most: ${ruleLabel(top.rule).toLowerCase()} (${top.primary}).` }] : []),
    { t: 'actions', items: [{ label: 'Open the funnel', action: { kind: 'go', screen: 'funnel' } }] },
  ];
}

async function droppedBy(rule: string): Promise<Block[]> {
  const snap = await loadSnapshot();
  const who = snap.rejections.filter((r) => r.status === 'dropped' && r.droppedBy?.rule === rule);
  if (!who.length) return [{ t: 'p', text: `Nobody was dropped first by "${ruleLabel(rule).toLowerCase()}".` }];
  return [
    { t: 'p', text: `${plural(who.length, 'person')} ${who.length === 1 ? 'was' : 'were'} stopped first by "${ruleLabel(rule).toLowerCase()}". Some examples:` },
    { t: 'people', rows: who.slice(0, 6).map((w) => ({ id: w.candidateId, name: w.displayName, photoRef: null, line: cap(w.droppedBy!.reason) })) },
  ];
}

async function calendar(): Promise<Block[]> {
  const cal = (await loadCalendar()).data;
  const up = cal.proposals.filter((p) => p.status !== 'declined' && p.start.slice(0, 10) >= cal.today).sort((a, b) => a.start.localeCompare(b.start));
  if (!up.length) return [{ t: 'p', text: 'Nothing is on the calendar.' }];
  return [
    { t: 'p', text: `${plural(up.length, 'date')} coming up.` },
    { t: 'facts', rows: up.map((p) => [`${day(p.start)} ${time(p.start)}`, `${kindWord(p.kind)} with ${p.person.displayName}, ${p.city} (${p.status})`] as [string, string]) },
    { t: 'actions', items: [{ label: 'Open the calendar', action: { kind: 'go', screen: 'calendar' } }] },
  ];
}

async function where(): Promise<Block[]> {
  const cal = (await loadCalendar()).data;
  const here = stayOn(cal.stays, cal.today);
  const next = cal.stays.filter((s) => s.from > cal.today).slice(0, 2);
  return [
    { t: 'p', text: here ? `Eric is in ${here.city} until ${dayLong(addDays(here.to, -1))}.` : 'Eric has no stay booked today.' },
    ...(next.length ? [{ t: 'p' as const, tone: 'dim' as const, text: `Next: ${next.map((s) => `${s.city} from ${day(s.from)}`).join(', then ')}.` }] : []),
  ];
}

async function model(): Promise<Block[]> {
  const people = (await loadPool().catch(() => [])).slice(0, 4).map((c) => ({ id: c.id, displayName: c.displayName, age: c.declared.age, city: c.declared.city, photoRef: c.photos[0]?.photoRef ?? null }));
  const r = await fromSeam<ModelReport>(ENDPOINTS.modelReport, () => fixtureModelReport(64, people));
  const f = r.data.finding;
  return [
    { t: 'p', text: f ? f.title : `It has ${r.data.labels.count} labels and will not say anything until it has 40.` },
    ...(f ? [{ t: 'p' as const, tone: 'dim' as const, text: f.evidence }] : []),
    ...(r.source === 'fixture' ? [{ t: 'p' as const, tone: 'dim' as const, text: 'This is a fixture finding; the scoring service is not merged yet.' }] : []),
    { t: 'actions', items: [{ label: 'Open Training', action: { kind: 'go', screen: 'training' } }] },
  ];
}

async function send(who: PersonKey | null, mem: Memory): Promise<Block[]> {
  if (who) mem.lastPersonId = who.id;
  return [
    { t: 'p', tone: 'bad', text: 'I do not send messages, and I will not start. A message goes out only when you press Send on the Drafts screen, after reading it.' },
    { t: 'p', text: who ? `I can draft an opener for ${who.name}. You read it, change it, and send it yourself.` : 'I can draft an opener for you to read, change and send yourself.' },
    { t: 'actions', items: [{ label: 'Open Drafts', action: { kind: 'go', screen: 'drafts' }, primary: true }] },
  ];
}

// ---------------------------------------------------------------------------------------------
// Moving a date
// ---------------------------------------------------------------------------------------------

const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();

function resolveTarget(orig: string, which: DayRef, to: MoveTarget): string {
  // A bare weekday ("to Saturday") means the next one on or after the date being moved, not after today.
  const from = orig.slice(0, 10);
  const named = to.date ? addDays(from, (dow(to.date) - dow(from) + 7) % 7) : undefined;
  const date = named ?? (to.shiftWeeks ? addDays(which.date, 7 * to.shiftWeeks) : from);
  return `${date}T${to.time ?? orig.slice(11, 16)}:00`;
}

async function move(which0: DayRef | null, to: MoveTarget | null, who: PersonKey | null, _ctx: ParseContext): Promise<Block[]> {
  let which = which0;
  const cal = (await loadCalendar()).data;
  const live = cal.proposals.filter((p) => p.status !== 'declined' && p.start.slice(0, 10) >= cal.today).sort((a, b) => a.start.localeCompare(b.start));
  if (!live.length) return [{ t: 'p', text: 'There are no dates to move.' }];

  const list = (ps: typeof live): Block => ({ t: 'actions', items: ps.map((p) => ({ label: `${day(p.start)} ${kindWord(p.kind).toLowerCase()}, ${p.person.displayName.split(' ')[0]}`, action: { kind: 'ask' as const, text: `move ${day(p.start).split(' ')[0]!.toLowerCase()} ${p.kind}${to ? ` to ${to.said}` : ''}` } })) });

  if (!which && !who) return [{ t: 'p', text: 'Which date should I move?' }, list(live)];

  // A weekday name means the nearest upcoming date with that weekday that actually has something on it.
  const on = (d: string) => live.filter((p) => p.start.slice(0, 10) === d && (!which?.kind || p.kind === which.kind) && (!who || p.person.id === who.id));
  const w0 = which;
  const hits = w0 ? [0, 7, 14, 21].map((n) => on(addDays(w0.date, n))).find((h) => h.length) ?? [] : live.filter((p) => !who || p.person.id === who.id);
  if (which && hits.length) which = { ...which, date: hits[0]!.start.slice(0, 10) };
  if (!hits.length) return [{ t: 'p', text: which ? `There is no date on ${day(which.date)}.` : 'I cannot find that date.' }, list(live)];
  if (hits.length > 1) return [{ t: 'p', text: `There are ${hits.length} dates on ${which ? day(which.date) : 'that day'}. Which one?` }, list(hits)];

  const p = hits[0]!;
  const label = `${kindWord(p.kind).toLowerCase()} with ${p.person.displayName}, ${day(p.start)} at ${time(p.start)} in ${p.city}`;

  if (!to) {
    const stay = stayOn(cal.stays, p.start.slice(0, 10));
    const options: Array<{ label: string; action: Action }> = [];
    for (let n = 1; n <= 6 && options.length < 3; n++) {
      const d = addDays(p.start.slice(0, 10), n);
      const start = `${d}T${p.start.slice(11, 16)}:00`;
      if (stay && validateMove(p.id, start).ok) options.push({ label: `${day(d)}, same time`, action: { kind: 'move', id: p.id, start } });
    }
    return [
      { t: 'p', text: `Moving the ${label}. To when?` },
      { t: 'p', tone: 'dim', text: 'Say a day or a time, for example "move Friday to Saturday at 9pm". Eric is in this city until ' + (stay ? dayLong(addDays(stay.to, -1)) : 'later') + '.' },
      ...(options.length ? [{ t: 'actions' as const, items: options }] : []),
    ];
  }

  const start = resolveTarget(p.start, which ?? { date: p.start.slice(0, 10), said: '' }, to);
  const v = validateMove(p.id, start);
  if (!v.ok) return [{ t: 'p', tone: 'bad', text: `I cannot do that: ${v.message}` }];
  return [
    { t: 'p', text: `Move the ${label} to ${day(start)} at ${time(start)}?` },
    { t: 'p', tone: 'dim', text: 'This changes the proposal on your calendar. It sends nothing, and the date needs their agreement again.' },
    { t: 'actions', items: [{ label: 'Yes, move it', action: { kind: 'move', id: p.id, start }, primary: true }, { label: 'Leave it', action: { kind: 'dismiss' } }] },
  ];
}

/** Runs an action the person clicked. Only ever called from a click handler in the chat screen. */
export async function perform(a: Action): Promise<Block[]> {
  switch (a.kind) {
    case 'overturn':
      await agent.overturn(a.id, 'overturned from chat');
      invalidateAll();
      return [{ t: 'p', tone: 'ok', text: `${a.name} is back at your gate. Nothing was sent.` }, { t: 'actions', items: [{ label: 'Open the gate', action: { kind: 'go', screen: 'swipe' }, primary: true }] }];
    case 'move': {
      const r = await moveProposal(a.id, a.start);
      return [{ t: 'p', tone: r.ok ? 'ok' : 'bad', text: r.message }];
    }
    case 'dismiss':
      return [{ t: 'p', tone: 'dim', text: 'Left as it was.' }];
    default:
      return [];
  }
}
