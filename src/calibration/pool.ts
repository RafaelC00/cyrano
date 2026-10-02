import type { Candidate } from '../domain/types.ts';
import { RULES } from '../agent/rules.ts';
import type { Preferences } from '../agent/preferences.ts';
import { generateProfiles } from '../platform/seed.ts';
import { PlatformStore } from '../platform/store.ts';

/**
 * The calibration pool: people Eric compares during his one sitting.
 *
 * It is a SEPARATE synthetic pool from the 500 the funnel runs on (different seed), so the
 * model is never trained on anyone it later ranks. It is filtered by his own hard rules except
 * city, because he will meet people in cities he travels to and the calibration should not be
 * narrower than the funnel's eventual input. Only declared fields decide membership.
 */
export const CALIBRATION_SEED = 20261002;
export const CALIBRATION_POOL_SIZE = 10000;

export function calibrationPool(prefs: Preferences, size = CALIBRATION_POOL_SIZE): Candidate[] {
  const store = new PlatformStore(generateProfiles({ seed: CALIBRATION_SEED, size }), { existingMatches: 0 });
  const all: Candidate[] = [];
  let cursor: string | undefined;
  do {
    const page = store.listCandidates(cursor, 100);
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const rules = RULES.filter((r) => r.id !== 'city.allowed');
  return all.filter((c) => rules.every((r) => r.evaluate(c.declared, prefs).pass));
}
