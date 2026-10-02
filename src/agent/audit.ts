export type AuditOutcome = 'pass' | 'fail' | 'overturn' | 'accept' | 'reject';
export type Stage = 'broad' | 'rules' | 'rank' | 'gate';

export interface AuditEntry {
  candidateId: string;
  rule: string;
  outcome: AuditOutcome;
  reason: string;
  timestamp: string;
  stage: Stage;
  runId?: string;
}

export interface AuditQuery {
  candidateId?: string;
  rule?: string;
  outcome?: AuditOutcome;
  stage?: Stage;
}

/** Append-only. Entries are frozen; there is no update or delete. */
export class AuditLog {
  private entries: AuditEntry[] = [];
  private clock: () => Date;

  constructor(clock: () => Date = () => new Date()) {
    this.clock = clock;
  }

  record(e: Omit<AuditEntry, 'timestamp'>): AuditEntry {
    const entry = Object.freeze({ ...e, timestamp: this.clock().toISOString() });
    this.entries.push(entry);
    return entry;
  }

  query(q: AuditQuery = {}): AuditEntry[] {
    return this.entries.filter(
      (e) =>
        (!q.candidateId || e.candidateId === q.candidateId) &&
        (!q.rule || e.rule === q.rule) &&
        (!q.outcome || e.outcome === q.outcome) &&
        (!q.stage || e.stage === q.stage),
    );
  }

  get size(): number {
    return this.entries.length;
  }
}
