import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { MockPlatform } from '../src/adapter/mock.ts';
import { RealPlatform } from '../src/adapter/real.ts';
import { PlatformError } from '../src/adapter/types.ts';
import type { PlatformAdapter } from '../src/adapter/types.ts';
import { createDraft } from '../src/outbox/draft.ts';
import type { ApprovedDraft } from '../src/outbox/outbox.ts';
import { call, makeSys } from './helpers.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(dir = SRC): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}
const rel = (p: string) => relative(SRC, p).split(sep).join('/');
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
const filesMatching = (re: RegExp) =>
  sourceFiles().filter((f) => re.test(stripComments(readFileSync(f, 'utf8')))).map(rel).sort();

// ---------- behaviour: spy on every request the agent makes ----------

function spiedSystem() {
  const requests: Array<{ method: string; path: string }> = [];
  const sys = makeSys({
    fetchWrapper: (inner) => (async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
      requests.push({ method: init?.method ?? 'GET', path: url.pathname });
      return inner(input, init);
    }) as typeof fetch,
  });
  const sends = () => requests.filter((r) => r.method === 'POST' && /\/matches\/[^/]+\/messages$/.test(r.path));
  return { sys, requests, sends };
}

test('running the funnel, the gate decisions and drafting never sends a message', async () => {
  const { sys, sends } = spiedSystem();
  await sys.funnel.run();
  for (const t of sys.gate.pending().slice(0, 10)) await sys.gate.accept(t.candidate.id);
  const matches = await sys.adapter.listMatches();
  assert.ok(matches.length > 8, 'accepting should have produced at least one new match');
  for (const m of matches) await call(sys.app, 'POST', `/matches/${m.id}/drafts`);
  assert.equal(sys.outbox.list('pending').length, matches.length);
  assert.equal(sends().length, 0, 'no POST to any /messages endpoint');
  assert.equal(sys.platform.store.viewerMessageCount(), 0);
});

test('a draft is sent only by the explicit approve call, exactly once', async () => {
  const { sys, sends } = spiedSystem();
  const match = (await sys.adapter.listMatches())[0]!;
  const draft = (await call<{ id: string; body: string }>(sys.app, 'POST', `/matches/${match.id}/drafts`)).body;
  assert.equal(sends().length, 0);

  const ok = await call(sys.app, 'POST', `/drafts/${draft.id}/approve`, { seenBody: draft.body });
  assert.equal(ok.status, 200);
  assert.equal(sends().length, 1);
  assert.equal(sys.platform.store.viewerMessageCount(), 1);

  const again = await call(sys.app, 'POST', `/drafts/${draft.id}/approve`, { seenBody: draft.body });
  assert.equal(again.status, 409);
  assert.equal(sends().length, 1, 'double approval does not double-send');
});

test('approval must carry the exact text the human saw', async () => {
  const { sys, sends } = spiedSystem();
  const match = (await sys.adapter.listMatches())[0]!;
  const draft = (await call<{ id: string; body: string }>(sys.app, 'POST', `/matches/${match.id}/drafts`)).body;
  assert.equal((await call(sys.app, 'POST', `/drafts/${draft.id}/approve`, {})).status, 400);
  const bad = await call<{ error: { code: string } }>(sys.app, 'POST', `/drafts/${draft.id}/approve`, { seenBody: 'something else' });
  assert.equal(bad.status, 409);
  assert.equal(bad.body.error.code, 'body_mismatch');
  assert.equal(sends().length, 0);
});

test('a discarded draft can never be sent', async () => {
  const { sys, sends } = spiedSystem();
  const match = (await sys.adapter.listMatches())[0]!;
  const draft = (await call<{ id: string; body: string }>(sys.app, 'POST', `/matches/${match.id}/drafts`)).body;
  assert.equal((await call(sys.app, 'POST', `/drafts/${draft.id}/discard`)).status, 200);
  assert.equal((await call(sys.app, 'POST', `/drafts/${draft.id}/approve`, { seenBody: draft.body })).status, 409);
  assert.equal(sends().length, 0);
});

test('a human-written draft goes through the same gate', async () => {
  const { sys, sends } = spiedSystem();
  const match = (await sys.adapter.listMatches())[0]!;
  const draft = (await call<{ id: string; author: string }>(sys.app, 'POST', `/matches/${match.id}/drafts`, { body: 'Hello there' })).body;
  assert.equal(draft.author, 'human');
  assert.equal(sends().length, 0);
});

// ---------- runtime: the adapter refuses anything that was not minted by the outbox ----------

test('deliver rejects a Draft, a forged object, and a clone of a real approval', async () => {
  const { sys, sends } = spiedSystem();
  const match = (await sys.adapter.listMatches())[0]!;
  const draft = createDraft({ matchId: match.id, body: 'sneaky', author: 'agent', generator: 'test', now: new Date() });

  // @ts-expect-error a Draft is not an ApprovedDraft: the type checker refuses this call
  await assert.rejects(sys.adapter.deliver(draft), (e: unknown) => e instanceof PlatformError && e.code === 'not_approved');

  const forged = { kind: 'approved', draftId: draft.id, matchId: match.id, body: 'sneaky', approvedAt: new Date().toISOString() } as unknown as ApprovedDraft;
  await assert.rejects(sys.adapter.deliver(forged), (e: unknown) => e instanceof PlatformError && e.code === 'not_approved');

  // Capture a genuine ApprovedDraft via a spy adapter, then try a structural clone of it.
  let genuine: ApprovedDraft | undefined;
  const spy: PlatformAdapter = Object.create(sys.adapter, {
    deliver: { value: (a: ApprovedDraft) => { genuine = a; return sys.adapter.deliver(a); } },
  });
  const { Outbox } = await import('../src/outbox/outbox.ts');
  const outbox = new Outbox(spy);
  const d = await outbox.draft(match.id, 'real one', 'human', 'test');
  await outbox.approveAndSend(d.id, { via: 'http', seenBody: 'real one' });
  assert.ok(genuine);
  const before = sends().length;
  await assert.rejects(sys.adapter.deliver({ ...genuine }), (e: unknown) => e instanceof PlatformError && e.code === 'not_approved');
  assert.equal(sends().length, before, 'nothing extra reached the wire');
});

// ---------- structure: scan the source so a future autonomous send fails the suite ----------

test('only the outbox calls adapter.deliver', () => {
  assert.deepEqual(filesMatching(/\.deliver\s*\(/), ['outbox/outbox.ts']);
});

test('only the approve route calls approveAndSend', () => {
  assert.deepEqual(filesMatching(/\.approveAndSend\s*\(/), ['agent/app.ts']);
});

test('only the approve route builds a HumanApproval', () => {
  assert.deepEqual(filesMatching(/via:\s*'http'/), ['agent/app.ts', 'outbox/outbox.ts']);
  // outbox.ts only *checks* it; the construction in agent/app.ts is inside the approve route.
  const app = stripComments(readFileSync(join(SRC, 'agent/app.ts'), 'utf8'));
  const idx = app.indexOf("via: 'http'");
  assert.ok(app.lastIndexOf("'/drafts/:id/approve'", idx) > app.lastIndexOf('app.get(', idx));
});

test('the only code that POSTs a message to the platform is the adapter', () => {
  assert.deepEqual(filesMatching(/\/messages`?,\s*\{\s*body/), ['adapter/mock.ts']);
  const agentFiles = sourceFiles().filter((f) => rel(f).startsWith('agent/'));
  for (const f of agentFiles) {
    assert.doesNotMatch(stripComments(readFileSync(f, 'utf8')), /\bfetch\s*\(/, `${rel(f)} must not talk to the network directly`);
  }
});

test('the only module that can mint an ApprovedDraft does not export the minting function', () => {
  const src = readFileSync(join(SRC, 'outbox/outbox.ts'), 'utf8');
  assert.doesNotMatch(src, /export\s+(async\s+)?function\s+mint/);
  assert.doesNotMatch(src, /export\s+const\s+minted/);
  assert.doesNotMatch(src, /export\s+(declare\s+)?const\s+approvedBrand/);
});

test('the adapter surface has no send-like method other than deliver', () => {
  for (const proto of [MockPlatform.prototype, RealPlatform.prototype]) {
    const names = Object.getOwnPropertyNames(proto).filter((n) => /send|post|message|write|deliver/i.test(n));
    assert.deepEqual(names.sort(), ['draftMessage', 'deliver'].sort(), proto.constructor.name);
  }
});

test('the funnel and gate modules do not even import the outbox', () => {
  for (const f of ['agent/funnel.ts', 'agent/gate.ts', 'agent/reversal.ts', 'agent/scoring.ts', 'agent/rules.ts', 'agent/opener.ts']) {
    assert.doesNotMatch(readFileSync(join(SRC, f), 'utf8'), /outbox/i, f);
  }
});
