import type { Children, Gender, Intent, Smoking } from '../domain/types.ts';

/**
 * The viewer's stated preferences. Everything here is something the user said, and every hard
 * constraint maps to a self-declared profile field.
 */
export interface Preferences {
  viewer: {
    age: number;
    gender: Gender;
    interestedIn: Gender[];
    languages: string[];
    interests: string[];
    intents: Intent[];
  };
  ageRange: { min: number; max: number };
  cities: string[];
  requireSharedLanguage: boolean;
  excludedSmoking: Smoking[];
  excludedChildren: Children[];
  /** Stage 1 drops accounts inactive for longer than this: they cannot reply. */
  dormantAfterDays: number;
  /** Stage 4 capacity: how many candidates reach the human per run. */
  gateSize: number;
}

/**
 * Eric Vossberg's stated preferences: the fictional user this project is written around, taken
 * from his persona. Each hard constraint maps to a self-declared profile field.
 *
 *   man, interested in women, 34; age 26 to 34; English, or German, Spanish or Dutch;
 *   his current city or one he will be in within six weeks (Amsterdam, Lisbon, Berlin and
 *   Madrid on his itinerary; the pool has no Singapore or Dubai); something ongoing; no smoking;
 *   not wanting children within two years.
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
    cities: ['Amsterdam', 'Lisbon', 'Berlin', 'Madrid'],
    requireSharedLanguage: true,
    excludedSmoking: ['sometimes', 'regularly'],
    excludedChildren: ['want'],
    dormantAfterDays: 30,
    gateSize: 10,
  };
}

/** The viewer is Eric. There is no other user. */
export const defaultPreferences = ericPreferences;
