import type { Candidate } from '../domain/types.ts';
import { hashString, mulberry32, pick } from '../platform/rng.ts';
import type { Rng } from '../platform/rng.ts';
import { identityKey } from '../vision/library.ts';

/**
 * Work and roots: what a profile would say about how a person's life is anchored.
 *
 * The phase 1 platform schema has no job, tenure or time-in-city fields, but a real profile
 * carries all of them. This module stands in for those fields. The values are generated
 * deterministically from the profile identity (same profile, same life, on every run) with
 * realistic correlations: a ceramicist has a studio and stays put, a freelance consultant is on
 * planes. They are treated as SELF-DECLARED profile fields, exactly like age or city. They are
 * never inferred from a photograph.
 */

export interface Occupation {
  title: string;
  /**
   * 0 to 1: how much the work needs a particular physical place (a studio, a clinic, a shop).
   * 0 means it can be done from an airport lounge; 1 means it cannot be done anywhere else.
   */
  placeBound: number;
}

export const OCCUPATIONS: readonly Occupation[] = [
  { title: 'ceramicist with a studio', placeBound: 1 },
  { title: 'bakery owner', placeBound: 1 },
  { title: 'bookshop owner', placeBound: 1 },
  { title: 'physiotherapist with a clinic', placeBound: 0.95 },
  { title: 'secondary school teacher', placeBound: 0.9 },
  { title: 'nurse', placeBound: 0.95 },
  { title: 'carpenter', placeBound: 0.95 },
  { title: 'restaurant chef', placeBound: 0.95 },
  { title: 'veterinarian', placeBound: 0.95 },
  { title: 'architect', placeBound: 0.55 },
  { title: 'orchestra musician', placeBound: 0.8 },
  { title: 'climbing gym coach', placeBound: 0.9 },
  { title: 'urban planner', placeBound: 0.6 },
  { title: 'laboratory scientist', placeBound: 0.85 },
  { title: 'product designer', placeBound: 0.3 },
  { title: 'software contractor', placeBound: 0.05 },
  { title: 'freelance translator', placeBound: 0.05 },
  { title: 'management consultant', placeBound: 0.15 },
  { title: 'travel writer', placeBound: 0 },
  { title: 'photographer on assignment', placeBound: 0.1 },
  { title: 'remote product manager', placeBound: 0.1 },
  { title: 'airline crew', placeBound: 0 },
  { title: 'independent trader', placeBound: 0 },
  { title: 'event producer', placeBound: 0.3 },
];

const CRAFT_INTERESTS = ['ceramics', 'baking', 'gardening', 'sketching', 'vinyl records'];
const CRAFT_TITLES = OCCUPATIONS.filter((o) => o.placeBound >= 0.9);

export interface LifeStructure {
  occupation: Occupation;
  /** Years lived in the declared city. */
  yearsInCity: number;
  /** Years in the current job or practice. */
  tenureYears: number;
  /** Runs, or is attached to, a practice with a physical location (studio, shop, clinic, club). */
  hasPhysicalPractice: boolean;
  /** Nights away from home in a typical month. */
  nightsAwayPerMonth: number;
  /** Years the oldest local friendships have lasted. */
  oldestLocalFriendYears: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const expo = (rng: Rng, mean: number) => -Math.log(1 - rng()) * mean;

/** Deterministic life structure for a profile. */
export function lifeOf(c: Pick<Candidate, 'id' | 'displayName' | 'declared'>): LifeStructure {
  const rng = mulberry32(hashString(`life|${identityKey(c)}`));
  const age = c.declared.age;
  const craftLeaning = c.declared.interests.some((i) => CRAFT_INTERESTS.includes(i));
  const occupation = craftLeaning && rng() < 0.3 ? pick(rng, CRAFT_TITLES) : pick(rng, OCCUPATIONS);
  const bound = occupation.placeBound;

  const adultYears = Math.max(1, age - 20);
  // Place-bound work goes with staying put; mobile work goes with moving more often.
  const stay = 4 + 9 * bound;
  const yearsInCity = clamp(Math.floor(expo(rng, stay * (age / 34))), 0, age - 16);
  const tenureYears = clamp(Math.floor(expo(rng, 2.5 + 4 * bound)), 0, adultYears);
  const hasPhysicalPractice = rng() < (bound >= 0.9 ? 0.8 : bound >= 0.5 ? 0.35 : 0.08);
  const nightsAwayPerMonth = clamp(Math.round(expo(rng, 2 + 12 * (1 - bound))), 0, 28);
  const oldestLocalFriendYears = clamp(Math.floor(yearsInCity * (0.4 + 0.9 * rng())), 0, age - 12);
  return { occupation, yearsInCity, tenureYears, hasPhysicalPractice, nightsAwayPerMonth, oldestLocalFriendYears };
}
