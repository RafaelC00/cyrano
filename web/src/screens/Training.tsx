import { useCallback, useEffect, useState } from 'react';
import { ENDPOINTS, fromSeam, postSeam } from '../contracts.ts';
import type { FeatureWeight, Label, LabelSummary, ModelReport, PersonRef, Source, TrainingItem } from '../contracts.ts';
import { fixtureModelReport, fixtureTrainingItems, labelSummary, undoLabel, writeLabel } from '../fixtures.ts';
import { known, loadPool } from '../lib/data.ts';
import { langName, pct } from '../lib/format.ts';
import { useResource } from '../lib/resource.ts';
import { ErrorBox, Icon, Kbd, Loading, PageHeader, Photo, SourceBadge } from '../ui/kit.tsx';

type Mode = 'pair' | 'rating';

function PersonCard({ p, cue, onPick, disabled }: { p: PersonRef; cue?: string; onPick?: () => void; disabled?: boolean }) {
  const c = known(p.id);
  const body = (
    <>
      <Photo photoRef={p.photoRef} name={p.displayName} className="tcard__photo" />
      <span className="tcard__body">
        <span className="tcard__name serif">
          {p.displayName}
          <span className="mono dim"> {p.age}</span>
        </span>
        <span className="dim">{p.city}</span>
        {c ? (
          <>
            <span className="tcard__line">{c.declared.interests.slice(0, 4).join(' · ')}</span>
            <span className="tcard__line faint">
              {c.declared.languages.map(langName).join(', ')} · {c.declared.lookingFor.join(', ')}
            </span>
            {c.declared.prompts[0] ? <span className="tcard__quote">“{c.declared.prompts[0].answer}”</span> : null}
          </>
        ) : null}
        {cue ? (
          <span className="tcard__cue">
            <Kbd>{cue}</Kbd> choose
          </span>
        ) : null}
      </span>
    </>
  );
  return onPick ? (
    <button className="tcard tcard--btn" onClick={onPick} disabled={disabled}>
      {body}
    </button>
  ) : (
    <div className="tcard">{body}</div>
  );
}

function Progress({ s }: { s: LabelSummary }) {
  const p = Math.min(1, s.count / s.target);
  return (
    <div className="tprog" role="img" aria-label={`${s.count} of ${s.target} labels`}>
      <div className="tprog__nums">
        <span className="serif">{s.count}</span>
        <span className="faint mono">/ {s.target} labels</span>
      </div>
      <div className="meter">
        <i style={{ width: `${p * 100}%` }} />
      </div>
    </div>
  );
}

function Axis({ f }: { f: FeatureWeight }) {
  const x = (v: number) => `${50 + Math.max(-1, Math.min(1, v)) * 50}%`;
  const contradicts = Math.sign(f.stated) !== Math.sign(f.learned) && Math.abs(f.stated) > 0.3 && Math.abs(f.learned) > 0.15;
  const hidden = Math.abs(f.stated) < 0.15 && Math.abs(f.learned) > 0.3;
  return (
    <li className="axis">
      <div className="axis__label">
        <span>{f.label}</span>
        {contradicts ? <span className="chip chip--bad">contradicts</span> : hidden ? <span className="chip chip--accent">not stated</span> : null}
      </div>
      <div className="axis__track" role="img" aria-label={`${f.label}: you stated ${f.stated.toFixed(2)}, your choices imply ${f.learned.toFixed(2)}`}>
        <i className="axis__zero" />
        <i className="axis__ci" style={{ left: x(f.low), width: `calc(${x(f.high)} - ${x(f.low)})` }} />
        <i className="axis__learned" style={{ left: x(f.learned) }} />
        <i className="axis__stated" style={{ left: x(f.stated) }} />
      </div>
    </li>
  );
}

function Calibration({ bins }: { bins: ModelReport['calibration'] }) {
  const S = 120;
  const pt = (v: number) => 8 + v * (S - 16);
  return (
    <svg className="calib" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Calibration: predicted probability against how often you agreed">
      <rect x="8" y="8" width={S - 16} height={S - 16} fill="none" stroke="var(--line)" />
      <line x1={pt(0)} y1={S - pt(0)} x2={pt(1)} y2={S - pt(1)} stroke="var(--line-strong)" strokeDasharray="3 3" />
      <polyline fill="none" stroke="var(--info)" strokeWidth="1.5" points={bins.map((b) => `${pt(b.predicted)},${S - pt(b.observed)}`).join(' ')} />
      {bins.map((b) => (
        <circle key={b.predicted} cx={pt(b.predicted)} cy={S - pt(b.observed)} r={2 + Math.min(3, b.n / 8)} fill="var(--info)" />
      ))}
    </svg>
  );
}

function ModelPanel({ report, source }: { report: ModelReport; source: Source }) {
  const h = report.heldOut;
  const gap = h ? h.learned - h.stated : 0;
  return (
    <aside className="model" aria-label="What the model has learned">
      <header className="model__head">
        <div>
          <p className="eyebrow">What it has learned</p>
          <h2 className="serif">Stated against revealed.</h2>
        </div>
        <SourceBadge source={source} what="The scoring service is not merged yet. This panel is generated locally and moves as you add labels." />
      </header>

      {report.finding ? (
        <section className="finding">
          <h3 className="serif">{report.finding.title}</h3>
          <p>{report.finding.evidence}</p>
          <p className="faint finding__hint">You can disagree with this. That is the point of showing the evidence.</p>
        </section>
      ) : (
        <section className="finding finding--wait">
          <h3 className="serif">Not enough labels to say anything yet.</h3>
          <p>The model reports nothing until it has at least 40 judgments, so it cannot guess at you.</p>
        </section>
      )}

      <section>
        <div className="model__sub">
          <p className="eyebrow">Weight in your choices</p>
          <ul className="legend" aria-hidden="true">
            <li>
              <i className="lg lg--stated" /> you said
            </li>
            <li>
              <i className="lg lg--learned" /> you chose
            </li>
          </ul>
        </div>
        <div className="axis__scale" aria-hidden="true">
          <span>avoid</span>
          <span>prefer</span>
        </div>
        <ul className="axes">
          {report.features.map((f) => (
            <Axis key={f.key} f={f} />
          ))}
        </ul>
        <p className="faint model__fine">Bars are the interval the labels can support. It narrows as you label more.</p>
      </section>

      <section className="held">
        <p className="eyebrow">Held-out test</p>
        {h ? (
          <>
            <div className="held__nums">
              <div>
                <span className="serif">{pct(h.learned)}</span>
                <span className="faint">learned model</span>
              </div>
              <div>
                <span className="serif dim">{pct(h.stated)}</span>
                <span className="faint">stated-preference baseline</span>
              </div>
            </div>
            <p className="dim">
              {gap > 0.005
                ? `Beats the baseline by ${(gap * 100).toFixed(0)} points on ${h.n} comparisons it never saw.`
                : 'Does not beat the stated-preference baseline yet. That is reported as it is.'}
            </p>
          </>
        ) : (
          <p className="faint">Needs 40 labels before there is anything held out to test on.</p>
        )}
        <div className="held__calib">
          <Calibration bins={report.calibration} />
          <p className="faint">
            Calibration. When it says 70 percent, you agree about 70 percent of the time if the line follows the diagonal.
          </p>
        </div>
      </section>

      <section>
        <p className="eyebrow">Where it disagrees with you</p>
        <ul className="disagree">
          {report.disagreements.map((d) => (
            <li key={d.person.id}>
              <Photo photoRef={d.person.photoRef} name={d.person.displayName} className="disagree__photo" />
              <div>
                <p>
                  <b>{d.person.displayName}</b>
                  <span className="mono faint">
                    {' '}
                    you #{d.statedRank} → model #{d.learnedRank}
                  </span>
                </p>
                <p className="dim">{d.because}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <p className="faint model__fine">{report.note}</p>
    </aside>
  );
}

export default function Training() {
  const [mode, setMode] = useState<Mode>('pair');
  const [summary, setSummary] = useState<LabelSummary>(() => labelSummary());
  const [source, setSource] = useState<Source>('fixture');
  const [say, setSay] = useState('');
  const [shown, setShown] = useState(0);

  const pool = useResource(() => loadPool().catch(() => []));
  const batch = useResource(
    async () => {
      const people = pool.data ?? [];
      const r = await fromSeam<TrainingItem[]>(`${ENDPOINTS.trainingNext}?mode=${mode}&n=40`, () => fixtureTrainingItems(people, mode, 40));
      setSource(r.source);
      return r.data;
    },
    [mode, pool.data?.length],
  );
  const report = useResource(
    async () => {
      const people = (pool.data ?? []).slice(0, 4).map((c) => ({ id: c.id, displayName: c.displayName, age: c.declared.age, city: c.declared.city, photoRef: c.photos[0]?.photoRef ?? null }));
      return fromSeam<ModelReport>(ENDPOINTS.modelReport, () => fixtureModelReport(summary.count, people));
    },
    [summary.count, pool.data?.length],
  );

  const items = batch.data ?? [];
  const item = items[shown];

  useEffect(() => setShown(0), [mode]);
  // Ran out of the fetched batch: fetch the next one.
  useEffect(() => {
    if (batch.data && shown >= batch.data.length && !batch.loading) {
      setShown(0);
      batch.reload();
    }
  }, [shown, batch.data, batch.loading, batch.reload]);

  const submit = useCallback(
    async (l: Label, word: string) => {
      const r = await postSeam<LabelSummary>(ENDPOINTS.trainingLabels, l, () => writeLabel(l));
      setSummary(r.data);
      setShown((i) => i + 1);
      setSay(`${word}. ${r.data.count} labels.`);
    },
    [],
  );

  const choose = useCallback(
    (choice: 'a' | 'b' | 'neither') => {
      if (item?.kind !== 'pair') return;
      void submit({ itemId: item.id, kind: 'pair', choice, at: new Date().toISOString() }, choice === 'neither' ? 'Skipped' : `Chose ${choice === 'a' ? item.a.displayName : item.b.displayName}`);
    },
    [item, submit],
  );
  const rate = useCallback(
    (rating: 1 | 2 | 3 | 4 | 5) => {
      if (item?.kind !== 'rating') return;
      void submit({ itemId: item.id, kind: 'rating', rating, at: new Date().toISOString() }, `Rated ${item.person.displayName} ${rating}`);
    },
    [item, submit],
  );
  const undo = useCallback(() => {
    if (shown === 0) return;
    setSummary(undoLabel());
    setShown((i) => i - 1);
    setSay('Last label undone.');
  }, [shown]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (mode === 'pair') {
        if (e.key === 'ArrowLeft' || e.key === 'a') choose('a');
        else if (e.key === 'ArrowRight' || e.key === 'b') choose('b');
        else if (e.key === 'ArrowDown' || e.key === 'n') choose('neither');
      } else if (/^[1-5]$/.test(e.key)) rate(Number(e.key) as 1 | 2 | 3 | 4 | 5);
      if (e.key === 'z') undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, choose, rate, undo]);

  return (
    <>
      <PageHeader
        eyebrow="Calibration · preference learning"
        title={
          <>
            Teach it <em>your taste.</em>
          </>
        }
        lede="Each comparison is one label. The model fits your choices, then shows you where they differ from what you wrote down. Your stated profile is an input; what you pick is the finding."
        right={
          <div className="seg" role="group" aria-label="Label style">
            <button aria-pressed={mode === 'pair'} onClick={() => setMode('pair')}>
              Pairwise
            </button>
            <button aria-pressed={mode === 'rating'} onClick={() => setMode('rating')}>
              Rate
            </button>
          </div>
        }
      />
      <p className="sr-only" role="status" aria-live="polite">
        {say}
      </p>

      <div className="train">
        <section className="train__label" aria-label="Labelling">
          <div className="train__top">
            <Progress s={summary} />
            <SourceBadge source={source} what="Training items come from the scoring service when it is merged. Until then they are drawn from the live pool and labels stay in this browser." />
          </div>

          {batch.error ? <ErrorBox error={batch.error} retry={batch.reload} /> : null}
          {batch.loading && !batch.data ? <Loading /> : null}

          {item?.kind === 'pair' ? (
            <>
              <p className="train__q serif">Who would you rather meet?</p>
              <div className="pair" key={item.id}>
                <PersonCard p={item.a} cue="←" onPick={() => choose('a')} />
                <PersonCard p={item.b} cue="→" onPick={() => choose('b')} />
              </div>
              <div className="train__actions">
                <button className="btn" onClick={() => choose('neither')}>
                  Can't choose <Kbd>↓</Kbd>
                </button>
                <button className="btn btn--ghost" onClick={undo} disabled={shown === 0}>
                  <Icon name="undo" size={16} /> Undo <Kbd>Z</Kbd>
                </button>
              </div>
            </>
          ) : null}

          {item?.kind === 'rating' ? (
            <>
              <p className="train__q serif">How much would you want to meet this person?</p>
              <div className="rate" key={item.id}>
                <PersonCard p={item.person} />
                <div className="rate__scale" role="group" aria-label="Rating, 1 to 5">
                  {([1, 2, 3, 4, 5] as const).map((n) => (
                    <button key={n} onClick={() => rate(n)} aria-label={`${n} of 5`}>
                      <span className="serif">{n}</span>
                      <Kbd>{String(n)}</Kbd>
                    </button>
                  ))}
                </div>
                <div className="rate__ends faint">
                  <span>Not at all</span>
                  <span>Very much</span>
                </div>
              </div>
              <div className="train__actions">
                <button className="btn btn--ghost" onClick={undo} disabled={shown === 0}>
                  <Icon name="undo" size={16} /> Undo <Kbd>Z</Kbd>
                </button>
              </div>
            </>
          ) : null}
          <p className="faint train__fine">
            Everyone here is generated. The labels are stored in this browser until the scoring service takes them.
          </p>
        </section>

        {report.data ? <ModelPanel report={report.data.data} source={report.data.source} /> : report.error ? <ErrorBox error={report.error} /> : <Loading />}
      </div>
    </>
  );
}
