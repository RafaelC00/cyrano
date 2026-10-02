import { writeIcs } from '../calendar/ics.ts';
import { CalendarError } from '../calendar/types.ts';
import type { CalendarAdapter, ConfirmedEvent, Hold, Slot, SlotKind } from '../calendar/types.ts';
import type { Candidate, DeclaredProfile } from '../domain/types.ts';

/**
 * proposed:  slots are held on Eric's calendar and offered to her; no answer yet
 * confirmed: she picked one; it is an event on his calendar; the others are released
 * released: nothing came of it; every hold was given back
 */
export type DateStatus = 'proposed' | 'confirmed' | 'released';

export interface PlannedDate {
  candidateId: string;
  name: string;
  matchId?: string;
  /** Her declared profile when the plan was made. Lets the brief explain her without the funnel. */
  declared?: DeclaredProfile;
  /** Her city, which is where every slot is. */
  city: string;
  status: DateStatus;
  slots: Slot[];
  holds: Array<{ slotId: string; holdId: string }>;
  eventId?: string;
  /** The slot she chose, once confirmed. */
  chosen?: Slot;
  place?: string;
  proposedAt: string;
  confirmedAt?: string;
}

export interface ProposeOptions {
  matchId?: string;
  count?: number;
  kinds?: readonly SlotKind[];
  /** Hold lifetime in hours. Default is the calendar's own. */
  holdHours?: number;
}

/**
 * Turns "she is in Lisbon" into "three evenings Eric can be there", holds them so nothing else
 * is offered into them, and carries one through to a confirmed date and an .ics file.
 *
 * It only ever changes Eric's own calendar. Telling her which slots are on offer is a message,
 * and a message is a draft a person approves; this class has no way to send one.
 */
export class Scheduler {
  private calendar: CalendarAdapter;
  private clock: () => Date;
  private plans = new Map<string, PlannedDate>();

  constructor(calendar: CalendarAdapter, clock: () => Date = () => new Date()) {
    this.calendar = calendar;
    this.clock = clock;
  }

  /**
   * Proposes slots in her city and holds each of them. Returns a plan with no slots when Eric is
   * not in her city in the window: the honest answer to "when can we meet there" is "not soon".
   */
  async propose(candidate: Candidate, opts: ProposeOptions = {}): Promise<PlannedDate> {
    const existing = this.plans.get(candidate.id);
    if (existing?.status === 'confirmed') {
      throw new CalendarError('bad_request', `A date with ${existing.name} is already confirmed; release it before proposing another`);
    }
    await this.release(candidate.id); // a new proposal replaces the old one
    const city = candidate.declared.city;
    const slots = await this.calendar.proposeSlots({ city, count: opts.count ?? 3, kinds: opts.kinds });
    const holds: PlannedDate['holds'] = [];
    const held: Slot[] = [];
    for (const slot of slots) {
      try {
        const h: Hold = await this.calendar.hold({
          slot,
          label: candidate.displayName,
          matchId: opts.matchId,
          candidateId: candidate.id,
          ttlHours: opts.holdHours,
        });
        holds.push({ slotId: slot.id, holdId: h.id });
        held.push(slot);
      } catch (e) {
        if (!(e instanceof CalendarError && e.code === 'slot_conflict')) throw e;
        // Someone took it between the proposal and the hold; offer fewer rather than a slot we do not own.
      }
    }
    const plan: PlannedDate = {
      candidateId: candidate.id,
      name: candidate.displayName,
      matchId: opts.matchId,
      declared: candidate.declared,
      city,
      status: held.length ? 'proposed' : 'released',
      slots: held,
      holds,
      proposedAt: this.clock().toISOString(),
    };
    this.plans.set(candidate.id, plan);
    return plan;
  }

  /** She picked a slot. Confirms that hold, gives the others back. */
  async confirm(candidateId: string, slotId: string, details: { place?: string } = {}): Promise<ConfirmedEvent> {
    const plan = this.require(candidateId);
    if (plan.status !== 'proposed') throw new CalendarError('bad_request', `Date with ${plan.name} is ${plan.status}, not waiting for an answer`);
    const chosen = plan.holds.find((h) => h.slotId === slotId);
    if (!chosen) throw new CalendarError('not_found', `Slot ${slotId} was not proposed to ${plan.name}`);
    const event = await this.calendar.confirm(chosen.holdId, details);
    for (const h of plan.holds) if (h.holdId !== chosen.holdId) await this.calendar.cancel(h.holdId);
    plan.status = 'confirmed';
    plan.eventId = event.id;
    plan.chosen = event.slot;
    plan.place = event.place;
    plan.confirmedAt = event.confirmedAt;
    plan.holds = [{ slotId, holdId: chosen.holdId }];
    return event;
  }

  /** Gives back every hold (and cancels a confirmed event). For a declined offer or a discarded draft. */
  async release(candidateId: string): Promise<void> {
    const plan = this.plans.get(candidateId);
    if (!plan) return;
    for (const h of plan.holds) await this.calendar.cancel(h.holdId);
    plan.holds = [];
    plan.status = 'released';
  }

  /** Writes the confirmed date as a standard .ics file and returns its path. */
  async exportIcs(candidateId: string, dir: string, event: ConfirmedEvent): Promise<string> {
    const plan = this.require(candidateId);
    if (plan.status !== 'confirmed' || plan.eventId !== event.id) throw new CalendarError('bad_request', `No confirmed date with ${plan.name} matches that event`);
    return writeIcs(event, dir);
  }

  get(candidateId: string): PlannedDate | undefined {
    return this.plans.get(candidateId);
  }

  list(): PlannedDate[] {
    return [...this.plans.values()];
  }

  private require(candidateId: string): PlannedDate {
    const plan = this.plans.get(candidateId);
    if (!plan) throw new CalendarError('not_found', `No date planned with ${candidateId}`);
    return plan;
  }
}
