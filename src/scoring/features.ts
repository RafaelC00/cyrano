import type { Candidate } from '../domain/types.ts';
import type { Preferences } from '../agent/preferences.ts';
import { describePixels } from '../vision/features.ts';
import type { VisualFeatures } from '../vision/features.ts';
import { visualFeaturesFor } from '../vision/library.ts';
import { lifeOf } from './life.ts';
import type { LifeStructure } from './life.ts';

/**
 * Engineered features for the preference model.
 *
 * Every feature is a number a person can inspect on the profile or the photograph, with a
 * plain-language phrase for each direction so the explanation reads as a sentence. Three groups:
 *   declared  what the person typed (age, interests, languages, intent, city)
 *   life      work and roots (see life.ts), self-declared-style fields
 *   visual    descriptive features of the PHOTOGRAPH (see src/vision/features.ts); never a
 *             judgement of the person
 *
 * The model is trained on labels alone; nothing in this file knows what the labels reward.
 */

export type FeatureGroup = 'declared' | 'life' | 'visual';

export interface Inputs {
  candidate: Candidate;
  prefs: Preferences;
  life: LifeStructure;
  visual: VisualFeatures | undefined;
}

export interface FeatureDef {
  name: string;
  group: FeatureGroup;
  /** Phrase for a candidate scoring HIGH on this feature, e.g. "has lived in the city a long time". */
  high: string;
  /** Phrase for scoring LOW. */
  low: string;
  /** NaN means "not observed" (for example no visual features); it is imputed with the training mean. */
  value(i: Inputs): number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const bin = (b: boolean) => (b ? 1 : 0);
const v = (f: (x: VisualFeatures) => number) => (i: Inputs) => (i.visual ? f(i.visual) : Number.NaN);

export const FEATURES: readonly FeatureDef[] = [
  // declared
  {
    name: 'interest_overlap', group: 'declared', high: 'shares many of his interests', low: 'shares few of his interests',
    value: ({ candidate: c, prefs: p }) => {
      const shared = c.declared.interests.filter((x) => p.viewer.interests.includes(x)).length;
      return shared / Math.max(1, new Set([...c.declared.interests, ...p.viewer.interests]).size);
    },
  },
  {
    name: 'intent_match', group: 'declared', high: 'wants the same kind of relationship', low: 'wants a different kind of relationship',
    value: ({ candidate: c, prefs: p }) => clamp01(c.declared.lookingFor.filter((x) => p.viewer.intents.includes(x)).length / Math.max(1, p.viewer.intents.length)),
  },
  {
    name: 'shared_languages', group: 'declared', high: 'shares more of his languages', low: 'shares fewer of his languages',
    value: ({ candidate: c, prefs: p }) => clamp01(c.declared.languages.filter((x) => p.viewer.languages.includes(x)).length / Math.max(1, p.viewer.languages.length)),
  },
  { name: 'age_fit', group: 'declared', high: 'is close to his own age', low: 'is further from his own age', value: ({ candidate: c, prefs: p }) => clamp01(1 - Math.abs(c.declared.age - p.viewer.age) / 15) },
  { name: 'in_his_cities', group: 'declared', high: 'lives in one of his cities', low: 'lives outside his cities', value: ({ candidate: c, prefs: p }) => bin(p.cities.includes(c.declared.city)) },
  {
    name: 'recently_active', group: 'declared', high: 'is active on the app', low: 'is rarely active on the app',
    value: ({ candidate: c }) => clamp01(c.activity.sessionsLast30d / 20) * Math.exp(-c.activity.daysSinceActive / 14),
  },
  // life: work and roots
  { name: 'years_in_city', group: 'life', high: 'has lived in their city for years', low: 'has only recently arrived in their city', value: ({ life }) => Math.min(life.yearsInCity, 20) },
  { name: 'job_tenure_years', group: 'life', high: 'has stayed in the same work for years', low: 'is new to their current work', value: ({ life }) => Math.min(life.tenureYears, 15) },
  { name: 'physical_practice', group: 'life', high: 'runs or belongs to a practice with a physical place', low: 'has no practice tied to a place', value: ({ life }) => bin(life.hasPhysicalPractice) },
  { name: 'work_needs_a_place', group: 'life', high: 'does work that cannot be done from an airport lounge', low: 'does work that can be done from anywhere', value: ({ life }) => life.occupation.placeBound },
  { name: 'nights_away_per_month', group: 'life', high: 'is away from home many nights a month', low: 'is rarely away from home', value: ({ life }) => life.nightsAwayPerMonth },
  { name: 'old_local_friendships', group: 'life', high: 'has long-standing local friendships', low: 'has few long-standing local friendships', value: ({ life }) => Math.min(life.oldestLocalFriendYears, 25) },
  // visual: descriptive features of the photograph
  { name: 'photo_candid', group: 'visual', high: 'has a candid main photo', low: 'does not have a candid main photo', value: v((x) => bin(x.photoType === 'candid')) },
  { name: 'photo_posed', group: 'visual', high: 'has a posed main photo', low: 'does not have a posed main photo', value: v((x) => bin(x.photoType === 'posed')) },
  { name: 'photo_group', group: 'visual', high: 'is in a group in the main photo', low: 'is alone in the main photo', value: v((x) => bin(x.people === 'group')) },
  { name: 'photo_nature', group: 'visual', high: 'is photographed in nature', low: 'is not photographed in nature', value: v((x) => bin(x.setting === 'nature')) },
  { name: 'photo_indoor', group: 'visual', high: 'is photographed indoors', low: 'is not photographed indoors', value: v((x) => bin(x.setting === 'indoor')) },
  { name: 'photo_urban', group: 'visual', high: 'is photographed in a city setting', low: 'is not photographed in a city setting', value: v((x) => bin(x.setting === 'urban')) },
  { name: 'photo_doing_something_craft', group: 'visual', high: 'is making something in the main photo', low: 'is not making something in the main photo', value: v((x) => bin(x.activityKind === 'craft')) },
  { name: 'photo_doing_sport', group: 'visual', high: 'is exercising in the main photo', low: 'is not exercising in the main photo', value: v((x) => bin(x.activityKind === 'sport')) },
  { name: 'photo_social_scene', group: 'visual', high: 'is at a social scene in the main photo', low: 'is not at a social scene in the main photo', value: v((x) => bin(x.activityKind === 'social')) },
  { name: 'photo_well_lit', group: 'visual', high: 'has a well lit main photo', low: 'has a dim or harsh main photo', value: v((x) => bin(describePixels(x.pixels).lighting === 'even')) },
  { name: 'photo_sharp', group: 'visual', high: 'has a sharp main photo', low: 'has a soft main photo', value: v((x) => bin(describePixels(x.pixels).focus === 'sharp')) },
];

export const FEATURE_NAMES = FEATURES.map((f) => f.name);

export function inputsFor(candidate: Candidate, prefs: Preferences): Inputs {
  return { candidate, prefs, life: lifeOf(candidate), visual: visualFeaturesFor(candidate) };
}

export function featureVector(candidate: Candidate, prefs: Preferences): number[] {
  const i = inputsFor(candidate, prefs);
  return FEATURES.map((f) => f.value(i));
}
