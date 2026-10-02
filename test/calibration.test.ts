import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { calibrationPreferences } from '../src/calibration/eric.ts';
import { STATED_CLAIMS } from '../src/calibration/eric.ts';
import { buildDivergence, renderDivergenceReport } from '../src/calibration/divergence.ts';
import { aggregate, bootstrapWeights, runTrial, splitPool } from '../src/calibration/evaluate.ts';
import { LATENT_WEIGHTS, generateLabels, latentUtility } from '../src/calibration/latent.ts';
import { calibrationPool } from '../src/calibration/pool.ts';
import { RULES } from '../src/agent/rules.ts';
import { mulberry32 } from '../src/platform/rng.ts';

const prefs = calibrationPreferences();
const pool = calibrationPool(prefs);

test('the calibration pool is separate from the funnel pool and passes his declared rules (city aside)', () => {
  assert.ok(pool.length >= 300, `pool ${pool.length}`);
  const rules = RULES.filter((r) => r.id !== 'city.allowed');
  for (const c of pool) assert.ok(rules.every((r) => r.evaluate(c.declared, prefs).pass));
  assert.ok(pool.some((c) => !prefs.cities.includes(c.declared.city)), 'city must not narrow the calibration pool');
  assert.equal(new Set(pool.map((c) => c.displayName)).size, pool.length);
});

test('the latent function contradicts every claim Eric made about being unanchored', () => {
  for (const claim of STATED_CLAIMS) {
    const w = LATENT_WEIGHTS[claim.feature];
    assert.ok(w !== undefined, `latent function has no weight for ${claim.feature}`);
    assert.equal(Math.sign(w), -claim.expected, `${claim.feature}: stated ${claim.expected}, latent ${w}`);
  }
});

test('labels are deterministic, unique pairs, noisy, and follow the latent function', () => {
  const a = generateLabels(pool, prefs, 400, mulberry32(3));
  const b = generateLabels(pool, prefs, 400, mulberry32(3));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, generateLabels(pool, prefs, 400, mulberry32(4)));
  assert.equal(new Set(a.map((l) => [l.a, l.b].sort().join('|'))).size, 400);
  const util = new Map(pool.map((c) => [c.id, latentUtility(c, prefs)]));
  const agree = a.filter((l) => util.get(l.chosen)! > util.get(l.chosen === l.a ? l.b : l.a)!).length / a.length;
  assert.ok(agree > 0.7 && agree < 0.95, `labels agree with the latent order ${agree}`);
});

test('held out means held-out PEOPLE: no test person appears in any training label', () => {
  const t = runTrial(pool, prefs, { seed: 11, trainLabels: 200, testLabels: 100 });
  const test = new Set(t.testPeople.map((c) => c.id));
  for (const l of t.trainLabels) assert.ok(!test.has(l.a) && !test.has(l.b));
  for (const l of t.testLabels) assert.ok(test.has(l.a) && test.has(l.b));
  const split = splitPool(pool, mulberry32(11));
  assert.equal(split.train.length + split.test.length, pool.length);
  assert.equal(new Set([...split.train, ...split.test].map((c) => c.id)).size, pool.length);
});

test('on held-out data the learned model beats both stated-preference comparators on this synthetic setup', () => {
  const trials = Array.from({ length: 6 }, (_, i) => runTrial(pool, prefs, { seed: 40 + i, trainLabels: 600, testLabels: 300 }));
  const a = aggregate(trials);
  assert.ok(a.table.learned.labelAccuracy.mean > a.table.statedBaseline.labelAccuracy.mean + 0.1);
  assert.ok(a.table.learned.concordance.mean > 0.8);
  // The oracle is the ceiling and is itself below 1 on noisy labels.
  assert.ok(a.table.oracle.labelAccuracy.mean < 0.95);
  assert.ok(a.table.learned.labelAccuracy.mean <= a.table.oracle.labelAccuracy.mean + 0.03);
  // Reading the pitch literally ranks the people Eric picks BELOW chance: the divergence as a number.
  assert.ok(a.table.statedMobility.spearman.mean < -0.3);
});

test('the model recovers the sign of every rooted feature and invents no large effects', () => {
  const t = runTrial(pool, prefs, { seed: 1, trainLabels: 600, testLabels: 300 });
  const w = (n: string) => t.model.weights[t.model.featureNames.indexOf(n)]!;
  for (const n of ['years_in_city', 'physical_practice', 'work_needs_a_place', 'old_local_friendships']) assert.ok(w(n) > 0, n);
  assert.ok(w('nights_away_per_month') < 0);
  const zero = t.model.featureNames.filter((n) => !(n in LATENT_WEIGHTS));
  for (const n of zero) assert.ok(Math.abs(w(n)) < 0.3, `${n} weight ${w(n)} with no true effect`);
});

test('the divergence report states the contradiction, with evidence, and does not leak the latent function', () => {
  const t = runTrial(pool, prefs, { seed: 1, trainLabels: 600, testLabels: 300 });
  const train = pool.filter((c) => !t.testPeople.some((p) => p.id === c.id));
  const ci = bootstrapWeights(train, t.trainLabels, prefs, t.model, 60, mulberry32(2));
  const d = buildDivergence(t.model, ci, train, t.trainLabels, prefs);
  assert.ok(d.headline.rate < 0.3, `stated-fit pick rate ${d.headline.rate}`);
  const contradicted = d.features.filter((f) => f.verdict === 'contradicts').map((f) => f.feature);
  assert.ok(contradicted.includes('years_in_city'));
  assert.ok(contradicted.includes('nights_away_per_month'));
  const md = renderDivergenceReport(d, { scorer: 'learned-pairwise-v1', seedNote: '' });
  assert.match(md, /CONTRADICTS|Where you said one thing and chose another/);
  assert.match(md, /95% interval/);
  assert.doesNotMatch(md, /LATENT_WEIGHTS|latentUtility|ground truth function/i);
});

test('committed outputs exist, are consistent with each other, and leak no local paths', () => {
  const dir = new URL('../data/calibration/', import.meta.url);
  const evalJson = JSON.parse(readFileSync(new URL('eval.json', dir), 'utf8'));
  const evalMd = readFileSync(new URL('EVAL.md', dir), 'utf8');
  const div = readFileSync(new URL('DIVERGENCE.md', dir), 'utf8');
  const learned = evalJson.linear.table.learned.labelAccuracy.mean.toFixed(3);
  assert.ok(evalMd.includes(learned), 'EVAL.md reports the numbers eval.json holds');
  assert.match(evalMd, /## Verdict/);
  assert.match(div, /## Where you said one thing and chose another/);
  const labels = JSON.parse(readFileSync(new URL('labels.json', dir), 'utf8'));
  assert.ok(labels.train.length >= 300);
  assert.ok(!('latent' in labels) && !JSON.stringify(labels).includes('LATENT'));
  for (const f of ['EVAL.md', 'DIVERGENCE.md', 'eval.json', 'labels.json', 'model.json', 'ground-truth.json']) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    assert.doesNotMatch(text, /[A-Za-z]:\\|\/Users\/|\/home\//, f);
  }
  assert.ok(typeof evalJson.linear.diff.statedBaseline.labelAccuracy.mean === 'number');
});
