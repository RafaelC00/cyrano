/**
 * THE SEAM.
 *
 * Phase 1 (platform, funnel, audit, reversal, outbox) is real and lives in `api/phase1.ts`.
 * Two further services are being built on other branches and are not merged yet:
 *
 *   - scoring and preference learning   (training labels, learned scores, the model report)
 *   - drafting and scheduling           (draft metadata, calendar, weekly brief)
 *
 * Everything this UI needs from them is declared in this one file: the types, the endpoint
 * paths we expect, and `fromSeam`, which asks the agent for the live endpoint and falls back to
 * a local fixture (`fixtures.ts`) when the agent does not serve it yet. Each result carries its
 * `source`, and the UI shows a "fixture" badge wherever data did not come from the backend.
 *
 * When a branch merges: check its response shape against the type below, adjust here if it
 * differs, and the screen switches from fixture to live with no other change.
 */

import { AGENT_BASE, ApiError } from './api/phase1.ts';

export type Source = 'live' | 'fixture';
export interface Sourced<T> {
  data: T;
  source: Source;
}

/** Paths relative to the agent API. Expected shapes are the types below. */
export const ENDPOINTS = {
  // scoring and preference learning
  modelReport: '/model/report', //                  GET   -> ModelReport
  trainingNext: '/training/next', //                GET   ?mode=pair|rating&n=  -> TrainingItem[]
  trainingLabels: '/training/labels', //            GET   -> LabelSummary      POST Label -> LabelSummary
  learnedScores: '/scores', //                      GET   ?ids=a,b,c -> LearnedScore[]
  // drafting and scheduling
  draftMeta: (draftId: string) => `/drafts/${draftId}/meta`, //   GET -> DraftMeta
  calendar: '/calendar', //                         GET   -> CalendarState
  calendarMove: (id: string) => `/calendar/${id}/move`, //        POST {start} -> DateProposal
  calendarConfirm: (id: string) => `/calendar/${id}/confirm`, //  POST -> DateProposal   (human action)
  calendarIcs: '/calendar.ics', //                  GET   -> text/calendar
  brief: '/brief', //                               GET   -> WeeklyBrief
} as const;

/** A person as the screens need them. `photoRef` is a platform photo reference, or null. */
export interface PersonRef {
  id: string;
  displayName: string;
  age: number;
  city: string;
  photoRef: string | null;
}

// ---------------------------------------------------------------------------------------------
// Scoring and preference learning
// ---------------------------------------------------------------------------------------------

export interface LearnedScore {
  candidateId: string;
  /** 0..1, from the learned model. */
  learned: number;
  /** 0..1, from the stated-preference baseline, for comparison. */
  stated: number;
  /** Largest signed contributions, in plain words. */
  factors: Array<{ label: string; contribution: number }>;
}

export type TrainingItem =
  | { kind: 'pair'; id: string; a: PersonRef; b: PersonRef }
  | { kind: 'rating'; id: string; person: PersonRef };

export type Label =
  | { itemId: string; kind: 'pair'; choice: 'a' | 'b' | 'neither'; at: string }
  | { itemId: string; kind: 'rating'; rating: 1 | 2 | 3 | 4 | 5; at: string };

export interface LabelSummary {
  count: number;
  target: number;
}

export interface FeatureWeight {
  key: string;
  label: string;
  /** What the stated profile implies, -1..1. */
  stated: number;
  /** What the labels imply, -1..1, with an interval that narrows as labels accumulate. */
  learned: number;
  low: number;
  high: number;
}

export interface Disagreement {
  person: PersonRef;
  kind: 'model-higher' | 'model-lower';
  statedRank: number;
  learnedRank: number;
  because: string;
}

export interface ModelReport {
  labels: LabelSummary;
  /** Held-out accuracy of the learned model against the stated-preference baseline. */
  heldOut: { n: number; learned: number; stated: number } | null;
  /** The headline finding, written so a person can disagree with it. */
  finding: { title: string; evidence: string } | null;
  features: FeatureWeight[];
  disagreements: Disagreement[];
  /** Reliability curve: when the model said p, how often did you agree. */
  calibration: Array<{ predicted: number; observed: number; n: number }>;
  note: string;
}

// ---------------------------------------------------------------------------------------------
// Drafting and scheduling
// ---------------------------------------------------------------------------------------------

export type Lang = 'en' | 'de' | 'es' | 'nl';

export interface DraftMeta {
  draftId: string;
  language: Lang;
  languageReason: string;
  /** The profile detail the opener is built on. */
  detail: { field: string; value: string } | null;
  /** Which voice rules the draft was checked against. */
  voiceChecks: Array<{ rule: string; ok: boolean }>;
}

export interface Stay {
  city: string;
  from: string; // ISO date
  to: string; // ISO date, exclusive
}

export type ProposalStatus = 'proposed' | 'confirmed' | 'declined';

export interface DateProposal {
  id: string;
  person: PersonRef;
  start: string; // ISO date-time, local to `city`
  end: string;
  city: string;
  venue: string;
  kind: 'coffee' | 'drink' | 'dinner';
  status: ProposalStatus;
  /** Why this slot: the constraint it satisfies. */
  reason: string;
}

export interface CalendarState {
  today: string; // ISO date
  stays: Stay[];
  proposals: DateProposal[];
}

export interface BriefEntry {
  proposalId: string | null;
  person: PersonRef;
  when: string; // ISO date-time
  where: string;
  city: string;
  why: string;
}

export interface WeeklyBrief {
  weekOf: string; // ISO date, a Monday
  summary: string;
  entries: BriefEntry[];
}

// ---------------------------------------------------------------------------------------------
// Live-or-fixture
// ---------------------------------------------------------------------------------------------

/** Ask the agent for `path`; if it is not served (or the agent is down), use the fixture. */
export async function fromSeam<T>(path: string, fixture: () => T | Promise<T>): Promise<Sourced<T>> {
  try {
    const res = await fetch(AGENT_BASE + path, { headers: { Accept: 'application/json' } });
    const type = res.headers.get('content-type') ?? '';
    if (res.ok && type.includes('application/json')) return { data: (await res.json()) as T, source: 'live' };
  } catch {
    // fall through to the fixture
  }
  return { data: await fixture(), source: 'fixture' };
}

/** POST to the agent; if it is not served, run the local fixture instead. */
export async function postSeam<T>(path: string, body: unknown, fixture: () => T): Promise<Sourced<T>> {
  try {
    const res = await fetch(AGENT_BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) return { data: (await res.json()) as T, source: 'live' };
  } catch {
    // fall through to the fixture
  }
  return { data: fixture(), source: 'fixture' };
}

export { ApiError };
