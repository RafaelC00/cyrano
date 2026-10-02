import type { Slot } from '../calendar/types.ts';
import { dayInZone, daysBetween, weekdayName } from '../calendar/time.ts';
import type { Candidate } from '../domain/types.ts';
import { hashString, mulberry32 } from '../platform/rng.ts';
import type { Rng } from '../platform/rng.ts';
import type { Citation, DraftContext, DraftGenerator, DraftLang, GeneratedDraft, GenerationRefusal, PresenceClaim } from './types.ts';
import { interestIn, PACKS } from './voice.ts';
import type { Pack, Variant } from './voice.ts';

export const TEMPLATE_GENERATOR = 'voice-template-v1';

/**
 * The languages he can write in, in his own order of comfort. This is a tiebreak only.
 * It is not the selection rule: see chooseLanguage.
 */
export const LANGUAGE_ORDER: readonly DraftLang[] = ['de', 'en', 'es', 'nl'];

export interface LanguageChoice {
  language: DraftLang;
  /** False when she lists none of the four and English is a fallback, not a match. */
  matched: boolean;
  /** 'hers' when her own ordering decided it, 'tiebreak' when his comfort did. */
  decidedBy: 'hers' | 'tiebreak' | 'fallback';
}

/**
 * Write to her in her language, not in his.
 *
 * Her declared languages are taken as ordered, most fluent first, which is how these fields
 * are filled in practice. So the rule is: the FIRST language she lists that he can write in.
 * His own order only breaks a tie, and only when she declares several of his languages at the
 * same position, which cannot happen with an ordered list but is kept for callers that pass a
 * set. English is the fallback when there is no overlap, and the result says so.
 *
 * Selecting by his order instead would mean a Dutch woman who also lists English receives
 * English, which contradicts the register rule that he switches to her language, and would
 * make Spanish and Dutch openers almost unreachable.
 */
export function chooseLanguage(declaredLanguages: readonly string[]): LanguageChoice {
  const canWrite = new Set<string>(LANGUAGE_ORDER);
  for (const raw of declaredLanguages) {
    const l = raw.toLowerCase();
    if (canWrite.has(l)) return { language: l as DraftLang, matched: true, decidedBy: 'hers' };
  }
  return { language: 'en', matched: false, decidedBy: 'fallback' };
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** A candidate detail, in the order it is worth using. Tier 1 is the most specific. */
interface Detail {
  tier: 1 | 2 | 3;
  kind: 'interests' | 'interest' | 'prompt' | 'city' | 'languages';
  slots: (lang: DraftLang) => Record<string, string>;
  citation: (lang: DraftLang) => Citation;
}

function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function detailsFor(c: Candidate, lang: DraftLang, rng: Rng): Detail[] {
  const d = c.declared;
  const out: Detail[] = [];

  d.prompts.forEach((p, i) => {
    out.push({
      tier: 1,
      kind: 'prompt',
      slots: () => ({ q: p.question, ans: p.answer }),
      citation: () => ({
        field: 'prompts',
        path: `declared.prompts[${i}]`,
        value: [p.answer],
        rendered: [p.answer],
        summary: `Prompt "${p.question}": "${p.answer}"`,
      }),
    });
  });

  for (let i = 0; i < d.interests.length; i++) {
    for (let j = i + 1; j < d.interests.length; j++) {
      const a = d.interests[i]!;
      const b = d.interests[j]!;
      out.push({
        tier: 1,
        kind: 'interests',
        slots: (l) => ({ a: interestIn(l, a), b: interestIn(l, b), A: cap(interestIn(l, a)) }),
        citation: (l) => ({
          field: 'interests',
          path: `declared.interests[${i}], declared.interests[${j}]`,
          value: [a, b],
          rendered: [interestIn(l, a), interestIn(l, b)],
          summary: `Interests: ${a}, ${b}`,
        }),
      });
    }
  }

  d.interests.forEach((a, i) => {
    out.push({
      tier: 2,
      kind: 'interest',
      slots: (l) => ({ a: interestIn(l, a), A: cap(interestIn(l, a)) }),
      citation: (l) => ({
        field: 'interests',
        path: `declared.interests[${i}]`,
        value: [a],
        rendered: [interestIn(l, a)],
        summary: `Interest: ${a}`,
      }),
    });
  });

  // Writing in her language is itself a detail she gave, but only worth saying when it is not English.
  if (lang !== 'en' && d.languages.map((x) => x.toLowerCase()).includes(lang)) {
    out.push({
      tier: 2,
      kind: 'languages',
      slots: (l) => ({ L: PACKS[l].name }),
      citation: (l) => ({
        field: 'languages',
        path: `declared.languages[${d.languages.findIndex((x) => x.toLowerCase() === lang)}]`,
        value: [d.languages.find((x) => x.toLowerCase() === lang)!],
        rendered: [PACKS[l].name],
        summary: `Language: ${PACKS[l].name}`,
      }),
    });
  }

  out.push({
    tier: 3,
    kind: 'city',
    slots: () => ({ city: d.city }),
    citation: () => ({ field: 'city', path: 'declared.city', value: [d.city], rendered: [d.city], summary: `City: ${d.city}` }),
  });

  const byTier = (t: 1 | 2 | 3) => shuffle(rng, out.filter((x) => x.tier === t));
  return [...byTier(1), ...byTier(2), ...byTier(3)];
}

function pickVariant(rng: Rng, vs: readonly Variant[]): Variant {
  return vs[Math.floor(rng() * vs.length)]!;
}

function fill(template: string, slots: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = slots[k];
    if (v === undefined) throw new Error(`Template slot {${k}} has no value in "${template}"`);
    return v;
  });
}

/** How a day reads inside a sentence: just the weekday when it is close, with the date when it is not. */
function dayPhrase(slot: Slot, now: Date, lang: DraftLang): string {
  const today = dayInZone(now, slot.timezone);
  if (daysBetween(today, slot.day) <= 5) return weekdayName(slot.day, lang);
  const f = new Intl.DateTimeFormat({ en: 'en-GB', de: 'de-DE', es: 'es-ES', nl: 'nl-NL' }[lang], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return f.format(new Date(`${slot.day}T00:00:00Z`));
}

/**
 * The slots one message may propose: the first, plus the second when it is the same kind of
 * meeting in the same stay ("Thursday or Friday"). Anything else would blur what is being asked.
 */
function proposed(slots: readonly Slot[], now: Date): Slot[] {
  const first = slots[0];
  if (!first) return [];
  const second = slots[1];
  // A far-off pair would need two long dates, which breaks "two or three lines": offer one.
  const near = daysBetween(dayInZone(now, first.timezone), first.day) <= 5;
  return near && second && second.kind === first.kind && second.stay.from === first.stay.from && second.stay.city === first.stay.city
    ? [first, second]
    : [first];
}

/** Pick a variant per component; for Dutch, apply exactly one slip among the components that have one. */
function assemble(parts: Array<{ v: Variant; slots: Record<string, string> }>, rng: Rng, slipOn: boolean): { texts: string[]; slips: number } {
  const slippable = parts.map((p, i) => (typeof p.v === 'object' ? i : -1)).filter((i) => i >= 0);
  const slipAt = slipOn && slippable.length ? slippable[Math.floor(rng() * slippable.length)]! : -1;
  let slips = 0;
  const texts = parts.map((p, i) => {
    const raw = typeof p.v === 'string' ? p.v : i === slipAt ? p.v.slip : p.v.ok;
    if (typeof p.v === 'object' && i === slipAt) slips++;
    return fill(raw, p.slots);
  });
  return { texts, slips };
}

/**
 * The free lane: a template-and-slot engine. Variation comes from many small interchangeable
 * pieces (detail sentence, presence sentence, ask, join style), a detail chosen from everything
 * on her profile, real day and date names from the platform's locale data, and the interest
 * vocabulary translated per language. Same inputs give the same draft; `variant` or a retry
 * after a rejection moves to a different detail and different wording. No network, no model.
 */
export class TemplateGenerator implements DraftGenerator {
  readonly name = TEMPLATE_GENERATOR;

  generate(ctx: DraftContext, attempt: number): GeneratedDraft | GenerationRefusal {
    const choice = chooseLanguage(ctx.candidate.declared.languages);
    const lang = choice.language;
    const pack = PACKS[lang];
    const rng = mulberry32(hashString(`${ctx.candidate.id}|${ctx.kind}|${ctx.variant ?? 0}|${attempt}`));
    const slots = proposed(ctx.slots, ctx.now);

    if (ctx.kind === 'opener') return this.opener(ctx, lang, pack, rng, slots, attempt);
    return this.thread(ctx, lang, pack, rng, slots);
  }

  private opener(ctx: DraftContext, lang: DraftLang, pack: Pack, rng: Rng, slots: Slot[], attempt: number): GeneratedDraft | GenerationRefusal {
    const first = slots[0];
    if (!first) {
      return { refused: true, reason: 'no_overlap', message: `Eric is in no city with a free slot near ${ctx.candidate.declared.city} in the planning window, so there is nothing concrete to propose.` };
    }
    // The detail order is fixed per candidate and variant; attempts walk down it.
    const order = detailsFor(ctx.candidate, lang, mulberry32(hashString(`${ctx.candidate.id}|detail|${ctx.variant ?? 0}`)));
    if (!order.length) return { refused: true, reason: 'no_detail', message: 'The profile has nothing specific to draw on.' };
    const detail = order[attempt % order.length]!;

    const dayText = slots.map((s) => dayPhrase(s, ctx.now, lang)).join(pack.or);
    const today = dayInZone(ctx.now, first.timezone);
    const stay = first.stay;
    const inStayNow = stay.from <= today;
    const tentative = first.confidence === 'tentative';

    let presenceSlots: Record<string, string>;
    let presenceVariants: Variant[];
    let claimFrom: string;
    if (inStayNow) {
      const far = daysBetween(today, stay.to) > 6;
      presenceSlots = { city: first.city, until: far ? pack.dateLong(stay.to) : weekdayName(stay.to, lang) };
      presenceVariants = pack.presence.until;
      claimFrom = today;
    } else {
      const range = pack.range(stay.from, stay.to);
      presenceSlots = { city: first.city, range, Range: cap(range) };
      presenceVariants = pack.presence.range;
      claimFrom = stay.from;
    }

    const parts = [
      { v: pickVariant(rng, pack.detail[detail.kind]), slots: detail.slots(lang) },
      { v: pickVariant(rng, presenceVariants), slots: presenceSlots },
      { v: pickVariant(rng, pack.ask[first.kind]), slots: { day: dayText, Day: cap(dayText) } },
    ];
    const { texts, slips } = assemble(parts, rng, lang === 'nl');
    const [detailText, presenceText, askText] = texts as [string, string, string];
    const joined = rng() < 0.4 && presenceText.endsWith('.');
    const body = joined
      ? `${detailText} ${presenceText.slice(0, -1)}${pack.join}${lowerFirstIfAsk(askText, lang)}`
      : `${detailText} ${presenceText} ${askText}`;

    const claims: PresenceClaim[] = [
      { city: first.city, from: claimFrom, to: stay.to, tentative },
      ...slots.map((s) => ({ city: s.city, from: s.day, to: s.day, tentative: s.confidence === 'tentative' })),
    ];
    return {
      kind: 'opener',
      body,
      language: lang,
      citation: detail.citation(lang),
      claims,
      slotIds: slots.map((s) => s.id),
      slips,
      generator: this.name,
    };
  }

  private thread(ctx: DraftContext, lang: DraftLang, pack: Pack, rng: Rng, slots: Slot[]): GeneratedDraft | GenerationRefusal {
    const first = slots[0];
    if (!first) return { refused: true, reason: 'needs_slot', message: `A ${ctx.kind} refers to a date, and none was given.` };
    const dayText = slots.map((s) => dayPhrase(s, ctx.now, lang)).join(pack.or);
    let part: { v: Variant; slots: Record<string, string> };
    if (ctx.kind === 'follow-up') {
      part = { v: pickVariant(rng, pack.followUp), slots: { day: dayText, Day: cap(dayText) } };
    } else {
      if (!ctx.previous) return { refused: true, reason: 'needs_slot', message: 'A reschedule needs the date being moved.' };
      const old = dayPhrase(ctx.previous, ctx.now, lang);
      part = { v: pickVariant(rng, pack.reschedule), slots: { old, new: dayText, New: cap(dayText) } };
    }
    const { texts, slips } = assemble([part], rng, lang === 'nl');
    return {
      kind: ctx.kind,
      body: texts[0]!,
      language: lang,
      citation: {
        field: 'slot',
        path: `slot:${first.id}`,
        value: slots.map((s) => s.id),
        rendered: [dayText],
        summary: `${ctx.kind === 'follow-up' ? 'Date' : 'New date'}: ${first.kind} ${first.localStart.replace('T', ' ')} in ${first.city}`,
      },
      claims: slots.map((s) => ({ city: s.city, from: s.day, to: s.day, tentative: s.confidence === 'tentative' })),
      slotIds: slots.map((s) => s.id),
      slips,
      generator: this.name,
    };
  }
}

/** After an em dash the ask continues the sentence, so a capital letter would read as a new one. */
function lowerFirstIfAsk(text: string, lang: DraftLang): string {
  if (lang === 'de') return text; // German nouns stay capitalised ("Kaffee am Donnerstag?")
  return text.charAt(0).toLowerCase() + text.slice(1);
}
