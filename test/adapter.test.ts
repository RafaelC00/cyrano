import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MockPlatform } from '../src/adapter/mock.ts';
import { RealPlatform, RealPlatformDisabledError } from '../src/adapter/real.ts';
import { PlatformError } from '../src/adapter/types.ts';
import { makeSys } from './helpers.ts';

test('RealPlatform throws on construction and names both reasons', () => {
  assert.throws(
    () =>
      new RealPlatform({
        baseUrl: 'https://example.invalid',
        auth: { kind: 'oauth', accessToken: 'x', refresh: async () => 'y' },
        rateLimit: { requestsPerMinute: 1, burst: 1 },
        backoff: { baseMs: 1, maxMs: 2, maxAttempts: 1 },
      }),
    (e: unknown) => {
      assert.ok(e instanceof RealPlatformDisabledError);
      assert.match(e.message, /terms of service/i);
      assert.match(e.message, /GDPR/);
      assert.match(e.message, /photograph/i);
      return true;
    },
  );
});

test('MockPlatform implements every operation against the platform', async () => {
  const { adapter } = makeSys();
  const page = await adapter.listCandidates({ limit: 5 });
  assert.equal(page.items.length, 5);
  assert.ok(page.nextCursor);
  const next = await adapter.listCandidates({ cursor: page.nextCursor!, limit: 5 });
  assert.notEqual(next.items[0]!.id, page.items[0]!.id);

  const c = page.items[0]!;
  assert.equal((await adapter.getProfile(c.id)).id, c.id);
  assert.equal((await adapter.pass(c.id)).action, 'pass');
  await adapter.rewindPass(c.id);
  assert.equal((await adapter.like(c.id)).action, 'like');

  const matches = await adapter.listMatches();
  assert.ok(matches.length >= 8);
  const thread = await adapter.readThread(matches[0]!.id);
  assert.equal(thread[0]!.from, 'candidate');
  const draft = await adapter.draftMessage(matches[0]!.id, { body: ' hi ', author: 'human', generator: 't' });
  assert.equal(draft.kind, 'draft');
  assert.equal(draft.body, 'hi');
});

test('platform failures surface as typed PlatformErrors with retryability', async () => {
  const { adapter } = makeSys();
  await assert.rejects(adapter.getProfile('p_9999'), (e: unknown) => e instanceof PlatformError && e.status === 404 && !e.retryable);
  await assert.rejects(adapter.readThread('m_9999'), (e: unknown) => e instanceof PlatformError && e.status === 404);
  await assert.rejects(adapter.draftMessage('m_9999', { body: 'x', author: 'human', generator: 't' }), PlatformError);

  const down = new MockPlatform({ baseUrl: 'http://x', fetch: (async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch });
  await assert.rejects(down.listCandidates(), (e: unknown) => e instanceof PlatformError && e.code === 'network' && e.retryable);

  const busy = new MockPlatform({ baseUrl: 'http://x', fetch: (async () => new Response('{"error":{"code":"rate_limited","message":"slow down"}}', { status: 429 })) as typeof fetch });
  await assert.rejects(busy.listCandidates(), (e: unknown) => e instanceof PlatformError && e.status === 429 && e.retryable && e.code === 'rate_limited');
});

test('empty and oversized drafts are refused', async () => {
  const { adapter } = makeSys();
  const m = (await adapter.listMatches())[0]!;
  await assert.rejects(adapter.draftMessage(m.id, { body: '   ', author: 'human', generator: 't' }));
  await assert.rejects(adapter.draftMessage(m.id, { body: 'x'.repeat(1001), author: 'human', generator: 't' }));
});
