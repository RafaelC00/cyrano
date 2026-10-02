import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ericPreferences } from '../src/calibration/eric.ts';
import { StatedPreferenceScorer } from '../src/agent/scoring.ts';
import { mulberry32 } from '../src/platform/rng.ts';
import { FEATURES, featureVector } from '../src/scoring/features.ts';
import { LearnedScorer, SCORER_NAMES, StatedMobilityScorer, createScorer, loadModel } from '../src/scoring/learned.ts';
import { lifeOf } from '../src/scoring/life.ts';
import { columnStats, fitPairwise, standardise, utility } from '../src/scoring/pairwise.ts';
import { generateProfiles } from '../src/platform/seed.ts';
import { PlatformStore } from '../src/platform/store.ts';
import { candidate, makeSys } from './helpers.ts';

const prefs = ericPreferences();
const people = () => {
  const store = new PlatformStore(generateProfiles({ size: 300 }), { existingMatches: 0 });
  return store.listCandidates(undefined, 100).items;
};

test('pairwise fit recovers known weights from comparisons it generated itself', () => {
  // A self-contained check with its own generator: the model code never sees how labels are made.
  const rng = mulberry32(5);
  const truth = [1.5, -1, 0, 0.5];
  const X = Array.from({ length: 300 }, () => truth.map(() => rng() * 4 - 2));
  const pairs = [];
  for (let k = 0; k < 4000; k++) {
    const i = Math.floor(rng() * X.length);
    const j = Math.floor(rng() * X.length);
    if (i === j) continue;
    const du = truth.reduce((s, w, d) => s + w * (X[i]![d]! - X[j]![d]!), 0);
    pairs.push(rng() < 1 / (1 + Math.exp(-du)) ? { winner: i, loser: j } : { winner: j, loser: i });
  }
  const m = fitPairwise(['a', 'b', 'c', 'd'], X, pairs, { l2: 0.1 });
  const sd = m.std;
  truth.forEach((w, d) => assert.ok(Math.abs(m.weights[d]! - w * sd[d]!) < 0.25, `weight ${d}: ${m.weights[d]} vs ${w * sd[d]!}`));
});

test('standardisation imputes unobserved values with the training mean', () => {
  const { mean, std } = columnStats([[1, 10], [3, Number.NaN], [5, 30]]);
  assert.deepEqual(mean, [3, 20]);
  assert.equal(standardise([Number.NaN, Number.NaN], mean, std)[0], 0);
  assert.equal(standardise([3, 20], mean, std)[1], 0);
});

test('fitting with no comparisons is an error, not a silent zero model', () => {
  assert.throws(() => fitPairwise(['a'], [[1]], []), /no comparisons/);
});

test('life structure is deterministic and plausible', () => {
  const ps = people();
  for (const c of ps) {
    const a = lifeOf(c);
    assert.deepEqual(a, lifeOf(c));
    assert.ok(a.yearsInCity >= 0 && a.yearsInCity <= c.declared.age);
    assert.ok(a.nightsAwayPerMonth >= 0 && a.nightsAwayPerMonth <= 28);
  }
  // Place-bound work stays put; portable work travels.
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
  const bound = ps.map(lifeOf).filter((l) => l.occupation.placeBound >= 0.9);
  const free = ps.map(lifeOf).filter((l) => l.occupation.placeBound <= 0.1);
  assert.ok(mean(bound.map((l) => l.nightsAwayPerMonth)) < mean(free.map((l) => l.nightsAwayPerMonth)));
  assert.ok(mean(bound.map((l) => l.yearsInCity)) > mean(free.map((l) => l.yearsInCity)));
});

test('feature vectors cover every definition and describe the photograph, never the person', () => {
  const c = people()[0]!;
  const v = featureVector(c, prefs);
  assert.equal(v.length, FEATURES.length);
  for (const f of FEATURES) {
    assert.doesNotMatch(f.name, /attract|beaut|handsome|pretty|face|body|race|ethnic|skin|gender|health/i, f.name);
    assert.ok(f.high && f.low);
  }
  // A candidate whose photo is placeholder art has unobserved visual features, not zeros.
  const plain = featureVector({ ...c, photos: [{ slot: 0, photoRef: 'ph:v1:p_x:0' }] }, prefs);
  FEATURES.forEach((f, j) => assert.equal(Number.isNaN(plain[j]!), f.group === 'visual', f.name));
});

test('the learned scorer honours the Scorer contract and explains itself', () => {
  const scorer = new LearnedScorer();
  assert.equal(scorer.name, 'learned-pairwise-v1');
  for (const c of people().slice(0, 40)) {
    const r = scorer.score(c, prefs);
    assert.ok(r.score >= 0 && r.score <= 1);
    assert.equal(r.scorer, 'learned-pairwise-v1');
    assert.ok(r.explanation.length > 10);
    assert.deepEqual(r, scorer.score(c, prefs));
    const sum = Object.values(r.components).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - r.score) < 0.02, `components sum ${sum} vs score ${r.score}`);
  }
});

test('the learned scorer ranks the rooted person above the unanchored one, and the baselines do not', () => {
  // Two profiles identical on every declared field; only the life structure differs, via the
  // identity that seeds it. Search for a rooted and an unanchored person in a real pool instead.
  const ps = people().filter((c) => c.declared.gender === 'woman');
  const rooted = ps.find((c) => lifeOf(c).occupation.placeBound >= 0.9 && lifeOf(c).yearsInCity >= 10 && lifeOf(c).nightsAwayPerMonth <= 2)!;
  const roaming = ps.find((c) => lifeOf(c).occupation.placeBound <= 0.1 && lifeOf(c).yearsInCity <= 2 && lifeOf(c).nightsAwayPerMonth >= 10)!;
  assert.ok(rooted && roaming);
  const learned = new LearnedScorer();
  assert.ok(learned.score(rooted, prefs).score > learned.score(roaming, prefs).score);
  const mobility = new StatedMobilityScorer();
  assert.ok(mobility.score(rooted, prefs).score < mobility.score(roaming, prefs).score);
});

test('the scorer is selectable by name, and the stated baseline is unchanged', () => {
  assert.deepEqual([...SCORER_NAMES], ['stated', 'stated-mobility', 'learned']);
  assert.equal(createScorer('stated').name, 'stated-preference-v1');
  assert.equal(createScorer('stated-mobility').name, 'stated-mobility-v1');
  assert.equal(createScorer('learned').name, 'learned-pairwise-v1');
  const c = candidate();
  assert.deepEqual(new StatedPreferenceScorer().score(c, prefs), createScorer('stated').score(c, prefs));
});

test('a missing or mismatched model fails loudly', () => {
  assert.throws(() => loadModel(fileURLToPath(new URL('./nope.json', import.meta.url))), /npm run calibrate/);
  const m = loadModel();
  assert.equal(m.featureNames.length, FEATURES.length);
  assert.equal(m.weights.length, FEATURES.length);
  assert.ok(Number.isFinite(utility(m, featureVector(people()[0]!, prefs))));
});

test('the funnel runs on the learned scorer, ranks with it, and still never swipes', async () => {
  const sys = makeSys({ prefs: { ...prefs, gateSize: 5 }, scorer: createScorer('learned'), seed: { size: 3000 } });
  const before = sys.platform.store.swipeCount();
  const res = await sys.app.request('/runs', { method: 'POST' });
  assert.equal(res.status, 201);
  const gate = ((await (await sys.app.request('/gate')).json()) as { items: Array<{ score: { scorer: string; explanation: string } }> }).items;
  assert.equal(gate.length, 5);
  assert.ok(gate.every((g) => g.score.scorer === 'learned-pairwise-v1' && g.score.explanation));
  assert.equal(sys.platform.store.swipeCount(), before);
});

test('rejection stays on declared fields: the learned scorer is never consulted for stage 2', () => {
  const funnel = readFileSync(new URL('../src/agent/funnel.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(funnel, /scoring\/learned|vision\//);
  const rules = readFileSync(new URL('../src/agent/rules.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(rules, /scoring|vision|lifeOf/);
});

test('the learner cannot see the latent function: nothing under src/scoring or src/vision imports calibration', () => {
  for (const dir of ['../src/scoring/', '../src/vision/']) {
    for (const f of readdirSync(new URL(dir, import.meta.url))) {
      const src = readFileSync(new URL(dir + f, import.meta.url), 'utf8');
      assert.doesNotMatch(src, /from '\.\.\/calibration|LATENT_WEIGHTS|latentUtility|ground-truth/, `${dir}${f}`);
    }
  }
  const pairwise = readFileSync(new URL('../src/scoring/pairwise.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(pairwise, /from '\.\.\/(calibration|platform)/);
});
