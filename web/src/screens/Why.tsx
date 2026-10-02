import { useMemo, useState } from 'react';
import { agent, ApiError } from '../api/phase1.ts';
import type { AuditEntry, WhyReport } from '../api/phase1.ts';
import { getCandidate, loadPool, loadSnapshot } from '../lib/data.ts';
import { ruleLabel, ruleName, stamp, STAGE_LABELS } from '../lib/format.ts';
import { go, href } from '../lib/router.ts';
import { invalidateAll, useResource } from '../lib/resource.ts';
import { ErrorBox, Icon, Loading, PageHeader, Photo } from '../ui/kit.tsx';
import { StandingTag } from '../ui/profile.tsx';

const OUTCOME_ICON: Record<AuditEntry['outcome'], { icon: 'check' | 'x' | 'undo' | 'spark'; cls: string; word: string }> = {
  pass: { icon: 'check', cls: 'ok', word: 'Passed' },
  fail: { icon: 'x', cls: 'bad', word: 'Failed' },
  overturn: { icon: 'undo', cls: 'info', word: 'Overturned' },
  accept: { icon: 'check', cls: 'ok', word: 'Accepted' },
  reject: { icon: 'x', cls: 'bad', word: 'Rejected' },
};

function Finder({ selected }: { selected?: string }) {
  const pool = useResource(() => loadPool());
  const [q, setQ] = useState('');
  const hits = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    return (pool.data ?? []).filter((c) => c.displayName.toLowerCase().includes(n) || c.id.toLowerCase().includes(n)).slice(0, 8);
  }, [q, pool.data]);

  return (
    <div className="finder">
      <div className="field">
        <label htmlFor="why-q">Look someone up</label>
        <div className="finder__input">
          <Icon name="search" size={16} />
          <input id="why-q" className="input" placeholder="A name or an id, for example Marta" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" autoFocus={!selected} />
        </div>
      </div>
      {hits.length ? (
        <ul className="finder__hits" aria-label="Matches">
          {hits.map((c) => (
            <li key={c.id}>
              <a href={href('why', c.id)} onClick={() => setQ('')}>
                <Photo photoRef={c.photos[0]?.photoRef} name={c.displayName} className="finder__thumb" />
                <span>
                  {c.displayName} <span className="mono faint">{c.id}</span>
                </span>
                <span className="faint">
                  {c.declared.age}, {c.declared.city}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : q ? (
        <p className="faint">Nobody called that in the pool.</p>
      ) : null}
    </div>
  );
}

function NearMisses() {
  const snap = useResource(loadSnapshot);
  if (!snap.data) return snap.error ? <ErrorBox error={snap.error} retry={snap.reload} /> : <Loading />;
  const names = new Map(snap.data.rejections.map((r) => [r.candidateId, r.displayName]));
  const close = snap.data.audit
    .filter((e) => e.rule === 'rank.cutoff' && e.outcome === 'fail')
    .map((e) => ({ id: e.candidateId, rank: Number(/ranked (\d+) of/.exec(e.reason)?.[1] ?? 99), reason: e.reason }))
    .filter((e) => names.has(e.id))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 8);
  const passed = snap.data.rejections.filter((r) => r.status === 'rejected').slice(0, 8);

  return (
    <div className="why-lists">
      <section>
        <p className="eyebrow">Close calls at the cutoff</p>
        <p className="dim why-lists__lede">Scored well, but the gate only holds so many. These are the first to check when someone good seems to be missing.</p>
        {close.length ? (
          <ul className="why-list">
            {close.map((c) => (
              <li key={c.id}>
                <a href={href('why', c.id)}>
                  <span>{names.get(c.id)}</span>
                  <span className="mono faint">rank {c.rank}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint">Nothing yet. Run the funnel first.</p>
        )}
      </section>
      <section>
        <p className="eyebrow">Passed by you</p>
        <p className="dim why-lists__lede">A human pass can be rewound on the platform and the person put back.</p>
        {passed.length ? (
          <ul className="why-list">
            {passed.map((c) => (
              <li key={c.candidateId}>
                <a href={href('why', c.candidateId)}>
                  <span>{c.displayName}</span>
                  <span className="faint">passed</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="faint">You have not passed anyone.</p>
        )}
      </section>
    </div>
  );
}

function Report({ id }: { id: string }) {
  const why = useResource(() => agent.why(id), [id]);
  const cand = useResource(() => getCandidate(id).catch(() => undefined), [id]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<Error>();

  const notFound = why.error instanceof ApiError && why.error.status === 404;
  if (notFound)
    return (
      <div className="notice notice--info" role="status">
        <div>
          <b>No record of this person.</b> They have not been evaluated yet, so there is nothing to explain.{' '}
          <a href={href('funnel')}>Run the funnel</a>.
        </div>
      </div>
    );
  if (why.error && !why.data) return <ErrorBox error={why.error} retry={why.reload} />;
  if (!why.data) return <Loading />;
  const w: WhyReport = why.data;
  const c = cand.data;

  const overturn = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await agent.overturn(id, note.trim() || undefined);
      setDone(true);
      setNote('');
      invalidateAll();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const verdict = (() => {
    if (w.status === 'accepted') return { head: 'You accepted this person.', body: 'A like is on the platform. It cannot be undone, so there is nothing to overturn.' };
    if (w.status === 'pending') return { head: 'Waiting at your gate.', body: w.overturned ? 'You overturned an earlier drop and they went back to the gate.' : 'Passed every rule and made the cut.' };
    const d = w.droppedBy;
    if (!d) return { head: 'Dropped.', body: '' };
    if (d.stage === 'gate') return { head: 'You passed on this person.', body: 'That was your decision at the gate. The pass is rewound on the platform if you overturn it.' };
    return { head: `Stopped at ${STAGE_LABELS[d.stage]?.toLowerCase()}: ${ruleLabel(d.rule).toLowerCase()}.`, body: d.reason };
  })();

  return (
    <article className="whyrep">
      <header className="whyrep__head">
        <Photo photoRef={c?.photos[0]?.photoRef} name={w.displayName} className="whyrep__photo" />
        <div>
          <h2 className="serif">
            {w.displayName}
            {c ? <span className="mono dim"> {c.declared.age}</span> : null}
          </h2>
          <p className="dim">
            {c ? `${c.declared.city}, ${c.declared.country} · ` : ''}
            <span className="mono">{w.candidateId}</span>
          </p>
          <StandingTag s={w.status === 'dropped' && w.droppedBy ? { status: 'dropped', stage: w.droppedBy.stage, rule: w.droppedBy.rule, reason: w.droppedBy.reason } : { status: w.status === 'rejected' ? 'rejected' : w.status === 'pending' ? 'pending' : 'accepted' }} />
        </div>
      </header>

      <section className="verdict">
        <p className="eyebrow">Verdict</p>
        <h3 className="serif">{verdict.head}</h3>
        {verdict.body ? <p className="dim">{verdict.body}</p> : null}
        {w.droppedBy && w.droppedBy.alsoFailed.length ? (
          <div className="verdict__also">
            <p className="label">Also failed</p>
            <ul>
              {w.droppedBy.alsoFailed.map((f) => (
                <li key={f.rule}>
                  <span className="chip chip--bad">{ruleLabel(f.rule)}</span> <span className="dim">{f.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="timeline-wrap">
        <p className="eyebrow">Every rule that evaluated them, in order</p>
        <ol className="timeline">
          {w.history.map((e, i) => {
            const o = OUTCOME_ICON[e.outcome];
            return (
              <li key={i} className={`tl tl--${o.cls}`}>
                <span className="tl__icon" aria-hidden="true">
                  <Icon name={o.icon} size={14} />
                </span>
                <div className="tl__body">
                  <p className="tl__top">
                    <b>{ruleName(e.rule)}</b> <span className="sr-only">{o.word}</span>
                    <span className="mono faint">{e.rule}</span>
                  </p>
                  <p className="dim">{e.reason}</p>
                </div>
                <span className="tl__meta mono faint">
                  {STAGE_LABELS[e.stage]}
                  <br />
                  {stamp(e.timestamp)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="overturn card">
        <div>
          <p className="eyebrow">Overturn</p>
          <h3 className="serif">Was this wrong?</h3>
          <p className="dim">
            Overturning puts them back at your gate. The original failure stays in the log, and the overturn is recorded as its own entry. Nothing is sent to them.
          </p>
        </div>
        {done ? (
          <div className="notice notice--ok" role="status">
            <div>
              <b>Back at the gate.</b> <a href={href('swipe')}>Go and decide</a>
            </div>
          </div>
        ) : w.reversible ? (
          <>
            <div className="field">
              <label htmlFor="ot-note">Why it was wrong (optional)</label>
              <textarea id="ot-note" className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: moving to Madrid in November" />
            </div>
            {err ? <ErrorBox error={err} /> : null}
            <button className="btn btn--primary" style={{ justifySelf: 'start' }} onClick={overturn} disabled={busy}>
              {busy ? <span className="spin" /> : <Icon name="undo" size={16} />} Overturn and put back
            </button>
          </>
        ) : (
          <p className="notice">
            {w.status === 'pending' ? (
              <span>
                They are already at the gate. <a href={href('swipe')}>Open the gate</a>.
              </span>
            ) : (
              <span>This one cannot be reversed: a like cannot be taken back from the platform.</span>
            )}
          </p>
        )}
      </section>
    </article>
  );
}

export default function Why({ param }: { param?: string }) {
  return (
    <>
      <PageHeader
        eyebrow="Audit · every decision, with its reason"
        title={
          <>
            "Wait, this one was good. <em>What happened?</em>"
          </>
        }
        lede="Look anyone up. You will see each rule that evaluated them, what it decided and why, and you can overturn the call."
        right={param ? <button className="btn" onClick={() => go('why')}>Back to search</button> : undefined}
      />
      <div className="why-layout">
        <Finder selected={param} />
        {param ? <Report id={param} key={param} /> : <NearMisses />}
      </div>
    </>
  );
}
