import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Candidate, Gender } from '../domain/types.ts';
import { hashString } from '../platform/rng.ts';
import type { VisualFeatures } from './features.ts';

/**
 * The portrait library.
 *
 * 50 to 70 generated images of invented people stand behind every profile in the pool. A library
 * is REUSED: with 500 profiles and about 60 portraits each portrait appears on roughly eight
 * profiles. That is a deliberate trade (generating 500 distinct portraits is not free in time and
 * the free lane is rate limited), it is stated here and in the README, and it means a visitor
 * will occasionally see the same face on two profiles.
 *
 * The assignment is deterministic. For a profile it narrows the library to portraits generated
 * for the same DECLARED gender and a similar DECLARED age (the profile's own typed fields, never
 * an inference from the image), then picks one by hashing the profile identity. Same profile,
 * same portrait, on every run and every machine.
 */

export interface LibrarySpec {
  id: string;
  age: number;
  /** As written in the generation prompt: 'woman' | 'man' | 'nonbinary person'. */
  gender: string;
  setting: string;
  activityKind: string;
  people: string;
  photoType: string;
  quality: string;
  prompt: string;
}

export interface LibraryEntry {
  id: string;
  file: string;
  generation: string;
  spec: LibrarySpec;
}

export const LIBRARY_DIR = fileURLToPath(new URL('../../data/portraits/library/', import.meta.url));

export class PortraitLibrary {
  readonly entries: LibraryEntry[];
  private features = new Map<string, VisualFeatures>();

  constructor(dir: string = LIBRARY_DIR) {
    this.dir = dir;
    const manifestPath = `${dir}manifest.json`;
    this.entries = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')).entries as LibraryEntry[]) : [];
    const featurePath = `${dir}features.json`;
    if (existsSync(featurePath)) {
      const raw = JSON.parse(readFileSync(featurePath, 'utf8')).features as Array<Omit<VisualFeatures, 'libraryId'> & { id: string }>;
      for (const f of raw) {
        const { id, ...rest } = f;
        this.features.set(id, { libraryId: id, ...rest });
      }
    }
  }

  private dir: string;

  get size(): number {
    return this.entries.length;
  }

  bytes(entry: LibraryEntry): Buffer {
    return readFileSync(`${this.dir}${entry.file}`);
  }

  featuresOf(libraryId: string): VisualFeatures | undefined {
    return this.features.get(libraryId);
  }
}

let shared: PortraitLibrary | undefined;
export function defaultLibrary(): PortraitLibrary {
  return (shared ??= new PortraitLibrary());
}

const SPEC_GENDER: Record<Gender, string> = { woman: 'woman', man: 'man', nonbinary: 'nonbinary person' };

/** Stable identity for hashing. The display name is unique per profile across seeds. */
export const identityKey = (c: Pick<Candidate, 'id' | 'displayName'>) => `${c.id}|${c.displayName}`;

/**
 * Picks the library portrait for a profile. Returns undefined only when the library is empty.
 * Uses declared gender and age to keep the pairing plausible; widens the age window, then drops
 * it, if the narrow window is empty (the 20 or so nonbinary profiles draw from a small subset).
 */
export function assignPortrait(c: Pick<Candidate, 'id' | 'displayName' | 'declared'>, lib: PortraitLibrary = defaultLibrary()): LibraryEntry | undefined {
  if (!lib.size) return undefined;
  const g = SPEC_GENDER[c.declared.gender];
  let pool: LibraryEntry[] = [];
  for (const window of [5, 9, 15]) {
    pool = lib.entries.filter((e) => e.spec.gender === g && Math.abs(e.spec.age - c.declared.age) <= window);
    if (pool.length >= 3) break;
  }
  if (!pool.length) pool = lib.entries.filter((e) => e.spec.gender === g);
  if (!pool.length) pool = lib.entries;
  return pool[hashString(`portrait|${identityKey(c)}`) % pool.length];
}

/** Parses `gp:v1:<profileId>:<slot>`. */
export function isGeneratedPortraitRef(ref: string): boolean {
  return ref.startsWith('gp:');
}

/** Visual features for a candidate's primary photo, when it is a generated portrait. */
export function visualFeaturesFor(c: Candidate, lib: PortraitLibrary = defaultLibrary()): VisualFeatures | undefined {
  const ref = c.photos[0]?.photoRef;
  if (!ref || !isGeneratedPortraitRef(ref)) return undefined;
  const entry = assignPortrait(c, lib);
  return entry ? lib.featuresOf(entry.id) : undefined;
}
