import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildIcs } from './ics.ts';
import { zoneOf } from './itinerary.ts';
import type { Itinerary } from './itinerary.ts';
import { computeSlots, ERIC_RHYTHM } from './slots.ts';
import type { Rhythm } from './slots.ts';
import { dayInZone } from './time.ts';
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

export interface LocalCalendarOptions {
  itinerary: Itinerary;
  rhythm?: Rhythm;
  clock?: () => Date;
  /** JSON file for state. Omit for an in-memory calendar. Written atomically on every change. */
  storagePath?: string;
  /** Hold lifetime when a request does not say. Default 48 hours. */
  defaultHoldHours?: number;
}

interface State {
  version: 1;
  seq: number;
  busy: BusyBlock[];
  holds: Hold[];
  events: ConfirmedEvent[];
}

const empty = (): State => ({ version: 1, seq: 0, busy: [], holds: [], events: [] });

const overlaps = (a: TimeRange, b: TimeRange) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/**
 * The fully implemented calendar. It knows where Eric is (the itinerary), when he sleeps (the
 * rhythm), and what is already booked, and it keeps holds and confirmed dates in a JSON file so
 * they survive a restart. Nothing here touches a network or an account.
 */
export class LocalCalendar implements CalendarAdapter {
  readonly name = 'local';
  readonly itinerary: Itinerary;
  private rhythm: Rhythm;
  private clock: () => Date;
  private path: string | undefined;
  private holdHours: number;
  private state: State;

  constructor(opts: LocalCalendarOptions) {
    this.itinerary = opts.itinerary;
    this.rhythm = opts.rhythm ?? ERIC_RHYTHM;
    this.clock = opts.clock ?? (() => new Date());
    this.path = opts.storagePath;
    this.holdHours = opts.defaultHoldHours ?? 48;
    this.state = this.path && existsSync(this.path) ? this.load(this.path) : empty();
  }

  private load(path: string): State {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<State>;
    if (raw.version !== 1 || !Array.isArray(raw.busy) || !Array.isArray(raw.holds) || !Array.isArray(raw.events)) {
      throw new CalendarError('bad_request', `Calendar file ${path} is not a version 1 calendar; refusing to overwrite it`);
    }
    return { version: 1, seq: raw.seq ?? 0, busy: raw.busy, holds: raw.holds, events: raw.events };
  }

  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    renameSync(tmp, this.path);
  }

  private nextId(prefix: string): string {
    this.state.seq += 1;
    return `${prefix}_${String(this.state.seq).padStart(3, '0')}`;
  }

  /** Drops holds that ran out. Called before every read so an expired hold never blocks. */
  private expire(): void {
    const now = this.clock().getTime();
    const live = this.state.holds.filter((h) => Date.parse(h.expiresAt) > now);
    if (live.length !== this.state.holds.length) {
      this.state.holds = live;
      this.save();
    }
  }

  /** Something already in Eric's day that this calendar did not create, e.g. a call. */
  addBusy(block: Omit<BusyBlock, 'id' | 'source'>): BusyBlock {
    const b: BusyBlock = { ...block, id: this.nextId('busy'), source: 'external' };
    this.state.busy.push(b);
    this.save();
    return b;
  }

  async listBusy(range: TimeRange): Promise<BusyBlock[]> {
    return this.busyNow().filter((b) => overlaps(b, range)).sort((a, b) => a.start.localeCompare(b.start));
  }

  private busyNow(exceptId?: string): BusyBlock[] {
    this.expire();
    return [
      ...this.state.busy,
      ...this.state.holds.map((h): BusyBlock => ({ id: h.id, start: h.slot.start, end: h.slot.end, label: h.label, source: 'hold' })),
      ...this.state.events.map((e): BusyBlock => ({ id: e.id, start: e.slot.start, end: e.slot.end, label: e.label, source: 'event' })),
    ].filter((b) => b.id !== exceptId);
  }

  async proposeSlots(req: SlotRequest): Promise<Slot[]> {
    zoneOf(req.city); // fail loudly on an unknown city
    return computeSlots({ itinerary: this.itinerary, rhythm: this.rhythm, now: this.clock(), req, busy: this.busyNow() });
  }

  /** Same checks a proposal passes on presence and clashes, so a forged slot cannot get in. */
  private validate(slot: Slot, exceptId?: string): void {
    const zone = zoneOf(slot.city);
    if (dayInZone(new Date(slot.start), zone) !== slot.day) {
      throw new CalendarError('bad_request', `Slot ${slot.id} says ${slot.day} but its start is a different day in ${slot.city}`);
    }
    if (!this.itinerary.isIn(slot.city, slot.day)) {
      throw new CalendarError('not_in_city', `Eric is not in ${slot.city} on ${slot.day}; refusing to hold a date there`);
    }
    if (Date.parse(slot.start) <= this.clock().getTime()) {
      throw new CalendarError('bad_request', `Slot ${slot.id} is in the past`);
    }
    const clash = this.busyNow(exceptId).find((b) => overlaps(b, slot));
    if (clash) throw new CalendarError('slot_conflict', `Slot ${slot.id} clashes with ${clash.source} "${clash.label}" (${clash.id})`);
  }

  async hold(req: HoldRequest): Promise<Hold> {
    this.validate(req.slot);
    const now = this.clock();
    const hours = req.ttlHours ?? this.holdHours;
    const hold: Hold = {
      id: this.nextId('hold'),
      slot: req.slot,
      label: req.label,
      matchId: req.matchId,
      candidateId: req.candidateId,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + hours * 3_600_000).toISOString(),
    };
    this.state.holds.push(hold);
    this.save();
    return hold;
  }

  async confirm(holdId: string, details: ConfirmDetails = {}): Promise<ConfirmedEvent> {
    const already = this.state.events.find((e) => e.id === holdId);
    if (already) return already; // idempotent: confirming twice is the same event
    const hold = this.state.holds.find((h) => h.id === holdId);
    if (!hold) throw new CalendarError('not_found', `No hold ${holdId}`);
    if (Date.parse(hold.expiresAt) <= this.clock().getTime()) {
      this.expire();
      throw new CalendarError('hold_expired', `Hold ${holdId} expired at ${hold.expiresAt}; propose the slot again`);
    }
    this.validate(hold.slot, holdId); // a clash added since the hold was placed is caught here
    const event: ConfirmedEvent = {
      id: hold.id,
      slot: hold.slot,
      label: hold.label,
      matchId: hold.matchId,
      candidateId: hold.candidateId,
      place: details.place,
      confirmedAt: this.clock().toISOString(),
      uid: `${randomUUID()}@cyrano.invalid`,
    };
    this.state.holds = this.state.holds.filter((h) => h.id !== holdId);
    this.state.events.push(event);
    this.save();
    return event;
  }

  async cancel(id: string): Promise<void> {
    const before = this.state.holds.length + this.state.events.length + this.state.busy.length;
    this.state.holds = this.state.holds.filter((h) => h.id !== id);
    this.state.events = this.state.events.filter((e) => e.id !== id);
    this.state.busy = this.state.busy.filter((b) => b.id !== id);
    if (this.state.holds.length + this.state.events.length + this.state.busy.length !== before) this.save();
  }

  listHolds(): Hold[] {
    this.expire();
    return [...this.state.holds];
  }

  listEvents(): ConfirmedEvent[] {
    return [...this.state.events].sort((a, b) => a.slot.start.localeCompare(b.slot.start));
  }

  getEvent(id: string): ConfirmedEvent {
    const e = this.state.events.find((x) => x.id === id);
    if (!e) throw new CalendarError('not_found', `No confirmed event ${id}`);
    return e;
  }

  /** The .ics text for a confirmed event. Standard RFC 5545; no account, no API. */
  exportIcs(eventId: string): string {
    return buildIcs(this.getEvent(eventId));
  }
}
