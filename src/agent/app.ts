import { Hono } from 'hono';
import type { PlatformAdapter } from '../adapter/types.ts';
import { buildWeeklyBrief } from '../brief/brief.ts';
import type { Itinerary } from '../calendar/itinerary.ts';
import { buildIcsCalendar } from '../calendar/ics.ts';
import type { LocalCalendar } from '../calendar/local.ts';
import { threadRejection } from '../drafting/check.ts';
import type { Drafter } from '../drafting/drafter.ts';
import { handleError, HttpError, readJson } from '../http.ts';
import type { Outbox } from '../outbox/outbox.ts';
import type { Scheduler } from '../schedule/scheduler.ts';
import type { LearnedScorer } from '../scoring/learned.ts';
import { comparisonsPage, trainingReport } from './model-report.ts';
import { briefView, calendarState, draftMeta, parseProposalId } from './views.ts';
import type { LearnedScore } from './views.ts';
import type { AuditLog, AuditOutcome, Stage } from './audit.ts';
import type { Funnel } from './funnel.ts';
import type { Gate } from './gate.ts';
import type { Preferences } from './preferences.ts';
import { RULES } from './rules.ts';
import { StatedPreferenceScorer } from './scoring.ts';
import type { Reversal } from './reversal.ts';
import type { CandidateState } from './state.ts';

export interface AgentParts {
  adapter: PlatformAdapter;
  funnel: Funnel;
  gate: Gate;
  reversal: Reversal;
  audit: AuditLog;
  state: CandidateState;
  outbox: Outbox;
  prefs: () => Preferences;
  drafter: Drafter;
  scheduler: Scheduler;
  calendar: LocalCalendar;
  itinerary: Itinerary;
  clock: () => Date;
  /** The trained model, for the shortlist's second column. The funnel's own scorer may differ. */
  learned: LearnedScorer;
}

/** The agent's HTTP API. Every endpoint that acts on the outside world is a human decision. */
export function createAgentApp(p: AgentParts): Hono {
  const app = new Hono();
  app.onError(handleError);

  app.get('/health', (c) => c.json({ ok: true, service: 'agent', adapter: p.adapter.name }));
  app.get('/preferences', (c) => c.json(p.prefs()));
  app.get('/rules', (c) =>
    c.json(RULES.map((r) => ({ id: r.id, description: r.description, fields: r.fields }))),
  );

  // Funnel
  app.post('/runs', async (c) => c.json(await p.funnel.run(), 201));

  // Stage 4: the human gate
  app.get('/gate', (c) =>
    c.json({
      items: p.gate.pending().map((t) => ({
        candidateId: t.candidate.id,
        displayName: t.candidate.displayName,
        rank: t.rank,
        score: t.score,
        overturned: t.overturned,
        declared: t.candidate.declared,
        photoRef: t.candidate.photos[0]?.photoRef ?? null,
      })),
    }),
  );
  app.post('/gate/:id/accept', async (c) => c.json(await p.gate.accept(c.req.param('id'))));
  app.post('/gate/:id/reject', async (c) => c.json(await p.gate.reject(c.req.param('id'))));

  // Audit and reversal
  app.get('/audit', (c) => {
    const q = c.req.query();
    return c.json({
      items: p.audit.query({
        candidateId: q.candidateId,
        rule: q.rule,
        outcome: q.outcome as AuditOutcome | undefined,
        stage: q.stage as Stage | undefined,
      }),
    });
  });
  app.get('/rejections', (c) => c.json({ items: p.reversal.rejections({ stage: c.req.query('stage') }) }));
  app.get('/candidates/:id/why', (c) => c.json(p.reversal.why(c.req.param('id'))));
  app.post('/candidates/:id/overturn', async (c) => {
    const text = await c.req.text();
    let note: string | undefined;
    if (text) {
      try {
        const j = JSON.parse(text) as { note?: unknown };
        if (typeof j.note === 'string') note = j.note;
      } catch {
        throw new HttpError(400, 'bad_json', 'Body must be JSON if present');
      }
    }
    return c.json(await p.reversal.overturn(c.req.param('id'), note));
  });

  // The learned model: the held-out result, Eric's comparisons, and scores for the shortlist
  app.get('/model/report', (c) => c.json(trainingReport()));
  app.get('/model/comparisons', (c) => {
    const n = Math.min(50, Math.max(1, Number(c.req.query('n') ?? 20) || 20));
    const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
    return c.json(comparisonsPage(offset, n, c.req.query('against') === '1'));
  });
  app.get('/scores', async (c) => {
    const ids = (c.req.query('ids') ?? '').split(',').filter(Boolean).slice(0, 100);
    const stated = new StatedPreferenceScorer();
    const out: LearnedScore[] = [];
    for (const id of ids) {
      const cand = await p.adapter.getProfile(id);
      out.push({
        candidateId: id,
        learned: p.learned.score(cand, p.prefs()).score,
        stated: stated.score(cand, p.prefs()).score,
        factors: p.learned.factors(cand, p.prefs()),
      });
    }
    return c.json(out);
  });

  // Scheduling: proposals sit on Eric's own calendar. Nothing here tells her anything.
  const calendarNow = () => calendarState({ now: p.clock(), itinerary: p.itinerary, calendar: p.calendar, scheduler: p.scheduler, adapter: p.adapter });
  app.get('/calendar', async (c) => c.json(await calendarNow()));
  /** A person records that she agreed to this slot. Gives the other holds back. Sends nothing. */
  app.post('/calendar/:id/confirm', async (c) => {
    const ref = parseProposalId(c.req.param('id'));
    const slot = ref && p.scheduler.get(ref.candidateId)?.slots[ref.index];
    if (!ref || !slot) throw new HttpError(404, 'not_found', `No proposal ${c.req.param('id')}`);
    await p.scheduler.confirm(ref.candidateId, slot.id);
    return c.json(await calendarNow());
  });
  /** A person moves a date to a time they chose. It becomes a proposal again; nothing is sent. */
  app.post('/calendar/:id/move', async (c) => {
    const ref = parseProposalId(c.req.param('id'));
    const plan = ref && p.scheduler.get(ref.candidateId);
    const slot = plan && (plan.status === 'confirmed' ? plan.chosen : plan.slots[ref.index]);
    if (!ref || !slot) throw new HttpError(404, 'not_found', `No proposal ${c.req.param('id')}`);
    const body = await readJson(c);
    if (typeof body.start !== 'string') throw new HttpError(400, 'bad_request', 'Expected {start: "2026-10-15T20:00"}, a local time in the city of the date');
    await p.scheduler.move(ref.candidateId, slot.id, body.start);
    return c.json(await calendarNow());
  });
  /** A person drops the whole plan with her: every hold, or the confirmed date, is given back. */
  app.post('/calendar/:id/drop', async (c) => {
    const ref = parseProposalId(c.req.param('id'));
    if (!ref || !p.scheduler.get(ref.candidateId)) throw new HttpError(404, 'not_found', `No proposal ${c.req.param('id')}`);
    await p.scheduler.release(ref.candidateId);
    return c.json(await calendarNow());
  });
  app.get('/calendar.ics', (c) => {
    c.header('Content-Type', 'text/calendar; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="cyrano-dates.ics"');
    return c.body(buildIcsCalendar(p.calendar.listEvents()));
  });

  /** The weekly brief, in the shape the web client declares. */
  app.get('/brief', async (c) => {
    const pendingDrafts = [];
    const matches = await p.adapter.listMatches();
    for (const r of p.outbox.list('pending')) {
      const offered = p.drafter.offeredDraft(r.draft.id);
      const m = matches.find((x) => x.id === r.draft.matchId);
      const name = m ? (await p.adapter.getProfile(m.candidateId)).displayName : r.draft.matchId;
      pendingDrafts.push({ draftId: r.draft.id, candidateName: name, language: offered?.language, citation: offered?.citation.summary });
    }
    const brief = buildWeeklyBrief({ now: p.clock(), tracked: p.state.all(), plans: p.scheduler.list(), prefs: p.prefs(), itinerary: p.itinerary, pendingDrafts });
    return c.json(await briefView(brief, p.scheduler.list(), p.adapter));
  });

  // Matches and drafts
  app.get('/matches', async (c) => c.json({ items: await p.adapter.listMatches() }));
  app.get('/matches/:id/thread', async (c) => c.json({ items: await p.adapter.readThread(c.req.param('id')) }));

  /**
   * Creates a DRAFT. Sends nothing.
   *
   * With `{body}` the text is a person's own. Without it, the voice-trained `Drafter` writes an
   * opener: it first proposes slots in her city (holds on Eric's own calendar, nothing sent to
   * her), then composes text that passes the prohibited-content check or is not offered at all.
   * A held draft answers 409 with `held_<reason>` and the reason in words. This is the only
   * drafting path; there is no unchecked one.
   */
  app.post('/matches/:id/drafts', async (c) => {
    const matchId = c.req.param('id');
    const text = await c.req.text();
    let input: { body?: unknown; variant?: unknown } = {};
    if (text) {
      try {
        input = JSON.parse(text) as typeof input;
      } catch {
        throw new HttpError(400, 'bad_json', 'Body must be JSON if present');
      }
    }
    if (typeof input.body === 'string') return c.json(await p.outbox.draft(matchId, input.body, 'human', 'human'), 201);

    const match = (await p.adapter.listMatches()).find((m) => m.id === matchId);
    if (!match) throw new HttpError(404, 'not_found', `No match ${matchId}`);
    const candidate = await p.adapter.getProfile(match.candidateId);
    const thread = await p.adapter.readThread(matchId);
    // Whether an opener may go out at all does not depend on wording or on his calendar: ask first,
    // so a thread that cannot get one never gets slots held for it either.
    const blocked = threadRejection('opener', thread);
    if (blocked) throw new HttpError(409, 'held_thread_state', blocked.reason);

    let plan = p.scheduler.get(candidate.id);
    if (plan?.status === 'confirmed') {
      throw new HttpError(409, 'held_already_arranged', `A date with ${plan.name} is already confirmed, so there is nothing left to propose.`);
    }
    const live = new Set(p.calendar.listHolds().map((h) => h.id));
    if (!plan || plan.status === 'released' || plan.holds.some((h) => !live.has(h.holdId))) {
      plan = await p.scheduler.propose(candidate, { matchId, count: 3 });
    }
    if (!plan.slots.length) {
      throw new HttpError(409, 'held_no_slot', `Eric is not in ${candidate.declared.city} in the next six weeks, so there is nothing to propose and no opener to write.`);
    }
    const variant = typeof input.variant === 'number' ? input.variant : undefined;
    const out = await p.drafter.offer(p.outbox, matchId, { kind: 'opener', candidate, now: p.clock(), itinerary: p.itinerary, slots: plan.slots, thread, variant });
    if (out.status === 'held') throw new HttpError(409, `held_${out.reason}`, out.message);
    return c.json(out.draft, 201);
  });

  /** How a drafter-written draft was made: language, the profile detail, the checks it passed. */
  app.get('/drafts/:id/meta', async (c) => {
    const offered = p.drafter.offeredDraft(c.req.param('id'));
    if (!offered) throw new HttpError(404, 'no_meta', 'No drafting record: this draft was written by a person, so no voice checks were run on it.');
    const match = (await p.adapter.listMatches()).find((m) => m.id === offered.draft.matchId);
    if (!match) throw new HttpError(404, 'not_found', `No match ${offered.draft.matchId}`);
    return c.json(draftMeta(offered, await p.adapter.getProfile(match.candidateId)));
  });
  app.get('/drafts', (c) => c.json({ items: p.outbox.list(c.req.query('status') as 'pending' | 'sent' | 'discarded' | undefined) }));
  app.get('/drafts/:id', (c) => c.json(p.outbox.get(c.req.param('id'))));
  app.post('/drafts/:id/discard', (c) => c.json(p.outbox.discard(c.req.param('id'))));

  /** The only route that can put text on the wire. A person calls it, with the text they read. */
  app.post('/drafts/:id/approve', async (c) => {
    const body = await readJson(c);
    if (typeof body.seenBody !== 'string') {
      throw new HttpError(400, 'bad_request', 'Expected {seenBody: string}: the exact text you read and approve');
    }
    return c.json(await p.outbox.approveAndSend(c.req.param('id'), { via: 'http', seenBody: body.seenBody }));
  });

  return app;
}
