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

export function defaultPreferences(): Preferences {
  return {
    viewer: {
      age: 33,
      gender: 'woman',
      interestedIn: ['man'],
      languages: ['en', 'es'],
      interests: ['cooking', 'hiking', 'film', 'board games', 'bookshops', 'climbing', 'travel', 'coffee'],
      intents: ['long-term', 'open'],
    },
    ageRange: { min: 28, max: 40 },
    cities: ['Lisbon', 'Porto', 'Madrid', 'Barcelona'],
    requireSharedLanguage: true,
    excludedSmoking: ['regularly'],
    excludedChildren: ['dont-want'],
    dormantAfterDays: 30,
    gateSize: 10,
  };
}
