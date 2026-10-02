import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mulberry32 } from '../src/platform/rng.ts';
import { ericPreferences } from '../src/calibration/eric.ts';
import { buildDivergence, renderDivergenceReport } from '../src/calibration/divergence.ts';
import { aggregate, bootstrapWeights, latentInModelUnits, runTrial, spearman, summarise } from '../src/calibration/evaluate.ts';
import { IDIOSYNCRASY_SD, LAPSE_RATE, LATENT_WEIGHTS, idiosyncrasy, latentSignal } from '../src/calibration/latent.ts';
import { CALIBRATION_POOL_SIZE, CALIBRATION_SEED, calibrationPool } from '../src/calibration/pool.ts';
import { recovery, renderEvalReport } from '../src/calibration/report.ts';
import { assignPortrait, defaultLibrary } from '../src/vision/library.ts';
import { FEATURES } from '../src/scoring/features.ts';
import { MODEL_PATH } from '../src/scoring/learned.ts';
import type { ModelFile } from '../src/scoring/learned.ts';

/**
 * Generates Eric's calibration labels, trains the model on the labels alone, evaluates on held-out
 * people, and writes the model, the labels, the ground truth and both reports into data/calibration.
 *
 *   npm run calibrate
 */
const OUT = fileURLToPath(new URL('../data/calibration/', import.meta.url));
const LIB = fileURLToPath(new URL('../data/portraits/library/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const TRAIN = 600;
const TEST = 300;
const TRIALS = 30;
const HEADLINE_SEED = 1;
const prefs = ericPreferences();
const pool = calibrationPool(prefs);
console.log(`calibration pool: ${pool.length} eligible of ${CALIBRATION_POOL_SIZE} generated`);

const seeds = Array.from({ length: TRIALS }, (_, i) => HEADLINE_SEED + i);
const linearTrials = seeds.map((seed) => runTrial(pool, prefs, { seed, trainLabels: TRAIN, testLabels: TEST }));
const nonlinearTrials = seeds.map((seed) => runTrial(pool, prefs, { seed, trainLabels: TRAIN, testLabels: TEST, variant: 'nonlinear' }));
const headline = linearTrials[0]!;

const curve = [25, 50, 100, 200, 400, 600, 1000].map((n) => {
  const ts = seeds.slice(0, 20).map((seed) => runTrial(pool, prefs, { seed: 500 + seed, trainLabels: n, testLabels: TEST }));
  return { n, learned: summarise(ts.map((t) => t.learned.labelAccuracy)), baseline: summarise(ts.map((t) => t.statedBaseline.labelAccuracy)) };
});

// Weight intervals and the recovery check for the shipped (headline) model.
const trainPeople = pool.filter((c) => !headline.testPeople.some((t) => t.id === c.id));
const ci = bootstrapWeights(trainPeople, headline.trainLabels, prefs, headline.model, 200, mulberry32(7));
const rec = recovery(headline.model, latentInModelUnits(headline.model, LATENT_WEIGHTS), ci, (n) => FEATURES.find((f) => f.name === n)!.group, spearman);

let extraction: { n: number; agreementWithGenerationSpec: Record<string, { agree: number; of: number; rate: number }> } | undefined;
if (existsSync(`${LIB}extraction-eval.json`)) extraction = JSON.parse(readFileSync(`${LIB}extraction-eval.json`, 'utf8'));

const evalMd = renderEvalReport({
  linear: aggregate(linearTrials),
  nonlinear: aggregate(nonlinearTrials),
  headline,
  rec,
  curve,
  trialsLabels: { train: TRAIN, test: TEST },
  pool: { generated: CALIBRATION_POOL_SIZE, eligible: pool.length },
  lapse: LAPSE_RATE,
  extraction,
  pooled: linearTrials,
  portraitsInPool: new Set(pool.map((c) => assignPortrait(c)?.id)).size,
  libraryPortraits: defaultLibrary().size,
});

const div = buildDivergence(headline.model, ci, trainPeople, headline.trainLabels, prefs);
const divMd = renderDivergenceReport(div, {
  scorer: 'learned-pairwise-v1',
  seedNote: 'Select it with `--scorer learned` in `npm run demo:learned`.',
});

const model: ModelFile = {
  version: 1,
  trainedAt: 'seed-derived (deterministic)',
  note: 'Trained on comparison labels alone. See data/calibration/EVAL.md for the held-out evaluation of exactly this model.',
  ...headline.model,
};
writeFileSync(MODEL_PATH, JSON.stringify(model, null, 1));
writeFileSync(`${OUT}labels.json`, JSON.stringify({
  note: 'Eric\'s comparison labels (synthetic). Each entry: the pair shown and the candidate he picked. Generated from a latent function that is NOT in this file.',
  pool: { seed: CALIBRATION_SEED, generated: CALIBRATION_POOL_SIZE, eligible: pool.length },
  headlineSeed: HEADLINE_SEED,
  train: headline.trainLabels,
  test: headline.testLabels,
}, null, 0));
writeFileSync(`${OUT}ground-truth.json`, JSON.stringify({
  note: 'GROUND TRUTH for evaluation only. The model never reads this file.',
  latentWeightsPerRawUnit: LATENT_WEIGHTS,
  idiosyncrasySd: IDIOSYNCRASY_SD,
  lapseRate: LAPSE_RATE,
  people: Object.fromEntries(pool.map((c) => [c.id, { signal: Math.round(latentSignal(c, prefs) * 1000) / 1000, idiosyncrasy: Math.round(idiosyncrasy(c) * 1000) / 1000 }])),
}, null, 0));
writeFileSync(`${OUT}EVAL.md`, evalMd + '\n');
writeFileSync(`${OUT}DIVERGENCE.md`, divMd + '\n');
const agg = aggregate(linearTrials);
writeFileSync(`${OUT}eval.json`, JSON.stringify({ trials: TRIALS, trainLabels: TRAIN, testLabels: TEST, linear: agg, recovery: { cosine: rec.cosine, signAgreement: rec.signAgreement, spurious: rec.spuriousCount, top5: rec.top5 }, curve, nonlinear: aggregate(nonlinearTrials) }, null, 1));

const f = (x: number) => x.toFixed(3);
console.log(`held-out label accuracy   learned ${f(agg.table.learned.labelAccuracy.mean)}   stated-preference-v1 ${f(agg.table.statedBaseline.labelAccuracy.mean)}   oracle ${f(agg.table.oracle.labelAccuracy.mean)}`);
console.log(`recovery: cosine ${f(rec.cosine)}, signs ${rec.signAgreement.ok}/${rec.signAgreement.of}, spurious ${rec.spuriousCount}`);
console.log('wrote data/calibration/{model,labels,ground-truth,eval}.json, EVAL.md, DIVERGENCE.md');
