import { agent, ApiError, platform } from '../api/phase1.ts';
import type { AuditEntry, Candidate, FunnelReport, GateItem, Rejection, RuleInfo, Stage } from '../api/phase1.ts';
import type { PersonRef } from '../contracts.ts';

// ---------------------------------------------------------------------------------------------
// The pool. The platform lists only unswiped people, so we keep what we have seen: a person you
// accept or pass should not vanish from the pool view.
// ---------------------------------------------------------------------------------------------

const seen = new Map<string, Candidate>();
let poolPromise: Promise<void> | null = null;

async function fetchWholePool() {
  let cursor: string | undefined;
  do {
    const page = await platform.page(cursor);
    for (const c of page.items) seen.set(c.id, c);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

export function loadPool(force = false): Promise<Candidate[]> {
  if (force || !poolPromise) {
    poolPromise = fetchWholePool().catch((e) => {
      poolPromise = null;
      throw e;
    });
  }
  return poolPromise.then(() => [...seen.values()]);
}

export async function getCandidate(id: string): Promise<Candidate> {
  const hit = seen.get(id);
  if (hit) return hit;
  const c = await platform.candidate(id);
  seen.set(id, c);
  return c;
}

export const known = (id: string) => seen.get(id);

export const personRef = (c: Candidate): PersonRef => ({
  id: c.id,
  displayName: c.displayName,
  age: c.declared.age,
  city: c.declared.city,
  photoRef: c.photos[0]?.photoRef ?? null,
});

// ---------------------------------------------------------------------------------------------
// Where everyone stands
// ---------------------------------------------------------------------------------------------

export type Standing =
  | { status: 'untracked' }
  | { status: 'dropped'; stage: Stage; rule: string; reason: string }
  | { status: 'pending'; rank?: number; score?: number }
  | { status: 'accepted' }
  | { status: 'rejected' };

export interface Snapshot {
  audit: AuditEntry[];
  gate: GateItem[];
  rejections: Rejection[];
  rules: RuleInfo[];
  standing: Map<string, Standing>;
  funnel: FunnelView | null;
}

export interface StageView {
  id: Stage;
  in: number;
  dropped: number;
  out: number;
}

export interface ReasonView {
  rule: string;
  /** Candidates whose first failing rule this was (they are counted once, here). */
  primary: number;
  /** Candidates who failed this rule at all, including ones another rule already dropped. */
  total: number;
  example?: string;
}

export interface FunnelView {
  stages: StageView[];
  reasons: Record<'broad' | 'rules' | 'rank', ReasonView[]>;
  humanRejected: number;
  accepted: number;
  pending: number;
  overturned: number;
  entered: number;
}

/** Reconstructs the funnel from the audit log, so the page is right after a reload. */
export function deriveFunnel(audit: AuditEntry[], gate: GateItem[], rejections: Rejection[]): FunnelView | null {
  const staged = audit.filter((e) => e.stage === 'broad' || e.stage === 'rules' || e.stage === 'rank');
  if (staged.length === 0) return null;

  const by = (stage: Stage) => staged.filter((e) => e.stage === stage);
  const entered = new Set(by('broad').map((e) => e.candidateId));
  const broadFail = new Set(by('broad').filter((e) => e.outcome === 'fail').map((e) => e.candidateId));
  const rulesIn = new Set(by('rules').map((e) => e.candidateId));
  const rulesFail = new Set(by('rules').filter((e) => e.outcome === 'fail').map((e) => e.candidateId));
  const rankIn = new Set(by('rank').map((e) => e.candidateId));
  const rankFail = new Set(by('rank').filter((e) => e.outcome === 'fail').map((e) => e.candidateId));
  const rankPass = rankIn.size - rankFail.size;

  const reasonsFor = (stage: 'broad' | 'rules' | 'rank'): ReasonView[] => {
    const rows = new Map<string, ReasonView>();
    const firstSeen = new Set<string>();
    for (const e of by(stage)) {
      if (e.outcome !== 'fail') continue;
      const row = rows.get(e.rule) ?? { rule: e.rule, primary: 0, total: 0, example: e.reason };
      row.total++;
      if (!firstSeen.has(e.candidateId)) {
        firstSeen.add(e.candidateId);
        row.primary++;
      }
      rows.set(e.rule, row);
    }
    return [...rows.values()].sort((a, b) => b.primary - a.primary || b.total - a.total);
  };

  const gateEntries = audit.filter((e) => e.stage === 'gate');
  return {
    entered: entered.size,
    stages: [
      { id: 'broad', in: entered.size, dropped: broadFail.size, out: entered.size - broadFail.size },
      { id: 'rules', in: rulesIn.size, dropped: rulesFail.size, out: rulesIn.size - rulesFail.size },
      { id: 'rank', in: rankIn.size, dropped: rankFail.size, out: rankPass },
      { id: 'gate', in: rankPass, dropped: 0, out: rankPass },
    ],
    reasons: { broad: reasonsFor('broad'), rules: reasonsFor('rules'), rank: reasonsFor('rank') },
    humanRejected: rejections.filter((r) => r.status === 'rejected').length,
    accepted: gateEntries.filter((e) => e.outcome === 'accept').length,
    pending: gate.length,
    overturned: gateEntries.filter((e) => e.outcome === 'overturn').length,
  };
}

/** Everyone who has ever been at the gate this session, so decided people stay on the shortlist. */
export const gateMemory = new Map<string, GateItem>();

export async function loadSnapshot(): Promise<Snapshot> {
  const [audit, gate, rejections, rules] = await Promise.all([agent.audit(), agent.gate(), agent.rejections(), agent.rules()]);
  for (const g of gate) gateMemory.set(g.candidateId, g);
  const standing = new Map<string, Standing>();
  for (const e of audit) if (e.outcome === 'accept') standing.set(e.candidateId, { status: 'accepted' });
  for (const r of rejections) {
    if (r.status === 'rejected') standing.set(r.candidateId, { status: 'rejected' });
    else if (r.droppedBy) standing.set(r.candidateId, { status: 'dropped', stage: r.droppedBy.stage, rule: r.droppedBy.rule, reason: r.droppedBy.reason });
  }
  for (const g of gate) standing.set(g.candidateId, { status: 'pending', rank: g.rank, score: g.score?.score });
  return { audit, gate, rejections, rules, standing, funnel: deriveFunnel(audit, gate, rejections) };
}

export async function runFunnel(): Promise<FunnelReport> {
  return agent.run();
}

export const isUnreachable = (e: unknown) => e instanceof ApiError && e.code === 'unreachable';

// ---------------------------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------------------------

export const firstName = (c: { displayName: string }) => c.displayName.split(' ')[0] ?? c.displayName;
