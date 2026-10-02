import type { Preferences } from '../agent/preferences.ts';

/**
 * Eric Vossberg's STATED preferences, as a `Preferences` object for the rule layer and scorers.
 * Everything here is something the invented persona said about himself (see the persona notes);
 * every hard constraint maps to a self-declared profile field.
 *
 * Assumption, flagged: the persona does not say who Eric is attracted to. `interestedIn` is set
 * to women so the pool is non-trivial; it has no effect on scoring.
 */
export function ericPreferences(): Preferences {
  return {
    viewer: {
      age: 34,
      gender: 'man',
      interestedIn: ['woman'],
      languages: ['en', 'de', 'es', 'nl'],
      interests: ['travel', 'running', 'coffee', 'chess', 'language learning', 'jazz', 'podcasts', 'museums'],
      intents: ['long-term', 'open'],
    },
    ageRange: { min: 26, max: 34 },
    // His current city, plus cities he will be in within six weeks. The pool has no Dubai or Singapore.
    cities: ['Amsterdam', 'Lisbon', 'Berlin'],
    requireSharedLanguage: true,
    excludedSmoking: ['sometimes', 'regularly'],
    excludedChildren: ['want'],
    dormantAfterDays: 30,
    gateSize: 10,
  };
}

/**
 * What Eric said he wants, as claims about features, with the sentence each claim comes from.
 * `expected` is the direction his own words imply for "more of this feature is better".
 * Claims he did not make are absent: silence is not a claim, and the divergence report treats a
 * strong revealed preference on an unclaimed feature as "revealed only", not as a contradiction.
 */
export interface StatedClaim {
  feature: string;
  expected: 1 | -1;
  basis: 'explicit' | 'implied';
  source: string;
}

export const STATED_CLAIMS: readonly StatedClaim[] = [
  { feature: 'nights_away_per_month', expected: 1, basis: 'explicit', source: '"I travel constantly. I need someone who gets that"; "someone I can see in two cities"' },
  { feature: 'years_in_city', expected: -1, basis: 'explicit', source: '"as mobile and unanchored as he is"' },
  { feature: 'work_needs_a_place', expected: -1, basis: 'implied', source: '"independent ... not waiting on me": portable work fits a mobile partner' },
  { feature: 'job_tenure_years', expected: -1, basis: 'implied', source: '"unanchored"' },
  { feature: 'old_local_friendships', expected: -1, basis: 'implied', source: '"unanchored"' },
];
