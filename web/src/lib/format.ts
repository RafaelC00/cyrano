const LANGS: Record<string, string> = {
  en: 'English',
  de: 'German',
  es: 'Spanish',
  nl: 'Dutch',
  pt: 'Portuguese',
  fr: 'French',
  it: 'Italian',
};
export const langName = (c: string) => LANGS[c] ?? c.toUpperCase();

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;

export const RULE_LABELS: Record<string, string> = {
  'broad.dormant': 'Inactive too long',
  'age.range': 'Age outside range',
  'orientation.mutual': 'Interest not mutual',
  'city.allowed': 'City not accepted',
  'language.shared': 'No shared language',
  'intent.overlap': 'Different intent',
  'smoking.excluded': 'Smoking exclusion',
  'children.excluded': 'Children exclusion',
  'rank.cutoff': 'Below the cutoff',
  'gate.human': 'Your decision',
  'human.overturn': 'Overturned',
};
/** Neutral names, for rows that may be a pass or a fail. */
export const RULE_NAMES: Record<string, string> = {
  'broad.dormant': 'Recent activity',
  'age.range': 'Age range',
  'orientation.mutual': 'Mutual interest',
  'city.allowed': 'City',
  'language.shared': 'Shared language',
  'intent.overlap': 'Intent',
  'smoking.excluded': 'Smoking',
  'children.excluded': 'Children',
  'rank.cutoff': 'Rank cutoff',
  'gate.human': 'Your decision',
  'human.overturn': 'Overturned',
};
export const ruleName = (id: string) => RULE_NAMES[id] ?? id;
export const ruleLabel = (id: string) => RULE_LABELS[id] ?? id;

export const STAGE_LABELS: Record<string, string> = {
  broad: 'Broad pass',
  rules: 'Rule filter',
  rank: 'Rank',
  gate: 'Your gate',
};

const dtf = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o });
const fmtDay = dtf({ weekday: 'short', day: 'numeric', month: 'short' });
const fmtDayLong = dtf({ weekday: 'long', day: 'numeric', month: 'long' });
const fmtTime = dtf({ hour: '2-digit', minute: '2-digit', hour12: false });
const fmtShort = dtf({ day: 'numeric', month: 'short' });
const fmtStamp = dtf({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** Wall-clock formatting: the ISO strings used by fixtures are local to the city and carry no zone. */
const asUtc = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso.replace(/Z?$/, 'Z'));
export const day = (iso: string) => fmtDay.format(asUtc(iso));
export const dayLong = (iso: string) => fmtDayLong.format(asUtc(iso));
export const time = (iso: string) => fmtTime.format(asUtc(iso));
export const shortDate = (iso: string) => fmtShort.format(asUtc(iso));
export const stamp = (iso: string) => fmtStamp.format(new Date(iso));

export const addDays = (iso: string, n: number) => {
  const d = asUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export const weekdayIndex = (iso: string) => asUtc(iso).getUTCDay();

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
