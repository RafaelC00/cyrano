import { useSyncExternalStore } from 'react';
import { ApiError } from '../api/phase1.ts';
import { agentGet, agentPost, ENDPOINTS } from '../contracts.ts';
import type { CalendarState, DateProposal, Stay } from '../contracts.ts';
import { addDays } from './format.ts';

let current: CalendarState | null = null;
let inflight: Promise<CalendarState> | null = null;
let failure: Error | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** The calendar as the agent holds it. Every change goes through the agent and comes back as the new state. */
export function loadCalendar(force = false): Promise<CalendarState> {
  if (current && !force) return Promise.resolve(current);
  if (force) inflight = null;
  inflight ??= agentGet<CalendarState>(ENDPOINTS.calendar)
    .then((c) => {
      current = c;
      failure = null;
      emit();
      return c;
    })
    .catch((e: Error) => {
      failure = e;
      inflight = null;
      emit();
      throw e;
    });
  return inflight;
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useCalendar = (): { cal: CalendarState | null; error: Error | null } => {
  const cal = useSyncExternalStore(subscribe, () => current);
  const error = useSyncExternalStore(subscribe, () => failure);
  if (!cal && !inflight && !error) void loadCalendar().catch(() => undefined);
  return { cal, error };
};

export const stayOn = (stays: Stay[], date: string): Stay | undefined => stays.find((s) => date >= s.from && date < s.to);

function adopt(next: CalendarState) {
  current = next;
  failure = null;
  emit();
}

/** Marking a date confirmed is a human action: it records that she agreed. It sends nothing. */
export async function confirmProposal(id: string) {
  adopt(await agentPost<CalendarState>(ENDPOINTS.calendarConfirm(id)));
}

/** Gives back every hold with her, or the confirmed date. It sends nothing either. */
export async function dropProposal(id: string) {
  adopt(await agentPost<CalendarState>(ENDPOINTS.calendarDrop(id)));
}

export type MoveResult = { ok: true; message: string } | { ok: false; message: string };

/** Checks a move without doing it: right city that day, not in the past, no overlap. The agent checks again, including sleep. */
export function validateMove(id: string, newStart: string): MoveResult & { end?: string; proposal?: DateProposal } {
  const cal = current;
  const p = cal?.proposals.find((x) => x.id === id);
  if (!cal || !p) return { ok: false, message: 'No such date.' };
  const day = newStart.slice(0, 10);
  const stay = stayOn(cal.stays, day);
  if (day < cal.today) return { ok: false, message: 'That day is in the past.' };
  if (stay?.city !== p.city) {
    return { ok: false, message: `Eric is ${stay ? `in ${stay.city}` : 'not booked anywhere'} on ${day}, and this date is in ${p.city}.` };
  }
  const len = new Date(`${p.end}Z`).getTime() - new Date(`${p.start}Z`).getTime();
  const end = new Date(new Date(`${newStart.slice(0, 19)}Z`).getTime() + len).toISOString().slice(0, 19);
  const clash = cal.proposals.find((x) => x.id !== id && x.status !== 'declined' && x.start < end && x.end > newStart.slice(0, 19));
  if (clash) return { ok: false, message: `That overlaps with ${clash.person.displayName}.` };
  return { ok: true, message: 'ok', end, proposal: p };
}

/** Moves a date to a new local start. The agent refuses a day he is not in the city, a time he sleeps, or a clash. */
export async function moveProposal(id: string, newStart: string): Promise<MoveResult> {
  const v = validateMove(id, newStart);
  if (!v.ok) return v;
  try {
    adopt(await agentPost<CalendarState>(ENDPOINTS.calendarMove(id), { start: newStart.slice(0, 16) }));
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, message: e.message };
    throw e;
  }
  // A moved date is a new proposal: it has to be agreed again.
  return { ok: true, message: `Moved to ${newStart.slice(0, 10)} ${newStart.slice(11, 16)}. It needs their agreement again; nothing has been sent.` };
}

export const weekStart = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
};
