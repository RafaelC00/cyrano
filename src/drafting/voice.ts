import { dayOfMonth, monthName, weekdayName } from '../calendar/time.ts';
import type { DayString } from '../calendar/time.ts';
import type { SlotKind } from '../calendar/types.ts';
import type { DraftLang } from './types.ts';

/**
 * Eric's register, as data. The four rules (short, concrete, one plain detail, her language)
 * live in the shape of these templates: nothing here has a greeting, a compliment or a joke,
 * and every opener is a detail, a place and time, and a plain ask.
 *
 * A variant is either a string or `{ ok, slip }`. In Dutch a slip is a small learner's error
 * (a wrong preposition, a missing "te", the wrong article). Exactly one slip is applied per
 * Dutch draft, on purpose: it reads as effort rather than fluency. The slips are catalogued
 * here so they are chosen, never random damage.
 */
export type Variant = string | { ok: string; slip: string };

export interface Pack {
  /** The language's own name, as it appears in "your profile says Dutch". */
  name: string;
  interests: Record<string, string>;
  detail: {
    interests: Variant[];
    interest: Variant[];
    prompt: Variant[];
    city: Variant[];
    languages: Variant[];
  };
  presence: { until: Variant[]; range: Variant[] };
  ask: Record<SlotKind, Variant[]>;
  followUp: Variant[];
  reschedule: Variant[];
  /** Words between two alternative days: "Thursday or Friday". */
  or: string;
  /** Used between a presence sentence and an ask when they are joined. */
  join: string;
  range(from: DayString, to: DayString): string;
  dateLong(day: DayString): string;
}

const sameMonth = (a: DayString, b: DayString) => a.slice(0, 7) === b.slice(0, 7);

export const PACKS: Record<DraftLang, Pack> = {
  en: {
    name: 'English',
    interests: {},
    detail: {
      interests: [
        "You've got {a} and {b} in the same profile. That's a good combination.",
        '{A} and {b} is a genuinely unexpected pair.',
        "{A} and {b}: I don't see those two together very often.",
        'I noticed you list {a} and {b}. Not a common pairing.',
      ],
      interest: [
        "You list {a} on your profile, and I'd like to hear more about that.",
        'Not many profiles here mention {a}. I would like to hear how you got into it.',
      ],
      prompt: [
        'Your answer to "{q}" was "{ans}". That one stayed with me.',
        '"{ans}" under "{q}". That is a specific answer, and I like it.',
        'You wrote "{ans}" for "{q}". I would like to hear the longer version.',
      ],
      city: [
        "You're based in {city}. I'd like to meet someone who knows it properly.",
        'Your profile says {city}, a city I would like to see through someone who lives there.',
      ],
      languages: ['Your profile lists {L}, so I will write in {L}.'],
    },
    presence: {
      until: ["I'm in {city} until {until}.", "I'm around in {city} until {until}."],
      range: ["I'm in {city} {range}.", "I'll be in {city} {range}."],
    },
    ask: {
      coffee: ['Coffee on {day}?', 'Would you want to get a coffee on {day}?'],
      drinks: ['Drink on {day}?', 'Are you free for a drink on {day}?', "Any chance you'd want to get a drink on {day}?"],
      dinner: ['Dinner on {day}?', 'Would you want to have dinner on {day}?'],
    },
    followUp: [
      "{Day} works. Pick somewhere near you and I'll come to that side of town.",
      "{Day} it is. Choose the place, and I'll come to your side of town.",
    ],
    reschedule: [
      'I have to move {old}, sorry. Would {new} still work?',
      'Can we move {old}? {New} would work for me.',
    ],
    or: ' or ',
    join: ' — ',
    range: (a, b) =>
      sameMonth(a, b)
        ? `from ${dayOfMonth(a)} to ${dayOfMonth(b)} ${monthName(b, 'en')}`
        : `from ${dayOfMonth(a)} ${monthName(a, 'en')} to ${dayOfMonth(b)} ${monthName(b, 'en')}`,
    dateLong: (d) => `${dayOfMonth(d)} ${monthName(d, 'en')}`,
  },

  de: {
    name: 'Deutsch',
    interests: {
      cooking: 'Kochen', hiking: 'Wandern', film: 'Film', 'board games': 'Brettspiele', climbing: 'Klettern',
      bookshops: 'Buchläden', jazz: 'Jazz', cycling: 'Radfahren', ceramics: 'Keramik', sailing: 'Segeln',
      chess: 'Schach', photography: 'Fotografie', running: 'Laufen', gardening: 'Gärtnern',
      'live music': 'Livemusik', museums: 'Museen', bouldering: 'Bouldern', baking: 'Backen',
      'language learning': 'Sprachenlernen', surfing: 'Surfen', theatre: 'Theater',
      'vinyl records': 'Schallplatten', yoga: 'Yoga', travel: 'Reisen', podcasts: 'Podcasts',
      astronomy: 'Astronomie', karaoke: 'Karaoke', swimming: 'Schwimmen', 'street food': 'Streetfood',
      sketching: 'Zeichnen', coffee: 'Kaffee', tennis: 'Tennis', volunteering: 'Ehrenamt',
      crosswords: 'Kreuzworträtsel', camping: 'Camping', dancing: 'Tanzen',
    },
    detail: {
      interests: [
        'Du hast {a} und {b} im selben Profil. Das ist eine gute Kombination.',
        '{A} und {b} ist eine ungewöhnliche Mischung.',
        'In deinem Profil stehen {a} und {b}. Das sieht man selten zusammen.',
      ],
      interest: [
        'Du schreibst {a} in dein Profil. Dazu würde ich gern mehr hören.',
        '{A} steht in deinem Profil, und ich würde gern wissen, wie du dazu gekommen bist.',
      ],
      prompt: [
        'Auf "{q}" hast du "{ans}" geschrieben. Das ist eine konkrete Antwort, und sie gefällt mir.',
        'Deine Antwort auf "{q}": "{ans}". Die längere Version würde ich gern hören.',
      ],
      city: [
        'Du bist in {city} zu Hause. Ich würde gern jemanden treffen, der die Stadt richtig kennt.',
      ],
      languages: ['In deinem Profil steht {L}, also schreibe ich dir auf {L}.'],
    },
    presence: {
      until: ['Ich bin bis {until} in {city}.', 'Ich bin noch bis {until} in {city}.'],
      range: ['Ich bin {range} in {city}.', '{Range} bin ich in {city}.'],
    },
    ask: {
      coffee: ['Kaffee am {day}?', 'Hättest du Lust auf einen Kaffee am {day}?'],
      drinks: ['Etwas trinken am {day}?', 'Hättest du Lust, am {day} etwas trinken zu gehen?'],
      dinner: ['Abendessen am {day}?', 'Hättest du Lust auf ein Abendessen am {day}?'],
    },
    followUp: [
      'Dann {Day}. Such du das Lokal aus, ich komme zu dir rüber.',
      '{Day} passt. Such du den Ort aus, ich komme auf deine Seite der Stadt.',
    ],
    reschedule: [
      'Ich muss den Termin am {old} verschieben, tut mir leid. Würde {new} stattdessen passen?',
      'Können wir den {old} verschieben? {New} würde bei mir gehen.',
    ],
    or: ' oder ',
    join: ' — ',
    range: (a, b) =>
      sameMonth(a, b)
        ? `vom ${dayOfMonth(a)}. bis ${dayOfMonth(b)}. ${monthName(b, 'de')}`
        : `vom ${dayOfMonth(a)}. ${monthName(a, 'de')} bis ${dayOfMonth(b)}. ${monthName(b, 'de')}`,
    dateLong: (d) => `${dayOfMonth(d)}. ${monthName(d, 'de')}`,
  },

  es: {
    name: 'español',
    interests: {
      cooking: 'cocinar', hiking: 'senderismo', film: 'cine', 'board games': 'juegos de mesa', climbing: 'escalada',
      bookshops: 'librerías', jazz: 'jazz', cycling: 'ciclismo', ceramics: 'cerámica', sailing: 'vela',
      chess: 'ajedrez', photography: 'fotografía', running: 'correr', gardening: 'jardinería',
      'live music': 'música en directo', museums: 'museos', bouldering: 'búlder', baking: 'repostería',
      'language learning': 'aprender idiomas', surfing: 'surf', theatre: 'teatro',
      'vinyl records': 'discos de vinilo', yoga: 'yoga', travel: 'viajar', podcasts: 'pódcast',
      astronomy: 'astronomía', karaoke: 'karaoke', swimming: 'natación', 'street food': 'comida callejera',
      sketching: 'dibujar', coffee: 'café', tennis: 'tenis', volunteering: 'voluntariado',
      crosswords: 'crucigramas', camping: 'acampar', dancing: 'bailar',
    },
    detail: {
      interests: [
        'Lo de {a} y {b} no me lo esperaba en el mismo perfil.',
        '{A} y {b} en el mismo perfil. Es una combinación rara y buena.',
        'Veo {a} y {b} en tu perfil. No es algo que se vea mucho junto.',
      ],
      interest: [
        'Pones {a} en tu perfil y me gustaría saber más.',
        '{A} aparece en tu perfil, y me gustaría oír cómo llegaste a eso.',
      ],
      prompt: [
        'En "{q}" pusiste "{ans}". Es una respuesta concreta y me gusta.',
        'Tu respuesta a "{q}": "{ans}". Me gustaría oír la versión larga.',
      ],
      city: ['Vives en {city}. Me gustaría conocer a alguien que conozca bien la ciudad.'],
      languages: ['Tu perfil dice {L}, así que te escribo en {L}.'],
    },
    presence: {
      until: ['Estoy en {city} hasta el {until}.', 'Sigo en {city} hasta el {until}.'],
      range: ['Estoy en {city} {range}.', 'Voy a estar en {city} {range}.'],
    },
    ask: {
      coffee: ['¿Un café el {day}?', '¿Te apetece un café el {day}?'],
      drinks: ['¿Tomamos algo el {day}?', '¿Te apetece tomar algo el {day}?'],
      dinner: ['¿Cenamos el {day}?', '¿Te apetece cenar el {day}?'],
    },
    followUp: [
      'Perfecto, el {day}. Elige tú el sitio, yo me muevo.',
      'El {day} me va bien. Elige tú el sitio y yo me acerco.',
    ],
    reschedule: [
      'Tengo que mover lo del {old}, lo siento. ¿Te vendría bien el {new}?',
      '¿Podemos mover lo del {old}? El {new} me viene bien.',
    ],
    or: ' o el ',
    join: ' — ',
    range: (a, b) =>
      sameMonth(a, b)
        ? `del ${dayOfMonth(a)} al ${dayOfMonth(b)} de ${monthName(b, 'es')}`
        : `del ${dayOfMonth(a)} de ${monthName(a, 'es')} al ${dayOfMonth(b)} de ${monthName(b, 'es')}`,
    dateLong: (d) => `${dayOfMonth(d)} de ${monthName(d, 'es')}`,
  },

  nl: {
    name: 'Nederlands',
    interests: {
      cooking: 'koken', hiking: 'wandelen', film: 'film', 'board games': 'bordspellen', climbing: 'klimmen',
      bookshops: 'boekwinkels', jazz: 'jazz', cycling: 'fietsen', ceramics: 'keramiek', sailing: 'zeilen',
      chess: 'schaken', photography: 'fotografie', running: 'hardlopen', gardening: 'tuinieren',
      'live music': 'livemuziek', museums: 'musea', bouldering: 'boulderen', baking: 'bakken',
      'language learning': 'talen leren', surfing: 'surfen', theatre: 'theater',
      'vinyl records': 'vinylplaten', yoga: 'yoga', travel: 'reizen', podcasts: 'podcasts',
      astronomy: 'sterrenkunde', karaoke: 'karaoke', swimming: 'zwemmen', 'street food': 'streetfood',
      sketching: 'tekenen', coffee: 'koffie', tennis: 'tennis', volunteering: 'vrijwilligerswerk',
      crosswords: 'kruiswoordpuzzels', camping: 'kamperen', dancing: 'dansen',
    },
    detail: {
      interests: [
        { ok: 'Je profiel zegt {a} en {b}. Dat is een goede combinatie.', slip: 'Je profiel zegt {a} en {b}. Dat is een goed combinatie.' },
        { ok: '{A} en {b} is een bijzondere combinatie.', slip: '{A} en {b} is een bijzonder combinatie.' },
        { ok: 'Ik zie {a} en {b} in je profiel. Dat zie je niet vaak samen.', slip: 'Ik zie {a} en {b} in je profiel. Dat zie je niet veel samen.' },
      ],
      interest: [
        { ok: 'Je zet {a} in je profiel en ik hoor er graag meer over.', slip: 'Je zet {a} op je profiel en ik hoor er graag meer over.' },
      ],
      prompt: [
        { ok: 'Bij "{q}" schreef je "{ans}". Dat is een concreet antwoord en ik vind het goed.', slip: 'Op "{q}" schreef je "{ans}". Dat is een concreet antwoord en ik vind het goed.' },
      ],
      city: [
        { ok: 'Je woont in {city}. Ik zou graag iemand ontmoeten die de stad goed kent.', slip: 'Je woont in {city}. Ik zou graag iemand ontmoeten die kent de stad goed.' },
      ],
      languages: [
        { ok: 'Mijn Nederlands is nog niet best, maar je profiel zegt {L}, dus ik probeer het in het Nederlands.', slip: 'Mijn Nederlands is nog niet best, maar je profiel zegt {L}, dus ik probeer het in de Nederlands.' },
      ],
    },
    presence: {
      until: [
        { ok: 'Ik ben tot {until} in {city}.', slip: 'Ik ben tot {until} bij {city}.' },
        { ok: 'Ik ben nog tot {until} in {city}.', slip: 'Ik ben nog tot {until} op {city}.' },
      ],
      range: [
        { ok: 'Ik ben {range} in {city}.', slip: 'Ik ben {range} bij {city}.' },
      ],
    },
    ask: {
      coffee: ['Koffie {day}?', { ok: 'Zin om {day} koffie te drinken?', slip: 'Zin om {day} koffie drinken?' }],
      drinks: [{ ok: 'Zin om {day} iets te drinken?', slip: 'Zin om {day} iets drinken?' }, 'Een drankje {day}?'],
      dinner: [{ ok: 'Zin om {day} samen te eten?', slip: 'Zin om {day} samen eten?' }, 'Samen eten {day}?'],
    },
    followUp: [
      { ok: '{Day} is goed. Kies jij maar een plek, ik kom naar jouw kant.', slip: '{Day} is goed. Kies jij maar een plek, ik kom naar jou kant.' },
    ],
    reschedule: [
      { ok: 'Ik moet {old} verplaatsen, sorry. Zou {new} ook kunnen?', slip: 'Ik moet {old} te verplaatsen, sorry. Zou {new} ook kunnen?' },
    ],
    or: ' of ',
    join: ' — ',
    range: (a, b) =>
      sameMonth(a, b)
        ? `van ${dayOfMonth(a)} tot ${dayOfMonth(b)} ${monthName(b, 'nl')}`
        : `van ${dayOfMonth(a)} ${monthName(a, 'nl')} tot ${dayOfMonth(b)} ${monthName(b, 'nl')}`,
    dateLong: (d) => `${dayOfMonth(d)} ${monthName(d, 'nl')}`,
  },
};

/** English interests are the profile's own words, so they map to themselves. */
export function interestIn(lang: DraftLang, interest: string): string {
  return PACKS[lang].interests[interest] ?? interest;
}

export const weekday = weekdayName;
