import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateProfiles } from '../src/platform/seed.ts';
import { parsePhotoRef } from '../src/platform/photo.ts';
import { createPlatform } from '../src/platform/server.ts';

test('seed is deterministic and large enough', () => {
  const a = generateProfiles();
  const b = generateProfiles();
  assert.ok(a.length >= 400);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, generateProfiles({ seed: 1 }));
});

test('every profile is synthetic, uniquely named, and structurally complete', () => {
  const ps = generateProfiles();
  assert.equal(new Set(ps.map((p) => p.displayName)).size, ps.length);
  for (const p of ps) {
    assert.equal(p.synthetic, true);
    assert.ok(p.declared.languages.length >= 1);
    assert.ok(p.declared.interests.length >= 3);
    assert.ok(p.declared.lookingFor.length >= 1);
    assert.ok(p.declared.prompts.length >= 2);
    assert.ok(p.photoRefs.length >= 3);
    for (const ref of p.photoRefs) {
      const parsed = parsePhotoRef(ref);
      assert.ok(parsed, ref);
      assert.equal(parsed.profileId, p.id);
    }
  }
});

test('candidate pagination visits every unswiped profile exactly once', async () => {
  const { app, store } = createPlatform();
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const res = await app.request(`/candidates?limit=64${cursor ? `&cursor=${cursor}` : ''}`);
    const page = (await res.json()) as { items: Array<{ id: string; activity: { daysSinceActive: number } }>; nextCursor: string | null };
    seen.push(...page.items.map((i) => i.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(new Set(seen).size, seen.length);
  assert.equal(seen.length, store.size - store.swipeCount());
});

test('bad pagination input is a 400, not a crash', async () => {
  const { app } = createPlatform();
  assert.equal((await app.request('/candidates?limit=0')).status, 400);
  assert.equal((await app.request('/candidates?limit=1000')).status, 400);
  assert.equal((await app.request('/candidates?cursor=%21%21')).status, 400);
});

test('swiping: like can match, double swipe is a conflict, a pass can be rewound, a like cannot', async () => {
  const { app, store } = createPlatform();
  const post = (candidateId: string, action: string) =>
    app.request('/swipes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidateId, action }) });
  const page = store.listCandidates(undefined, 100).items;

  const passId = page[0]!.id;
  assert.equal((await post(passId, 'pass')).status, 201);
  assert.equal((await post(passId, 'like')).status, 409);
  assert.equal((await app.request(`/swipes/${passId}`, { method: 'DELETE' })).status, 200);
  assert.equal((await post(passId, 'like')).status, 201);
  assert.equal((await app.request(`/swipes/${passId}`, { method: 'DELETE' })).status, 409);

  let matched = 0;
  for (const c of page.slice(1)) {
    const r = (await (await post(c.id, 'like')).json()) as { matched: boolean };
    if (r.matched) matched++;
  }
  assert.ok(matched > 0, 'some likes should match back');
  assert.equal((await post('p_9999', 'like')).status, 404);
  assert.equal((await post(page[1]!.id, 'maybe')).status, 400);
});

test('matches have threads, and messages are validated', async () => {
  const { app, store } = createPlatform();
  const matches = (await (await app.request('/matches')).json()) as { items: Array<{ id: string }> };
  assert.equal(matches.items.length, 8);
  const id = matches.items[0]!.id;
  const thread = (await (await app.request(`/matches/${id}/messages`)).json()) as { items: Array<{ from: string }> };
  assert.equal(thread.items[0]!.from, 'candidate');
  const post = (body: unknown) => app.request(`/matches/${id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await post({ body: '' })).status, 400);
  assert.equal((await post({ body: 'x'.repeat(1001) })).status, 400);
  assert.equal((await post({ body: 'hello' })).status, 201);
  assert.equal(store.viewerMessageCount(), 1);
  assert.equal((await app.request('/matches/m_9999/messages')).status, 404);
});

test('photo placeholders are deterministic SVG and unknown refs 404', async () => {
  const { app, store } = createPlatform();
  // Slot 0 is a generated portrait (see test/vision.test.ts); other slots stay placeholder art.
  const ref = store.getCandidate('p_0020').photos[1]!.photoRef;
  const a = await app.request(`/photos/${encodeURIComponent(ref)}`);
  const b = await app.request(`/photos/${encodeURIComponent(ref)}`);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'image/svg+xml');
  const svg = await a.text();
  assert.equal(svg, await b.text());
  assert.match(svg, /^<svg /);
  assert.equal((await app.request('/photos/ph:v1:p_0020:1')).status, 200);
  assert.equal((await app.request('/photos/nope')).status, 404);
  assert.equal((await app.request('/photos/gen:v1:p_0020:0')).status, 404);
});
