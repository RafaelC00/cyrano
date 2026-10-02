import type { Candidate } from '../domain/types.ts';
import type { Stage } from './audit.ts';
import type { ScoreResult } from './scoring.ts';

/**
 * dropped:  removed by stage 1, 2 or 3 (reversible)
 * pending:  waiting at the human gate
 * accepted: human liked; the like is on the platform and cannot be undone
 * rejected: human passed; reversible while the platform supports rewind
 */
export type CandidateStatus = 'dropped' | 'pending' | 'accepted' | 'rejected';

export interface DropRecord {
  stage: Stage;
  rule: string;
  reason: string;
  timestamp: string;
  /** Other rules that also failed, when stage 2 dropped it. */
  alsoFailed: Array<{ rule: string; reason: string }>;
}

export interface TrackedCandidate {
  candidate: Candidate;
  status: CandidateStatus;
  /** Stage that last decided this candidate's status. */
  stage: Stage;
  drop?: DropRecord;
  score?: ScoreResult;
  /** Position by score within its run, 1-based. */
  rank?: number;
  overturned: boolean;
  firstSeenRunId: string;
}

export class CandidateState {
  private map = new Map<string, TrackedCandidate>();

  has(id: string): boolean {
    return this.map.has(id);
  }
  get(id: string): TrackedCandidate | undefined {
    return this.map.get(id);
  }
  set(t: TrackedCandidate): void {
    this.map.set(t.candidate.id, t);
  }
  all(): TrackedCandidate[] {
    return [...this.map.values()];
  }
  byStatus(status: CandidateStatus): TrackedCandidate[] {
    return this.all().filter((t) => t.status === status);
  }
}
