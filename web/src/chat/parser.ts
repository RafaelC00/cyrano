/**
 * The free chat parser. No model call, no network, no cost.
 *
 * A message is normalised (lower-case, accents and punctuation stripped, number words turned
 * into digits), then every intent scores it against a small set of weighted cues. The best score
 * wins if it clears a threshold; otherwise the answer is "unknown" with the closest guesses.
 * Slots (who, how many, which day, where to move it) are extracted with their own small rules:
 * names are matched against the people the screens already know about, "her" resolves to the
 * last person mentioned, and weekdays resolve to the next date from today.
 *
 * This file imports nothing, so it runs under `node --test` as well as in the browser.
 */

export interface PersonKey {
  id: string;
  name: string;
}

export interface ParseContext {
  people: PersonKey[];
  /** Whoever the conversation was last about, for "her", "him", "that one". */
  lastPersonId?: string;
  /** ISO date, for resolving weekdays. */
  today: string;
}

export interface DayRef {
  date: string;
  /** What was said, for echoing back. */
  said: string;
  kind?: 'coffee' | 'drink' | 'dinner';
}

export interface MoveTarget {
  date?: string;
  time?: string;
  shiftWeeks?: number;
  said: string;
}

export type Intent =
  | { kind: 'help' }
  | { kind: 'greeting' }
  | { kind: 'why_dropped'; who: PersonKey | null; ambiguous?: PersonKey[] }
  | { kind: 'top'; n: number }
  | { kind: 'move'; which: DayRef | null; to: MoveTarget | null; who: PersonKey | null }
  | { kind: 'overturn'; who: PersonKey | null; ambiguous?: PersonKey[] }
  | { kind: 'funnel' }
  | { kind: 'dropped_by'; rule: string; said: string }
  | { kind: 'calendar' }
  | { kind: 'where' }
  | { kind: 'brief' }
  | { kind: 'model' }
  | { kind: 'send'; who: PersonKey | null }
  | { kind: 'unknown'; guesses: string[] };

export interface Parsed {
  intent: Intent;
  /** 0..1, how far the winner is ahead. Informational. */
  confidence: number;
  scores: Array<{ kind: Intent['kind']; score: number }>;
}

// ---------------------------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9:_\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (NUMBER_WORDS[w] !== undefined ? String(NUMBER_WORDS[w]) : w))
    .join(' ');
}

// ---------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_ALIAS: Record<string, number> = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

const parseIso = (iso: string) => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
};

/** The next occurrence of a weekday, today included. */
function nextWeekday(today: string, dow: number): string {
  const cur = parseIso(today).getUTCDay();
  return addDays(today, (dow - cur + 7) % 7);
}

function findDay(norm: string, today: string): { date: string; said: string } | null {
  const words = norm.split(' ');
  for (const w of words) {
    if (w === 'today') return { date: today, said: 'today' };
    if (w === 'tomorrow') return { date: addDays(today, 1), said: 'tomorrow' };
    const full = DAYS.indexOf(w);
    if (full >= 0) return { date: nextWeekday(today, full), said: w };
    if (DAY_ALIAS[w] !== undefined) return { date: nextWeekday(today, DAY_ALIAS[w]!), said: w };
  }
  return null;
}

function findTime(norm: string): string | null {
  const ampm = /\b(\d{1,2})(?::(\d{2}))?\s?(am|pm)\b/.exec(norm);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === 'pm') h += 12;
    return `${String(h).padStart(2, '0')}:${ampm[2] ?? '00'}`;
  }
  const hm = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(norm);
  if (hm) return `${hm[1]!.padStart(2, '0')}:${hm[2]}`;
  const at = /\bat (\d{1,2})\b/.exec(norm);
  if (at && Number(at[1]) <= 23) return `${at[1]!.padStart(2, '0')}:00`;
  if (/\bmorning\b/.test(norm)) return '11:00';
  if (/\blunch\b/.test(norm)) return '13:00';
  if (/\bevening\b/.test(norm)) return '19:30';
  if (/\bnight\b/.test(norm)) return '21:00';
  return null;
}

function findKind(norm: string): DayRef['kind'] | undefined {
  if (/\b(coffee|cafe|brunch)\b/.test(norm)) return 'coffee';
  if (/\b(drink|drinks|wine|beer|cocktails?)\b/.test(norm)) return 'drink';
  if (/\b(dinner|supper|meal)\b/.test(norm)) return 'dinner';
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      // a swap of two neighbouring letters counts as one typo
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, dp[i - 2]![j - 2]! + 1);
      dp[i]![j] = v;
    }
  }
  return dp[a.length]![b.length]!;
}

const STOP = new Set(['the', 'her', 'him', 'them', 'she', 'why', 'did', 'you', 'drop', 'top', 'best', 'move', 'what', 'and', 'for', 'was', 'who', 'one', 'now']);

export function findPeople(norm: string, ctx: ParseContext): { who: PersonKey | null; ambiguous?: PersonKey[] } {
  const idHit = /\b([a-z]_\d{3,6})\b/.exec(norm);
  if (idHit) {
    const p = ctx.people.find((x) => x.id.toLowerCase() === idHit[1]);
    if (p) return { who: p };
  }
  const tokens = norm.split(' ');
  const text = ` ${norm} `;

  // 1. A full name said out loud.
  const full = ctx.people.filter((p) => text.includes(` ${normalise(p.name)} `));
  if (full.length === 1) return { who: full[0]! };

  // 2. A first or last name. Exact first, then one typo for longer words.
  const score = new Map<string, number>();
  for (const p of ctx.people) {
    const parts = normalise(p.name).split(' ');
    for (const t of tokens) {
      if (t.length < 3 || STOP.has(t)) continue;
      for (const part of parts) {
        if (part === t) score.set(p.id, Math.max(score.get(p.id) ?? 0, 2));
        else if (t.length >= 5 && part.length >= 5 && editDistance(part, t) <= 1) score.set(p.id, Math.max(score.get(p.id) ?? 0, 1));
      }
    }
  }
  if (score.size) {
    const best = Math.max(...score.values());
    const top = ctx.people.filter((p) => score.get(p.id) === best);
    if (top.length === 1) return { who: top[0]! };
    return { who: null, ambiguous: top.slice(0, 6) };
  }

  // 3. A pronoun, resolved from the conversation.
  if (/\b(her|she|him|he|them|they|that one|this one|that person)\b/.test(norm) && ctx.lastPersonId) {
    const p = ctx.people.find((x) => x.id === ctx.lastPersonId);
    if (p) return { who: p };
  }
  return { who: null };
}

// ---------------------------------------------------------------------------------------------
// Intent cues
// ---------------------------------------------------------------------------------------------

type Cue = [RegExp, number];

const CUES: Record<Intent['kind'], Cue[]> = {
  help: [[/\b(help|what can you do|commands|how do i use|what do you do|options)\b/, 4]],
  greeting: [[/^(hi|hello|hey|yo|good (morning|evening|afternoon))\b/, 3]],
  why_dropped: [
    [/\bwhy\b.*\b(drop|dropped|dropping|reject|rejected|cut|removed|excluded|skipped|missed|filtered|failed|gone|left out|pass|passed)\b/, 4],
    [/\bwhat happened (to|with)\b/, 4],
    [/\bwhy (did|was|is|were|didnt|isnt|wasnt|are)\b/, 1.5],
    [/\bwhy not\b/, 2.5],
    [/\bwhy\b.*\b(not|isnt|wasnt)\b.*\b(on|in)\b.*\b(list|shortlist|gate)\b/, 3],
    [/\bexplain\b/, 1.5],
  ],
  top: [
    [/\b(top|best|strongest|highest)\b( \d+)?/, 3],
    [/\bshortlist|short list\b/, 2.5],
    [/\bshow\b.*\b(top|best|shortlist|ranked|ranking)\b/, 2],
    [/\bwho (made|makes) (it|the cut)\b/, 3],
    [/\bleaderboard|ranking|ranked\b/, 2],
  ],
  move: [
    [/\b(move|reschedule|postpone|push|shift|bump|delay|change)\b/, 3.5],
    [/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|tomorrow|next week)\b/, 1],
    [/\b(date|dinner|coffee|drinks?)\b/, 1],
  ],
  overturn: [
    [/\b(overturn|reinstate|restore|reconsider|reverse)\b/, 4.5],
    [/\bbring\b.*\bback\b/, 4.5],
    [/\bput\b.*\bback\b/, 4.5],
    [/\bundo\b.*\b(drop|reject|pass)/, 4],
    [/\b(give|take)\b.*\b(another|second) (look|chance)\b/, 4],
    [/\bwas (a )?mistake|was wrong|should not have been dropped\b/, 3],
  ],
  funnel: [
    [/\bfunnel\b/, 3.5],
    [/\bhow many\b/, 2.5],
    [/\b(summary|overview|status|numbers|stats)\b/, 2],
    [/\bmade it\b|\breach(ed)? (me|the gate)\b|\bsurviv/, 2],
  ],
  dropped_by: [
    [/\b(dropped|rejected|cut|filtered|excluded|removed)\b.*\b(by|for|because|on)\b/, 2.5],
    [/\b(who|how many|which)\b.*\b(dropped|rejected|failed)\b/, 2.5],
    [/\b(age|city|cities|language|languages|smok\w*|child\w*|kids|orientation|intent|dormant|inactive)\b.*\b(rule|filter)\b/, 3],
  ],
  calendar: [
    [/\b(calendar|schedule|agenda|upcoming|dates)\b/, 3],
    [/\bwhat.?s on\b|\bwhen (am|are|do) (i|we)\b|\bwho am i (seeing|meeting)\b/, 3.5],
    [/\bthis week|next week\b/, 1],
    [/\bics\b|\bdownload\b|\bexport\b/, 2],
  ],
  where: [[/\bwhere (am i|is eric|will i be|will eric be|are we)\b|\bwhich city\b|\bwhat city\b|\bwhere.?s eric\b|\bam i in\b/, 5]],
  brief: [[/\b(brief|digest|weekly summary|this week.?s summary|the week)\b/, 4]],
  model: [
    [/\b(model|learned|learning|taste|calibrat\w*|training|labels?|revealed)\b/, 2.5],
    [/\bwhat (do you|does it) (know|think)\b/, 2.5],
    [/\bhow (am i|is it|are you) doing\b/, 2],
    [/\bwhat have you learned\b/, 4],
  ],
  send: [
    [/\b(send|text|message|dm|write to|reply|contact|email|ping)\b/, 3.5],
    [/\b(write|draft)\b.*\b(opener|message|first message)\b/, 3.5],
    [/\bopener\b/, 2],
  ],
  unknown: [],
};

const RULE_WORDS: Array<[RegExp, string]> = [
  [/\b(age|old|young|older|younger)\b/, 'age.range'],
  [/\b(cit(y|ies)|location|town)\b/, 'city.allowed'],
  [/\b(language|languages|speak)\b/, 'language.shared'],
  [/\b(smok\w*)\b/, 'smoking.excluded'],
  [/\b(child\w*|kids)\b/, 'children.excluded'],
  [/\b(orientation|gender|mutual)\b/, 'orientation.mutual'],
  [/\b(intent|looking for)\b/, 'intent.overlap'],
  [/\b(dormant|inactive|active)\b/, 'broad.dormant'],
  [/\b(cutoff|cut off|rank|ranking|score)\b/, 'rank.cutoff'],
];

export function ruleFromText(norm: string): string | null {
  for (const [re, id] of RULE_WORDS) if (re.test(norm)) return id;
  return null;
}

const THRESHOLD = 2.4;

export function parse(text: string, ctx: ParseContext): Parsed {
  const norm = normalise(text);
  const scores = (Object.keys(CUES) as Intent['kind'][])
    .map((kind) => ({ kind, score: CUES[kind].reduce((s, [re, w]) => (re.test(norm) ? s + w : s), 0) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  const people = findPeople(norm, ctx);
  const rule = ruleFromText(norm);

  // "why did you drop the age rule people" is about a rule, not a person.
  if (scores[0]?.kind === 'why_dropped' && !people.who && !people.ambiguous && rule && /\b(by|because|for|rule|filter)\b/.test(norm)) {
    scores.unshift({ kind: 'dropped_by', score: scores[0].score + 0.5 });
  }
  // A person plus a send verb is a send request even if "message" scored low.
  const best = scores[0];
  if (!best || best.score < THRESHOLD) {
    return { intent: { kind: 'unknown', guesses: scores.slice(0, 2).map((s) => s.kind) }, confidence: 0, scores };
  }
  const second = scores[1]?.score ?? 0;
  const confidence = Math.min(1, (best.score - second) / best.score + 0.2);

  let intent: Intent;
  switch (best.kind) {
    case 'why_dropped':
      intent = { kind: 'why_dropped', who: people.who, ambiguous: people.ambiguous };
      break;
    case 'overturn':
      intent = { kind: 'overturn', who: people.who, ambiguous: people.ambiguous };
      break;
    case 'send':
      intent = { kind: 'send', who: people.who };
      break;
    case 'top': {
      const m = /\b(?:top|best|first|strongest) (\d{1,3})\b|\b(\d{1,3}) (?:best|top|strongest)\b/.exec(norm);
      const n = Math.max(1, Math.min(20, Number(m?.[1] ?? m?.[2] ?? 5)));
      intent = { kind: 'top', n };
      break;
    }
    case 'dropped_by':
      intent = { kind: 'dropped_by', rule: rule ?? 'city.allowed', said: rule ? norm : '' };
      break;
    case 'move':
      intent = parseMove(norm, ctx, people.who);
      break;
    default:
      intent = { kind: best.kind } as Intent;
  }
  return { intent, confidence, scores };
}

function parseMove(norm: string, ctx: ParseContext, who: PersonKey | null): Intent {
  // "move friday dinner to saturday at 9pm" -> what is moved, then where it goes.
  const m = /\b(?:move|reschedule|postpone|push|shift|bump|delay|change)\b(.*)/.exec(norm);
  const rest = (m?.[1] ?? norm).trim();
  const [from, ...after] = rest.split(/\b(?:to|for|until|onto|into|till|by)\b/);
  const toText = after.join(' ').trim();

  const dayFrom = findDay(from ?? '', ctx.today);
  const which: DayRef | null = dayFrom ? { date: dayFrom.date, said: dayFrom.said, kind: findKind(from ?? '') } : null;

  let to: MoveTarget | null = null;
  const source = toText || (dayFrom ? '' : rest);
  if (source || /\bnext week\b/.test(norm)) {
    const day = findDay(source, ctx.today);
    const time = findTime(source);
    const week = /\bnext week\b/.test(source) || (/\bnext week\b/.test(norm) && !toText);
    if (day || time || week) {
      to = {
        date: day?.date,
        time: time ?? undefined,
        shiftWeeks: week && !day ? 1 : undefined,
        said: source.trim(),
      };
    }
  }
  return { kind: 'move', which, to, who };
}
