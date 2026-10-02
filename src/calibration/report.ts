import type { Candidate } from '../domain/types.ts';
import { cosine, METRIC_NAMES } from './evaluate.ts';
import type { MetricName, ScorerKey, Summary, Trial, aggregate } from './evaluate.ts';
import type { PairwiseModel } from '../scoring/pairwise.ts';
import { describe } from './divergence.ts';

type Agg = ReturnType<typeof aggregate>;

const f3 = (x: number) => x.toFixed(3);
const sm = (s: Summary) => `${f3(s.mean)} (${f3(s.lo)} to ${f3(s.hi)})`;
const w2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

const METRIC_LABEL: Record<MetricName, string> = {
  labelAccuracy: 'accuracy on held-out labels',
  concordance: 'agreement with true order, all held-out pairs',
  spearman: 'rank correlation with true utility',
  precisionAtTop10pct: 'top-10% overlap with true top 10%',
};
const SCORER_LABEL: Record<ScorerKey, string> = {
  learned: 'learned (pairwise logistic)',
  statedBaseline: 'stated-preference-v1 (in the repo)',
  statedMobility: 'stated-mobility-v1 (literal reading of the pitch)',
  oracle: 'oracle: the latent function itself',
};

export interface Recovery {
  rows: Array<{ feature: string; group: string; latent: number; learned: number; lo: number; hi: number; signOk: boolean | null; spurious: boolean }>;
  cosine: number;
  /** Sign agreement over features the latent function actually uses. */
  signAgreement: { ok: number; of: number };
  /** Features with zero latent weight whose interval excludes zero. */
  spuriousCount: number;
  top5: { learned: string[]; latent: string[]; overlap: number };
  /** Rank correlation between |learned| and |latent| over all features. */
  rankCorrelation: number;
}

export function recovery(model: PairwiseModel, latentUnits: number[], ci: Array<{ lo: number; hi: number }>, groupOf: (n: string) => string, rank: (a: number[], b: number[]) => number): Recovery {
  const rows = model.featureNames.map((n, j) => {
    const latent = latentUnits[j]!;
    const w = model.weights[j]!;
    const stable = ci[j]!.lo > 0 || ci[j]!.hi < 0;
    return { feature: n, group: groupOf(n), latent, learned: w, lo: ci[j]!.lo, hi: ci[j]!.hi, signOk: latent === 0 ? null : Math.sign(w) === Math.sign(latent), spurious: latent === 0 && stable };
  });
  const used = rows.filter((r) => r.latent !== 0);
  const topBy = (key: 'latent' | 'learned') => [...rows].sort((a, b) => Math.abs(b[key]) - Math.abs(a[key])).slice(0, 5).map((r) => r.feature);
  const tl = topBy('latent');
  const tw = topBy('learned');
  return {
    rows,
    cosine: cosine(model.weights, latentUnits),
    signAgreement: { ok: used.filter((r) => r.signOk).length, of: used.length },
    spuriousCount: rows.filter((r) => r.spurious).length,
    top5: { learned: tw, latent: tl, overlap: tw.filter((x) => tl.includes(x)).length },
    rankCorrelation: rank(rows.map((r) => Math.abs(r.learned)), rows.map((r) => Math.abs(r.latent))),
  };
}

/** Reliability bins over the held-out labels of every trial: predicted P(first picked) against what happened. */
export function calibrationBins(trials: Trial[]) {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0000001];
  const all = trials.flatMap((t) => t.predictions);
  const bins: Array<{ from: number; to: number; n: number; predicted: number; observed: number }> = [];
  let ece = 0;
  let total = 0;
  for (let i = 0; i < edges.length - 1; i++) {
    const rows = all.filter((p) => p.p >= edges[i]! && p.p < edges[i + 1]!);
    if (!rows.length) continue;
    const predicted = rows.reduce((s, r) => s + r.p, 0) / rows.length;
    const observed = rows.reduce((s, r) => s + r.y, 0) / rows.length;
    ece += rows.length * Math.abs(predicted - observed);
    total += rows.length;
    bins.push({ from: edges[i]!, to: Math.min(1, edges[i + 1]!), n: rows.length, predicted, observed });
  }
  return { bins, ece: ece / total };
}

/** Headline-split labels where the model was at least `minMargin` logits sure and the label went the other way. */
export function confidentMisses(headline: Trial, minMargin = 2) {
  return headline.predictions
    .filter((p) => Math.abs(p.margin) >= minMargin && (p.margin > 0 ? 1 : 0) !== p.y)
    .sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin))
    .map((p) => ({ preferred: p.margin > 0 ? p.a : p.b, picked: p.chosen, margin: Math.abs(p.margin) }));
}

export interface EvalInputs {
  linear: Agg;
  nonlinear: Agg;
  headline: Trial;
  rec: Recovery;
  curve: Array<{ n: number; learned: Summary; baseline: Summary }>;
  trialsLabels: { train: number; test: number };
  pool: { generated: number; eligible: number };
  lapse: number;
  extraction?: { n: number; agreementWithGenerationSpec: Record<string, { agree: number; of: number; rate: number }> };
  pooled: Trial[];
  libraryPortraits: number;
  portraitsInPool: number;
}

function verdict(a: Agg): { text: string; wins: boolean } {
  const d = a.diff.statedBaseline.concordance;
  const dm = a.diff.statedBaseline.labelAccuracy;
  const wins = d.lo > 0 && dm.lo > 0;
  const worse = d.hi < 0 && dm.hi < 0;
  const text = wins
    ? `The learned model beats the stated-preference baseline on held-out data. Mean gain in held-out label accuracy is ${w2(dm.mean)} (95% interval ${w2(dm.lo)} to ${w2(dm.hi)}); it won in ${dm.learnedWins} of ${a.trials} splits.`
    : worse
      ? `The learned model is WORSE than the stated-preference baseline on held-out data (label accuracy ${w2(dm.mean)}, interval ${w2(dm.lo)} to ${w2(dm.hi)}).`
      : `The learned model does NOT clearly beat the stated-preference baseline: label accuracy difference ${w2(dm.mean)} (95% interval ${w2(dm.lo)} to ${w2(dm.hi)}).`;
  return { text, wins };
}

export function renderEvalReport(e: EvalInputs): string {
  const L: string[] = [];
  const out = (s = '') => L.push(s);
  const v = verdict(e.linear);

  out('# Evaluation: learned preference model versus stated preference');
  out();
  out('*Generated by `npm run calibrate`. Every number below is computed on held-out people the model never saw. Nothing was tuned on the test data.*');
  out();
  out('## Verdict');
  out();
  out(`**${v.text}**`);
  out();
  out(
    `The model recovered the sign of ${e.rec.signAgreement.ok} of ${e.rec.signAgreement.of} features the latent function uses, with cosine similarity ${f3(e.rec.cosine)} between learned and true weights, and ${e.rec.spuriousCount} spurious finding${e.rec.spuriousCount === 1 ? '' : 's'} (a feature with no true effect whose interval excluded zero).`,
  );
  out();
  out('Read the result for what it is. The labels come from a function we wrote, and the model class (a linear utility over named features) matches the shape of that function. A good score here shows the pipeline works and the finding is recoverable; it does not show the method would work on a real person. The nonlinear stress test below removes the shape match.');
  out();
  out('## Setup');
  out();
  out(`- Calibration pool: ${e.pool.generated} generated profiles from a separate seed, of which ${e.pool.eligible} pass Eric's hard rules (city excluded). The funnel runs on a different pool of 500.`);
  out(`- Each trial splits the pool by PERSON: 70% for training, 30% held out. Training labels compare only training people (${e.trialsLabels.train} comparisons); test labels compare only held-out people (${e.trialsLabels.test}). No held-out person appears in any training comparison.`);
  out(`- Label noise: choices follow a logistic (Bradley-Terry) rule on the latent utility, so near-ties are close to coin flips; ${Math.round(e.lapse * 100)}% of labels are pure coin flips; and a fixed per-person idiosyncratic term that no model can learn is added to the utility. Even the true function scores below 100% on its own labels.`);
  out(`- ${e.linear.trials} independent trials (different splits, different label draws). Intervals are 95% intervals of the mean across trials.`);
  out('- "True utility" is the latent function including the idiosyncratic term. The oracle row scores the latent function against its own noisy labels, which is the ceiling for any model.');
  out();
  out('## Held-out results');
  out();
  const table = (a: Agg) => {
    out('| scorer | ' + METRIC_NAMES.map((m) => METRIC_LABEL[m]).join(' | ') + ' |');
    out('|---|' + METRIC_NAMES.map(() => '---:').join('|') + '|');
    for (const k of ['learned', 'statedBaseline', 'statedMobility', 'oracle'] as ScorerKey[]) {
      out(`| ${SCORER_LABEL[k]} | ${METRIC_NAMES.map((m) => sm(a.table[k][m])).join(' | ')} |`);
    }
  };
  table(e.linear);
  out();
  out('Chance is 0.500 for accuracy and agreement, 0 for rank correlation, and 0.100 for top-10% overlap.');
  out();
  out('### Paired difference, learned minus baseline');
  out();
  out('| comparator | metric | mean difference | 95% interval | learned wins |');
  out('|---|---|---:|---|---:|');
  for (const b of ['statedBaseline', 'statedMobility'] as const) {
    for (const m of METRIC_NAMES) {
      const d = e.linear.diff[b][m];
      out(`| ${SCORER_LABEL[b]} | ${METRIC_LABEL[m]} | ${w2(d.mean)} | ${w2(d.lo)} to ${w2(d.hi)} | ${d.learnedWins} / ${e.linear.trials} |`);
    }
  }
  out();
  out(
    'The stated-preference baseline in the repo scores near chance because it cannot see work and roots at all: it ranks on shared interests, intent, language, activity and age fit, none of which the latent function cares about much. The literal-mobility comparator scores far BELOW chance, which is the divergence expressed as a number: ranking by what Eric says he wants puts the people he would pick near the bottom.',
  );
  out();
  out('## Did the model recover the latent signal?');
  out();
  out('Latent weights are shown in the model\'s units (logits per standard deviation of each feature), so the columns are directly comparable. A learned interval that excludes the latent value is not a failure by itself: label noise and the correlation between the rooted features (a person with a studio also tends to stay put) move weight between neighbours.');
  out();
  out('| feature | group | true (latent) | learned | 90% interval (cluster bootstrap over people) | sign |');
  out('|---|---|---:|---:|---|---|');
  for (const r of [...e.rec.rows].sort((a, b) => Math.abs(b.latent) - Math.abs(a.latent) || Math.abs(b.learned) - Math.abs(a.learned))) {
    out(`| ${r.feature} | ${r.group} | ${w2(r.latent)} | ${w2(r.learned)} | ${w2(r.lo)} to ${w2(r.hi)} | ${r.signOk === null ? (r.spurious ? 'SPURIOUS' : 'no true effect') : r.signOk ? 'ok' : 'WRONG'} |`);
  }
  out();
  const spurByGroup = ['declared', 'life', 'visual'].map((g) => [g, e.rec.rows.filter((r) => r.spurious && r.group === g).length] as const).filter(([, n]) => n > 0);
  out(`- Spurious findings by group: ${spurByGroup.length ? spurByGroup.map(([g, n]) => `${g} ${n}`).join(', ') : 'none'}. About one in ten features with no true effect is expected to show an interval that excludes zero by chance at this level, more when features are correlated. The visual features are the least reliable part of the model: the library has ${e.libraryPortraits} portraits, and because they are matched to profiles on declared gender and age, the calibration pool draws on only ${e.portraitsInPool} distinct ones. A visual weight is estimated from at most that many distinct images, shared across many people, and a feature that none of them shows (for example a nature setting) gets no weight at all.`);
  out(`- Top five features by size, learned: ${e.rec.top5.learned.join(', ')}.`);
  out(`- Top five by size, true: ${e.rec.top5.latent.join(', ')}. Overlap: ${e.rec.top5.overlap} of 5.`);
  out(`- Rank correlation between learned and true absolute weights across all features: ${f3(e.rec.rankCorrelation)}.`);
  out(`- This table is the headline split (seed ${e.headline.seed}), the model shipped in \`data/calibration/model.json\`: trained on ${e.headline.trainLabels.length} labels over ${e.headline.split.train} people, scored on ${e.headline.split.test} held-out people.`);
  out();
  out('## Learning curve');
  out();
  out('Held-out label accuracy as the number of training labels grows, averaged over trials. The baseline does not learn, so its line is flat.');
  out();
  out('| training labels | learned | stated-preference-v1 |');
  out('|---:|---|---|');
  for (const c of e.curve) out(`| ${c.n} | ${sm(c.learned)} | ${sm(c.baseline)} |`);
  out();
  out('## Stress test: a latent function the model cannot represent exactly');
  out();
  out('Same preference direction (rooted is better), different shape: saturating years in city, a tenure threshold, an interaction between having a practice and place-bound work, and a capped travel penalty. The model is unchanged and still linear.');
  out();
  table(e.nonlinear);
  out();
  const nl = e.nonlinear.diff.statedBaseline.labelAccuracy;
  out(`Learned minus baseline, held-out label accuracy: ${w2(nl.mean)} (95% interval ${w2(nl.lo)} to ${w2(nl.hi)}).`);
  out();
  out('## Probability calibration');
  out();
  out('Does "70% sure he picks A" mean A wins about 70% of the time? Held-out labels pooled over all trials, grouped by the model\'s predicted probability that the first person is picked.');
  out();
  out('| predicted P(first picked) | labels | predicted mean | observed |');
  out('|---|---:|---:|---:|');
  const allPreds = e.pooled.flatMap((t) => t.predictions);
  const cal = calibrationBins(e.pooled);
  for (const b of cal.bins) out(`| ${b.from.toFixed(1)} to ${b.to.toFixed(1)} | ${b.n} | ${f3(b.predicted)} | ${f3(b.observed)} |`);
  out();
  out(`Expected calibration error: ${f3(cal.ece)}. Log loss on held-out labels, headline split: learned ${f3(e.headline.logLoss.learned)} versus oracle ${f3(e.headline.logLoss.oracle)} (lower is better; ${f3(Math.log(2))} is a coin flip).`);
  out();
  out('## Where the model is confident and wrong');
  out();
  const confident = allPreds.filter((p) => Math.abs(p.margin) >= 2);
  const wrong = confident.filter((p) => (p.margin > 0 ? 1 : 0) !== p.y);
  out(`Of ${confident.length} held-out labels where the model's margin was at least 2 logits (about 88% confident), ${wrong.length} (${confident.length ? Math.round((100 * wrong.length) / confident.length) : 0}%) went the other way.`);
  out();
  const byId = new Map(e.headline.testPeople.map((c) => [c.id, c]));
  const cw = e.headline.predictions.filter((p) => Math.abs(p.margin) >= 2 && (p.margin > 0 ? 1 : 0) !== p.y).sort((a, b) => Math.abs(b.margin) - Math.abs(a.margin)).slice(0, 3);
  if (cw.length) {
    out('Largest misses on the headline split:');
    out();
    const desc = (id: string) => {
      const c: Candidate = byId.get(id)!;
      return `${c.displayName} (${describe(c)})`;
    };
    for (const p of cw) {
      const preferred = p.margin > 0 ? p.a : p.b;
      const picked = p.chosen;
      out(`- The model expected **${desc(preferred)}** to be picked (margin ${Math.abs(p.margin).toFixed(1)} logits). The label picked **${desc(picked)}**.`);
    }
    out();
  }
  out('A confident miss is not necessarily the model\'s mistake. Labels include coin flips and individual taste that no feature captures, and the model cannot tell those apart from signal. Each miss is a case a person can look at and overrule.');
  out();
  if (e.extraction) {
    out('## Visual feature extraction');
    out();
    out(`The scene features come from a local vision-language model asked only about the photograph. Agreement with what the image generator was ASKED to draw, over ${e.extraction.n} portraits:`);
    out();
    out('| feature | agree | rate |');
    out('|---|---:|---:|');
    for (const [k, a] of Object.entries(e.extraction.agreementWithGenerationSpec)) out(`| ${k} | ${a.agree} / ${a.of} | ${f3(a.rate)} |`);
    out();
    out('The generator can drift from its prompt, so disagreement is not purely extractor error. The portraits are reused across profiles, so errors are shared by every profile that uses the same portrait.');
    out();
  }
  out('## What this does not show');
  out();
  out('- That a real person has a revealed preference that contradicts their stated one. Eric is fictional; the contradiction is built in.');
  out('- That the method works on real labels, which are less tidy than a logistic choice rule.');
  out('- Anything about attractiveness. No feature measures it. The visual features describe photographs.');
  out('- That the 30% held-out people are representative of the 500 the funnel runs on. They come from the same generator, not the same pool.');
  return L.join('\n');
}
