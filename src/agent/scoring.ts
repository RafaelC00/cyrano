import type { Candidate } from '../domain/types.ts';
import type { Preferences } from './preferences.ts';

export interface ScoreResult {
  /** 0..1, higher is better. */
  score: number;
  /** Named contributions, each already weighted. They sum to `score`. */
  components: Record<string, number>;
  explanation: string;
  scorer: string;
}

/**
 * The seam for stage 3.
 *
 * Phase 1 ships `StatedPreferenceScorer`. Phase 4 swaps in a model learned from the user's own
 * labels behind this same interface. A scorer receives the full `Candidate` (declared fields,
 * photo slots and activity) because later scorers will use more than declared fields for
 * *ranking*. Hard rejection never goes through here: only stage 2 may drop, and only on
 * declared fields.
 */
export interface Scorer {
  readonly name: string;
  score(candidate: Candidate, prefs: Preferences): ScoreResult | Promise<ScoreResult>;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Baseline: a transparent weighted sum of stated preferences. The weights are stated constants
 * chosen by hand, not learned, and are not claimed to predict anything.
 */
export class StatedPreferenceScorer implements Scorer {
  readonly name = 'stated-preference-v1';
  static readonly WEIGHTS = { interests: 0.4, intent: 0.15, language: 0.1, activity: 0.2, ageFit: 0.15 } as const;

  score(c: Candidate, p: Preferences): ScoreResult {
    const w = StatedPreferenceScorer.WEIGHTS;
    const d = c.declared;

    const shared = d.interests.filter((i) => p.viewer.interests.includes(i));
    const union = new Set([...d.interests, ...p.viewer.interests]).size;
    const interests = union ? shared.length / union : 0;

    const intent = clamp01(d.lookingFor.filter((i) => p.viewer.intents.includes(i)).length / Math.max(1, p.viewer.intents.length));

    const langs = d.languages.filter((l) => p.viewer.languages.includes(l)).length;
    const language = clamp01(langs / Math.max(1, p.viewer.languages.length));

    const activity = clamp01(c.activity.sessionsLast30d / 20) * Math.exp(-c.activity.daysSinceActive / 14);

    const ageFit = clamp01(1 - Math.abs(d.age - p.viewer.age) / 15);

    const components = {
      interests: round(w.interests * interests),
      intent: round(w.intent * intent),
      language: round(w.language * language),
      activity: round(w.activity * activity),
      ageFit: round(w.ageFit * ageFit),
    };
    const score = round(Object.values(components).reduce((s, v) => s + v, 0));
    const top = Object.entries(components).sort((a, b) => b[1] - a[1])[0]![0];
    const explanation =
      `${shared.length ? `shares ${shared.join(', ')}; ` : 'no shared interests; '}` +
      `last active ${c.activity.daysSinceActive}d ago; largest contribution: ${top}`;
    return { score, components, explanation, scorer: this.name };
  }
}
