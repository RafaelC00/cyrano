import { parseArgs } from 'node:util';
import { ericPreferences } from '../src/agent/preferences.ts';
import { describe } from '../src/calibration/divergence.ts';
import { createScorer, SCORER_NAMES } from '../src/scoring/learned.ts';
import type { ScorerName } from '../src/scoring/learned.ts';
import { createSystem } from '../src/system.ts';
import type { FunnelReport } from '../src/agent/funnel.ts';
import type { ScoreResult } from '../src/agent/scoring.ts';

/**
 * Runs the funnel for Eric's stated preferences with a selectable stage-3 scorer, and shows who
 * reaches the human gate and why. Every scorer sees the same 500 people and the same hard rules.
 *
 *   npm run demo:learned                       learned model (default)
 *   npm run demo:learned -- --scorer stated    the stated-preference baseline
 *   npm run demo:learned -- --compare          all three side by side
 */
const { values } = parseArgs({ options: { scorer: { type: 'string', default: 'learned' }, compare: { type: 'boolean', default: false } } });
const prefs = ericPreferences();
// Eric's hard rules are strict: only 7 of the default 500 survive them, too few to show a ranking.
// The same generator at 4000 profiles (the first 500 are identical) leaves enough to rank.
const POOL = 4000;

interface GateItem { candidateId: string; displayName: string; rank: number; score: ScoreResult; declared: { city: string; age: number } }

async function run(name: ScorerName) {
  const sys = createSystem({ prefs, scorer: createScorer(name), seed: { size: POOL } });
  const res = await sys.app.request('/runs', { method: 'POST' });
  const report = (await res.json()) as FunnelReport;
  const gate = ((await (await sys.app.request('/gate')).json()) as { items: GateItem[] }).items;
  const people = new Map<string, import('../src/domain/types.ts').Candidate>();
  let cursor: string | undefined;
  do {
    const page = await sys.platform.store.listCandidates(cursor, 100);
    for (const c of page.items) people.set(c.id, c);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return { report, gate, people };
}

const names: ScorerName[] = values.compare ? [...SCORER_NAMES] : [values.scorer as ScorerName];
for (const n of names) if (!SCORER_NAMES.includes(n)) throw new Error(`--scorer must be one of ${SCORER_NAMES.join(', ')}`);

const results = new Map<ScorerName, Awaited<ReturnType<typeof run>>>();
for (const n of names) results.set(n, await run(n));

for (const [n, r] of results) {
  console.log(`\n=== scorer: ${n} ===`);
  for (const s of r.report.stages) console.log(`  ${s.stage.padEnd(6)} in ${String(s.in).padStart(4)}   dropped ${String(s.dropped).padStart(4)}   out ${String(s.out).padStart(4)}`);
  console.log(`  reached the human gate: ${r.report.reachedGate}`);
  for (const g of r.gate.slice(0, values.compare ? 5 : 10)) {
    const c = r.people.get(g.candidateId)!;
    console.log(`  #${String(g.rank).padStart(2)} ${g.score.score.toFixed(3)}  ${g.displayName}, ${g.declared.age}, ${g.declared.city}`);
    console.log(`        ${describe(c)}`);
    console.log(`        ${g.score.explanation}`);
  }
}

if (values.compare) {
  const sets = [...results].map(([n, r]) => [n, new Set(r.gate.map((g) => g.candidateId))] as const);
  console.log('\n=== overlap of the people who reach the gate ===');
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const shared = [...sets[i]![1]].filter((id) => sets[j]![1].has(id)).length;
    console.log(`  ${sets[i]![0]} vs ${sets[j]![0]}: ${shared} of ${sets[i]![1].size} in common`);
  }
}
