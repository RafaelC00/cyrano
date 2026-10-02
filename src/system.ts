import type { Hono } from 'hono';
import { MockPlatform } from './adapter/mock.ts';
import type { PlatformAdapter } from './adapter/types.ts';
import { createAgentApp } from './agent/app.ts';
import { Itinerary } from './calendar/itinerary.ts';
import { LocalCalendar } from './calendar/local.ts';
import { Drafter } from './drafting/drafter.ts';
import { Scheduler } from './schedule/scheduler.ts';
import { ericItinerary } from './schedule/persona.ts';
import { LearnedScorer } from './scoring/learned.ts';
import { AuditLog } from './agent/audit.ts';
import { Funnel } from './agent/funnel.ts';
import { Gate } from './agent/gate.ts';
import { defaultPreferences } from './agent/preferences.ts';
import type { Preferences } from './agent/preferences.ts';
import { Reversal } from './agent/reversal.ts';
import type { Scorer } from './agent/scoring.ts';
import { CandidateState } from './agent/state.ts';
import { Outbox } from './outbox/outbox.ts';
import { createPlatform } from './platform/server.ts';
import type { SeedOptions } from './platform/seed.ts';

export interface SystemOptions {
  seed?: SeedOptions;
  prefs?: Preferences;
  /** Stage 3. Defaults to the model in data/calibration/model.json. */
  scorer?: Scorer;
  /** Where Eric is. Defaults to his invented travel plan, anchored to the clock's date. */
  itinerary?: Itinerary;
  /** Persist holds and confirmed dates here. Omit for memory only. Plans themselves are never persisted. */
  calendarPath?: string;
  clock?: () => Date;
  /** Wrap the in-process fetch, e.g. to spy on every request the agent makes. */
  fetchWrapper?: (inner: typeof fetch) => typeof fetch;
}

/**
 * Wires the platform and the agent together in one process, with the agent talking to the
 * platform through the same HTTP surface (routed in-process, no socket). Used by tests and the
 * demo. `src/main.ts` runs the same two apps on real ports.
 */
export function createSystem(opts: SystemOptions = {}) {
  const platform = createPlatform(opts.seed);
  let inProcessFetch: typeof fetch = async (input, init) => platform.app.fetch(new Request(input, init));
  if (opts.fetchWrapper) inProcessFetch = opts.fetchWrapper(inProcessFetch);
  const adapter = new MockPlatform({ baseUrl: 'http://platform.local', fetch: inProcessFetch, clock: opts.clock });
  return { platform, ...createAgent(adapter, opts) };
}

export function createAgent(adapter: PlatformAdapter, opts: SystemOptions = {}) {
  const clock = opts.clock ?? (() => new Date());
  const prefsValue = opts.prefs ?? defaultPreferences();
  const prefs = () => prefsValue;
  const learned = new LearnedScorer();
  const scorer = opts.scorer ?? learned;
  const state = new CandidateState();
  const audit = new AuditLog(clock);
  const deps = { adapter, state, audit, scorer, prefs };
  const funnel = new Funnel({ ...deps, clock });
  const gate = new Gate(deps);
  const reversal = new Reversal(deps);
  const outbox = new Outbox(adapter, clock);
  const itinerary = opts.itinerary ?? ericItinerary(clock().toISOString().slice(0, 10));
  const calendar = new LocalCalendar({ itinerary, clock, storagePath: opts.calendarPath });
  const scheduler = new Scheduler(calendar, clock);
  const drafter = new Drafter();
  const app: Hono = createAgentApp({ adapter, funnel, gate, reversal, audit, state, outbox, prefs, drafter, scheduler, calendar, itinerary, clock, learned });
  return { adapter, state, audit, funnel, gate, reversal, outbox, prefs, drafter, scheduler, calendar, itinerary, app };
}
