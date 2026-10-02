import type { Candidate } from '../domain/types.ts';
import type { Preferences } from '../agent/preferences.ts';
import { FEATURES, featureVector } from '../scoring/features.ts';
import { lifeOf } from '../scoring/life.ts';
import { StatedMobilityScorer } from '../scoring/learned.ts';
import { utility } from '../scoring/pairwise.ts';
import type { PairwiseModel } from '../scoring/pairwise.ts';
import { STATED_CLAIMS } from './eric.ts';
import type { Label } from './latent.ts';

/**
 * The divergence report: where what Eric SAID and what his choices SHOW disagree, with evidence.
 *
 * Everything here is computed from the labels and the fitted model. It does not read the latent
 * function. Grading the model against the ground truth lives in evaluate.ts and the eval report;
 * this report is what a person would read.
 */

export type Verdict = 'contradicts' | 'confirms' | 'not-detected' | 'revealed-only' | 'no-signal';

export interface FeatureEvidence {
  feature: string;
  group: string;
  weight: number;
  ci: { lo: number; hi: number };
  /** The 90% interval excludes zero. */
  stable: boolean;
  claim?: { expected: 1 | -1; basis: string; source: string };
  verdict: Verdict;
  /** Model-free evidence: among comparisons where the two people clearly differ on this feature. */
  choice?: { n: number; pickedMore: number; rate: number; lo: number; hi: number };
  highPhrase: string;
  lowPhrase: string;
}

export interface Example {
  picked: string;
  other: string;
  pickedDescription: string;
  otherDescription: string;
}

export interface Divergence {
  nLabels: number;
  nPeople: number;
  features: FeatureEvidence[];
  headline: {
    /** Comparisons where one person clearly fitted the stated profile better (top third by margin). */
    n: number;
    pickedStatedBetter: number;
    rate: number;
    lo: number;
    hi: number;
  };
  examples: Example[];
}

function wilson(k: number, n: number): { lo: number; hi: number } {
  if (!n) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: (c - h) / d, hi: (c + h) / d };
}

export function describe(c: Candidate): string {
  const l = lifeOf(c);
  const n = (k: number, unit: string) => `${k} ${unit}${k === 1 ? '' : 's'}`;
  return `${l.occupation.title}, ${n(l.yearsInCity, 'year')} in ${c.declared.city}, ${n(l.nightsAwayPerMonth, 'night')} away a month${l.hasPhysicalPractice ? ', has a practice tied to a place' : ''}`;
}

export function buildDivergence(
  model: PairwiseModel,
  ci: Array<{ lo: number; hi: number }>,
  people: Candidate[],
  labels: Label[],
  prefs: Preferences,
): Divergence {
  const byId = new Map(people.map((c) => [c.id, c]));
  const vec = new Map(people.map((c) => [c.id, featureVector(c, prefs)]));
  const claims = new Map(STATED_CLAIMS.map((c) => [c.feature, c]));

  const features: FeatureEvidence[] = FEATURES.map((f, j) => {
    const w = model.weights[j]!;
    const interval = ci[j]!;
    const stable = interval.lo > 0 || interval.hi < 0;
    const claim = claims.get(f.name);
    // Model-free evidence: how often the person with more of the feature was picked, over the
    // comparisons where the two differ by at least half a standard deviation.
    let n = 0;
    let more = 0;
    for (const l of labels) {
      const a = vec.get(l.a)![j]!;
      const b = vec.get(l.b)![j]!;
      if (Number.isNaN(a) || Number.isNaN(b) || Math.abs(a - b) < 0.5 * model.std[j]!) continue;
      n++;
      const aHigher = a > b;
      if ((l.chosen === l.a) === aHigher) more++;
    }
    const rate = n ? more / n : 0.5;
    let verdict: Verdict;
    if (claim) verdict = !stable ? 'not-detected' : Math.sign(w) === claim.expected ? 'confirms' : 'contradicts';
    else verdict = stable ? 'revealed-only' : 'no-signal';
    return {
      feature: f.name,
      group: f.group,
      weight: w,
      ci: interval,
      stable,
      claim: claim ? { expected: claim.expected, basis: claim.basis, source: claim.source } : undefined,
      verdict,
      choice: n ? { n, pickedMore: more, rate, ...wilson(more, n) } : undefined,
      highPhrase: f.high,
      lowPhrase: f.low,
    };
  });

  // Headline: take the comparisons where the stated profile clearly favoured one person.
  const stated = new StatedMobilityScorer();
  const rows = labels
    .map((l) => {
      const a = byId.get(l.a)!;
      const b = byId.get(l.b)!;
      const margin = stated.score(a, prefs).score - stated.score(b, prefs).score;
      const statedBetter = margin > 0 ? a : b;
      return { l, a, b, margin: Math.abs(margin), statedBetter, pickedStatedBetter: l.chosen === statedBetter.id };
    })
    .sort((x, y) => y.margin - x.margin);
  const top = rows.slice(0, Math.floor(rows.length / 3));
  const picked = top.filter((r) => r.pickedStatedBetter).length;
  const headline = { n: top.length, pickedStatedBetter: picked, rate: top.length ? picked / top.length : 0, ...wilson(picked, top.length) };

  // Concrete cases: strong stated preference for one person, the model agrees with the pick.
  const examples: Example[] = [];
  for (const r of top) {
    if (r.pickedStatedBetter || examples.length >= 3) continue;
    const pickedC = byId.get(r.l.chosen)!;
    const other = r.l.chosen === r.a.id ? r.b : r.a;
    const du = utility(model, vec.get(pickedC.id)!) - utility(model, vec.get(other.id)!);
    if (du < 1) continue; // only cases the model also explains
    examples.push({ picked: pickedC.displayName, other: other.displayName, pickedDescription: describe(pickedC), otherDescription: describe(other) });
  }
  return { nLabels: labels.length, nPeople: people.length, features, headline, examples };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const w2 = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

const VERDICT_TEXT: Record<Verdict, string> = {
  contradicts: 'CONTRADICTS what you said',
  confirms: 'agrees with what you said',
  'not-detected': 'you said this; the labels show no clear effect',
  'revealed-only': 'you did not say this; your choices do',
  'no-signal': 'no clear effect',
};

/** Renders the human-readable report. */
export function renderDivergenceReport(d: Divergence, ctx: { scorer: string; seedNote: string }): string {
  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  const contradictions = d.features.filter((f) => f.verdict === 'contradicts').sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const revealed = d.features.filter((f) => f.verdict === 'revealed-only').sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const confirms = d.features.filter((f) => f.verdict === 'confirms');
  const notDetected = d.features.filter((f) => f.verdict === 'not-detected');

  out('# What you said, and what you picked');
  out();
  out('*Divergence report for Eric Vossberg, an invented persona. Generated by `npm run calibrate`.*');
  out();
  out(
    `**How this was made.** You compared ${d.nLabels} pairs of people, one choice at a time. A small, readable model (a logistic regression on differences between the two people) was fitted to those choices and nothing else. Below, every claim is either something you said or something your choices show, with the evidence next to it. You can disagree with any line.`,
  );
  out();
  out('> **Read this first.** Eric is fictional and so are his labels. They come from a latent preference function we wrote on purpose to contradict his stated profile. The question this report answers is whether the method can find that gap from the labels alone and state it plainly. It is a validation on synthetic ground truth, not a discovery about a person. See the eval report for the grading against the truth.');
  out();
  out('## The short version');
  out();
  const pick = d.headline;
  out(
    `You asked for someone mobile and unanchored. In the ${pick.n} comparisons where one person fitted that description clearly better than the other, you picked the better fit ${pct(pick.rate)} of the time (${pick.pickedStatedBetter} of ${pick.n}; 95% interval ${pct(pick.lo)} to ${pct(pick.hi)}). Chance is 50%.`,
  );
  out();
  if (contradictions.length) {
    out(`Your choices contradict your stated profile on **${contradictions.length}** point${contradictions.length > 1 ? 's' : ''}: ${contradictions.map((f) => f.feature.replaceAll('_', ' ')).join(', ')}.`);
  }
  out();
  out('## Where you said one thing and chose another');
  out();
  if (!contradictions.length) out('None found with a stable weight.');
  for (const f of contradictions) {
    const c = f.claim!;
    out(`### ${f.feature.replaceAll('_', ' ')}`);
    out();
    out(`- **You said:** ${c.source} (${c.basis}). That implies a person who ${c.expected > 0 ? f.highPhrase : f.lowPhrase}.`);
    out(`- **Your choices say:** you pick the person who ${f.weight > 0 ? f.highPhrase : f.lowPhrase}.`);
    if (f.choice) out(`- **Evidence from the raw choices:** when the two people clearly differed, you picked the one who ${f.highPhrase} ${pct(f.choice.rate)} of the time (${f.choice.pickedMore} of ${f.choice.n}; 95% interval ${pct(f.choice.lo)} to ${pct(f.choice.hi)}).`);
    out(`- **Model weight:** ${w2(f.weight)} logits per standard deviation (90% interval ${w2(f.ci.lo)} to ${w2(f.ci.hi)}).`);
    out();
  }
  if (d.examples.length) {
    out('### Three of your own choices, side by side');
    out();
    for (const e of d.examples) {
      out(`- You picked **${e.picked}** (${e.pickedDescription}) over **${e.other}** (${e.otherDescription}), although the second fits "mobile and unanchored" better.`);
    }
    out();
  }
  out('## What you did not say but your choices show');
  out();
  if (!revealed.length) out('Nothing beyond the points above.');
  for (const f of revealed.slice(0, 8)) {
    const weak = Math.min(Math.abs(f.ci.lo), Math.abs(f.ci.hi)) < 0.05;
    out(`- ${weak ? '(weak lead) ' : ''}**${f.feature.replaceAll('_', ' ')}**: you pick the person who ${f.weight > 0 ? f.highPhrase : f.lowPhrase} (weight ${w2(f.weight)}, 90% interval ${w2(f.ci.lo)} to ${w2(f.ci.hi)}${f.choice ? `; picked the higher one ${pct(f.choice.rate)} of ${f.choice.n} clear comparisons` : ''}).`);
  }
  if (revealed.length) out(`With ${d.features.length} features, one or two weak effects at the edge of their interval are expected by chance alone. A "weak lead" is an effect whose interval comes within 0.05 of zero: treat it as a question to ask, not a finding.`);
  out();
  out('## Where your words hold up, or the labels are silent');
  out();
  if (!confirms.length && !notDetected.length) out('No stated claim was confirmed.');
  for (const f of confirms) out(`- **${f.feature.replaceAll('_', ' ')}**: ${VERDICT_TEXT[f.verdict]} (${w2(f.weight)}).`);
  for (const f of notDetected) out(`- **${f.feature.replaceAll('_', ' ')}**: ${VERDICT_TEXT[f.verdict]} (${w2(f.weight)}, 90% interval ${w2(f.ci.lo)} to ${w2(f.ci.hi)}).`);
  out();
  out('## All weights');
  out();
  out('Weights are logits per standard deviation of the feature. Positive means you pick people with more of it. An interval that includes zero means the labels do not show a clear effect.');
  out();
  out('| feature | group | weight | 90% interval | said | verdict |');
  out('|---|---|---:|---|---|---|');
  for (const f of [...d.features].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))) {
    out(`| ${f.feature} | ${f.group} | ${w2(f.weight)} | ${w2(f.ci.lo)} to ${w2(f.ci.hi)} | ${f.claim ? (f.claim.expected > 0 ? 'more' : 'less') : '-'} | ${VERDICT_TEXT[f.verdict]} |`);
  }
  out();
  out('## What this does and does not claim');
  out();
  out('- The weights describe your choices in this sitting. They are not a statement about why you choose, and they are not a rule: the funnel uses them to rank, never to reject. Rejection stays on the fields you declared.');
  out('- The visual features describe the photograph (setting, activity, solo or group, photo type, lighting, focus). There is no attractiveness measure anywhere, by design.');
  out('- Some choices will be noise (a tired thumb, a near-tie), and the model cannot tell which. It also cannot see anything particular to one person that does not show up in a feature.');
  out(`- Scorer in the funnel: \`${ctx.scorer}\`. ${ctx.seedNote}`);
  out();
  return lines.join('\n');
}
