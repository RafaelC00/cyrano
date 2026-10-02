import { Itinerary } from '../calendar/itinerary.ts';

/**
 * Eric's invented travel plan: a quarter in five cities, flights booked about a week out.
 * Singapore until Thursday, then Amsterdam, Lisbon, Berlin, Madrid and Dubai. Dates are anchored
 * to `today`, so the plan stays valid whenever the system starts.
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
