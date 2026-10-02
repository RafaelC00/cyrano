import { HttpError } from '../http.ts';
import type { AuditEntry } from './audit.ts';
import type { GateDeps } from './gate.ts';
import type { CandidateStatus, DropRecord } from './state.ts';

export interface WhyReport {
  candidateId: string;
  displayName: string;
  status: CandidateStatus;
  /** Present when the candidate is currently dropped or rejected. */
  droppedBy: DropRecord | null;
  overturned: boolean;
  reversible: boolean;
  history: AuditEntry[];
}

/** "Why was this one dropped" and "put it back". */
export class Reversal {
  private deps: GateDeps;

  constructor(deps: GateDeps) {
    this.deps = deps;
  }

  why(id: string): WhyReport {
    const t = this.deps.state.get(id);
    if (!t) throw new HttpError(404, 'not_found', `No tracked candidate ${id}`);
    return {
      candidateId: id,
      displayName: t.candidate.displayName,
      status: t.status,
      droppedBy: t.status === 'dropped' || t.status === 'rejected' ? (t.drop ?? null) : null,
      overturned: t.overturned,
      reversible: t.status === 'dropped' || t.status === 'rejected',
      history: this.deps.audit.query({ candidateId: id }),
    };
  }

  /** Every currently rejected candidate (dropped by a stage, or passed by the human). */
  rejections(filter: { stage?: string } = {}) {
    return this.deps.state
      .all()
      .filter((t) => (t.status === 'dropped' || t.status === 'rejected') && (!filter.stage || t.stage === filter.stage))
      .map((t) => ({
        candidateId: t.candidate.id,
        displayName: t.candidate.displayName,
        status: t.status,
        droppedBy: t.drop ?? null,
      }));
  }

  /**
   * Puts a rejected candidate back at the human gate. A stage-1/2/3 drop was local only, so this
   * is just a state change. A human rejection was a pass on the platform, which is rewound.
   * An accepted candidate cannot be overturned: a like cannot be taken back.
   */
  async overturn(id: string, note?: string): Promise<WhyReport> {
    const { state, audit, adapter, scorer, prefs } = this.deps;
    const t = state.get(id);
    if (!t) throw new HttpError(404, 'not_found', `No tracked candidate ${id}`);
    if (t.status === 'accepted') throw new HttpError(409, 'irreversible', 'Already liked on the platform; a like cannot be undone');
    if (t.status === 'pending') throw new HttpError(409, 'not_rejected', 'Candidate is already waiting at the gate');

    const was = t.drop;
    if (t.status === 'rejected') await adapter.rewindPass(id);
    if (!t.score) t.score = await scorer.score(t.candidate, prefs());

    audit.record({
      candidateId: id,
      rule: 'human.overturn',
      outcome: 'overturn',
      reason: `overturned ${was ? `${was.rule} (${was.reason})` : 'rejection'}${note ? `; note: ${note}` : ''}`,
      stage: 'gate',
    });
    t.status = 'pending';
    t.stage = 'gate';
    t.overturned = true;
    t.drop = undefined;
    return this.why(id);
  }
}
