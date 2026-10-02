import { zoneOf } from './itinerary.ts';
import type { Itinerary } from './itinerary.ts';
import { addDays, dayInZone, dayRange, localToInstant, weekdayOf, zoneOffsetMs } from './time.ts';
import type { DayString } from './time.ts';
import type { BusyBlock, Slot, SlotKind, SlotRequest } from './types.ts';

/**
 * How Eric's body clock constrains a meeting. He trades Asian hours, so wherever he is west of
 * Southeast Asia he is asleep through the late-UTC morning and wakes for the Asia open. When he
 * is actually in Asia his day is ordinary and he sleeps at night local time.
 */
export interface Rhythm {
  /** Sleep window in UTC hours, used in every zone west of UTC+7. */
  sleepUtc: { startHour: number; endHour: number };
  /** Sleep window in local hours, used in zones at UTC+7 or further east. */
  asiaSleepLocal: { startHour: number; endHour: number };
  /** Nothing starts until this long after he wakes. */
  wakeBufferMin: number;
  /** Nothing runs into this long before he sleeps. */
  bedBufferMin: number;
}

export const ERIC_RHYTHM: Rhythm = {
  sleepUtc: { startHour: 3, endHour: 10 },
  asiaSleepLocal: { startHour: 0, endHour: 8 },
  wakeBufferMin: 90,
  bedBufferMin: 30,
};

const HOUR = 3_600_000;
const MIN = 60_000;

/** Sleep intervals (UTC ms) that could touch [fromMs, toMs], already padded by the buffers. */
export function sleepIntervals(r: Rhythm, zone: string, fromMs: number, toMs: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const pad = (s: number, e: number): [number, number] => [s - r.bedBufferMin * MIN, e + r.wakeBufferMin * MIN];
  const eastern = zoneOffsetMs(fromMs, zone) >= 7 * HOUR;
  if (!eastern) {
    const firstDay = new Date(fromMs - 86_400_000).toISOString().slice(0, 10);
    const lastDay = new Date(toMs + 86_400_000).toISOString().slice(0, 10);
    for (const d of dayRange(firstDay, lastDay)) {
      const base = Date.parse(`${d}T00:00:00Z`);
      out.push(pad(base + r.sleepUtc.startHour * HOUR, base + r.sleepUtc.endHour * HOUR));
    }
  } else {
    const firstDay = addDays(dayInZone(new Date(fromMs), zone), -1);
    const lastDay = addDays(dayInZone(new Date(toMs), zone), 1);
    for (const d of dayRange(firstDay, lastDay)) {
      const s = localToInstant(d, hhmm(r.asiaSleepLocal.startHour), zone).getTime();
      const e = localToInstant(d, hhmm(r.asiaSleepLocal.endHour), zone).getTime();
      out.push(pad(s, e));
    }
  }
  return out;
}

const hhmm = (h: number) => `${String(h).padStart(2, '0')}:00`;

const overlaps = (aS: number, aE: number, bS: number, bE: number) => aS < bE && bS < aE;

export function isAsleep(r: Rhythm, zone: string, startMs: number, endMs: number): boolean {
  return sleepIntervals(r, zone, startMs, endMs).some(([s, e]) => overlaps(startMs, endMs, s, e));
}

/** Local start times tried per kind, earliest first, and how long each lasts. */
export const SLOT_SHAPES: Readonly<Record<SlotKind, { times: readonly string[]; minutes: number; weight: number }>> = {
  coffee: { times: ['11:30', '15:00'], minutes: 60, weight: 0.6 },
  drinks: { times: ['18:30'], minutes: 90, weight: 0.9 },
  dinner: { times: ['20:00'], minutes: 120, weight: 1 },
};

/** Midweek and weekend evenings are better first dates than Monday or Sunday night. */
const DAY_WEIGHT = [0.7, 0.6, 0.85, 0.95, 1, 1, 1]; // Sun..Sat

export interface ProposeInput {
  itinerary: Itinerary;
  rhythm: Rhythm;
  now: Date;
  req: SlotRequest;
  /** Everything already on Eric's calendar. */
  busy: readonly Pick<BusyBlock, 'start' | 'end'>[];
  /** Hours from now before which nothing is offered. Default 18. */
  minLeadHours?: number;
  /** Travel and breathing room around anything already booked. Default 45 minutes. */
  busyBufferMin?: number;
}

/**
 * Pure slot proposal. Rules, in order of importance:
 *  1. Only days Eric is in `req.city`, per the itinerary. The arrival and departure days are
 *     skipped: he is in transit, and flights move.
 *  2. Never while he sleeps (see `Rhythm`), never inside the lead time, never on a clash with
 *     anything busy plus a buffer.
 *  3. At most one slot per day; the best `count` days by a small preference score, returned in
 *     chronological order.
 */
export function computeSlots(input: ProposeInput): Slot[] {
  const { itinerary, rhythm, now, req } = input;
  const zone = zoneOf(req.city);
  const kinds = req.kinds?.length ? req.kinds : (['dinner', 'drinks', 'coffee'] as const);
  const count = req.count ?? 3;
  const today = dayInZone(now, zone);
  const from = req.from && req.from > today ? req.from : today;
  const to = req.to ?? addDays(from, 42);
  const earliest = now.getTime() + (input.minLeadHours ?? 18) * HOUR;
  const bufferMs = (input.busyBufferMin ?? 45) * MIN;
  const busy = input.busy.map((b) => [Date.parse(b.start) - bufferMs, Date.parse(b.end) + bufferMs] as const);

  const best: Array<{ slot: Slot; score: number }> = [];
  for (const stay of itinerary.staysIn(req.city, from, to)) {
    const confidence = itinerary.firmness(stay, today);
    for (const day of dayRange(addDays(stay.from, 1), addDays(stay.to, -1))) {
      if (day < from || day > to) continue;
      let chosen: { slot: Slot; score: number } | null = null;
      for (const kind of kinds) {
        const shape = SLOT_SHAPES[kind];
        for (const t of shape.times) {
          const start = localToInstant(day, t, zone);
          const sMs = start.getTime();
          const eMs = sMs + shape.minutes * MIN;
          if (sMs < earliest) continue;
          if (isAsleep(rhythm, zone, sMs, eMs)) continue;
          if (busy.some(([bs, be]) => overlaps(sMs, eMs, bs, be))) continue;
          const lead = (sMs - now.getTime()) / (24 * HOUR);
          const score = shape.weight * (DAY_WEIGHT[weekdayOf(day)] ?? 0.5) - 0.004 * lead;
          if (!chosen || score > chosen.score) {
            const startIso = start.toISOString();
            chosen = {
              score,
              slot: {
                id: `${req.city}|${startIso}|${kind}`,
                kind,
                city: req.city,
                timezone: zone,
                day,
                localStart: `${day}T${t}`,
                start: startIso,
                end: new Date(eMs).toISOString(),
                stay,
                confidence,
              },
            };
          }
          break; // first feasible time for this kind is the one we use
        }
      }
      if (chosen) best.push(chosen);
    }
  }
  return best
    .sort((a, b) => b.score - a.score || a.slot.start.localeCompare(b.slot.start))
    .slice(0, count)
    .map((b) => b.slot)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export type { DayString };
