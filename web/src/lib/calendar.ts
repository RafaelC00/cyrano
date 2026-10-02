import { useSyncExternalStore } from 'react';
import { agent } from '../api/phase1.ts';
import { ENDPOINTS, fromSeam, postSeam } from '../contracts.ts';
import type { CalendarState, DateProposal, ProposalStatus, Sourced, Stay } from '../contracts.ts';
import { fixtureCalendar } from '../fixtures.ts';
import { gateMemory, loadPool } from './data.ts';
import { addDays } from './format.ts';

let current: Sourced<CalendarState> | null = null;
let inflight: Promise<Sourced<CalendarState>> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function loadCalendar(): Promise<Sourced<CalendarState>> {
  if (current) return Promise.resolve(current);
  inflight ??= fromSeam<CalendarState>(ENDPOINTS.calendar, async () => {
    const [pool, gate] = await Promise.all([loadPool().catch(() => []), agent.gate().catch(() => [])]);
    for (const g of gate) gateMemory.set(g.candidateId, g);
    return fixtureCalendar(pool, [...gate.map((g) => g.candidateId), ...gateMemory.keys()]);
  }).then((c) => {
    current = c;
    emit();
    return c;
  });
  return inflight;
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useCalendar = (): Sourced<CalendarState> | null => {
  const c = useSyncExternalStore(subscribe, () => current);
  if (!c && !inflight) void loadCalendar();
  return c;
};

export const stayOn = (stays: Stay[], date: string): Stay | undefined => stays.find((s) => date >= s.from && date < s.to);

function replace(id: string, patch: Partial<DateProposal>) {
  if (!current) return;
  current = { ...current, data: { ...current.data, proposals: current.data.proposals.map((p) => (p.id === id ? { ...p, ...patch } : p)) } };
  emit();
}

/** Marking a date confirmed is a human action: it records that she agreed. It sends nothing. */
export async function setStatus(id: string, status: ProposalStatus) {
  await postSeam(status === 'confirmed' ? ENDPOINTS.calendarConfirm(id) : `${ENDPOINTS.calendar}/${id}/${status}`, {}, () => null);
  replace(id, { status });
}

export type MoveResult = { ok: true; message: string } | { ok: false; message: string };

/** Checks a move without doing it: right city that day, not in the past, no overlap. */
export function validateMove(id: string, newStart: string): (MoveResult & { end?: string; proposal?: DateProposal }) {
  const cal = current?.data;
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

/** Moves a proposal to a new local start, keeping its length. Refuses a day he is not in the date's city. */
export async function moveProposal(id: string, newStart: string): Promise<MoveResult> {
  const v = validateMove(id, newStart);
  if (!v.ok) return v;
  await postSeam(ENDPOINTS.calendarMove(id), { start: newStart }, () => null);
  // A moved date is a new proposal: it has to be agreed again.
  replace(id, { start: newStart.slice(0, 19), end: v.end!, status: 'proposed' });
  return { ok: true, message: `Moved to ${newStart.slice(0, 10)} ${newStart.slice(11, 16)}. It needs their agreement again; nothing has been sent.` };
}

export const weekStart = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
};
