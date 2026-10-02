import { addDays, assertDay, daysBetween } from './time.ts';
import type { DayString } from './time.ts';

/** IANA zone per city Eric might be in. A city missing here is an error, never a guess. */
export const CITY_ZONES: Readonly<Record<string, string>> = {
  Amsterdam: 'Europe/Amsterdam',
  Utrecht: 'Europe/Amsterdam',
  Berlin: 'Europe/Berlin',
  Lisbon: 'Europe/Lisbon',
  Porto: 'Europe/Lisbon',
  Madrid: 'Europe/Madrid',
  Barcelona: 'Europe/Madrid',
  Paris: 'Europe/Paris',
  Milan: 'Europe/Rome',
  Dublin: 'Europe/Dublin',
  Zurich: 'Europe/Zurich',
  Dubai: 'Asia/Dubai',
  Singapore: 'Asia/Singapore',
};

export class UnknownCityError extends Error {
  constructor(city: string) {
    super(`No time zone known for "${city}". Add it to CITY_ZONES rather than guessing an offset.`);
    this.name = 'UnknownCityError';
  }
}

export function zoneOf(city: string): string {
  const z = CITY_ZONES[city];
  if (!z) throw new UnknownCityError(city);
  return z;
}

/** A continuous period in one city. Both days inclusive; the first is arrival, the last departure. */
export interface Stay {
  city: string;
  from: DayString;
  to: DayString;
}

/** A stay whose arrival is within a week of "now" is booked; further out it is intent only. */
export type Firmness = 'firm' | 'tentative';

/**
 * Where Eric is, by date. Eric books flights about a week ahead, so anything further out is a
 * plan, and every slot or claim derived from it carries `tentative`.
 */
export class Itinerary {
  /** Arrival within this many days of today counts as booked. */
  static readonly FIRM_HORIZON_DAYS = 7;
  private readonly all: readonly Stay[];

  constructor(stays: readonly Stay[]) {
    const sorted = stays
      .map((s) => ({ city: s.city, from: assertDay(s.from, 'stay.from'), to: assertDay(s.to, 'stay.to') }))
      .sort((a, b) => a.from.localeCompare(b.from));
    for (const s of sorted) {
      zoneOf(s.city);
      if (s.to < s.from) throw new RangeError(`Stay in ${s.city} ends (${s.to}) before it starts (${s.from})`);
    }
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.from <= prev.to) {
        throw new RangeError(
          `Stays overlap: ${prev.city} ${prev.from}..${prev.to} and ${cur.city} ${cur.from}..${cur.to}. A person is in one city at a time.`,
        );
      }
    }
    this.all = sorted;
  }

  stays(): readonly Stay[] {
    return this.all;
  }

  /** The city he is in on a day, or null on travel days between stays and outside the plan. */
  cityOn(day: DayString): string | null {
    return this.stayOn(day)?.city ?? null;
  }

  stayOn(day: DayString): Stay | null {
    return this.all.find((s) => s.from <= day && day <= s.to) ?? null;
  }

  isIn(city: string, day: DayString): boolean {
    return this.cityOn(day) === city;
  }

  /** Stays in `city` that overlap [from, to] (whole stays, not clipped). */
  staysIn(city: string, from: DayString, to: DayString): Stay[] {
    return this.all.filter((s) => s.city === city && s.from <= to && s.to >= from);
  }

  /** Does a single stay in `city` cover every day of [from, to]? */
  covers(city: string, from: DayString, to: DayString): boolean {
    return this.all.some((s) => s.city === city && s.from <= from && s.to >= to);
  }

  firmness(stay: Stay, today: DayString): Firmness {
    return daysBetween(today, stay.from) <= Itinerary.FIRM_HORIZON_DAYS ? 'firm' : 'tentative';
  }

  /** Cities with at least one stay overlapping the next `days` days. */
  citiesWithin(today: DayString, days: number): string[] {
    const end = addDays(today, days);
    return [...new Set(this.all.filter((s) => s.to >= today && s.from <= end).map((s) => s.city))];
  }

  toJSON(): readonly Stay[] {
    return this.all;
  }
}
