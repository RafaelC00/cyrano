/**
 * What the agent serves beyond the funnel: the learned model's result, drafts' provenance,
 * the calendar and the weekly brief. The types here mirror the backend's `src/agent/views.ts`
 * and `src/calibration/trainingReport.ts`; if one changes, change the other with it.
 *
 * Everything is read live from the agent. There are no local fixtures: if the agent is down the
 * screen says so.
 */

import { AGENT_BASE, ApiError, call } from './api/phase1.ts';

/** Paths relative to the agent API. */
export const ENDPOINTS = {
  modelReport: '/model/report', //                  GET -> ModelReport
  comparisons: '/model/comparisons', //             GET ?offset=&n=&against=1 -> ComparisonPage
  learnedScores: '/scores', //                      GET ?ids=a,b,c -> LearnedScore[]
  draftMeta: (draftId: string) => `/drafts/${draftId}/meta`, //   GET -> DraftMeta (404 for a hand-written draft)
  calendar: '/calendar', //                         GET -> CalendarState
  calendarConfirm: (id: string) => `/calendar/${id}/confirm`, //  POST -> CalendarState   (a person says she agreed)
  calendarMove: (id: string) => `/calendar/${id}/move`, //        POST {start: "2026-10-15T20:00"} -> CalendarState
  calendarDrop: (id: string) => `/calendar/${id}/drop`, //        POST -> CalendarState   (gives every hold back)
  calendarIcs: '/calendar.ics', //                  GET -> text/calendar
  brief: '/brief', //                               GET -> WeeklyBrief
} as const;

export const agentGet = <T>(path: string) => call<T>(AGENT_BASE, path, { headers: { Accept: 'application/json' } });
export const agentPost = <T>(path: string, body?: unknown) =>
  call<T>(AGENT_BASE, path, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

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
  /** Largest signed contributions to the learned score, in plain words. */
  factors: Array<{ label: string; contribution: number }>;
}

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

export interface PersonSummary {
  id: string;
  name: string;
  age: number;
  city: string;
  job: string;
  yearsInCity: number;
  nightsAwayPerMonth: number;
  hasPractice: boolean;
}

export interface FeatureWeight {
  key: string;
  group: string;
  /** What his own words imply: 1 more, -1 less, null if he said nothing about it. */
  said: 1 | -1 | null;
  /** Learned weight, logits per standard deviation of the feature, with a 90% interval. */
  weight: number;
  lo: number;
  hi: number;
  /** The weight the labels were generated from, in the same units. Known only because we wrote it. */
  built: number;
  verdict: string;
  phrase: string;
}

/** Held-out result of `npm run calibrate`, served as written. Every person in it is generated. */
export interface ModelReport {
  synthetic: true;
  setup: {
    trials: number;
    trainLabels: number;
    testLabels: number;
    pool: { generated: number; eligible: number };
    lapseRate: number;
    idiosyncrasySd: number;
    headline: { seed: number; trainPeople: number; testPeople: number };
  };
  scorers: Array<{ key: 'learned' | 'stated' | 'mobility' | 'oracle'; name: string; accuracy: Interval; correlation: Interval; top10: Interval }>;
  gain: Interval & { wins: number; of: number };
  stress: { learnedAccuracy: Interval; statedAccuracy: Interval; oracleAccuracy: Interval };
  finding: { title: string; evidence: string };
  features: FeatureWeight[];
  recovery: { cosine: number; signsRight: number; signsOf: number; spurious: number; top5Overlap: number };
  curve: Array<{ n: number; learned: Interval; baseline: Interval }>;
  calibration: { ece: number; bins: Array<{ predicted: number; observed: number; n: number }> };
  misses: Array<{ preferred: PersonSummary; picked: PersonSummary; margin: number }>;
  confident: { n: number; wrong: number };
  portraits: { library: number; inCalibrationPool: number };
}

export interface ComparisonPage {
  /** Comparisons matching the filter. */
  total: number;
  /** All of Eric's comparisons. */
  of: number;
  offset: number;
  items: Array<{ a: string; b: string; chosen: 'a' | 'b'; fitsPitch: 'a' | 'b' | null }>;
  people: Record<string, PersonSummary>;
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
  /** The prohibited-content rules this text passed. */
  voiceChecks: Array<{ rule: string; ok: boolean }>;
  /** Earlier texts the checker refused before this one passed. */
  rejectedAttempts: Array<{ rule: string; reason: string }>;
  /** Every place and date the text implies he will be. */
  claims: string[];
  generator: string;
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
  /** Null until the two of them have agreed a place. */
  venue: string | null;
  kind: 'coffee' | 'drinks' | 'dinner';
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
  when: string; // ISO date-time, local to `city`
  where: string;
  city: string;
  why: string;
  evidence: string[];
  status: 'confirmed' | 'proposed';
  alsoOffered: string[];
  travelNote: string | null;
}

export interface WeeklyBrief {
  weekOf: string; // ISO date, a Monday
  summary: string;
  entries: BriefEntry[];
  pending: Array<{ kind: string; text: string }>;
  atTheGate: Array<{ candidateId: string; name: string; rank: number | null; why: string }>;
  /** Dropped people the system is least sure about, so a person can look first. */
  leastSure: Array<{ candidateId: string; name: string; rule: string; reason: string; confidence: number; whyUnsure: string }>;
  basis: string;
}

export { ApiError };
