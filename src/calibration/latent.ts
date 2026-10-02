import type { Candidate } from '../domain/types.ts';
import type { Preferences } from '../agent/preferences.ts';
import { hashString, mulberry32 } from '../platform/rng.ts';
import type { Rng } from '../platform/rng.ts';
import { FEATURES, inputsFor } from '../scoring/features.ts';
import { identityKey } from '../vision/library.ts';

/**
 * ERIC'S LATENT PREFERENCE FUNCTION. GROUND TRUTH. THE MODEL NEVER SEES THIS FILE.
 *
 * Eric says he wants someone as mobile and unanchored as he is. This function, which generates
 * his comparison labels, says the opposite: he reliably prefers ROOTED people. A settled city,
 * a craft or practice with a physical location, long tenure, long friendships, and work that
 * cannot be done from an airport lounge all raise a person's utility; being away many nights a
 * month lowers it.
 *
 * This contradiction is the experiment's design, not a discovery. We wrote Eric, so the honest
 * claim is narrow: given labels from a known function that contradicts the stated profile, does
 * the method recover that function from the labels alone, and report the gap legibly?
 *
 * Guardrail: nothing under src/scoring imports this file (a test enforces it). The learner gets
 * feature vectors and (winner, loser) pairs and nothing else. This file and the evaluation that
 * grades the model against it are the only readers.
 *
 * Units: weights are per RAW unit of each feature (per year, per night, per 0..1 fraction).
 */
export const LATENT_WEIGHTS: Readonly<Record<string, number>> = {
  // rooted: the part that contradicts what he says
  years_in_city: 0.12,
  job_tenure_years: 0.1,
  physical_practice: 1.0,
  work_needs_a_place: 1.3,
  old_local_friendships: 0.06,
  nights_away_per_month: -0.07,
  // ordinary stated tastes, small
  interest_overlap: 2.0,
  // a taste about the photograph, not the person: candid and well lit
  photo_candid: 0.4,
  photo_well_lit: 0.3,
};

/** Standard deviation of Eric's idiosyncratic taste for particular individuals. No model can learn it. */
export const IDIOSYNCRASY_SD = 0.6;
/** Probability that a label is a lapse: a coin flip instead of a considered choice. */
export const LAPSE_RATE = 0.05;

function normal(rng: Rng): number {
  const u = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/**
 * `linear` is the main latent function above. `nonlinear` is a stress test of the same
 * preference (rooted is better) in a shape a linear model cannot represent exactly: saturating
 * curves, thresholds and an interaction. It exists to check the result does not hinge on the
 * model class happening to match the generator.
 */
export type LatentVariant = 'linear' | 'nonlinear';

/** The systematic part of utility: the part a model could in principle learn. */
export function latentSignal(c: Candidate, prefs: Preferences, variant: LatentVariant = 'linear'): number {
  const inputs = inputsFor(c, prefs);
  const val = (name: string) => {
    const f = FEATURES.find((x) => x.name === name)!;
    const x = f.value(inputs);
    return Number.isNaN(x) ? 0 : x;
  };
  if (variant === 'nonlinear') {
    const place = val('work_needs_a_place');
    return (
      2.0 * (1 - Math.exp(-val('years_in_city') / 6)) +
      1.0 * (val('job_tenure_years') >= 4 ? 1 : 0) +
      1.6 * val('physical_practice') * place +
      0.5 * place +
      1.2 * (1 - Math.exp(-val('old_local_friendships') / 8)) -
      Math.min(2.5, 0.15 * Math.max(0, val('nights_away_per_month') - 3)) +
      LATENT_WEIGHTS.interest_overlap! * val('interest_overlap') +
      LATENT_WEIGHTS.photo_candid! * val('photo_candid') +
      LATENT_WEIGHTS.photo_well_lit! * val('photo_well_lit')
    );
  }
  let u = 0;
  for (const [name, a] of Object.entries(LATENT_WEIGHTS)) u += a * val(name);
  return u;
}

/** Fixed per-person idiosyncratic term. Deterministic in the profile identity. */
export function idiosyncrasy(c: Candidate): number {
  return IDIOSYNCRASY_SD * normal(mulberry32(hashString(`idio|${identityKey(c)}`)));
}

/** Full latent utility: signal plus idiosyncrasy. */
export function latentUtility(c: Candidate, prefs: Preferences, variant: LatentVariant = 'linear'): number {
  return latentSignal(c, prefs, variant) + idiosyncrasy(c);
}

export interface Label {
  a: string;
  b: string;
  /** Candidate id Eric picked. */
  chosen: string;
}

/**
 * One sitting: `n` random pairs from `pool`, each decided by a Bradley-Terry choice on the latent
 * utility (logistic noise, so near-ties are close to coin flips), except that `LAPSE_RATE` of
 * labels are pure coin flips (a tired thumb).
 */
export function generateLabels(pool: Candidate[], prefs: Preferences, n: number, rng: Rng, variant: LatentVariant = 'linear'): Label[] {
  const util = new Map(pool.map((c) => [c.id, latentUtility(c, prefs, variant)]));
  const labels: Label[] = [];
  const seen = new Set<string>();
  while (labels.length < n) {
    const i = Math.floor(rng() * pool.length);
    const j = Math.floor(rng() * pool.length);
    if (i === j) continue;
    const [a, b] = [pool[i]!, pool[j]!];
    const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const pA = rng() < LAPSE_RATE ? 0.5 : 1 / (1 + Math.exp(-(util.get(a.id)! - util.get(b.id)!)));
    labels.push({ a: a.id, b: b.id, chosen: rng() < pA ? a.id : b.id });
  }
  return labels;
}
