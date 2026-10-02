import { createSystem } from '../src/system.ts';

/** Runs the whole funnel over the seeded pool and prints what actually happened. */
const sys = createSystem();
const { app, platform } = sys;

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await app.request(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const swipesBefore = platform.store.swipeCount();
const report = await api<import('../src/agent/funnel.ts').FunnelReport>('POST', '/runs');
console.log(`Pool on platform: ${platform.store.size} synthetic profiles (${platform.store.size - report.fetched} already matched/swiped before the run)`);
console.log(`Entered the funnel: ${report.entered}\n`);
for (const s of report.stages) console.log(`  ${s.stage.padEnd(6)} in ${String(s.in).padStart(4)}   dropped ${String(s.dropped).padStart(4)}   out ${String(s.out).padStart(4)}`);
console.log(`\nReached the human gate: ${report.reachedGate}`);
console.log('Dropped by primary reason:', report.droppedByRule);
console.log('Stage-2 failing evaluations (a candidate can fail several):', report.ruleFailuresByRule);
console.log(`Platform swipes recorded by the funnel itself: ${platform.store.swipeCount() - swipesBefore}`);

// Reversal: pick a rule-filter drop, ask why, overturn it.
const rejections = await api<{ items: Array<{ candidateId: string; droppedBy: { rule: string; alsoFailed: unknown[] } | null }> }>('GET', '/rejections?stage=rules');
// Prefer a near miss: dropped by exactly one rule.
const target = rejections.items.find((r) => r.droppedBy?.alsoFailed.length === 0) ?? rejections.items[0]!;
const why = await api<{ displayName: string; droppedBy: { rule: string; reason: string } }>('GET', `/candidates/${target.candidateId}/why`);
console.log(`\nReversal: ${target.candidateId} (${why.displayName}) was dropped by ${why.droppedBy.rule}: ${why.droppedBy.reason}`);
const back = await api<{ status: string; overturned: boolean }>('POST', `/candidates/${target.candidateId}/overturn`, { note: 'demo' });
console.log(`  after overturn: status=${back.status}, overturned=${back.overturned}`);
const gate = await api<{ items: Array<{ candidateId: string }> }>('GET', '/gate');
console.log(`  gate now holds ${gate.items.length}; contains ${target.candidateId}: ${gate.items.some((i) => i.candidateId === target.candidateId)}`);

// Human decisions: accept until one matches, then draft and approve.
let matchId: string | undefined;
for (const item of gate.items) {
  const r = await api<{ matched: boolean; matchId?: string }>('POST', `/gate/${item.candidateId}/accept`);
  if (r.matched) {
    matchId = r.matchId;
    break;
  }
}
console.log(`\nHuman accepted candidates until one matched: match ${matchId ?? 'none'}`);
if (matchId) {
  const draft = await api<{ id: string; body: string }>('POST', `/matches/${matchId}/drafts`);
  console.log(`  draft ${draft.id}: "${draft.body}"`);
  console.log(`  messages sent by the viewer so far: ${platform.store.viewerMessageCount()}`);
  await api('POST', `/drafts/${draft.id}/approve`, { seenBody: draft.body });
  console.log(`  after explicit approval: ${platform.store.viewerMessageCount()}`);
}
