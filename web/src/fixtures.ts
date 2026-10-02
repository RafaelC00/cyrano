/**
 * Local fixtures for the services that are not merged yet. See `contracts.ts` for the seam.
 *
 * People in fixtures are real entries from the live synthetic pool whenever the platform is
 * reachable (so photos and profiles match what you see on the other screens). The numbers,
 * schedule and model findings here are illustrative: nothing below was learned or planned.
 */

import type { Candidate, Draft, GateItem } from './api/phase1.ts';
import type {
  BriefEntry,
  CalendarState,
  DateProposal,
  DraftMeta,
  Disagreement,
  FeatureWeight,
  Label,
  LabelSummary,
  LearnedScore,
  ModelReport,
  PersonRef,
  TrainingItem,
  WeeklyBrief,
} from './contracts.ts';
import { addDays } from './lib/format.ts';

// ---------------------------------------------------------------------------------------------
// Deterministic helpers
// ---------------------------------------------------------------------------------------------

/** String to a stable number in [0, 1). */
export function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

const ref = (c: Candidate): PersonRef => ({
  id: c.id,
  displayName: c.displayName,
  age: c.declared.age,
  city: c.declared.city,
  photoRef: c.photos[0]?.photoRef ?? null,
});

/** Shown only when the platform is down, so the screens still render. */
const FALLBACK_CAST: PersonRef[] = [
  { id: 'x_001', displayName: 'Marisol Brandvold', age: 31, city: 'Madrid', photoRef: null },
  { id: 'x_002', displayName: 'Ines Kallergis', age: 29, city: 'Madrid', photoRef: null },
  { id: 'x_003', displayName: 'Tove Aldermar', age: 33, city: 'Madrid', photoRef: null },
  { id: 'x_004', displayName: 'Lucia Verhoeven', age: 30, city: 'Lisbon', photoRef: null },
  { id: 'x_005', displayName: 'Noor Castellane', age: 32, city: 'Lisbon', photoRef: null },
  { id: 'x_006', displayName: 'Saskia Doranov', age: 28, city: 'Porto', photoRef: null },
  { id: 'x_007', displayName: 'Marta Illesca', age: 34, city: 'Barcelona', photoRef: null },
  { id: 'x_008', displayName: 'Elin Marchetti', age: 27, city: 'Lisbon', photoRef: null },
];

// ---------------------------------------------------------------------------------------------
// Training labels (kept in the browser until the scoring service takes them)
// ---------------------------------------------------------------------------------------------

const LABEL_KEY = 'cyrano.labels.v1';
const LABEL_TARGET = 200;
/** Labels the demo model is pretended to have been fitted on before the visitor adds any. */
export const FIXTURE_BASE_LABELS = 64;

let memoryLabels: Label[] = [];

export function readLabels(): Label[] {
  try {
    const raw = localStorage.getItem(LABEL_KEY);
    if (raw) return JSON.parse(raw) as Label[];
  } catch {
    // storage blocked: use memory
  }
  return memoryLabels;
}

export function writeLabel(l: Label): LabelSummary {
  const all = [...readLabels(), l];
  memoryLabels = all;
  try {
    localStorage.setItem(LABEL_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
  return labelSummary();
}

export function undoLabel(): LabelSummary {
  const all = readLabels().slice(0, -1);
  memoryLabels = all;
  try {
    localStorage.setItem(LABEL_KEY, JSON.stringify(all));
  } catch {
    // ignore
  }
  return labelSummary();
}

export const labelSummary = (): LabelSummary => ({ count: FIXTURE_BASE_LABELS + readLabels().length, target: LABEL_TARGET });

export function fixtureTrainingItems(pool: Candidate[], mode: 'pair' | 'rating', n: number): TrainingItem[] {
  const people = pool.length >= 4 ? pool.map(ref) : FALLBACK_CAST;
  const start = readLabels().length;
  const out: TrainingItem[] = [];
  for (let i = 0; i < n; i++) {
    const k = start + i;
    const pick = (salt: string) => people[Math.floor(hash01(`${salt}${k}`) * people.length)]!;
    if (mode === 'rating') {
      out.push({ kind: 'rating', id: `r${k}`, person: pick('r') });
    } else {
      const a = pick('a');
      let b = pick('b');
      if (b.id === a.id) b = people[(people.indexOf(a) + 1) % people.length]!;
      out.push({ kind: 'pair', id: `p${k}`, a, b });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Model report: stated preference against what the labels imply
// ---------------------------------------------------------------------------------------------

/**
 * The shape of the finding this project is designed to surface: the stated profile asks for
 * someone as mobile as he is, the labels favour people with roots. The "true" values are the
 * ones a well-fitted model would converge to; fewer labels shrink them toward zero and widen the
 * interval, which is how a real fit behaves.
 */
const TRUE_FEATURES: Array<Omit<FeatureWeight, 'learned' | 'low' | 'high'> & { truth: number }> = [
  { key: 'mobile', label: 'Mobile, unanchored', stated: 0.82, truth: -0.41 },
  { key: 'settled', label: 'Long-settled in one city', stated: 0.04, truth: 0.58 },
  { key: 'craft', label: 'Craft with a physical place', stated: 0.0, truth: 0.47 },
  { key: 'ties', label: 'Long friendships, local roots', stated: 0.08, truth: 0.36 },
  { key: 'portable', label: 'Work that travels with them', stated: 0.6, truth: -0.22 },
  { key: 'ambition', label: 'Ambitious', stated: 0.7, truth: 0.08 },
  { key: 'language', label: 'Shared language', stated: 0.5, truth: 0.31 },
  { key: 'age', label: 'Inside 26 to 34', stated: 0.4, truth: 0.12 },
];

export function fixtureModelReport(count: number, people: PersonRef[]): ModelReport {
  const fit = 1 - Math.exp(-count / 40);
  const half = clamp(1.1 / Math.sqrt(Math.max(count, 4)), 0.06, 0.6);
  const features: FeatureWeight[] = TRUE_FEATURES.map((f) => {
    const learned = f.truth * fit;
    return { key: f.key, label: f.label, stated: f.stated, learned, low: learned - half, high: learned + half };
  });

  const ready = count >= 40;
  const pairs = Math.round(count * 0.6);
  const picked = Math.round(pairs * 0.74);

  const cast = people.length ? people : FALLBACK_CAST;
  const disagreements: Disagreement[] = cast.slice(0, 4).map((p, i) => ({
    person: p,
    kind: i % 2 === 0 ? 'model-higher' : 'model-lower',
    statedRank: 3 + i * 4,
    learnedRank: i % 2 === 0 ? 1 + i : 9 + i,
    because:
      i % 2 === 0
        ? 'Eight years in the same neighbourhood and a workshop that cannot travel. You rated three profiles like this above your usual.'
        : 'Strong on every stated criterion, but remote work and no ties anywhere. You passed on the last six like this.',
  }));

  const bins = [0.1, 0.3, 0.5, 0.7, 0.9];
  const calibration = bins.map((p, i) => ({
    predicted: p,
    observed: clamp(p + (hash01(`cal${i}`) - 0.5) * 0.16 * (1 - fit * 0.5), 0.02, 0.98),
    n: Math.max(2, Math.round(count / 6 + hash01(`n${i}`) * 4)),
  }));

  return {
    labels: { count, target: LABEL_TARGET },
    heldOut: ready ? { n: Math.round(count * 0.25), learned: 0.5 + 0.21 * (1 - Math.exp(-count / 50)), stated: 0.58 } : null,
    finding: ready
      ? {
          title: 'You asked for someone unanchored. You keep choosing people with roots.',
          evidence: `In ${picked} of ${pairs} comparisons where the two profiles differed on rootedness, you picked the more rooted one. The mobile and portable-career signals you listed carry a negative weight in what you actually chose.`,
        }
      : null,
    features,
    disagreements,
    calibration,
    note: 'Illustrative fixture. The labels, weights and findings below are generated for the demo; the scoring service replaces them on merge.',
  };
}

// ---------------------------------------------------------------------------------------------
// Learned scores on the shortlist
// ---------------------------------------------------------------------------------------------

const ROOTED = ['gardening', 'ceramics', 'bookshops', 'baking', 'yoga', 'vinyl records', 'theatre', 'museums', 'sketching', 'chess'];
const MOBILE = ['travel', 'surfing', 'sailing', 'language learning', 'camping', 'street food'];

export function fixtureLearnedScores(items: GateItem[]): LearnedScore[] {
  return items.map((g) => {
    const stated = g.score?.score ?? 0.5;
    const rooted = g.declared.interests.filter((i) => ROOTED.includes(i));
    const mobile = g.declared.interests.filter((i) => MOBILE.includes(i));
    const delta = (rooted.length - mobile.length) * 0.06 + (hash01(g.candidateId) - 0.5) * 0.14;
    const learned = clamp(stated * 0.7 + 0.18 + delta, 0.05, 0.97);
    const factors = [
      ...(rooted.length ? [{ label: `rooted interests (${rooted.slice(0, 2).join(', ')})`, contribution: 0.06 * rooted.length }] : []),
      ...(mobile.length ? [{ label: `mobile interests (${mobile.slice(0, 2).join(', ')})`, contribution: -0.06 * mobile.length }] : []),
      { label: 'stated-preference fit', contribution: stated * 0.3 },
    ].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));
    return { candidateId: g.candidateId, learned, stated, factors: factors.slice(0, 3) };
  });
}

// ---------------------------------------------------------------------------------------------
// Draft metadata (derived locally from the real draft and profile)
// ---------------------------------------------------------------------------------------------

const VIEWER_INTERESTS = ['cooking', 'hiking', 'film', 'board games', 'bookshops', 'climbing', 'travel', 'coffee'];

export function fixtureDraftMeta(draft: Draft, c: Candidate | undefined): DraftMeta {
  const common = c?.declared.interests.find((i) => VIEWER_INTERESTS.includes(i));
  const prompt = c?.declared.prompts[0];
  const detail = common
    ? { field: 'interest', value: common }
    : prompt
      ? { field: 'prompt', value: `${prompt.question}: ${prompt.answer}` }
      : null;
  const speaks = (c?.declared.languages ?? []).filter((l) => ['de', 'es', 'nl'].includes(l));
  const body = draft.body;
  return {
    draftId: draft.id,
    language: 'en',
    languageReason: speaks.length
      ? `Written in English. They also list ${speaks.join(', ')}; the voice rules switch to their language when they list one, which the current drafter does not do yet.`
      : 'Written in English: they do not list German, Spanish or Dutch, so the default applies.',
    detail,
    voiceChecks: [
      { rule: 'Short: two or three lines', ok: body.length <= 280 && body.split('\n').length <= 3 },
      { rule: 'Proposes a concrete thing, place or time', ok: /(coffee|dinner|drink|lunch|walk|thursday|friday|saturday|sunday|monday|tuesday|wednesday|tomorrow|this week|next week)/i.test(body) },
      { rule: 'Uses one specific detail from their profile', ok: !!detail && body.toLowerCase().includes(detail.field === 'interest' ? detail.value.toLowerCase() : (prompt?.question ?? '').toLowerCase()) },
      { rule: 'Does not open with "hey" or a question about the weekend', ok: !/^(hey|hi there|how was your weekend)/i.test(body) },
      { rule: 'No comment on their appearance', ok: !/(beautiful|gorgeous|pretty|stunning|hot|cute|sexy)/i.test(body) },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Calendar and brief
// ---------------------------------------------------------------------------------------------

export const FIXTURE_TODAY = '2026-10-02';

interface Slot {
  id: string;
  city: string;
  date: string;
  from: string;
  to: string;
  kind: DateProposal['kind'];
  venue: string;
  status: DateProposal['status'];
  reason: string;
}

const SLOTS: Slot[] = [
  { id: 'dt_001', city: 'Madrid', date: '2026-10-06', from: '11:00', to: '12:00', kind: 'coffee', venue: 'a small roaster in Malasana', status: 'confirmed', reason: 'They replied yes. Tuesday morning is free on both calendars.' },
  { id: 'dt_002', city: 'Madrid', date: '2026-10-08', from: '19:30', to: '21:00', kind: 'drink', venue: 'a wine bar near Chueca', status: 'proposed', reason: 'Thursday evening fits before the Singapore call at 02:00.' },
  { id: 'dt_003', city: 'Madrid', date: '2026-10-09', from: '20:30', to: '22:30', kind: 'dinner', venue: 'a Galician place off Calle Fuencarral', status: 'proposed', reason: 'Last evening in Madrid, and they suggested Friday themselves.' },
  { id: 'dt_004', city: 'Lisbon', date: '2026-10-14', from: '11:00', to: '12:00', kind: 'coffee', venue: 'a cafe in Principe Real', status: 'proposed', reason: 'First free morning after he lands on the 11th.' },
  { id: 'dt_005', city: 'Lisbon', date: '2026-10-15', from: '20:00', to: '22:00', kind: 'dinner', venue: 'a tasca in Alfama', status: 'proposed', reason: 'Their only free evening that week; he leaves for Singapore on the 18th.' },
];

/**
 * Binds the fixture schedule to people. Prefers people from the live shortlist who actually live
 * in the city of the date, then anyone in that city, then the invented fallback cast.
 */
export function fixtureCalendar(pool: Candidate[], preferredIds: string[]): CalendarState {
  const used = new Set<string>();
  const order = [...pool].sort((a, b) => {
    const pa = preferredIds.indexOf(a.id);
    const pb = preferredIds.indexOf(b.id);
    return (pa < 0 ? 999 : pa) - (pb < 0 ? 999 : pb);
  });
  const personFor = (city: string): PersonRef => {
    const live = order.find((c) => c.declared.city === city && !used.has(c.id) && preferredIds.includes(c.id));
    const any = live ?? order.find((c) => c.declared.city === city && !used.has(c.id) && true);
    if (any) {
      used.add(any.id);
      return ref(any);
    }
    const fb = FALLBACK_CAST.find((p) => p.city === city && !used.has(p.id)) ?? FALLBACK_CAST[0]!;
    used.add(fb.id);
    return fb;
  };

  const proposals: DateProposal[] = SLOTS.map((s) => ({
    id: s.id,
    person: personFor(s.city),
    start: `${s.date}T${s.from}:00`,
    end: `${s.date}T${s.to}:00`,
    city: s.city,
    venue: s.venue,
    kind: s.kind,
    status: s.status,
    reason: s.reason,
  }));

  return {
    today: FIXTURE_TODAY,
    stays: [
      { city: 'Amsterdam', from: '2026-09-21', to: '2026-09-28' },
      { city: 'Madrid', from: '2026-09-28', to: '2026-10-11' },
      { city: 'Lisbon', from: '2026-10-11', to: '2026-10-18' },
      { city: 'Singapore', from: '2026-10-18', to: '2026-11-01' },
    ],
    proposals,
  };
}

const KIND_WORD: Record<DateProposal['kind'], string> = { coffee: 'Coffee', drink: 'Drinks', dinner: 'Dinner' };
export const kindWord = (k: DateProposal['kind']) => KIND_WORD[k];

export function fixtureBrief(cal: CalendarState, gate: GateItem[]): WeeklyBrief {
  const weekOf = '2026-10-05';
  const open = cal.proposals.filter((p) => p.status !== 'declined').sort((a, b) => a.start.localeCompare(b.start));
  const week = open.filter((p) => p.start.slice(0, 10) >= weekOf && p.start.slice(0, 10) < addDays(weekOf, 14)).slice(0, 4);
  const entries: BriefEntry[] = week.map((p) => {
    const g = gate.find((x) => x.candidateId === p.person.id);
    return {
      proposalId: p.id,
      person: p.person,
      when: p.start,
      where: p.venue,
      city: p.city,
      why: g?.score?.explanation ?? p.reason,
    };
  });
  return {
    weekOf,
    summary: `${entries.length} people worth meeting across ${new Set(entries.map((e) => e.city)).size} cities. Nothing has been sent; every opener is waiting for you in Drafts.`,
    entries,
  };
}
