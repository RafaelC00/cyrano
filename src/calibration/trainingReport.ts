import type { Preferences } from '../agent/preferences.ts';
import type { Candidate } from '../domain/types.ts';
import { StatedMobilityScorer } from '../scoring/learned.ts';
import { lifeOf } from '../scoring/life.ts';
import type { Divergence } from './divergence.ts';
import type { aggregate, Summary, Trial } from './evaluate.ts';
import type { Label } from './latent.ts';
import { calibrationBins, confidentMisses } from './report.ts';
import type { Recovery } from './report.ts';

/**
 * The machine-readable form of the calibration result, written by `npm run calibrate` to
 * `data/calibration/report.json` and `comparisons.json` and served by the agent as
 * `/model/report` and `/model/comparisons`. Every number in it is copied from the same run that
 * writes EVAL.md; nothing here is computed at request time and nothing is hand-edited.
 */

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

export interface TrainingReport {
  /** Always true here: Eric, his labels and the pool are all generated. */
  synthetic: true;
  setup: {
    trials: number;
    trainLabels: number;
    testLabels: number;
    pool: { generated: number; eligible: number };
    lapseRate: number;
    idiosyncrasySd: number;
    /** The headline split is the one whose model ships in model.json. */
    headline: { seed: number; trainPeople: number; testPeople: number };
  };
  scorers: Array<{ key: 'learned' | 'stated' | 'mobility' | 'oracle'; name: string; accuracy: Interval; correlation: Interval; top10: Interval }>;
  /** Learned minus stated-preference-v1 on held-out label accuracy, with the count of trials won. */
  gain: Interval & { wins: number; of: number };
  stress: { learnedAccuracy: Interval; statedAccuracy: Interval; oracleAccuracy: Interval };
  finding: { title: string; evidence: string };
  features: Array<{
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
  }>;
  recovery: { cosine: number; signsRight: number; signsOf: number; spurious: number; top5Overlap: number };
  curve: Array<{ n: number; learned: Interval; baseline: Interval }>;
  calibration: { ece: number; bins: Array<{ predicted: number; observed: number; n: number }> };
  misses: Array<{ preferred: PersonSummary; picked: PersonSummary; margin: number }>;
  confident: { n: number; wrong: number };
  /** The visual features rest on these: portraits in the library, and distinct ones the calibration pool draws on. */
  portraits: { library: number; inCalibrationPool: number };
}

export interface Comparison {
  a: string;
  b: string;
  chosen: 'a' | 'b';
  /** Which of the two fits "mobile and unanchored" better by the literal reading, or null if tied. */
  fitsPitch: 'a' | 'b' | null;
}

export interface Comparisons {
  total: number;
  people: Record<string, PersonSummary>;
  items: Comparison[];
}

const iv = (s: Summary): Interval => ({ mean: s.mean, lo: s.lo, hi: s.hi });

export function summarisePerson(c: Candidate): PersonSummary {
  const l = lifeOf(c);
  return {
    id: c.id,
    name: c.displayName,
    age: c.declared.age,
    city: c.declared.city,
    job: l.occupation.title,
    yearsInCity: l.yearsInCity,
    nightsAwayPerMonth: l.nightsAwayPerMonth,
    hasPractice: l.hasPhysicalPractice,
  };
}

export function buildComparisons(people: Candidate[], labels: Label[], prefs: Preferences): Comparisons {
  const byId = new Map(people.map((c) => [c.id, c]));
  const pitch = new StatedMobilityScorer();
  const used = new Set<string>();
  const items = labels.map((l): Comparison => {
    used.add(l.a);
    used.add(l.b);
    const sa = pitch.score(byId.get(l.a)!, prefs).score;
    const sb = pitch.score(byId.get(l.b)!, prefs).score;
    return { a: l.a, b: l.b, chosen: l.chosen === l.a ? 'a' : 'b', fitsPitch: sa === sb ? null : sa > sb ? 'a' : 'b' };
  });
  return { total: items.length, people: Object.fromEntries([...used].map((id) => [id, summarisePerson(byId.get(id)!)])), items };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export interface TrainingInputs {
  linear: ReturnType<typeof aggregate>;
  nonlinear: ReturnType<typeof aggregate>;
  headline: Trial;
  rec: Recovery;
  divergence: Divergence;
  curve: Array<{ n: number; learned: Summary; baseline: Summary }>;
  pooled: Trial[];
  pool: { generated: number; eligible: number };
  lapse: number;
  idiosyncrasySd: number;
  claims: ReadonlyArray<{ feature: string; expected: 1 | -1 }>;
  trialsLabels: { train: number; test: number };
  portraits: { library: number; inCalibrationPool: number };
}

export function buildTrainingReport(i: TrainingInputs): TrainingReport {
  const t = i.linear.table;
  const row = (key: TrainingReport['scorers'][number]['key'], name: string, k: 'learned' | 'statedBaseline' | 'statedMobility' | 'oracle') => ({
    key,
    name,
    accuracy: iv(t[k].labelAccuracy),
    correlation: iv(t[k].spearman),
    top10: iv(t[k].precisionAtTop10pct),
  });
  const gain = i.linear.diff.statedBaseline.labelAccuracy;
  const said = new Map(i.claims.map((c) => [c.feature, c.expected]));
  const latent = new Map(i.rec.rows.map((r) => [r.feature, r.latent]));
  const h = i.divergence.headline;
  const people = new Map(i.headline.testPeople.map((c) => [c.id, c]));
  const cal = calibrationBins(i.pooled);
  const all = i.pooled.flatMap((p) => p.predictions);
  const confident = all.filter((p) => Math.abs(p.margin) >= 2);

  return {
    synthetic: true,
    setup: {
      trials: i.linear.trials,
      trainLabels: i.trialsLabels.train,
      testLabels: i.trialsLabels.test,
      pool: i.pool,
      lapseRate: i.lapse,
      idiosyncrasySd: i.idiosyncrasySd,
      headline: { seed: i.headline.seed, trainPeople: i.headline.split.train, testPeople: i.headline.split.test },
    },
    scorers: [
      row('learned', 'learned (pairwise logistic)', 'learned'),
      row('stated', 'stated-preference-v1', 'statedBaseline'),
      row('mobility', 'stated-mobility-v1', 'statedMobility'),
      row('oracle', 'the latent function itself', 'oracle'),
    ],
    gain: { ...iv(gain), wins: gain.learnedWins, of: i.linear.trials },
    stress: {
      learnedAccuracy: iv(i.nonlinear.table.learned.labelAccuracy),
      statedAccuracy: iv(i.nonlinear.table.statedBaseline.labelAccuracy),
      oracleAccuracy: iv(i.nonlinear.table.oracle.labelAccuracy),
    },
    finding: {
      title: 'He asked for someone unanchored. He keeps picking people with roots.',
      evidence: `In the ${h.n} comparisons where one person fitted "mobile and unanchored" clearly better than the other, he picked the better fit ${pct(h.rate)} of the time (${h.pickedStatedBetter} of ${h.n}; 95% interval ${pct(h.lo)} to ${pct(h.hi)}). Chance is 50%. The labels were generated from a function written to do exactly this, so the finding checks the method; it says nothing about a real person.`,
    },
    features: i.divergence.features.map((f) => ({
      key: f.feature,
      group: f.group,
      said: said.get(f.feature) ?? null,
      weight: f.weight,
      lo: f.ci.lo,
      hi: f.ci.hi,
      built: latent.get(f.feature) ?? 0,
      verdict: f.verdict,
      phrase: f.weight > 0 ? f.highPhrase : f.lowPhrase,
    })),
    recovery: { cosine: i.rec.cosine, signsRight: i.rec.signAgreement.ok, signsOf: i.rec.signAgreement.of, spurious: i.rec.spuriousCount, top5Overlap: i.rec.top5.overlap },
    curve: i.curve.map((c) => ({ n: c.n, learned: iv(c.learned), baseline: iv(c.baseline) })),
    calibration: { ece: cal.ece, bins: cal.bins.map((b) => ({ predicted: b.predicted, observed: b.observed, n: b.n })) },
    misses: confidentMisses(i.headline)
      .slice(0, 5)
      .map((m) => ({ preferred: summarisePerson(people.get(m.preferred)!), picked: summarisePerson(people.get(m.picked)!), margin: m.margin })),
    confident: { n: confident.length, wrong: confident.filter((p) => (p.margin > 0 ? 1 : 0) !== p.y).length },
    portraits: i.portraits,
  };
}
