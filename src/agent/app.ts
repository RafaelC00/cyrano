import { Hono } from 'hono';
import type { PlatformAdapter } from '../adapter/types.ts';
import { handleError, HttpError, readJson } from '../http.ts';
import type { Outbox } from '../outbox/outbox.ts';
import type { AuditLog, AuditOutcome, Stage } from './audit.ts';
import type { Funnel } from './funnel.ts';
import type { Gate } from './gate.ts';
import { draftOpener, OPENER_GENERATOR } from './opener.ts';
import type { Preferences } from './preferences.ts';
import { RULES } from './rules.ts';
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

  // Matches and drafts
  app.get('/matches', async (c) => c.json({ items: await p.adapter.listMatches() }));
  app.get('/matches/:id/thread', async (c) => c.json({ items: await p.adapter.readThread(c.req.param('id')) }));

  /** Creates a DRAFT. Sends nothing. With no body, the template drafter writes one. */
  app.post('/matches/:id/drafts', async (c) => {
    const matchId = c.req.param('id');
    const text = await c.req.text();
    let body: string | undefined;
    if (text) {
      const j = JSON.parse(text) as { body?: unknown };
      if (typeof j.body === 'string') body = j.body;
    }
    if (body !== undefined) return c.json(await p.outbox.draft(matchId, body, 'human', 'human'), 201);
    const match = (await p.adapter.listMatches()).find((m) => m.id === matchId);
    if (!match) throw new HttpError(404, 'not_found', `No match ${matchId}`);
    const candidate = await p.adapter.getProfile(match.candidateId);
    return c.json(await p.outbox.draft(matchId, draftOpener(candidate, p.prefs()), 'agent', OPENER_GENERATOR), 201);
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
