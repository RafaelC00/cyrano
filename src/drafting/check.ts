import { CITY_ZONES } from '../calendar/itinerary.ts';
import type { CheckResult, DraftContext, DraftKind, GeneratedDraft, Rejection, RuleId } from './types.ts';

/**
 * The prohibited-content check. It runs on every draft from every generator, and a draft that
 * fails is never offered.
 *
 * Deliberately conservative and deliberately word-list based: a false positive costs one retry,
 * a false negative costs a message Eric would not have sent. Each rule is independent so a
 * rejection can name exactly one thing. The lists cover the four languages the drafter writes in.
 *
 * What it cannot do: judge tone, or know that a sentence "would read differently if she knew it
 * was software". That last test is the reason a person presses send.
 */

const U = 'iu';
const W = (alts: string) => new RegExp(`(?<![\\p{L}])(?:${alts})(?![\\p{L}])`, U);

/** Appearance, bodies and photographs. Exact words (and plurals), so "photography" is fine. */
const APPEARANCE: RegExp[] = [
  W("beautiful|pretty|gorgeous|handsome|stunning|attractive|sexy|hot|cute|hotties?|smiles?|eyes|hair|photos?|pics?|pictures?|selfies?|bodies|body|physique|good-looking|good looking"),
  /(?<![\p{L}])you(?:'re| are)?\s+look(?:s|ing)?(?![\p{L}])/iu,
  /(?<![\p{L}])(?:your|her)\s+(?:looks|figure)(?![\p{L}])/iu,
  W('schön|schöne|schönes|hübsch|attraktiv|süß|süße|sexy|heiß|lächeln|augen|haare|foto|fotos|bild|bilder|aussehen|figur|körper'),
  W('guapa|guapo|guapísima|bonita|bonito|hermosa|preciosa|linda|atractiva|sexy|sonrisa|ojos|pelo|cabello|foto|fotos|físico|cuerpo|figura'),
  W('mooi|mooie|knap|aantrekkelijk|schattig|sexy|lach|ogen|haar|foto|foto\'s|uiterlijk|lichaam'),
];

/** Words that make a promise or make a plan sound settled. */
const COMMITMENT: RegExp[] = [
  W("i promise|promise you|can't wait|cannot wait|looking forward|definitely|for sure|guarantee|count on me|see you there|see you then|it's a date|our date|our first date|i've booked|i booked|reserved a table|i'll make it work|i'll make time|i'll fly|i'll clear|i'm all yours"),
  W('ich verspreche|versprochen|kann es kaum erwarten|freue mich auf|freu mich auf|auf jeden fall|ganz sicher|unser date|unser erstes date|ich habe reserviert|reserviert|ich komme extra'),
  W('te prometo|prometo|no puedo esperar|tengo ganas de|me hace ilusión|seguro que|sin falta|nuestra cita|he reservado|reservé|lo haré posible'),
  W("ik beloof|beloof|ik kan niet wachten|ik kijk uit naar|zeker weten|onze date|onze eerste date|ik heb gereserveerd|gereserveerd"),
];

const GREETING = /^\s*(?:hey|hi|hello|hallo|hola|hoi|hiya|good (?:morning|evening)|guten (?:morgen|abend)|buenas|buenos días)(?![\p{L}])/iu;

const SMALL_TALK = [
  /how (?:was|is) your (?:weekend|day|week)/i,
  /how are you/i,
  /how(?:'s| is) it going/i,
  /wie war dein (?:wochenende|tag)/i,
  /wie geht(?:'s| es)/i,
  /qué tal tu (?:fin de semana|día)/iu,
  /cómo estás/iu,
  /hoe was je (?:weekend|dag)/i,
  /hoe gaat het/i,
  /what are you up to/i,
];

const PET_NAME = W('babe|baby|honey|darling|sweetheart|sweetie|schatz|süße|süßer|liebling|maus|cariño|mi amor|cielo|corazón|schatje|lieverd|liefje|schat|lieve');

/** A statement that Eric is, was or will be somewhere. Each language's first-person forms. */
const PRESENCE = new RegExp(
  [
    "(?<![\\p{L}])(?:i'm|i am|i'll be|i will be|i'm back|i am back|i'm around|i'm staying|i'm based)(?![\\p{L}])",
    '(?<![\\p{L}])(?:ich bin|bin ich|ich werde|bleibe ich|ich bleibe)(?![\\p{L}])',
    '(?<![\\p{L}])(?:estoy|voy a estar|estaré|estaremos|me quedo)(?![\\p{L}])',
    '(?<![\\p{L}])(?:ik ben|ben ik|ik zit|ik blijf|ik ga naar)(?![\\p{L}])',
  ].join('|'),
  U,
);

const cityPattern = new RegExp(`(?<![\\p{L}])(${Object.keys(CITY_ZONES).join('|')})(?![\\p{L}])`, 'giu');

const norm = (s: string) => s.replace(/[‘’]/g, "'");

function firstMatch(patterns: readonly RegExp[], text: string): string | null {
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

function sentences(text: string): string[] {
  // "25. Oktober" is a date, not the end of a sentence.
  const masked = text.replace(/(\d)\.(?=\s)/g, '$1\u0001');
  return masked
    .split(/(?<=[.!?])\s+|\s[—–]\s|\n+/u)
    .map((s) => s.replace(/\u0001/g, '.').trim())
    .filter(Boolean);
}

function checkAppearance(d: GeneratedDraft): Rejection | null {
  const hit = firstMatch(APPEARANCE, norm(d.body));
  return hit ? { rule: 'appearance', reason: 'A first message must say nothing about how she looks or about her photographs.', excerpt: hit } : null;
}

function checkLocation(d: GeneratedDraft, ctx: DraftContext): Rejection | null {
  for (const c of d.claims) {
    if (!ctx.itinerary.covers(c.city, c.from, c.to)) {
      const actual = ctx.itinerary.stays().filter((s) => s.from <= c.to && s.to >= c.from).map((s) => `${s.city} ${s.from}..${s.to}`);
      return {
        rule: 'false-location',
        reason: `The draft implies Eric is in ${c.city} from ${c.from} to ${c.to}, but his itinerary has ${actual.length ? actual.join('; ') : 'him in no listed city then'}.`,
        excerpt: `${c.city} ${c.from}..${c.to}`,
      };
    }
  }
  // Independent of what the generator declared: any presence sentence naming a city must be backed.
  const claimed = new Set(d.claims.map((c) => c.city.toLowerCase()));
  for (const s of sentences(norm(d.body))) {
    if (!PRESENCE.test(s)) continue;
    for (const m of s.matchAll(cityPattern)) {
      if (!claimed.has(m[1]!.toLowerCase())) {
        return {
          rule: 'false-location',
          reason: `The text says Eric is in ${m[1]} but no checked claim backs it up.`,
          excerpt: s,
        };
      }
    }
  }
  return null;
}

function checkCommitment(d: GeneratedDraft): Rejection | null {
  const hit = firstMatch(COMMITMENT, norm(d.body));
  return hit ? { rule: 'implied-commitment', reason: 'The draft promises or settles something Eric has not decided.', excerpt: hit } : null;
}

/**
 * Is any message allowed in this thread right now? An opener needs an empty thread; a follow-up
 * or reschedule needs her reply to be the last thing said. No wording can change the answer,
 * so the drafter asks this before generating anything.
 */
export function threadRejection(kind: DraftKind, thread: DraftContext['thread']): Rejection | null {
  const last = thread[thread.length - 1];
  if (kind === 'opener') {
    if (thread.some((m) => m.from === 'viewer') && !thread.some((m) => m.from === 'candidate')) {
      return { rule: 'second-message', reason: 'Eric has already written and she has not replied; nothing goes out before a reply.', excerpt: '' };
    }
    if (thread.length > 0) {
      return {
        rule: 'second-message',
        reason: `This thread already has messages${thread[0]?.from === 'candidate' ? ' (she wrote first)' : ''}, so this is a reply, not an opener. Write it by hand.`,
        excerpt: '',
      };
    }
  } else if (!last || last.from !== 'candidate') {
    return { rule: 'second-message', reason: 'Her reply has to come before a follow-up or a reschedule; the last message in the thread is not from her.', excerpt: '' };
  }
  return null;
}

function checkSecondMessage(d: GeneratedDraft, ctx: DraftContext): Rejection | null {
  const state = threadRejection(d.kind, ctx.thread);
  if (state) return state;
  if (/\n\s*\n|^\s*---\s*$|(?<![\p{L}])p\.?s\.?(?![\p{L}])/imu.test(d.body)) {
    return { rule: 'second-message', reason: 'The body contains more than one message (a break, a separator or a P.S.).', excerpt: '' };
  }
  return null;
}

const lower = (s: string) => s.toLowerCase();

function checkCitation(d: GeneratedDraft, ctx: DraftContext): Rejection | null {
  const c = d.citation;
  const decl = ctx.candidate.declared;
  const fail = (reason: string, excerpt = ''): Rejection => ({ rule: 'citation', reason, excerpt });
  if (!c || !c.value.length) return fail('The draft cites no profile detail.');
  if (d.kind === 'opener' && c.field === 'slot') return fail('An opener must cite a declared profile field, not a calendar slot.');
  if (d.kind !== 'opener' && c.field !== 'slot') return fail('Follow-ups and reschedules cite the slot they refer to.');
  switch (c.field) {
    case 'interests':
      for (const v of c.value) if (!decl.interests.includes(v)) return fail(`"${v}" is not among her declared interests.`, v);
      break;
    case 'prompts':
      if (!decl.prompts.some((p) => c.value.includes(p.answer))) return fail('The cited prompt answer is not in her profile.', c.value[0]);
      break;
    case 'city':
      if (c.value[0] !== decl.city) return fail(`Her declared city is ${decl.city}, not ${c.value[0]}.`);
      break;
    case 'languages':
      for (const v of c.value) if (!decl.languages.includes(v)) return fail(`She does not declare "${v}".`, v);
      break;
    case 'slot': {
      const known = new Set([...ctx.slots.map((s) => s.id), ...(ctx.previous ? [ctx.previous.id] : [])]);
      for (const v of c.value) if (!known.has(v)) return fail('The cited slot is not one of the proposed slots.', v);
      break;
    }
  }
  const body = lower(d.body);
  for (const r of c.rendered) {
    if (!body.includes(lower(r))) return fail('The draft claims to use a detail it does not actually contain.', r);
  }
  return null;
}

function checkRegister(d: GeneratedDraft): Rejection[] {
  const out: Rejection[] = [];
  const body = norm(d.body);
  if (GREETING.test(body)) out.push({ rule: 'register-greeting', reason: 'Eric does not open with "hey" or a bare greeting.', excerpt: body.split(/\s+/)[0] ?? '' });
  const small = firstMatch(SMALL_TALK, body);
  if (small) out.push({ rule: 'register-small-talk', reason: 'Eric proposes something; he does not ask how her weekend was.', excerpt: small });
  const pet = PET_NAME.exec(body);
  if (pet) out.push({ rule: 'register-pet-name', reason: 'No pet names.', excerpt: pet[0] });
  const count = sentences(body).length;
  if (count > 4 || body.length > 320) out.push({ rule: 'register-length', reason: 'Two or three lines at most.', excerpt: `${count} sentences, ${body.length} characters` });
  return out;
}

/** Order matters only for which rejection is reported first; every violation is returned. */
export function checkDraft(draft: GeneratedDraft, ctx: DraftContext): CheckResult {
  const checked: RuleId[] = ['appearance', 'false-location', 'implied-commitment', 'second-message', 'citation', 'register-greeting', 'register-small-talk', 'register-pet-name', 'register-length'];
  const all = [
    checkAppearance(draft),
    checkLocation(draft, ctx),
    checkCommitment(draft),
    checkSecondMessage(draft, ctx),
    checkCitation(draft, ctx),
    ...checkRegister(draft),
  ].filter((r): r is Rejection => r !== null);
  return all.length ? { ok: false, rejection: all[0]!, all } : { ok: true, checked };
}
