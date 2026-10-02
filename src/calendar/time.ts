/**
 * Small date helpers. A "day" is a calendar date string (YYYY-MM-DD) with no time zone of its
 * own; an "instant" is a real moment (Date / ISO string with Z). Conversion between the two
 * always names a zone, using the platform's built-in tz database (no dependency, no network).
 */
export type DayString = string;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDayString(s: unknown): s is DayString {
  if (typeof s !== 'string') return false;
  const m = DAY_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return d.getUTCFullYear() === +m[1]! && d.getUTCMonth() === +m[2]! - 1 && d.getUTCDate() === +m[3]!;
}

export function assertDay(s: string, what = 'day'): DayString {
  if (!isDayString(s)) throw new RangeError(`${what} must be a valid YYYY-MM-DD date, got "${s}"`);
  return s;
}

function dayToUtcMs(day: DayString): number {
  const m = DAY_RE.exec(day)!;
  return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
}

export function addDays(day: DayString, n: number): DayString {
  return new Date(dayToUtcMs(day) + n * 86_400_000).toISOString().slice(0, 10);
}

export function daysBetween(a: DayString, b: DayString): number {
  return Math.round((dayToUtcMs(b) - dayToUtcMs(a)) / 86_400_000);
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(day: DayString): number {
  return new Date(dayToUtcMs(day)).getUTCDay();
}

export function dayRange(from: DayString, to: DayString): DayString[] {
  const out: DayString[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(zone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    dtfCache.set(zone, f);
  }
  return f;
}

function zoned(instant: Date, zone: string): Record<string, string> {
  return Object.fromEntries(partsFormatter(zone).formatToParts(instant).map((x) => [x.type, x.value]));
}

/** Offset of `zone` from UTC at the given instant, in milliseconds (east is positive). */
export function zoneOffsetMs(instantMs: number, zone: string): number {
  const p = zoned(new Date(instantMs), zone);
  const asUtc = Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!, +p.second!);
  return asUtc - Math.floor(instantMs / 1000) * 1000;
}

/** The wall-clock calendar day of an instant in a zone. */
export function dayInZone(instant: Date, zone: string): DayString {
  const p = zoned(instant, zone);
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * The instant at which a zone's wall clock reads `day` `hhmm`. Correct across DST changes for
 * every time that exists; for a time skipped by a spring-forward it returns an instant just
 * after the gap, and for an ambiguous autumn time it returns one of the two.
 */
export function localToInstant(day: DayString, hhmm: string, zone: string): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`time must be HH:MM, got "${hhmm}"`);
  const naive = dayToUtcMs(day) + (+m[1]! * 60 + +m[2]!) * 60_000;
  let guess = naive - zoneOffsetMs(naive, zone);
  guess = naive - zoneOffsetMs(guess, zone);
  return new Date(guess);
}

const LOCALES = { en: 'en-GB', de: 'de-DE', es: 'es-ES', nl: 'nl-NL' } as const;
export type Lang = keyof typeof LOCALES;

/** Weekday and month names come from the platform's ICU data, so every language is correct. */
export function weekdayName(day: DayString, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { weekday: 'long', timeZone: 'UTC' }).format(new Date(dayToUtcMs(day)));
}

export function monthName(day: DayString, lang: Lang): string {
  return new Intl.DateTimeFormat(LOCALES[lang], { month: 'long', timeZone: 'UTC' }).format(new Date(dayToUtcMs(day)));
}

export function dayOfMonth(day: DayString): number {
  return +DAY_RE.exec(day)![3]!;
}

/** "Thu 15 Oct 20:00" in the zone. English, for briefs and calendar descriptions. */
export function formatLocal(instant: Date, zone: string): string {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.hour}:${p.minute}`;
}
