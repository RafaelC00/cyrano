/**
 * A pairwise-preference model: Bradley-Terry with a linear utility, fitted as a logistic
 * regression on feature DIFFERENCES.
 *
 *   P(a is preferred to b) = sigmoid( w . (x_a - x_b) )
 *
 * Chosen because it is the simplest model that fits comparison labels, it is convex (one global
 * optimum, no seeds to tune), and the weights ARE the explanation: each is "how much this
 * feature moves the logit of being picked", in standard-deviation units of the feature.
 *
 * This file knows nothing about how labels were produced. It receives candidate feature vectors
 * and (winner, loser) pairs, and nothing else.
 */

export interface Comparison {
  /** Index into the feature matrix of the preferred item. */
  winner: number;
  /** Index into the feature matrix of the other item. */
  loser: number;
}

export interface PairwiseModel {
  featureNames: string[];
  /** Per-feature training mean and standard deviation, used to standardise at scoring time. */
  mean: number[];
  std: number[];
  /** Weights over standardised features. */
  weights: number[];
  l2: number;
  trainedOn: { comparisons: number; items: number };
}

const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/** Column means and standard deviations, ignoring NaN (unobserved). A constant column gets std 1. */
export function columnStats(X: number[][]): { mean: number[]; std: number[] } {
  const d = X[0]?.length ?? 0;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let n = 0;
    let s = 0;
    for (const r of X) if (!Number.isNaN(r[j]!)) (s += r[j]!), n++;
    const m = n ? s / n : 0;
    let ss = 0;
    for (const r of X) if (!Number.isNaN(r[j]!)) ss += (r[j]! - m) ** 2;
    const sd = n > 1 ? Math.sqrt(ss / (n - 1)) : 0;
    mean[j] = m;
    std[j] = sd > 1e-9 ? sd : 1;
  }
  return { mean, std };
}

/** Standardise one vector. Unobserved values become 0, which is the training mean. */
export function standardise(x: number[], mean: number[], std: number[]): number[] {
  return x.map((val, j) => (Number.isNaN(val) ? 0 : (val - mean[j]!) / std[j]!));
}

/** Solve A x = b by Gaussian elimination with partial pivoting. A is small (features x features). */
function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    const piv = M[c]![c]!;
    if (Math.abs(piv) < 1e-12) throw new Error('singular system in pairwise fit');
    for (let r = c + 1; r < n; r++) {
      const f = M[r]![c]! / piv;
      for (let k = c; k <= n; k++) M[r]![k]! -= f * M[c]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r]![n]!;
    for (let k = r + 1; k < n; k++) s -= M[r]![k]! * x[k]!;
    x[r] = s / M[r]![r]!;
  }
  return x;
}

/** Newton's method (IRLS) on the L2-penalised logistic loss over standardised difference vectors. */
function fitWeights(Z: number[][], pairs: Comparison[], l2: number): number[] {
  const d = Z[0]!.length;
  const diffs = pairs.map((p) => Z[p.winner]!.map((v, j) => v - Z[p.loser]![j]!));
  let w = new Array<number>(d).fill(0);
  for (let iter = 0; iter < 50; iter++) {
    const g = w.map((wj) => l2 * wj);
    const H = Array.from({ length: d }, (_, i) => Array.from({ length: d }, (_, j) => (i === j ? l2 : 0)));
    for (const x of diffs) {
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j]! * x[j]!;
      const p = sigmoid(z); // P(winner wins) under the current weights; every label has the winner first
      const s = p * (1 - p);
      for (let i = 0; i < d; i++) {
        g[i]! -= (1 - p) * x[i]!;
        for (let j = 0; j < d; j++) H[i]![j]! += s * x[i]! * x[j]!;
      }
    }
    const step = solve(H, g);
    w = w.map((wj, j) => wj - step[j]!);
    if (Math.sqrt(step.reduce((a, b) => a + b * b, 0)) < 1e-8) break;
  }
  return w;
}

/** Mean negative log likelihood of the comparisons under weights w (for choosing the penalty). */
function nll(Z: number[][], pairs: Comparison[], w: number[]): number {
  let s = 0;
  for (const p of pairs) {
    let z = 0;
    for (let j = 0; j < w.length; j++) z += w[j]! * (Z[p.winner]![j]! - Z[p.loser]![j]!);
    s += Math.log1p(Math.exp(-z));
  }
  return s / Math.max(1, pairs.length);
}

export interface FitOptions {
  /** Candidate L2 penalties; the one with the best cross-validated log loss wins. */
  l2Grid?: number[];
  folds?: number;
  /** Fixed penalty, skipping the search (used inside bootstrap loops). */
  l2?: number;
  /** Fixed standardisation, so bootstrap refits stay in the same units as the original fit. */
  standardisation?: { mean: number[]; std: number[] };
}

/**
 * Fits the model. `X` holds one raw feature vector per item; `pairs` index into it. The penalty is
 * chosen by k-fold cross-validation over the comparisons, then the model is refit on all of them.
 */
export function fitPairwise(featureNames: string[], X: number[][], pairs: Comparison[], opts: FitOptions = {}): PairwiseModel {
  if (!pairs.length) throw new Error('no comparisons to fit');
  const used = [...new Set(pairs.flatMap((p) => [p.winner, p.loser]))];
  const { mean, std } = opts.standardisation ?? columnStats(used.map((i) => X[i]!));
  const Z = X.map((x) => standardise(x, mean, std));

  let l2 = opts.l2;
  if (l2 === undefined) {
    const grid = opts.l2Grid ?? [0.1, 1, 3, 10, 30, 100];
    const k = Math.min(opts.folds ?? 5, pairs.length);
    let best = Infinity;
    for (const cand of grid) {
      let total = 0;
      for (let f = 0; f < k; f++) {
        const train = pairs.filter((_, i) => i % k !== f);
        const test = pairs.filter((_, i) => i % k === f);
        total += nll(Z, test, fitWeights(Z, train, cand)) * test.length;
      }
      const loss = total / pairs.length;
      if (loss < best) (best = loss), (l2 = cand);
    }
  }
  const weights = fitWeights(Z, pairs, l2!);
  return { featureNames, mean, std, weights, l2: l2!, trainedOn: { comparisons: pairs.length, items: used.length } };
}

/** Linear utility in logit units. Higher means more preferred. */
export function utility(model: PairwiseModel, x: number[]): number {
  const z = standardise(x, model.mean, model.std);
  let u = 0;
  for (let j = 0; j < z.length; j++) u += model.weights[j]! * z[j]!;
  return u;
}

/** Per-feature contributions to the utility: weight times standardised value. */
export function contributions(model: PairwiseModel, x: number[]): number[] {
  const z = standardise(x, model.mean, model.std);
  return z.map((zj, j) => model.weights[j]! * zj);
}
