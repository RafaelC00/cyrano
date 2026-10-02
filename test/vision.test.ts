import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PIXEL_FIELDS, VISUAL_FIELDS, describePixels } from '../src/vision/features.ts';
import { PortraitLibrary, assignPortrait, defaultLibrary, visualFeaturesFor } from '../src/vision/library.ts';
import { createPlatform } from '../src/platform/server.ts';
import { generateProfiles } from '../src/platform/seed.ts';
import { PlatformStore } from '../src/platform/store.ts';
import { candidate } from './helpers.ts';

const lib = defaultLibrary();
const FORBIDDEN = /attract|beaut|sexy|handsome|pretty|face|body|race|ethnic|skin|gender|age_|health|rating|score/i;

test('library holds 50 to 70 generated portraits, each a real JPEG, each with features', () => {
  assert.ok(lib.size >= 50 && lib.size <= 70, `library size ${lib.size}`);
  const dir = fileURLToPath(new URL('../data/portraits/library/', import.meta.url));
  for (const e of lib.entries) {
    const bytes = lib.bytes(e);
    assert.equal(bytes[0], 0xff, e.id);
    assert.equal(bytes[1], 0xd8, e.id);
    assert.ok(bytes.length > 20_000, `${e.id} is suspiciously small`);
    assert.ok(lib.featuresOf(e.id), `no features for ${e.id}`);
  }
  assert.equal(readdirSync(dir).filter((f) => f.endsWith('.jpg')).length, lib.size);
});

test('the library is varied: settings, photo types, solo and group, ages and genders', () => {
  const by = (k: (e: (typeof lib.entries)[number]) => string) => new Set(lib.entries.map(k));
  assert.equal(by((e) => e.spec.setting).size, 4);
  assert.equal(by((e) => e.spec.photoType).size, 3);
  assert.equal(by((e) => e.spec.people).size, 2);
  assert.ok(by((e) => e.spec.gender).size >= 3);
  const ages = lib.entries.map((e) => e.spec.age);
  assert.ok(Math.max(...ages) - Math.min(...ages) >= 15);
});

test('visual features are descriptive only: the schema has no field about the person', () => {
  const raw = JSON.parse(readFileSync(new URL('../data/portraits/library/features.json', import.meta.url), 'utf8')) as { features: Array<Record<string, unknown>> };
  assert.equal(raw.features.length, lib.size);
  for (const f of raw.features) {
    const keys = Object.keys(f).map((k) => (k === 'id' ? 'libraryId' : k)).sort();
    assert.deepEqual(keys, [...VISUAL_FIELDS].sort());
    assert.deepEqual(Object.keys(f.pixels as object).sort(), [...PIXEL_FIELDS].sort());
  }
  for (const name of [...VISUAL_FIELDS, ...PIXEL_FIELDS]) assert.doesNotMatch(name, FORBIDDEN, name);
});

test('the extractor is never asked about the person', () => {
  const py = readFileSync(new URL('../scripts/portraits/extract_features.py', import.meta.url), 'utf8');
  const prompt = /PROMPT = \(([\s\S]*?)\n\)/.exec(py)?.[1] ?? '';
  assert.ok(prompt.length > 200, 'could not find the prompt');
  assert.match(prompt, /Do not describe the person/);
  assert.doesNotMatch(prompt.replace('Do not describe the person', ''), /attract|beaut|handsome|pretty|\bface|\bage\b|gender|ethnic|skin|body|\bhair/i);
});

test('visual features are never read by the rule layer', () => {
  const rules = readFileSync(new URL('../src/agent/rules.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(rules, /vision|portrait|visualFeatures/i);
});

test('portrait pixel statistics read sensibly', () => {
  assert.equal(describePixels({ width: 1, height: 1, megapixels: 1, brightness: 0.2, contrast: 0.1, sharpness: 200, clippedHighlights: 0, underexposed: 0.4 }).lighting, 'dim');
  assert.equal(describePixels({ width: 1, height: 1, megapixels: 1, brightness: 0.5, contrast: 0.2, sharpness: 20, clippedHighlights: 0, underexposed: 0 }).focus, 'soft');
});

test('assignment is deterministic, respects declared gender, and reuses the library', () => {
  const profiles = [...new PlatformStore(generateProfiles(), { existingMatches: 0 }).listCandidates(undefined, 100).items];
  const a = profiles.map((c) => assignPortrait(c)!.id);
  const b = profiles.map((c) => assignPortrait(c)!.id);
  assert.deepEqual(a, b);
  const gender = { woman: 'woman', man: 'man', nonbinary: 'nonbinary person' } as const;
  for (const c of profiles) assert.equal(assignPortrait(c)!.spec.gender, gender[c.declared.gender]);

  // All 500: more profiles than portraits, so portraits are reused; every portrait is used.
  const store = new PlatformStore(generateProfiles(), { existingMatches: 0 });
  const used = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = store.listCandidates(cursor, 100);
    for (const c of page.items) used.set(assignPortrait(c)!.id, (used.get(assignPortrait(c)!.id) ?? 0) + 1);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.ok(store.size > lib.size);
  assert.ok([...used.values()].some((n) => n > 1), 'expected reuse');
  assert.ok(used.size >= lib.size * 0.9, `only ${used.size} of ${lib.size} portraits used`);
});

test('an empty library degrades to no assignment rather than throwing', () => {
  const empty = new PortraitLibrary(fileURLToPath(new URL('./nonexistent/', import.meta.url)));
  assert.equal(empty.size, 0);
  assert.equal(assignPortrait(candidate(), empty), undefined);
});

test('slot 0 is served as a generated JPEG, other slots stay placeholder SVG', async () => {
  const { app, store } = createPlatform();
  const c = store.getCandidate('p_0020');
  assert.match(c.photos[0]!.photoRef, /^gp:v1:p_0020:0$/);
  assert.match(c.photos[1]!.photoRef, /^ph:/);
  const res = await app.request(`/photos/${encodeURIComponent(c.photos[0]!.photoRef)}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  const bytes = new Uint8Array(await res.arrayBuffer());
  assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8]);
  const again = new Uint8Array(await (await app.request(`/photos/${encodeURIComponent(c.photos[0]!.photoRef)}`)).arrayBuffer());
  assert.equal(bytes.length, again.length);
  assert.equal((await app.request('/photos/gp:v1:p_9999:0')).status, 404);
});

test('visual features resolve for a generated-portrait candidate and not for placeholder art', () => {
  const store = new PlatformStore(generateProfiles(), { existingMatches: 0 });
  const c = store.getCandidate('p_0030');
  const f = visualFeaturesFor(c);
  assert.ok(f);
  assert.ok(['indoor', 'outdoor', 'nature', 'urban'].includes(f.setting));
  assert.equal(visualFeaturesFor({ ...c, photos: [{ slot: 0, photoRef: 'ph:v1:p_0030:0' }] }), undefined);
});
