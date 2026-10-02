import type { Itinerary } from './itinerary.ts';
import { CalendarError } from './types.ts';
import type {
  BusyBlock,
  CalendarAdapter,
  ConfirmDetails,
  ConfirmedEvent,
  Hold,
  HoldRequest,
  Slot,
  SlotRequest,
  TimeRange,
} from './types.ts';

/**
 * RealCalendar: a specification, not an implementation. Constructing it throws.
 *
 * It is disabled because this project spends nothing and holds no accounts: a real calendar
 * means an OAuth consent screen, a registered application, and a person's live schedule. The
 * local calendar plus a standard `.ics` export covers the same interoperability with none of
 * that. What a real provider (a hosted calendar service with an events and free/busy API) would
 * need, which is why the signatures are shaped as they are:
 *
 *  OAuth scopes. Ask for the least that works. Free/busy reads need only a free/busy scope
 *  (read of availability, no event bodies). Holds and confirmations need an events-write scope
 *  limited to a dedicated calendar the user creates for this app, never their primary one.
 *  Refresh tokens are long-lived secrets: store them encrypted, rotate on use where the
 *  provider supports it, and treat a revoked grant as "stop and ask", not "retry".
 *
 *  Free/busy queries. Query all of the user's calendars in one call (a single free/busy request
 *  accepts many calendar ids and one time range) rather than listing events, so private event
 *  titles are never fetched. Providers cap the range per query and the number of calendars; page
 *  by range. Free/busy returns busy intervals only, so `listBusy` maps each to a `BusyBlock`
 *  with an empty label. Tentative or "free" events are reported differently by each provider and
 *  must be normalised here, not in callers.
 *
 *  Time zones. The wire format is RFC 3339 with an offset; a recurring or floating event is
 *  expressed in a named zone. Convert on the way in and out and keep instants in UTC inside this
 *  system. The traps: a slot that does not exist (spring-forward) or exists twice (autumn),
 *  all-day events that mean "busy in whichever city I am in", and a calendar whose own default
 *  zone is the city he left. A provider calendar does not know where he is, so `proposeSlots`
 *  still needs the itinerary, and the stub takes it in its options for that reason.
 *
 *  Failure modes. Every one surfaces as a typed `CalendarError`, never as an empty list:
 *   - `auth_expired`: token revoked or expired and refresh failed. Halt; do not retry.
 *   - `rate_limited`: honour `Retry-After`, exponential backoff with jitter (retryable).
 *   - `provider_unavailable`: 5xx or network failure; retry, and breaker after repeated failure.
 *   - `slot_conflict`: someone else booked the time between proposal and hold. Re-propose.
 *   - `hold_expired`: the hold lapsed before confirmation. A hold is a provider "tentative"
 *     event with an expiry this app enforces itself, since providers have no hold primitive.
 *   - Silent staleness: sync tokens that expire (full re-sync required) and calendars shared
 *     read-only that accept a write call and drop it. Verify with a read-back after every write.
 *  Writes must be idempotent: key every created event on a client-side id so a retry after a
 *  timeout cannot create a duplicate dinner.
 */
export interface RealCalendarOptions {
  /** OAuth grant for the dedicated calendar. Scopes: free/busy read, events write on that calendar. */
  auth: { kind: 'oauth'; accessToken: string; refresh: () => Promise<string> };
  /** The dedicated calendar holds and events are written to. */
  calendarId: string;
  /** Calendars whose busy time counts. Read through free/busy only. */
  readCalendarIds: readonly string[];
  /** Where he is, since the provider cannot say. */
  itinerary: Itinerary;
  rateLimit: { requestsPerMinute: number };
  backoff: { baseMs: number; maxMs: number; maxAttempts: number };
}

export class RealCalendarDisabledError extends CalendarError {
  constructor() {
    super(
      'provider_disabled',
      'RealCalendar is intentionally disabled. It would need an OAuth grant to a live calendar, which this project does not hold. ' +
        'Use LocalCalendar, and hand the confirmed date to any calendar app with the standard .ics export.',
    );
    this.name = 'RealCalendarDisabledError';
  }
}

function unreachable(): never {
  throw new RealCalendarDisabledError();
}

export class RealCalendar implements CalendarAdapter {
  readonly name = 'real';

  constructor(_opts: RealCalendarOptions) {
    throw new RealCalendarDisabledError();
  }

  /** One free/busy request across `readCalendarIds`; map intervals to blocks; page by range. */
  listBusy(_range: TimeRange): Promise<BusyBlock[]> {
    return unreachable();
  }

  /** Itinerary and rhythm come from this system; busy time comes from `listBusy`. */
  proposeSlots(_req: SlotRequest): Promise<Slot[]> {
    return unreachable();
  }

  /** A tentative event on the dedicated calendar with a client-side idempotency key and an expiry. */
  hold(_req: HoldRequest): Promise<Hold> {
    return unreachable();
  }

  /** Re-check free/busy, then promote the tentative event to confirmed and read it back. */
  confirm(_holdId: string, _details?: ConfirmDetails): Promise<ConfirmedEvent> {
    return unreachable();
  }

  /** Delete the event; treat "already gone" as success. */
  cancel(_id: string): Promise<void> {
    return unreachable();
  }
}
