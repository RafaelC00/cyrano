import type { Preferences } from '../agent/preferences.ts';
import { Itinerary } from '../calendar/itinerary.ts';

/**
 * Eric's stated side, as data: the fictional user described in the project's persona notes.
 * Fixtures for the demo and the tests; nothing in the product reads this.
 */
export function ericPreferences(): Preferences {
  return {
    viewer: {
      age: 34,
      gender: 'man',
      interestedIn: ['woman'],
      languages: ['de', 'en', 'es', 'nl'],
      interests: ['cycling', 'coffee', 'travel', 'running', 'chess', 'museums', 'bookshops', 'jazz', 'cooking', 'language learning'],
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

/**
 * A quarter in five cities, flights booked about a week out: Singapore until Thursday, then
 * Amsterdam, Lisbon, Berlin, Madrid and Dubai. Dates are anchored to `today`, so the fixture
 * stays valid whenever it is used.
 */
export function ericItinerary(today: string): Itinerary {
  const d = (n: number) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  return new Itinerary([
    { city: 'Singapore', from: d(-4), to: d(6) },
    { city: 'Amsterdam', from: d(7), to: d(14) },
    { city: 'Lisbon', from: d(15), to: d(22) },
    { city: 'Berlin', from: d(23), to: d(28) },
    { city: 'Madrid', from: d(30), to: d(36) },
    { city: 'Dubai', from: d(43), to: d(49) },
    { city: 'Amsterdam', from: d(52), to: d(68) },
  ]);
}
