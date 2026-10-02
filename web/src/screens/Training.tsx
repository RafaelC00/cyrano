import { useCallback, useEffect, useState } from 'react';
import { agentGet, ENDPOINTS } from '../contracts.ts';
import type { ComparisonPage, FeatureWeight, Interval, ModelReport, PersonSummary } from '../contracts.ts';
import { pct } from '../lib/format.ts';
import { useResource } from '../lib/resource.ts';
import { ErrorBox, Icon, Kbd, Loading, PageHeader, Photo } from '../ui/kit.tsx';

const nice = (key: string) => {
  const t = key.replaceAll('_', ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const range = (i: Interval, digits = 1) => `${pct(i.lo, digits)} to ${pct(i.hi, digits)}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function Person({ p, picked, fits, side }: { p: PersonSummary; picked: boolean; fits: boolean; side: 'A' | 'B' }) {
  return (
    <div className={`tcard ${picked ? 'tcard--picked' : ''}`} aria-label={`${side}: ${p.name}${picked ? ', picked' : ''}`}>
      <Photo photoRef={null} name={p.name} className="tcard__photo" />
      <span className="tcard__body">
        <span className="tcard__name serif">
          {p.name}
          <span className="mono dim"> {p.age}</span>
        </span>
        <span className="dim">{p.city}</span>
        <span className="tcard__line">{p.job}</span>
        <span className="tcard__line faint">
          {plural(p.yearsInCity, 'year')} in {p.city} · {plural(p.nightsAwayPerMonth, 'night')} away a month
          {p.hasPractice ? ' · a practice tied to a place' : ''}
        </span>
        <span className="tcard__tags">
          {picked ? <span className="chip chip--accent">Eric picked this one</span> : null}
          {fits ? <span className="chip chip--info">fits "mobile and unanchored" better</span> : null}
        </span>
      </span>
    </div>
  );
}

function Comparisons() {
  const [against, setAgainst] = useState(false);
  const [index, setIndex] = useState(0);
  const page = useResource(() => agentGet<ComparisonPage>(`${ENDPOINTS.comparisons}?offset=${index}&n=1${against ? '&against=1' : ''}`), [index, against]);
  const total = page.data?.total ?? 0;
  const item = page.data?.items[0];

  const step = useCallback(
    (d: number) => {
      if (total) setIndex((i) => (i + d + total) % total);
    },
    [total],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step]);

  return (
    <section className="train__label" aria-label="Eric's comparisons">
      <div className="train__top">
        <div className="tprog">
          <div className="tprog__nums">
            <span className="serif">{total ? index + 1 : 0}</span>
            <span className="faint mono">/ {total} {against ? 'against what he said' : 'comparisons'}</span>
          </div>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={against}
            onChange={(e) => {
              setAgainst(e.target.checked);
              setIndex(0);
            }}
          />
          <span>Only where he picked against what he said</span>
        </label>
      </div>

      {page.error ? <ErrorBox error={page.error} retry={page.reload} /> : null}
      {page.loading && !page.data ? <Loading /> : null}

      {item && page.data ? (
        <>
          <p className="train__q serif">Two people. One pick.</p>
          <div className="pair" key={`${index}-${against}`}>
            <Person p={page.data.people[item.a]!} picked={item.chosen === 'a'} fits={item.fitsPitch === 'a'} side="A" />
            <Person p={page.data.people[item.b]!} picked={item.chosen === 'b'} fits={item.fitsPitch === 'b'} side="B" />
          </div>
          <div className="train__actions">
            <button className="btn" onClick={() => step(-1)}>
              <Icon name="back" size={16} /> Previous <Kbd>←</Kbd>
            </button>
            <button className="btn" onClick={() => step(1)}>
              Next <Kbd>→</Kbd>
            </button>
          </div>
        </>
      ) : null}
      <p className="faint train__fine">
        These {total ? '' : '600 '}comparisons were generated, not made by a person: each pick is a noisy draw from a preference function we wrote on purpose to favour people with roots. The people are generated too, and are not in the pool the funnel runs on. Every one of the 600 can be paged through here.
      </p>
    </section>
  );
}

function Axis({ f }: { f: FeatureWeight }) {
  const x = (v: number) => `${50 + Math.max(-1, Math.min(1, v / 0.8)) * 50}%`;
  const stable = f.lo > 0 || f.hi < 0;
  const contradicts = f.said !== null && stable && Math.sign(f.weight) !== f.said;
  const unsaid = f.said === null && stable;
  return (
    <li className="axis">
      <div className="axis__label">
        <span>{nice(f.key)}</span>
        {f.said !== null ? <span className="chip">said: {f.said > 0 ? 'more' : 'less'}</span> : null}
        {contradicts ? <span className="chip chip--bad">contradicts</span> : unsaid ? <span className="chip chip--accent">not stated</span> : null}
      </div>
      <div
        className="axis__track"
        role="img"
        aria-label={`${nice(f.key)}: learned weight ${f.weight.toFixed(2)}, 90 percent interval ${f.lo.toFixed(2)} to ${f.hi.toFixed(2)}; built in ${f.built.toFixed(2)}`}
      >
        <i className="axis__zero" />
        <i className="axis__ci" style={{ left: x(f.lo), width: `calc(${x(f.hi)} - ${x(f.lo)})` }} />
        {f.built !== 0 ? <i className="axis__built" style={{ left: x(f.built) }} /> : null}
        <i className="axis__learned" style={{ left: x(f.weight) }} />
      </div>
      <p className="mono faint axis__nums">
        {f.weight >= 0 ? '+' : ''}
        {f.weight.toFixed(2)} ({f.lo.toFixed(2)} to {f.hi.toFixed(2)}){f.built !== 0 ? ` · built in ${f.built >= 0 ? '+' : ''}${f.built.toFixed(2)}` : ''}
      </p>
    </li>
  );
}

function Calibration({ bins }: { bins: ModelReport['calibration']['bins'] }) {
  const S = 120;
  const pt = (v: number) => 8 + v * (S - 16);
  return (
    <svg className="calib" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Calibration: predicted probability against how often the first person was picked">
      <rect x="8" y="8" width={S - 16} height={S - 16} fill="none" stroke="var(--line)" />
      <line x1={pt(0)} y1={S - pt(0)} x2={pt(1)} y2={S - pt(1)} stroke="var(--line-strong)" strokeDasharray="3 3" />
      <polyline fill="none" stroke="var(--info)" strokeWidth="1.5" points={bins.map((b) => `${pt(b.predicted)},${S - pt(b.observed)}`).join(' ')} />
      {bins.map((b) => (
        <circle key={b.predicted} cx={pt(b.predicted)} cy={S - pt(b.observed)} r={3} fill="var(--info)" />
      ))}
    </svg>
  );
}

function Scorers({ r }: { r: ModelReport }) {
  const top = r.scorers.find((s) => s.key === 'oracle')!.accuracy.mean;
  return (
    <div className="scorers" role="table" aria-label="Held-out results">
      <div className="scorers__head" role="row">
        <span role="columnheader">Scorer</span>
        <span role="columnheader">Picks the same person as the label</span>
        <span role="columnheader">Rank correlation</span>
      </div>
      {r.scorers.map((s) => (
        <div key={s.key} className={`scorers__row scorers__row--${s.key}`} role="row">
          <span role="cell" className="scorers__name">
            {s.name}
          </span>
          <span role="cell" className="scorers__acc">
            <span className="scorers__bar" aria-hidden="true">
              <i style={{ width: `${s.accuracy.mean * 100}%` }} />
              <b style={{ left: '50%' }} />
              {s.key !== 'oracle' ? <u style={{ left: `${top * 100}%` }} /> : null}
            </span>
            <span className="mono">
              {pct(s.accuracy.mean, 1)} <small className="faint">({range(s.accuracy)})</small>
            </span>
          </span>
          <span role="cell" className="mono">
            {s.correlation.mean >= 0 ? '+' : ''}
            {s.correlation.mean.toFixed(3)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ModelPanel({ r }: { r: ModelReport }) {
  const learned = r.scorers.find((s) => s.key === 'learned')!;
  const stated = r.scorers.find((s) => s.key === 'stated')!;
  const mobility = r.scorers.find((s) => s.key === 'mobility')!;
  const oracle = r.scorers.find((s) => s.key === 'oracle')!;
  const clear = r.features.filter((f) => f.lo > 0 || f.hi < 0 || f.said !== null).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const rest = r.features.filter((f) => !clear.includes(f)).sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  return (
    <aside className="model" aria-label="What the model learned from Eric's comparisons">
      <header className="model__head">
        <div>
          <p className="eyebrow">What it learned · held out · all synthetic</p>
          <h2 className="serif">Stated against revealed.</h2>
        </div>
      </header>

      <section className="finding">
        <h3 className="serif">{r.finding.title}</h3>
        <p>{r.finding.evidence}</p>
        <p className="faint finding__hint">You can disagree with this. That is the point of showing the evidence.</p>
      </section>

      <section className="held">
        <p className="eyebrow">Held-out test · {r.setup.trials} random splits</p>
        <div className="held__nums">
          <div>
            <span className="serif">{pct(learned.accuracy.mean, 1)}</span>
            <span className="faint">learned model</span>
          </div>
          <div>
            <span className="serif dim">{pct(stated.accuracy.mean, 1)}</span>
            <span className="faint">stated-preference baseline</span>
          </div>
        </div>
        <p className="dim">
          Beats the baseline by {(r.gain.mean * 100).toFixed(0)} points ({(r.gain.lo * 100).toFixed(0)} to {(r.gain.hi * 100).toFixed(0)}), and wins {r.gain.wins} of {r.gain.of} splits. Each split trains on {r.setup.trainLabels} comparisons and tests on {r.setup.testLabels} between people it never saw. The most any model could score is {pct(oracle.accuracy.mean, 1)}, because the labels are noisy.
        </p>
        <Scorers r={r} />
        <p className="faint model__fine">
          The literal reading of Eric's pitch, ranking by how mobile and unanchored someone is, scores {pct(mobility.accuracy.mean, 1)}, far below the 50% of a coin flip, with a rank correlation of {mobility.correlation.mean.toFixed(3)}. That is the divergence as a number: ranking by what he says puts the people he picks near the bottom. Chance is 50%. The marked line is the ceiling.
        </p>
      </section>

      <section className="caveat" aria-label="How much weight this deserves">
        <p className="eyebrow">How much weight this deserves</p>
        <ul>
          <li>The labels come from a function we wrote, and the model is a linear utility over named features, the same shape. That is partly why it wins. A second test with a function the model cannot represent exactly gives {pct(r.stress.learnedAccuracy.mean, 1)} against {pct(r.stress.statedAccuracy.mean, 1)}.</li>
          <li>The visual features are the least reliable part. The library has {r.portraits.library} portraits and the calibration pool draws on only {r.portraits.inCalibrationPool} of them, so each visual weight rests on very few distinct images. A nature setting and a craft activity never appear, so they get zero weight.</li>
          <li>Eric is fictional. None of this shows the method works on a real person's choices.</li>
        </ul>
      </section>

      <section>
        <div className="model__sub">
          <p className="eyebrow">Weight in his choices</p>
          <ul className="legend" aria-hidden="true">
            <li>
              <i className="lg lg--built" /> built in
            </li>
            <li>
              <i className="lg lg--learned" /> learned
            </li>
          </ul>
        </div>
        <div className="axis__scale" aria-hidden="true">
          <span>avoids</span>
          <span>prefers</span>
        </div>
        <ul className="axes">
          {clear.map((f) => (
            <Axis key={f.key} f={f} />
          ))}
        </ul>
        <details className="model__more">
          <summary className="faint">{rest.length} features with no clear effect</summary>
          <ul className="axes">
            {rest.map((f) => (
              <Axis key={f.key} f={f} />
            ))}
          </ul>
        </details>
        <p className="faint model__fine">
          Logits per standard deviation of the feature, with a 90% interval from resampling people. It recovered the sign of {r.recovery.signsRight} of {r.recovery.signsOf} features the labels really use (cosine {r.recovery.cosine.toFixed(3)} with the true weights) and reported {r.recovery.spurious} that has none.
        </p>
      </section>

      <section className="held">
        <p className="eyebrow">Does "70% sure" mean 70%?</p>
        <div className="held__calib">
          <Calibration bins={r.calibration.bins} />
          <p className="faint">
            Held-out comparisons pooled over all splits, by predicted probability. On the diagonal is calibrated; expected calibration error {r.calibration.ece.toFixed(3)}.
          </p>
        </div>
      </section>

      <section>
        <p className="eyebrow">Where it was confident and wrong</p>
        <p className="faint model__fine">
          Of {r.confident.n} held-out comparisons where it was about 88% sure or more, {r.confident.wrong} went the other way. Some are noise the model cannot tell from signal.
        </p>
        <ul className="disagree">
          {r.misses.slice(0, 3).map((m) => (
            <li key={m.preferred.id + m.picked.id}>
              <div>
                <p>
                  Expected <b>{m.preferred.name}</b> <span className="dim">({m.preferred.job}, {plural(m.preferred.yearsInCity, 'year')} in {m.preferred.city}, {plural(m.preferred.nightsAwayPerMonth, 'night')} away a month)</span>
                </p>
                <p className="dim">
                  The label picked <b>{m.picked.name}</b> ({m.picked.job}, {plural(m.picked.yearsInCity, 'year')} in {m.picked.city}, {plural(m.picked.nightsAwayPerMonth, 'night')} away a month).
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="faint model__fine">
        Generated by <span className="mono">npm run calibrate</span> from a pool of {r.setup.pool.generated.toLocaleString('en')} generated profiles, {r.setup.pool.eligible} of which pass Eric's hard rules. The same numbers are in <span className="mono">data/calibration/EVAL.md</span>.
      </p>
    </aside>
  );
}

export default function Training() {
  const report = useResource(() => agentGet<ModelReport>(ENDPOINTS.modelReport));
  return (
    <>
      <PageHeader
        eyebrow="Calibration · preference learning"
        title={
          <>
            What Eric said, <em>and what he picked.</em>
          </>
        }
        lede="A small model was fitted to 600 of Eric's comparisons and nothing else. Then it was tested on people it had never seen, against a stated-preference baseline and against the literal reading of what he asked for. Stated preference is an input; the choices are the finding."
      />
      <div className="train">
        <Comparisons />
        {report.data ? <ModelPanel r={report.data} /> : report.error ? <ErrorBox error={report.error} retry={report.reload} /> : <Loading />}
      </div>
    </>
  );
}
