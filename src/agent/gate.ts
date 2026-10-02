import type { PlatformAdapter } from '../adapter/types.ts';
import { HttpError } from '../http.ts';
import type { SwipeResult } from '../domain/types.ts';
import type { AuditLog } from './audit.ts';
import type { Preferences } from './preferences.ts';
import type { Scorer } from './scoring.ts';
import type { CandidateState, TrackedCandidate } from './state.ts';

export interface GateDeps {
  adapter: PlatformAdapter;
  state: CandidateState;
  audit: AuditLog;
  scorer: Scorer;
  prefs: () => Preferences;
}

/**
 * Stage 4. The only code that records a like or a pass on the platform. Each method is called
 * by an HTTP route that represents a person's decision; nothing in the funnel calls them.
 */
export class Gate {
  private deps: GateDeps;

  constructor(deps: GateDeps) {
    this.deps = deps;
  }

  pending(): TrackedCandidate[] {
    return this.deps.state
      .byStatus('pending')
      .sort((a, b) => (b.score?.score ?? 0) - (a.score?.score ?? 0) || a.candidate.id.localeCompare(b.candidate.id));
  }

  private requirePending(id: string): TrackedCandidate {
    const t = this.deps.state.get(id);
    if (!t) throw new HttpError(404, 'not_found', `No tracked candidate ${id}`);
    if (t.status !== 'pending') throw new HttpError(409, 'not_pending', `Candidate is ${t.status}, not waiting at the gate`);
    return t;
  }

  async accept(id: string): Promise<SwipeResult> {
    const t = this.requirePending(id);
    const result = await this.deps.adapter.like(id);
    t.status = 'accepted';
    t.stage = 'gate';
    this.deps.audit.record({ candidateId: id, rule: 'gate.human', outcome: 'accept', reason: 'accepted by human at the gate', stage: 'gate' });
    return result;
  }

  async reject(id: string): Promise<SwipeResult> {
    const t = this.requirePending(id);
    const result = await this.deps.adapter.pass(id);
    t.status = 'rejected';
    t.stage = 'gate';
    t.drop = {
      stage: 'gate',
      rule: 'gate.human',
      reason: 'rejected by human at the gate',
      timestamp: new Date().toISOString(),
      alsoFailed: [],
    };
    this.deps.audit.record({ candidateId: id, rule: 'gate.human', outcome: 'reject', reason: 'rejected by human at the gate', stage: 'gate' });
    return result;
  }
}
