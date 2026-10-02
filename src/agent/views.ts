import type { PlatformAdapter } from '../adapter/types.ts';
import type { WeeklyBrief as BriefOut } from '../brief/brief.ts';
import type { Itinerary } from '../calendar/itinerary.ts';
import type { LocalCalendar } from '../calendar/local.ts';
import { addDays, weekdayName } from '../calendar/time.ts';
import type { Slot } from '../calendar/types.ts';
import type { Candidate } from '../domain/types.ts';
import { chooseLanguage, LANGUAGE_ORDER } from '../drafting/generator.ts';
import type { OfferedDraft } from '../drafting/drafter.ts';
import type { RuleId } from '../drafting/types.ts';
import type { PlannedDate, Scheduler } from '../schedule/scheduler.ts';

/**
 * The response shapes the web client declares in `web/src/contracts.ts`. They are built here from
 * the scheduler, the calendar, the brief and the drafter, so the screens read live state and
 * there is one definition of each shape. If a type below changes, change the contract with it.
 */

export interface PersonRef {
  id: string;
  displayName: string;
  age: number;
  city: string;
  photoRef: string | null;
}

export const personRef = (c: Candidate): PersonRef => ({
  id: c.id,
  displayName: c.displayName,
  age: c.declared.age,
  city: c.declared.city,
  photoRef: c.photos[0]?.photoRef ?? null,
});

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

export type ProposalStatus = 'proposed' | 'confirmed' | 'declined';

export interface DateProposal {
  /** `<candidateId>.<index of the slot in her plan>`. Stable while the plan stands. */
  id: string;
  person: PersonRef;
  /** Wall clock in `city`, no zone: `2026-10-15T20:00:00`. */
  start: string;
  end: string;
  city: string;
  /** Null until the two of them have agreed a place. */
  venue: string | null;
  kind: 'coffee' | 'drinks' | 'dinner';
  status: ProposalStatus;
  /** Why this slot, from the itinerary and his calendar. */
  reason: string;
}

export interface CalendarState {
  today: string;
  stays: Array<{ city: string; from: string; to: string }>;
  proposals: DateProposal[];
}

const localIso = (s: string) => `${s}:00`;

/** Local end time of a slot: its local start plus its duration. */
function localEnd(slot: Slot): string {
  const ms = Date.parse(slot.end) - Date.parse(slot.start);
  return new Date(Date.parse(`${slot.localStart}:00Z`) + ms).toISOString().slice(0, 19);
}

function reasonFor(slot: Slot): string {
  const stay = slot.stay;
  const day = weekdayName(slot.day, 'en');
  const clock = slot.localStart.slice(11);
  const booked = slot.confidence === 'firm' ? 'booked' : 'not booked yet, so this holds only if the flight does';
  return `${day} ${slot.kind} at ${clock}, inside his ${stay.city} stay (${stay.from} to ${stay.to}, ${booked}); clear of his sleep and of everything else on his calendar.`;
}

export const proposalId = (candidateId: string, index: number) => `${candidateId}.${index}`;

export function parseProposalId(id: string): { candidateId: string; index: number } | null {
  const m = /^(.+)\.(\d+)$/.exec(id);
  return m ? { candidateId: m[1]!, index: Number(m[2]) } : null;
}

export async function calendarState(opts: {
  now: Date;
  itinerary: Itinerary;
  calendar: LocalCalendar;
  scheduler: Scheduler;
  adapter: PlatformAdapter;
}): Promise<CalendarState> {
  const liveHolds = new Set(opts.calendar.listHolds().map((h) => h.id));
  const proposals: DateProposal[] = [];
  for (const plan of opts.scheduler.list()) {
    const person = personRef(await opts.adapter.getProfile(plan.candidateId));
    plan.slots.forEach((slot, i) => {
      const hold = plan.holds.find((h) => h.slotId === slot.id);
      let status: ProposalStatus;
      let reason = reasonFor(slot);
      if (plan.status === 'confirmed') {
        if (plan.chosen?.id !== slot.id) status = 'declined';
        else status = 'confirmed';
        if (status === 'declined') reason = `Another slot was chosen; this one was released. ${reason}`;
      } else if (plan.status === 'proposed' && hold && liveHolds.has(hold.holdId)) {
        status = 'proposed';
      } else {
        status = 'declined';
        reason = `${plan.status === 'released' ? 'Released' : 'The hold lapsed with no answer'}; the slot is free again. ${reason}`;
      }
      proposals.push({
        id: proposalId(plan.candidateId, i),
        person,
        start: localIso(slot.localStart),
        end: localEnd(slot),
        city: slot.city,
        venue: plan.status === 'confirmed' && plan.chosen?.id === slot.id ? (plan.place ?? null) : null,
        kind: slot.kind,
        status,
        reason,
      });
    });
  }
  proposals.sort((a, b) => a.start.localeCompare(b.start));
  return {
    today: opts.now.toISOString().slice(0, 10),
    stays: opts.itinerary.stays().map((s) => ({ city: s.city, from: s.from, to: addDays(s.to, 1) })),
    proposals,
  };
}

// ---------------------------------------------------------------------------------------------
// Learned scores
// ---------------------------------------------------------------------------------------------

export interface LearnedScore {
  candidateId: string;
  /** 0..1, from the learned model. */
  learned: number;
  /** 0..1, from the stated-preference baseline. */
  stated: number;
  /** Largest signed contributions to the learned score, in words. */
  factors: Array<{ label: string; contribution: number }>;
}

// ---------------------------------------------------------------------------------------------
// Draft metadata
// ---------------------------------------------------------------------------------------------

export interface DraftMeta {
  draftId: string;
  language: 'en' | 'de' | 'es' | 'nl';
  languageReason: string;
  detail: { field: string; value: string } | null;
  voiceChecks: Array<{ rule: string; ok: boolean }>;
  /** Earlier texts the checker refused before this one passed. */
  rejectedAttempts: Array<{ rule: string; reason: string }>;
  /** Every place and date the text implies he will be. */
  claims: string[];
  generator: string;
}

const LANGUAGE_NAME = { en: 'English', de: 'German', es: 'Spanish', nl: 'Dutch' } as const;

export const RULE_LABEL: Record<RuleId, string> = {
  appearance: 'Says nothing about her appearance',
  'false-location': 'Claims no place or date that his itinerary contradicts',
  'implied-commitment': 'Promises nothing and settles nothing',
  'second-message': 'Sends one message, not a run of them before she replies',
  citation: 'The profile detail it cites is really in her profile and really in the text',
  'register-greeting': 'Does not open with "hey" or any greeting',
  'register-small-talk': 'No small talk about her weekend',
  'register-pet-name': 'No pet names',
  'register-length': 'Short: two or three lines',
};

export function draftMeta(offered: OfferedDraft, candidate: Candidate): DraftMeta {
  const choice = chooseLanguage(candidate.declared.languages);
  const lang = offered.language;
  const hisOrder = LANGUAGE_ORDER.map((l) => LANGUAGE_NAME[l]).join(', ');
  const languageReason = choice.matched
    ? `Written in ${LANGUAGE_NAME[lang]}: it is the first language she lists that he writes (${hisOrder}), and the voice rules switch to hers.`
    : `Written in English: she lists none of ${hisOrder}, so English is the fallback.`;
  const c = offered.citation;
  return {
    draftId: offered.draft.id,
    language: lang,
    languageReason,
    detail: { field: c.field, value: c.summary },
    voiceChecks: offered.checked.map((r) => ({ rule: RULE_LABEL[r] ?? r, ok: true })),
    rejectedAttempts: offered.rejected.map((a) => ({ rule: RULE_LABEL[a.rejection.rule] ?? a.rejection.rule, reason: a.rejection.reason })),
    claims: offered.claims.map((x) => `In ${x.city} from ${x.from} to ${x.to}${x.tentative ? ' (not booked yet)' : ''}`),
    generator: offered.draft.generator,
  };
}

// ---------------------------------------------------------------------------------------------
// Weekly brief
// ---------------------------------------------------------------------------------------------

export interface BriefView {
  weekOf: string;
  summary: string;
  entries: Array<{ proposalId: string | null; person: PersonRef; when: string; where: string; city: string; why: string; evidence: string[]; status: 'confirmed' | 'proposed'; alsoOffered: string[]; travelNote: string | null }>;
  pending: Array<{ kind: string; text: string }>;
  atTheGate: Array<{ candidateId: string; name: string; rank: number | null; why: string }>;
  leastSure: Array<{ candidateId: string; name: string; rule: string; reason: string; confidence: number; whyUnsure: string }>;
  basis: string;
}

export async function briefView(b: BriefOut, plans: readonly PlannedDate[], adapter: PlatformAdapter): Promise<BriefView> {
  const entries: BriefView['entries'] = [];
  for (const d of b.dates) {
    const plan = plans.find((p) => p.candidateId === d.candidateId)!;
    const slot = plan.status === 'confirmed' ? plan.chosen! : plan.slots[0]!;
    const index = plan.slots.findIndex((s) => s.id === slot.id);
    entries.push({
      proposalId: proposalId(d.candidateId, index),
      person: personRef(await adapter.getProfile(d.candidateId)),
      when: localIso(slot.localStart),
      where: d.where.place ?? 'place to be agreed',
      city: d.where.city,
      why: d.why.headline,
      evidence: d.why.evidence,
      status: d.status,
      alsoOffered: d.alternatives,
      travelNote: d.travelNote ?? null,
    });
  }
  const confirmed = entries.filter((e) => e.status === 'confirmed').length;
  const cities = new Set(entries.map((e) => e.city)).size;
  const summary = entries.length
    ? `${entries.length} ${entries.length === 1 ? 'person' : 'people'} worth meeting across ${cities} ${cities === 1 ? 'city' : 'cities'}, ${confirmed} confirmed. Nothing has been sent; every opener waits in Drafts.`
    : 'Nothing is arranged yet. Run the funnel, clear the gate, and ask for an opener to put dates on the calendar.';
  return {
    weekOf: b.weekOf,
    summary,
    entries,
    pending: b.pending.map((p) => ({ kind: p.kind, text: p.text })),
    atTheGate: b.atTheGate.map((g) => ({ candidateId: g.candidateId, name: g.name, rank: g.rank, why: g.why.headline })),
    leastSure: b.leastSure.map((d) => ({ candidateId: d.candidateId, name: d.name, rule: d.rule, reason: d.reason, confidence: d.confidence, whyUnsure: d.whyUnsure })),
    basis: b.basis,
  };
}
