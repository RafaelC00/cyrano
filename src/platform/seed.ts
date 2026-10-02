import type { Candidate, Children, Gender, Intent, PromptAnswer, Smoking } from '../domain/types.ts';
import { makePhotoRef } from './photo.ts';
import { int, mulberry32, pick, sample, weighted } from './rng.ts';
import type { Rng } from './rng.ts';

/** All activity is computed relative to this instant unless the platform is given another clock. */
export const SEED_EPOCH = '2026-10-01T12:00:00.000Z';

/** What the platform stores. `likesViewer` is hidden state that decides who matches back. */
export interface SeedProfile {
  id: string;
  displayName: string;
  synthetic: true;
  declared: Candidate['declared'];
  photoRefs: string[];
  lastActiveAt: string;
  sessionsLast30d: number;
  likesViewer: boolean;
}

const PLACES: ReadonlyArray<{ city: string; country: string; lang: string }> = [
  { city: 'Lisbon', country: 'PT', lang: 'pt' },
  { city: 'Porto', country: 'PT', lang: 'pt' },
  { city: 'Madrid', country: 'ES', lang: 'es' },
  { city: 'Barcelona', country: 'ES', lang: 'es' },
  { city: 'Amsterdam', country: 'NL', lang: 'nl' },
  { city: 'Utrecht', country: 'NL', lang: 'nl' },
  { city: 'Berlin', country: 'DE', lang: 'de' },
  { city: 'Paris', country: 'FR', lang: 'fr' },
  { city: 'Milan', country: 'IT', lang: 'it' },
  { city: 'Dublin', country: 'IE', lang: 'en' },
];

export const INTERESTS = [
  'cooking', 'hiking', 'film', 'board games', 'climbing', 'bookshops', 'jazz', 'cycling',
  'ceramics', 'sailing', 'chess', 'photography', 'running', 'gardening', 'live music', 'museums',
  'bouldering', 'baking', 'language learning', 'surfing', 'theatre', 'vinyl records', 'yoga',
  'travel', 'podcasts', 'astronomy', 'karaoke', 'swimming', 'street food', 'sketching',
  'coffee', 'tennis', 'volunteering', 'crosswords', 'camping', 'dancing',
] as const;

const PROMPTS: ReadonlyArray<{ id: string; question: string; answers: readonly string[] }> = [
  { id: 'win-me-over', question: 'The way to win me over is', answers: [
    'a recommendation I would never have found myself', 'turning up exactly when you said you would',
    'cooking badly and laughing about it', 'asking a second question after the first one'] },
  { id: 'sunday', question: 'A perfect Sunday looks like', answers: [
    'a long walk, a longer lunch, nothing scheduled', 'markets in the morning and a film at night',
    'a book, a window, and no phone', 'a long run followed by an even longer breakfast'] },
  { id: 'unpopular', question: 'My most unpopular opinion', answers: [
    'the best part of a trip is the train, not the destination', 'cold pizza beats hot pizza',
    'every city is better with a river', 'brunch is just late breakfast with a markup'] },
  { id: 'learning', question: 'Currently learning', answers: [
    'how to make bread that is not a brick', 'to read a map without a blue dot',
    'a language I am embarrassingly bad at', 'how to do a proper handstand'] },
  { id: 'green-flag', question: 'My green flag is', answers: [
    'being kind to waiters', 'saying "I do not know" without flinching',
    'replying to messages like a person', 'having a favourite mug'] },
  { id: 'weekend-trip', question: 'Next trip I want to take', answers: [
    'somewhere I can get to by night train', 'a coastline I have only seen in photographs',
    'a mountain hut with no signal', 'wherever the cheapest flight goes on Friday'] },
];

const ONSETS = ['k', 'v', 'm', 't', 's', 'r', 'l', 'n', 'z', 'd', 'b', 'f', 'g', 'h'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'ae', 'io', 'ia'];
const CODAS = ['', '', 'n', 'l', 'r', 's', 'm'];
const SURNAME_A = ['Ash', 'Brook', 'Cinder', 'Dusk', 'Ember', 'Fen', 'Glass', 'Hollow', 'Iron', 'Juniper',
  'Kestrel', 'Lark', 'Moss', 'Nettle', 'Orchard', 'Pike', 'Quarry', 'Rook', 'Sedge', 'Tarn'];
const SURNAME_B = ['mere', 'field', 'wick', 'ward', 'stone', 'thorn', 'bury', 'combe', 'dale', 'holt'];

/** Three invented syllables plus a compound surname: reads as a name, matches no one. */
function syntheticName(rng: Rng): string {
  let given = '';
  for (let i = 0; i < 3; i++) given += pick(rng, ONSETS) + pick(rng, VOWELS) + (i === 2 ? pick(rng, CODAS) : '');
  given = given[0]!.toUpperCase() + given.slice(1);
  return `${given} ${pick(rng, SURNAME_A)}${pick(rng, SURNAME_B)}`;
}

function genInterestedIn(rng: Rng, gender: Gender): Gender[] {
  if (gender === 'nonbinary') return ['woman', 'man', 'nonbinary'];
  const other: Gender = gender === 'woman' ? 'man' : 'woman';
  return weighted<Gender[]>(rng, [[[other], 78], [[gender], 10], [[other, gender], 12]]);
}

export interface SeedOptions {
  seed?: number;
  size?: number;
  epoch?: string;
}

export function generateProfiles(opts: SeedOptions = {}): SeedProfile[] {
  const rng = mulberry32(opts.seed ?? 20261001);
  const size = opts.size ?? 500;
  const epoch = Date.parse(opts.epoch ?? SEED_EPOCH);
  const names = new Set<string>();
  const out: SeedProfile[] = [];

  for (let i = 0; i < size; i++) {
    const id = `p_${String(i + 1).padStart(4, '0')}`;
    let displayName = syntheticName(rng);
    while (names.has(displayName)) displayName = syntheticName(rng);
    names.add(displayName);

    const gender = weighted<Gender>(rng, [['woman', 48], ['man', 48], ['nonbinary', 4]]);
    const place = pick(rng, PLACES);
    const languages = new Set<string>([place.lang]);
    if (rng() < 0.75) languages.add('en');
    if (rng() < 0.15) languages.add(pick(rng, ['es', 'fr', 'de', 'pt', 'it', 'nl']));

    const intents = new Set<Intent>([
      weighted<Intent>(rng, [['long-term', 40], ['open', 25], ['short-term', 12], ['casual', 13], ['friendship', 10]]),
    ]);
    if (rng() < 0.3) intents.add(pick(rng, ['open', 'long-term', 'short-term'] as Intent[]));

    const prompts: PromptAnswer[] = sample(rng, PROMPTS, int(rng, 2, 3)).map((p) => ({
      promptId: p.id,
      question: p.question,
      answer: pick(rng, p.answers),
    }));

    const photoCount = int(rng, 3, 6);
    const photoRefs = Array.from({ length: photoCount }, (_, s) => makePhotoRef(id, s));

    const daysAgo = Math.floor(-Math.log(1 - rng()) * 12);
    const lastActiveAt = new Date(epoch - daysAgo * 86_400_000 - int(rng, 0, 23) * 3_600_000).toISOString();
    const sessionsLast30d = Math.max(0, Math.round(30 * Math.exp(-daysAgo / 10) * (0.4 + rng())));

    out.push({
      id,
      displayName,
      synthetic: true,
      declared: {
        age: int(rng, 22, 46),
        gender,
        interestedIn: genInterestedIn(rng, gender),
        city: place.city,
        country: place.country,
        languages: [...languages],
        interests: sample(rng, INTERESTS, int(rng, 3, 6)),
        lookingFor: [...intents],
        smoking: weighted<Smoking>(rng, [['never', 70], ['sometimes', 20], ['regularly', 10]]),
        children: weighted<Children>(rng, [['want', 35], ['dont-want', 20], ['open', 30], ['have', 15]]),
        prompts,
      },
      photoRefs,
      lastActiveAt,
      sessionsLast30d,
      likesViewer: rng() < 0.3,
    });
  }
  return out;
}
