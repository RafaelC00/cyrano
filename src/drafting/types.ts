import type { Itinerary } from '../calendar/itinerary.ts';
import type { Slot } from '../calendar/types.ts';
import type { Lang } from '../calendar/time.ts';
import type { Candidate, ThreadMessage } from '../domain/types.ts';

export type DraftLang = Lang;

/** opener: first message. follow-up: after she replied. reschedule: move a date already arranged. */
export type DraftKind = 'opener' | 'follow-up' | 'reschedule';

/**
 * The profile detail (or, for non-openers, the calendar fact) a draft was built from. The UI
 * shows this next to the text, and the checker verifies it: the cited value must really be in
 * the profile and the draft must really contain it.
 */
export interface Citation {
  field: 'interests' | 'prompts' | 'city' | 'languages' | 'slot';
  /** Where it lives, e.g. `declared.interests[2]`, `declared.prompts[1]`. */
  path: string;
  /** The raw declared values, as the profile has them. */
  value: string[];
  /** Strings that must appear in the draft body, as rendered in the draft's language. */
  rendered: string[];
  /** One line for a person: what was used. */
  summary: string;
}

/** "Eric is in `city` from `from` to `to`", as the draft implies it. Verified against the itinerary. */
export interface PresenceClaim {
  city: string;
  from: string;
  to: string;
  /** The stay behind it is not booked yet (more than a week out). */
  tentative: boolean;
}

export interface GeneratedDraft {
  kind: DraftKind;
  body: string;
  language: DraftLang;
  citation: Citation;
  /** Every place and date the text implies Eric will be. */
  claims: PresenceClaim[];
  /** Slots the text proposes, so the calendar and the message agree. */
  slotIds: string[];
  /** Deliberate imperfections (Dutch only). Reported, never hidden. */
  slips: number;
  generator: string;
}

export interface DraftContext {
  kind: DraftKind;
  candidate: Candidate;
  now: Date;
  itinerary: Itinerary;
  /** Slots proposed in her city: the dates an opener offers, or the date a follow-up refers to. */
  slots: readonly Slot[];
  /** For a reschedule: the arranged date being moved. */
  previous?: Slot;
  /** The match thread so far. Decides whether any message may be sent at all. */
  thread: readonly ThreadMessage[];
  /** Asking for "another one" changes this; the same inputs otherwise give the same draft. */
  variant?: number;
}

export interface GenerationRefusal {
  refused: true;
  reason: 'no_overlap' | 'no_detail' | 'needs_slot';
  message: string;
}

/**
 * The seam for any text source. The default is the free template engine. A model-backed
 * generator would implement this and nothing else: its output goes through the same checker and
 * the same outbox, and it can never be the only line of defence.
 */
export interface DraftGenerator {
  readonly name: string;
  generate(ctx: DraftContext, attempt: number): GeneratedDraft | GenerationRefusal | Promise<GeneratedDraft | GenerationRefusal>;
}

export type RuleId =
  | 'appearance'
  | 'false-location'
  | 'implied-commitment'
  | 'second-message'
  | 'citation'
  | 'register-greeting'
  | 'register-small-talk'
  | 'register-pet-name'
  | 'register-length';

export interface Rejection {
  rule: RuleId;
  /** Plain statement of what is wrong, safe to show a person. */
  reason: string;
  /** The words that triggered it, or empty when the problem is structural. */
  excerpt: string;
}

export type CheckResult =
  | { ok: true; checked: RuleId[] }
  | { ok: false; rejection: Rejection; all: Rejection[] };

/** One failed attempt, kept so "why did it take three tries" has an answer. */
export interface Attempt {
  attempt: number;
  body: string;
  rejection: Rejection;
}
