import { LocalCalendar } from '../src/calendar/local.ts';
import type { LocalCalendarOptions } from '../src/calendar/local.ts';
import type { Candidate } from '../src/domain/types.ts';
import type { DraftContext } from '../src/drafting/types.ts';
import { ericItinerary } from '../src/schedule/persona.ts';
import { candidate } from './helpers.ts';

/** Friday 2 October 2026, 09:00 UTC: Eric is in Singapore until Thursday. */
export const NOW = new Date('2026-10-02T09:00:00.000Z');
export const TODAY = '2026-10-02';

export function makeCalendar(opts: Partial<LocalCalendarOptions> = {}) {
  let t = NOW.getTime();
  const clock = () => new Date(t);
  const advance = (ms: number) => {
    t += ms;
  };
  const itinerary = opts.itinerary ?? ericItinerary(TODAY);
  const calendar = new LocalCalendar({ itinerary, clock, ...opts });
  return { calendar, itinerary, clock, advance };
}

export function person(declared: Partial<Candidate['declared']> = {}, id = 'p_test', name = 'Testa Quillfield'): Candidate {
  const c = candidate({
    city: 'Amsterdam',
    country: 'NL',
    languages: ['en'],
    interests: ['ceramics', 'sailing', 'chess'],
    prompts: [{ promptId: 'sunday', question: 'A perfect Sunday looks like', answer: 'a long walk, a longer lunch, nothing scheduled' }],
    ...declared,
  });
  return { ...c, id, displayName: name };
}

export async function openerCtx(c: Candidate, over: Partial<DraftContext> = {}): Promise<DraftContext> {
  const { calendar, itinerary } = makeCalendar();
  const slots = await calendar.proposeSlots({ city: c.declared.city, count: 2 });
  return { kind: 'opener', candidate: c, now: NOW, itinerary, slots, thread: [], ...over };
}
