import { ericPreferences } from '../agent/preferences.ts';
import type { Preferences } from '../agent/preferences.ts';

/**
 * The preferences the calibration in `data/calibration` was run with: Eric's, with the three
 * cities he was booked into when it was generated. His itinerary later gained Madrid, which is
 * in his default preferences now. The calibration pool ignores the city rule, and the one
 * feature that reads the list (`in_his_cities`) carries almost no weight, but the result is
 * only reproducible against these exact preferences, so they stay frozen here.
 */
export function calibrationPreferences(): Preferences {
  return { ...ericPreferences(), cities: ['Amsterdam', 'Lisbon', 'Berlin'] };
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
