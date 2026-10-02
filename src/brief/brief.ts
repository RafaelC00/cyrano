import type { Preferences } from '../agent/preferences.ts';
import type { TrackedCandidate } from '../agent/state.ts';
import type { Itinerary } from '../calendar/itinerary.ts';
import { addDays, daysBetween, formatLocal, weekdayOf } from '../calendar/time.ts';
import type { SlotKind } from '../calendar/types.ts';
import type { PlannedDate } from '../schedule/scheduler.ts';

/**
 * The weekly brief: the product's main output. Everything here is computed from state the
 * system already holds (the ranking, the profiles, the calendar, the audit of what was dropped),
 * so each line can be traced back. No model is involved and nothing is invented.
 */

export interface BriefInput {
  now: Date;
  tracked: readonly TrackedCandidate[];
  plans: readonly PlannedDate[];
  prefs: Preferences;
  itinerary: Itinerary;
  /** Drafts in the outbox that are waiting for him to read and press send. */
  pendingDrafts?: ReadonlyArray<{ draftId: string; candidateName: string; language?: string; citation?: string }>;
  /** Dates further out than this are left for a later brief. Default 30 days. */
  horizonDays?: number;
  /** "Three or four people": the most dates shown. Default 4. */
  maxDates?: number;
  /** How many low-confidence drops to surface. Default 3. */
  maxDrops?: number;
}

export interface Why {
  /** One sentence a person can read in a glance. */
  headline: string;
  /** The facts behind it, each traceable to the ranking or to a declared profile field. */
  evidence: string[];
}

export interface BriefDate {
  candidateId: string;
  name: string;
  age: number | null;
  status: 'confirmed' | 'proposed';
  when: { startUtc: string; local: string; timezone: string; kind: SlotKind };
  where: { city: string; place?: string };
  why: Why;
  /** Other slots offered, for a proposed date. */
  alternatives: string[];
  /** Set when the date depends on travel Eric has not booked. */
  travelNote?: string;
}

export interface PendingItem {
  kind: 'gate' | 'draft' | 'awaiting-reply' | 'travel';
  text: string;
  candidateId?: string;
}

export interface DroppedNote {
  candidateId: string;
  name: string;
  /** The rule or stage that dropped her. */
  rule: string;
  reason: string;
  /** 0..1. How sure the system is that the drop was right. Lower means look first. */
  confidence: number;
  /** Why the system is unsure, in plain words. */
  whyUnsure: string;
  undo: string;
}

export interface WeeklyBrief {
  weekOf: string;
  generatedAt: string;
  dates: BriefDate[];
  pending: PendingItem[];
  /** Candidates waiting at the gate, with the reason each one is there. */
  atTheGate: Array<{ candidateId: string; name: string; rank: number | null; why: Why }>;
  leastSure: DroppedNote[];
  /** What the brief is made of, so a reader knows what it can and cannot claim. */
  basis: string;
}

const COMPONENT_LABELS: Record<string, string> = {
  interests: 'shared interests',
  intent: 'matching intent',
  language: 'shared language',
  activity: 'recent activity, so likely to reply',
  ageFit: 'closeness in age',
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const list = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** Why her: drawn from the ranking and the declared profile, never from a template blurb. */
export function explainWhy(t: TrackedCandidate | undefined, prefs: Preferences, scoredCount: number, plan?: PlannedDate): Why {
  const evidence: string[] = [];
  const headlineBits: string[] = [];
  const d = t?.candidate.declared ?? plan?.declared;
  if (!d) return { headline: 'No ranking and no profile on record for her.', evidence: ['Not in the funnel state, and the plan holds no profile snapshot.'] };
  if (!t) evidence.push('Matched before the funnel ran, so there is no ranking for her; what follows is from her declared profile only.');
  const shared = d.interests.filter((i) => prefs.viewer.interests.includes(i));
  if (shared.length) {
    headlineBits.push(`shares ${list(shared)} with you`);
    evidence.push(`Declared interests in common: ${shared.join(', ')}.`);
  }
  const intents = d.lookingFor.filter((i) => prefs.viewer.intents.includes(i));
  if (intents.length) evidence.push(`Looking for ${list(intents)}, as are you.`);
  const langs = d.languages.filter((l) => prefs.viewer.languages.includes(l));
  if (langs.length) evidence.push(`Languages in common: ${langs.join(', ')}.`);

  if (t?.score) {
    const top = Object.entries(t.score.components)
      .filter(([k, v]) => v > 0 && k !== 'baseline') // the learned scorer's 0.5 starting point is not a reason
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);
    if (top.length) {
      evidence.push(`Ranking: strongest contributions were ${top.map(([k, v]) => `${COMPONENT_LABELS[k] ?? k.replaceAll('_', ' ')} (${v})`).join(' and ')}; scorer ${t.score.scorer}.`);
      if (!shared.length) headlineBits.push(`strongest signal is ${COMPONENT_LABELS[top[0]![0]] ?? top[0]![0].replaceAll('_', ' ')}`);
    }
    if (t.score.explanation) evidence.push(`Scorer's note: ${t.score.explanation}.`);
  }
  if (t?.rank !== undefined) {
    headlineBits.push(`ranked ${ordinal(t.rank)} of ${scoredCount}`);
    evidence.push(`Position ${t.rank} of ${scoredCount} scored candidates${t.score ? `, score ${t.score.score}` : ''}.`);
  }
  if (t?.overturned) evidence.push('You overturned an earlier drop to bring her back, so she is here on your word, not the filter\'s.');
  const stay = plan?.slots[0]?.stay ?? plan?.chosen?.stay;
  if (stay) headlineBits.push(`you are both in ${stay.city} ${shortRange(stay.from, stay.to)}`);

  const headline = headlineBits.length ? `${capitalise(list(headlineBits))}.` : t ? 'Passed every rule; nothing in the profile stood out beyond that.' : 'Nothing in her declared profile overlaps with yours beyond the city.';
  return { headline, evidence };
}

const shortDay = (d: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const shortRange = (a: string, b: string) => `${shortDay(a)} to ${shortDay(b)}`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * How unsure the system is about a drop, as 0..1 where 1 is "certainly right". Heuristic and
 * labelled as such: it measures distance from the boundary the drop sat on, not a probability.
 */
function dropConfidence(t: TrackedCandidate, prefs: Preferences, itinerary: Itinerary, today: string, cutoffScore: number | undefined): { confidence: number; whyUnsure: string } {
  const drop = t.drop!;
  const d = t.candidate.declared;
  const alsoFailed = drop.alsoFailed.length;

  if (drop.rule === 'rank.cutoff') {
    if (t.score && cutoffScore !== undefined) {
      const gap = Math.max(0, cutoffScore - t.score.score);
      return {
        confidence: round2(clamp01(0.3 + gap / 0.2)),
        whyUnsure: `Score ${t.score.score} was ${round2(gap)} below the lowest score that made the gate (${cutoffScore}). A cutoff is arbitrary at its edge.`,
      };
    }
    return { confidence: 0.5, whyUnsure: 'Dropped at the rank cutoff; no cutoff score to compare against.' };
  }
  if (drop.rule === 'city.allowed') {
    const upcoming = itinerary.citiesWithin(today, 42);
    if (upcoming.includes(d.city)) {
      return { confidence: 0.2, whyUnsure: `${d.city} is not in the city list, but your itinerary has you there within six weeks. Your own rule allows that.` };
    }
  }
  if (drop.rule === 'age.range') {
    const miss = d.age < prefs.ageRange.min ? prefs.ageRange.min - d.age : d.age - prefs.ageRange.max;
    return { confidence: round2(clamp01(0.25 + 0.15 * miss + 0.1 * alsoFailed)), whyUnsure: `Declared age ${d.age} is ${miss} year${miss === 1 ? '' : 's'} outside ${prefs.ageRange.min}-${prefs.ageRange.max}. An edge of a range is where a rule is least certain.` };
  }
  if (drop.rule === 'broad.dormant') {
    return { confidence: round2(0.5 + 0.5 * clamp01((t.candidate.activity.daysSinceActive - prefs.dormantAfterDays) / prefs.dormantAfterDays)), whyUnsure: `Last active ${t.candidate.activity.daysSinceActive} days ago against a ${prefs.dormantAfterDays}-day limit; she may still read messages.` };
  }
  const base = drop.rule === 'orientation.mutual' ? 0.97 : drop.rule === 'smoking.excluded' || drop.rule === 'children.excluded' ? 0.9 : 0.7;
  const sole = alsoFailed === 0;
  return {
    confidence: round2(clamp01(base - (sole ? 0.3 : 0) + 0.05 * alsoFailed)),
    whyUnsure: sole ? `${drop.rule} was the only rule she failed, so one changed answer would put her back.` : `She failed ${alsoFailed + 1} rules, which makes the drop sturdier.`,
  };
}

export function buildWeeklyBrief(input: BriefInput): WeeklyBrief {
  const { now, tracked, plans, prefs, itinerary } = input;
  const horizon = input.horizonDays ?? 30;
  const today = now.toISOString().slice(0, 10);
  const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
  const byId = new Map(tracked.map((t) => [t.candidate.id, t]));
  const scoredCount = tracked.filter((t) => t.rank !== undefined).length;

  // Dates: confirmed first, then proposed, each by time. Only what is near enough to matter.
  const dates: BriefDate[] = plans
    .filter((p) => p.status !== 'released')
    .map((p) => {
      const slot = p.status === 'confirmed' ? p.chosen! : p.slots[0];
      return slot ? { p, slot } : null;
    })
    .filter((x): x is { p: PlannedDate; slot: NonNullable<PlannedDate['chosen']> } => x !== null)
    .filter(({ slot }) => Date.parse(slot.end) >= now.getTime() && daysBetween(today, slot.day) <= horizon)
    .sort((a, b) => Number(b.p.status === 'confirmed') - Number(a.p.status === 'confirmed') || a.slot.start.localeCompare(b.slot.start))
    .slice(0, input.maxDates ?? 4)
    .map(({ p, slot }) => {
      const t = byId.get(p.candidateId);
      return {
        candidateId: p.candidateId,
        name: p.name,
        age: t?.candidate.declared.age ?? p.declared?.age ?? null,
        status: p.status as 'confirmed' | 'proposed',
        when: { startUtc: slot.start, local: formatLocal(new Date(slot.start), slot.timezone), timezone: slot.timezone, kind: slot.kind },
        where: { city: slot.city, place: p.place },
        why: explainWhy(t, prefs, scoredCount, p),
        alternatives: p.status === 'proposed' ? p.slots.slice(1).map((s) => formatLocal(new Date(s.start), s.timezone)) : [],
        travelNote: slot.confidence === 'tentative' ? `Your trip to ${slot.city} is not booked yet (${shortRange(slot.stay.from, slot.stay.to)}). This date holds only if the flight does.` : undefined,
      };
    });

  const pending: PendingItem[] = [];
  const gate = tracked
    .filter((t) => t.status === 'pending')
    .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0) || a.candidate.id.localeCompare(b.candidate.id));
  if (gate.length) pending.push({ kind: 'gate', text: `${gate.length} ${gate.length === 1 ? 'person is' : 'people are'} waiting at the gate for your yes or no.` });
  for (const d of input.pendingDrafts ?? []) {
    pending.push({ kind: 'draft', candidateId: undefined, text: `Draft to ${d.candidateName} is waiting for you to read it and press send${d.language ? ` (${d.language})` : ''}${d.citation ? `, built on: ${d.citation}` : ''}.` });
  }
  const waiting = plans.filter((x) => x.status === 'proposed');
  if (waiting.length) {
    pending.push({ kind: 'awaiting-reply', text: `${waiting.length} proposal${waiting.length === 1 ? ' is' : 's are'} out and waiting on a reply (${waiting.map((p) => `${p.name}, ${p.city}`).join('; ')}). The held slots lapse on their own if nobody answers.` });
  }
  for (const d of dates.filter((x) => x.travelNote)) pending.push({ kind: 'travel', candidateId: d.candidateId, text: `${d.name} in ${d.where.city}: ${d.travelNote}` });

  const surfaced = tracked.filter((t) => t.status !== 'dropped' && t.score && t.rank !== undefined);
  const cutoffScore = surfaced.length ? Math.min(...surfaced.map((t) => t.score!.score)) : undefined;
  const leastSure: DroppedNote[] = tracked
    .filter((t) => t.status === 'dropped' && !t.overturned && t.drop)
    .map((t) => ({ t, ...dropConfidence(t, prefs, itinerary, today, cutoffScore) }))
    .sort((a, b) => a.confidence - b.confidence || a.t.candidate.id.localeCompare(b.t.candidate.id))
    .slice(0, input.maxDrops ?? 3)
    .map(({ t, confidence, whyUnsure }) => ({
      candidateId: t.candidate.id,
      name: t.candidate.displayName,
      rule: t.drop!.rule,
      reason: t.drop!.reason,
      confidence,
      whyUnsure,
      undo: `POST /candidates/${t.candidate.id}/overturn`,
    }));

  return {
    weekOf: monday,
    generatedAt: now.toISOString(),
    dates,
    pending,
    atTheGate: gate.slice(0, 4).map((t) => ({ candidateId: t.candidate.id, name: t.candidate.displayName, rank: t.rank ?? null, why: explainWhy(t, prefs, scoredCount) })),
    leastSure,
    basis:
      'Built from the ranking, the declared profiles, the calendar and the audit log. Confidence on a dropped candidate is distance from the boundary she was dropped at, not a probability.',
  };
}
