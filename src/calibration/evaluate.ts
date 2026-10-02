import type { Candidate } from '../domain/types.ts';
import type { Preferences } from '../agent/preferences.ts';
import { StatedPreferenceScorer } from '../agent/scoring.ts';
import type { Scorer } from '../agent/scoring.ts';
import { mulberry32 } from '../platform/rng.ts';
import type { Rng } from '../platform/rng.ts';
import { FEATURES, featureVector } from '../scoring/features.ts';
import { LearnedScorer, StatedMobilityScorer } from '../scoring/learned.ts';
import { fitPairwise, standardise, utility } from '../scoring/pairwise.ts';
import type { Comparison, PairwiseModel } from '../scoring/pairwise.ts';
import { generateLabels, latentSignal, latentUtility } from './latent.ts';
import type { Label, LatentVariant } from './latent.ts';

/**
 * Held-out evaluation of the learned model against the stated-preference baselines, graded
 * against the latent ground truth. This is the only code that reads both the model and the
 * latent function.
 *
 * Held out means PEOPLE, not just labels: the pool is split into training people and test people
 * before any label is drawn. Training labels compare only training people; test labels compare
 * only test people. The model never sees a test person, in any comparison.
 */

export interface Split {
  train: Candidate[];
  test: Candidate[];
}

export function splitPool(pool: Candidate[], rng: Rng, testFraction = 0.3): Split {
  const idx = pool.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  const nTest = Math.round(pool.length * testFraction);
  return { test: idx.slice(0, nTest).map((i) => pool[i]!), train: idx.slice(nTest).map((i) => pool[i]!) };
}

/** Training input: feature vectors and index pairs, built from labels alone. */
export function trainingData(people: Candidate[], labels: Label[], prefs: Preferences) {
  const index = new Map(people.map((c, i) => [c.id, i]));
  const X = people.map((c) => featureVector(c, prefs));
  const pairs: Comparison[] = labels.map((l) => {
    const w = index.get(l.chosen)!;
    const o = index.get(l.chosen === l.a ? l.b : l.a)!;
    return { winner: w, loser: o };
  });
  return { X, pairs };
}

export function trainModel(people: Candidate[], labels: Label[], prefs: Preferences): PairwiseModel {
  const { X, pairs } = trainingData(people, labels, prefs);
  return fitPairwise(FEATURES.map((f) => f.name), X, pairs);
}

export interface Metrics {
  /** Accuracy on the held-out labels (noisy: includes lapses and idiosyncrasy). */
  labelAccuracy: number;
  /** Fraction of ALL test-person pairs ordered as the latent utility orders them. */
  concordance: number;
  /** Spearman rank correlation with the latent utility across test people. */
  spearman: number;
  /** Overlap of the scorer's top 10% with the latent top 10%. */
  precisionAtTop10pct: number;
}

function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length).fill(0);
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[order[k]![1]] = avg;
    i = j + 1;
  }
  return r;
}

export function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i]! - ma) * (b[i]! - mb);
    saa += (a[i]! - ma) ** 2;
    sbb += (b[i]! - mb) ** 2;
  }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
}

export const spearman = (a: number[], b: number[]) => pearson(ranks(a), ranks(b));

export function measure(score: Map<string, number>, truth: Map<string, number>, testLabels: Label[]): Metrics {
  const ids = [...truth.keys()];
  let hit = 0;
  for (const l of testLabels) {
    const other = l.chosen === l.a ? l.b : l.a;
    const sc = score.get(l.chosen)! - score.get(other)!;
    hit += sc > 0 ? 1 : sc === 0 ? 0.5 : 0;
  }
  let conc = 0;
  let pairs = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const ds = score.get(ids[i]!)! - score.get(ids[j]!)!;
      const dt = truth.get(ids[i]!)! - truth.get(ids[j]!)!;
      pairs++;
      conc += ds === 0 ? 0.5 : (ds > 0) === (dt > 0) ? 1 : 0;
    }
  }
  const k = Math.max(1, Math.round(ids.length * 0.1));
  const top = (m: Map<string, number>) => new Set([...ids].sort((x, y) => m.get(y)! - m.get(x)! || x.localeCompare(y)).slice(0, k));
  const tl = top(truth);
  const ts = top(score);
  const overlap = [...ts].filter((id) => tl.has(id)).length / k;
  return {
    labelAccuracy: hit / testLabels.length,
    concordance: conc / pairs,
    spearman: pearson(ranks(ids.map((i) => score.get(i)!)), ranks(ids.map((i) => truth.get(i)!))),
    precisionAtTop10pct: overlap,
  };
}

export interface TrialOptions {
  seed: number;
  trainLabels: number;
  testLabels: number;
  variant?: LatentVariant;
}

export interface Trial {
  seed: number;
  split: { train: number; test: number };
  model: PairwiseModel;
  trainLabels: Label[];
  testLabels: Label[];
  learned: Metrics;
  statedBaseline: Metrics;
  statedMobility: Metrics;
  /** The latent function itself, scored against its own noisy labels: the ceiling for any model. */
  oracle: Metrics;
  /** Log loss of the learned model on held-out labels, against the oracle's. */
  logLoss: { learned: number; oracle: number };
  /** Learned model's P(a wins) for each held-out label, with the outcome. For the reliability table. */
  predictions: Array<{ p: number; y: 0 | 1; margin: number; a: string; b: string; chosen: string }>;
  testPeople: Candidate[];
}

export function runTrial(pool: Candidate[], prefs: Preferences, o: TrialOptions): Trial {
  const rng = mulberry32(o.seed);
  const variant = o.variant ?? 'linear';
  const { train, test } = splitPool(pool, rng);
  const trainLabels = generateLabels(train, prefs, o.trainLabels, rng, variant);
  const testLabels = generateLabels(test, prefs, o.testLabels, rng, variant);

  const model = trainModel(train, trainLabels, prefs);
  const learnedScorer = new LearnedScorer(model);

  const byId = new Map(test.map((c) => [c.id, c]));
  const truth = new Map(test.map((c) => [c.id, latentUtility(c, prefs, variant)]));
  const scoreWith = (s: Scorer) => new Map(test.map((c) => [c.id, (s.score(c, prefs) as { score: number }).score]));

  const logLoss = (u: (c: Candidate) => number) => {
    const um = new Map(test.map((c) => [c.id, u(c)]));
    let s = 0;
    for (const l of testLabels) {
      const other = l.chosen === l.a ? l.b : l.a;
      s += Math.log1p(Math.exp(-(um.get(l.chosen)! - um.get(other)!)));
    }
    return s / testLabels.length;
  };

  return {
    seed: o.seed,
    split: { train: train.length, test: test.length },
    model,
    trainLabels,
    testLabels,
    learned: measure(scoreWith(learnedScorer), truth, testLabels),
    statedBaseline: measure(scoreWith(new StatedPreferenceScorer()), truth, testLabels),
    statedMobility: measure(scoreWith(new StatedMobilityScorer()), truth, testLabels),
    oracle: measure(truth, truth, testLabels),
    predictions: testLabels.map((l) => {
      const ua = utility(model, featureVector(byId.get(l.a)!, prefs));
      const ub = utility(model, featureVector(byId.get(l.b)!, prefs));
      return { p: 1 / (1 + Math.exp(-(ua - ub))), y: (l.chosen === l.a ? 1 : 0) as 0 | 1, margin: ua - ub, a: l.a, b: l.b, chosen: l.chosen };
    }),
    testPeople: test,
    logLoss: {
      learned: logLoss((c) => utility(model, featureVector(c, prefs))),
      oracle: logLoss((c) => latentUtility(c, prefs, variant)),
    },
  };
}

export interface Summary {
  mean: number;
  sd: number;
  /** 95% interval of the mean across trials (normal approximation). */
  lo: number;
  hi: number;
}

export function summarise(xs: number[]): Summary {
  const n = xs.length;
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1)) : 0;
  const half = n > 1 ? (1.96 * sd) / Math.sqrt(n) : 0;
  return { mean, sd, lo: mean - half, hi: mean + half };
}

export type MetricName = keyof Metrics;
export const METRIC_NAMES: MetricName[] = ['labelAccuracy', 'concordance', 'spearman', 'precisionAtTop10pct'];
export type ScorerKey = 'learned' | 'statedBaseline' | 'statedMobility' | 'oracle';

/** Per-metric summary across trials, and the paired difference learned minus each baseline. */
export function aggregate(trials: Trial[]) {
  const by = (k: ScorerKey, m: MetricName) => trials.map((t) => t[k][m]);
  const table = {} as Record<ScorerKey, Record<MetricName, Summary>>;
  for (const k of ['learned', 'statedBaseline', 'statedMobility', 'oracle'] as ScorerKey[]) {
    table[k] = {} as Record<MetricName, Summary>;
    for (const m of METRIC_NAMES) table[k][m] = summarise(by(k, m));
  }
  const diff = {} as Record<'statedBaseline' | 'statedMobility', Record<MetricName, Summary & { learnedWins: number }>>;
  for (const base of ['statedBaseline', 'statedMobility'] as const) {
    diff[base] = {} as Record<MetricName, Summary & { learnedWins: number }>;
    for (const m of METRIC_NAMES) {
      const d = trials.map((t) => t.learned[m] - t[base][m]);
      diff[base][m] = { ...summarise(d), learnedWins: d.filter((x) => x > 0).length };
    }
  }
  return { table, diff, trials: trials.length };
}

/**
 * Intervals on each learned weight by a cluster bootstrap over PEOPLE. Labels share people (each
 * person appears in several comparisons, and each portrait on several people), so resampling
 * labels alone would give intervals that are too narrow. Here the people are resampled with
 * replacement and each comparison is repeated once per pairing of its two people's copies.
 */
export function bootstrapWeights(people: Candidate[], labels: Label[], prefs: Preferences, base: PairwiseModel, reps: number, rng: Rng) {
  const { X, pairs } = trainingData(people, labels, prefs);
  const n = people.length;
  const draws: number[][] = [];
  for (let r = 0; r < reps; r++) {
    const copies = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) copies[Math.floor(rng() * n)]!++;
    const sample: Comparison[] = [];
    for (const p of pairs) for (let k = copies[p.winner]! * copies[p.loser]!; k > 0; k--) sample.push(p);
    if (!sample.length) continue;
    draws.push(fitPairwise(base.featureNames, X, sample, { l2: base.l2, standardisation: { mean: base.mean, std: base.std } }).weights);
  }
  const m = draws.length;
  return base.featureNames.map((_, j) => {
    const col = draws.map((d) => d[j]!).sort((a, b) => a - b);
    return { lo: col[Math.floor(0.05 * (m - 1))]!, hi: col[Math.ceil(0.95 * (m - 1))]! };
  });
}

/** The latent weights expressed in the model's units: per standard deviation of each feature. */
export function latentInModelUnits(model: PairwiseModel, weights: Readonly<Record<string, number>>): number[] {
  return model.featureNames.map((n, j) => (weights[n] ?? 0) * model.std[j]!);
}

export function cosine(a: number[], b: number[]): number {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) (ab += a[i]! * b[i]!), (aa += a[i]! ** 2), (bb += b[i]! ** 2);
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

export { latentSignal, standardise };
