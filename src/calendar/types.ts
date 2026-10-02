import type { Firmness, Stay } from './itinerary.ts';
import type { DayString } from './time.ts';

export type SlotKind = 'coffee' | 'drinks' | 'dinner';

export interface TimeRange {
  /** ISO 8601 instants with a Z suffix. */
  start: string;
  end: string;
}

export interface BusyBlock extends TimeRange {
  id: string;
  label: string;
  source: 'external' | 'hold' | 'event';
}

/** A concrete time and place Eric could meet someone. Always inside a stay in `city`. */
export interface Slot extends TimeRange {
  /** Deterministic: city, start and kind. The same slot proposed twice has the same id. */
  id: string;
  kind: SlotKind;
  city: string;
  timezone: string;
  /** The wall-clock day in `city`, which can differ from the UTC day. */
  day: DayString;
  /** Wall clock in `city`, e.g. `2026-10-15T20:00`. */
  localStart: string;
  /** The stay this slot sits inside. Drafts cite it when they say where Eric will be. */
  stay: Stay;
  /** `tentative` when the stay is more than a week out and so not booked yet. */
  confidence: Firmness;
}

export interface SlotRequest {
  city: string;
  /** Defaults to today. */
  from?: DayString;
  /** Defaults to `from` + 42 days. */
  to?: DayString;
  kinds?: readonly SlotKind[];
  /** How many slots to return at most. Default 3. */
  count?: number;
}

export interface HoldRequest {
  slot: Slot;
  label: string;
  matchId?: string;
  candidateId?: string;
  /** Default 48. A hold that is not confirmed by then stops blocking the slot. */
  ttlHours?: number;
}

export interface Hold {
  id: string;
  slot: Slot;
  label: string;
  matchId?: string;
  candidateId?: string;
  createdAt: string;
  expiresAt: string;
}

export interface ConfirmDetails {
  /** A venue or neighbourhood, once the two people have agreed on one. */
  place?: string;
}

export interface ConfirmedEvent {
  id: string;
  slot: Slot;
  label: string;
  matchId?: string;
  candidateId?: string;
  place?: string;
  confirmedAt: string;
  /** Stable across re-exports, so importing the .ics twice updates rather than duplicates. */
  uid: string;
}

export type CalendarErrorCode =
  | 'slot_conflict'
  | 'hold_expired'
  | 'not_found'
  | 'not_in_city'
  | 'bad_request'
  | 'provider_disabled'
  | 'auth_expired'
  | 'rate_limited'
  | 'provider_unavailable';

export class CalendarError extends Error {
  readonly code: CalendarErrorCode;
  /** True when the same call could succeed later (rate limit, outage). */
  readonly retryable: boolean;
  constructor(code: CalendarErrorCode, message: string) {
    super(message);
    this.name = 'CalendarError';
    this.code = code;
    this.retryable = code === 'rate_limited' || code === 'provider_unavailable';
  }
}

/**
 * What scheduling needs from a calendar. Mirrors `PlatformAdapter`: one interface, a fully
 * working local implementation, and a documented stub for the real thing.
 *
 * Nothing here sends anything to another person. A hold or confirmation changes only Eric's own
 * calendar; telling her is a message, and messages go through the outbox.
 */
export interface CalendarAdapter {
  readonly name: string;

  /** Everything that already occupies Eric's time inside the range. */
  listBusy(range: TimeRange): Promise<BusyBlock[]>;
  /** Free slots, only on days Eric is in `req.city`, never while he sleeps, never on a clash. */
  proposeSlots(req: SlotRequest): Promise<Slot[]>;
  /** Reserves a slot so nothing else is offered into it. Expires unless confirmed. */
  hold(req: HoldRequest): Promise<Hold>;
  /** Turns a live hold into a confirmed event. */
  confirm(holdId: string, details?: ConfirmDetails): Promise<ConfirmedEvent>;
  /** Releases a hold or removes a confirmed event. Cancelling something already gone is a no-op. */
  cancel(id: string): Promise<void>;
}
