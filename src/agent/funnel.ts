import type { PlatformAdapter } from '../adapter/types.ts';
import type { Candidate } from '../domain/types.ts';
import type { AuditLog, Stage } from './audit.ts';
import type { Preferences } from './preferences.ts';
import { evaluateRules } from './rules.ts';
import type { Scorer } from './scoring.ts';
import type { CandidateState } from './state.ts';

export interface StageReport {
  stage: Stage;
  in: number;
  dropped: number;
  out: number;
}

export interface FunnelReport {
  runId: string;
  startedAt: string;
  /** Candidates the platform listed as unswiped. */
  fetched: number;
  /** Listed but already tracked from an earlier run (including ones the human rejected/overturned). */
  alreadyTracked: number;
  /** New candidates that entered stage 1 on this run. */
  entered: number;
  stages: StageReport[];
  /** Candidates dropped, counted by the primary (first) reason. */
  droppedByRule: Record<string, number>;
  /** Every failing evaluation at stage 2, counted per rule. A candidate can fail several. */
  ruleFailuresByRule: Record<string, number>;
  reachedGate: number;
}

export interface FunnelDeps {
  adapter: PlatformAdapter;
  state: CandidateState;
  audit: AuditLog;
  scorer: Scorer;
  prefs: () => Preferences;
  clock?: () => Date;
}

const PAGE = 100;

/**
 * Runs stages 1-3 and queues survivors for stage 4 (the human gate).
 *
 * This class never calls `like` or `pass`, and never touches messages. Dropping a candidate is
 * a local decision: nothing is recorded on the platform, so every drop stays reversible.
 */
export class Funnel {
  private deps: FunnelDeps;
  private runSeq = 0;

  constructor(deps: FunnelDeps) {
    this.deps = deps;
  }

  async run(): Promise<FunnelReport> {
    const { adapter, state, audit, scorer } = this.deps;
    const prefs = this.deps.prefs();
    const now = (this.deps.clock ?? (() => new Date()))();
    const runId = `run_${String(++this.runSeq).padStart(3, '0')}`;
    const bump = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);

    // ① Broad pass: cheap and wide. Collect everything, remove duplicates, skip what we already
    // track, and set aside accounts too dormant to ever reply. No judgement about people.
    const fetchedAll: Candidate[] = [];
    let cursor: string | undefined;
    do {
      const page = await adapter.listCandidates({ cursor, limit: PAGE });
      fetchedAll.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    const seen = new Set<string>();
    let alreadyTracked = 0;
    const fresh: Candidate[] = [];
    for (const c of fetchedAll) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (state.has(c.id)) alreadyTracked++;
      else fresh.push(c);
    }
    const entered = fresh.length;

    const droppedByRule: Record<string, number> = {};
    const ruleFailuresByRule: Record<string, number> = {};
    const drop = (c: Candidate, stage: Stage, rule: string, reason: string, alsoFailed: Array<{ rule: string; reason: string }> = []) => {
      const timestamp = now.toISOString();
      state.set({
        candidate: c,
        status: 'dropped',
        stage,
        drop: { stage, rule, reason, timestamp, alsoFailed },
        overturned: false,
        firstSeenRunId: runId,
      });
      bump(droppedByRule, rule);
    };

    const afterBroad: Candidate[] = [];
    for (const c of fresh) {
      if (c.activity.daysSinceActive > prefs.dormantAfterDays) {
        const reason = `last active ${c.activity.daysSinceActive} days ago; limit is ${prefs.dormantAfterDays}`;
        audit.record({ candidateId: c.id, rule: 'broad.dormant', outcome: 'fail', reason, stage: 'broad', runId });
        drop(c, 'broad', 'broad.dormant', reason);
      } else {
        audit.record({ candidateId: c.id, rule: 'broad.dormant', outcome: 'pass', reason: `active ${c.activity.daysSinceActive} days ago`, stage: 'broad', runId });
        afterBroad.push(c);
      }
    }
    const broad: StageReport = { stage: 'broad', in: entered, dropped: entered - afterBroad.length, out: afterBroad.length };

    // ② Rule filter: hard constraints on declared fields only. Passes the declared object alone.
    const afterRules: Candidate[] = [];
    for (const c of afterBroad) {
      const verdict = evaluateRules(c.id, c.declared, prefs, audit, runId);
      if (verdict.passed) {
        afterRules.push(c);
      } else {
        for (const f of verdict.failures) bump(ruleFailuresByRule, f.rule);
        const [primary, ...rest] = verdict.failures;
        drop(c, 'rules', primary!.rule, primary!.reason, rest);
      }
    }
    const rules: StageReport = { stage: 'rules', in: afterBroad.length, dropped: afterBroad.length - afterRules.length, out: afterRules.length };

    // ③ Rank: score survivors behind the Scorer seam, keep the top `gateSize`.
    const scored = await Promise.all(afterRules.map(async (c) => ({ c, s: await scorer.score(c, prefs) })));
    scored.sort((a, b) => b.s.score - a.s.score || a.c.id.localeCompare(b.c.id));
    let surfaced = 0;
    scored.forEach(({ c, s }, i) => {
      const rank = i + 1;
      if (rank <= prefs.gateSize) {
        surfaced++;
        audit.record({ candidateId: c.id, rule: 'rank.cutoff', outcome: 'pass', reason: `score ${s.score} ranked ${rank} of ${scored.length}; gate holds ${prefs.gateSize}`, stage: 'rank', runId });
        state.set({ candidate: c, status: 'pending', stage: 'gate', score: s, rank, overturned: false, firstSeenRunId: runId });
      } else {
        const reason = `score ${s.score} ranked ${rank} of ${scored.length}; gate holds ${prefs.gateSize}`;
        audit.record({ candidateId: c.id, rule: 'rank.cutoff', outcome: 'fail', reason, stage: 'rank', runId });
        drop(c, 'rank', 'rank.cutoff', reason);
        const t = state.get(c.id)!;
        t.score = s;
        t.rank = rank;
      }
    });
    const rank: StageReport = { stage: 'rank', in: afterRules.length, dropped: afterRules.length - surfaced, out: surfaced };

    // ④ Human gate: nothing happens to these until a person decides.
    const gate: StageReport = { stage: 'gate', in: surfaced, dropped: 0, out: surfaced };

    return {
      runId,
      startedAt: now.toISOString(),
      fetched: fetchedAll.length,
      alreadyTracked,
      entered,
      stages: [broad, rules, rank, gate],
      droppedByRule,
      ruleFailuresByRule,
      reachedGate: surfaced,
    };
  }
}
