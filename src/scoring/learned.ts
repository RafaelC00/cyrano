import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Candidate } from '../domain/types.ts';
import type { Preferences } from '../agent/preferences.ts';
import { StatedPreferenceScorer } from '../agent/scoring.ts';
import type { Scorer, ScoreResult } from '../agent/scoring.ts';
import { FEATURES, featureVector, inputsFor } from './features.ts';
import { contributions } from './pairwise.ts';
import type { PairwiseModel } from './pairwise.ts';

export const MODEL_PATH = fileURLToPath(new URL('../../data/calibration/model.json', import.meta.url));

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Logit units mapped onto 0..1: +/- LOGIT_SPAN is the full range, so 0 logit scores 0.5. */
const LOGIT_SPAN = 12;

export interface ModelFile extends PairwiseModel {
  version: 1;
  trainedAt: string;
  note: string;
}

export function loadModel(path: string = MODEL_PATH): ModelFile {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error('No trained preference model found. Run `npm run calibrate` to create data/calibration/model.json.');
  }
  const m = JSON.parse(raw) as ModelFile;
  const current = FEATURES.map((f) => f.name);
  if (m.featureNames.length !== current.length || m.featureNames.some((n, i) => n !== current[i])) {
    throw new Error('The saved model was trained on a different feature set. Run `npm run calibrate` again.');
  }
  return m;
}

/**
 * Stage 3 scorer backed by the model learned from the user's own comparison labels.
 *
 * It ranks. It never rejects: hard rejection stays in stage 2 on declared fields. Each score
 * comes with the contributions behind it, in the same 0..1 units as the baseline, so the funnel
 * can show why a person ranked where they did.
 */
export class LearnedScorer implements Scorer {
  readonly name = 'learned-pairwise-v1';
  private model: PairwiseModel;

  constructor(model: PairwiseModel = loadModel()) {
    this.model = model;
  }

  score(c: Candidate, p: Preferences): ScoreResult {
    const x = featureVector(c, p);
    const parts = contributions(this.model, x);
    const components: Record<string, number> = { baseline: 0.5 };
    this.model.featureNames.forEach((n, j) => (components[n] = round(parts[j]! / (2 * LOGIT_SPAN))));
    const raw = Object.values(components).reduce((s, v) => s + v, 0);
    return { score: round(clamp01(raw)), components, explanation: explain(this.model, parts, c, p), scorer: this.name };
  }

  /** The largest contributions to this person's score, signed, in the same 0..1 units as `score`. */
  factors(c: Candidate, p: Preferences, n = 3): Array<{ label: string; contribution: number }> {
    const inputs = inputsFor(c, p);
    const parts = contributions(this.model, featureVector(c, p));
    return FEATURES.map((f, j) => {
      const sd = this.model.std[j]!;
      const z = sd === 0 ? 0 : (f.value(inputs) - this.model.mean[j]!) / sd;
      return { label: z > 0 ? f.high : f.low, contribution: round(parts[j]! / (2 * LOGIT_SPAN)) };
    })
      .filter((x) => Math.abs(x.contribution) >= 0.005)
      .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
      .slice(0, n);
  }
}

/** The three largest pushes up and the largest push down, as a sentence. */
function explain(model: PairwiseModel, parts: number[], c: Candidate, p: Preferences): string {
  const inputs = inputsFor(c, p);
  const rows = FEATURES.map((f, j) => ({ f, part: parts[j]!, z: model.std[j]! === 0 ? 0 : (f.value(inputs) - model.mean[j]!) / model.std[j]! }));
  const phrase = (r: (typeof rows)[number]) => (r.z > 0 ? r.f.high : r.f.low);
  const up = rows.filter((r) => r.part > 0.05).sort((a, b) => b.part - a.part).slice(0, 3);
  const down = rows.filter((r) => r.part < -0.05).sort((a, b) => a.part - b.part).slice(0, 1);
  const upText = up.length ? `ranked up because this person ${up.map(phrase).join('; ')}` : 'no strong reason to rank up';
  const downText = down.length ? `; ranked down because this person ${phrase(down[0]!)}` : '';
  return `${upText}${downText}`;
}

/**
 * A literal reading of what Eric SAID he wants: mobile, independent, unanchored, plus the
 * stated-preference baseline's own terms. It is a second comparator for the learned model. The
 * repo baseline (`stated-preference-v1`) cannot see work and roots at all, so on its own it
 * could not even disagree with the finding; this one can.
 */
export class StatedMobilityScorer implements Scorer {
  readonly name = 'stated-mobility-v1';
  private base = new StatedPreferenceScorer();

  score(c: Candidate, p: Preferences): ScoreResult {
    const { life } = inputsFor(c, p);
    const mobile = clamp01(life.nightsAwayPerMonth / 14);
    const unanchored = clamp01(1 - life.yearsInCity / 12);
    const portable = 1 - life.occupation.placeBound;
    const baseline = this.base.score(c, p);
    const components = {
      mobile: round(0.25 * mobile),
      unanchored: round(0.2 * unanchored),
      portableWork: round(0.2 * portable),
      statedBaseline: round(0.35 * baseline.score),
    };
    const score = round(Object.values(components).reduce((s, v) => s + v, 0));
    return {
      score,
      components,
      explanation: `stated profile: ${life.nightsAwayPerMonth} nights away a month, ${life.yearsInCity} years in city, ${life.occupation.title}`,
      scorer: this.name,
    };
  }
}

export const SCORER_NAMES = ['stated', 'stated-mobility', 'learned'] as const;
export type ScorerName = (typeof SCORER_NAMES)[number];

/** Selects the funnel's stage-3 scorer by name. */
export function createScorer(name: ScorerName): Scorer {
  switch (name) {
    case 'stated':
      return new StatedPreferenceScorer();
    case 'stated-mobility':
      return new StatedMobilityScorer();
    case 'learned':
      return new LearnedScorer();
  }
}
