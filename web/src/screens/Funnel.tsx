import { useState } from 'react';
import { agent } from '../api/phase1.ts';
import type { Preferences, Stage } from '../api/phase1.ts';
import { loadSnapshot, runFunnel } from '../lib/data.ts';
import type { FunnelView, ReasonView, Snapshot } from '../lib/data.ts';
import { langName, plural, ruleLabel } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { invalidateAll, useResource } from '../lib/resource.ts';
import { Empty, ErrorBox, Icon, Loading, PageHeader } from '../ui/kit.tsx';

const STAGES: Record<Stage, { n: string; name: string; what: string }> = {
  broad: { n: '1', name: 'Broad pass', what: 'Cheap and wide. Gather everyone, set aside accounts too dormant to ever reply. No judgement about people.' },
  rules: { n: '2', name: 'Rule filter', what: 'Hard constraints you set, checked against what each person wrote in their own profile. Never a photograph.' },
  rank: { n: '3', name: 'Rank', what: 'Everyone left is scored and ordered. Only the top few go on to you.' },
  gate: { n: '4', name: 'Your gate', what: 'A person decides. Nothing is liked or passed until you do it.' },
};

function Reasons({ stage, rows, snap, dropped }: { stage: 'broad' | 'rules' | 'rank'; rows: ReasonView[]; snap: Snapshot; dropped: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  const rules = new Map(snap.rules.map((r) => [r.id, r.description]));
  return (
    <ul className="reasons" aria-label={`Why people dropped at ${STAGES[stage].name}`}>
      {rows.map((r) => {
        const who = snap.rejections.filter((x) => x.status === 'dropped' && x.droppedBy?.rule === r.rule);
        const isOpen = open === r.rule;
        return (
          <li key={r.rule} className="reason">
            <div className="reason__top">
              <span className="reason__name">{ruleLabel(r.rule)}</span>
              <span className="reason__count mono">{r.primary}</span>
            </div>
            <div className="meter meter--bad" aria-hidden="true">
              <i style={{ width: `${Math.max(2, (r.primary / Math.max(1, dropped)) * 100)}%` }} />
            </div>
            <p className="reason__why">
              {r.example ? `e.g. ${r.example}` : rules.get(r.rule)}
              {r.total > r.primary ? <span className="faint"> · {r.total} failed this rule in all</span> : null}
            </p>
            {who.length > 0 ? (
              <>
                <button className="reason__toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.rule)}>
                  {isOpen ? 'Hide' : 'Who'} <span className="faint">({who.length})</span>
                </button>
                {isOpen ? (
                  <ul className="reason__who">
                    {who.slice(0, 14).map((w) => (
                      <li key={w.candidateId}>
                        <a href={href('why', w.candidateId)} className="chip">
                          {w.displayName}
                        </a>
                      </li>
                    ))}
                    {who.length > 14 ? <li className="chip faint">+{who.length - 14} more</li> : null}
                  </ul>
                ) : null}
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function Stages({ f, snap }: { f: FunnelView; snap: Snapshot }) {
  return (
    <ol className="stages">
      {f.stages.map((s) => {
        const meta = STAGES[s.id];
        const shareOut = (s.out / Math.max(1, f.entered)) * 100;
        const shareIn = (s.in / Math.max(1, f.entered)) * 100;
        return (
          <li key={s.id} className={`stage stage--${s.id}`}>
            <div className="stage__head">
              <span className="stage__n mono">{meta.n}</span>
              <div>
                <h2 className="serif">{meta.name}</h2>
                <p className="dim">{meta.what}</p>
              </div>
              <div className="stage__figs">
                <span className="stage__out serif">{s.out.toLocaleString()}</span>
                <span className="stage__sub mono">
                  of {s.in.toLocaleString()} {s.dropped ? <b className="bad">−{s.dropped.toLocaleString()}</b> : null}
                </span>
              </div>
            </div>
            <div className="stage__bar" role="img" aria-label={`${s.out} of ${f.entered} remain`}>
              <i className="stage__in" style={{ width: `${Math.max(shareIn, 1.2)}%` }} />
              <i className="stage__keep" style={{ width: `${Math.max(shareOut, 1.2)}%` }} />
            </div>
            {s.id === 'gate' ? (
              <div className="gatestate">
                <div>
                  <b className="mono">{f.pending}</b>
                  <span>waiting for you</span>
                </div>
                <div>
                  <b className="mono">{f.accepted}</b>
                  <span>accepted</span>
                </div>
                <div>
                  <b className="mono">{f.humanRejected}</b>
                  <span>passed by you</span>
                </div>
                <div>
                  <b className="mono">{f.overturned}</b>
                  <span>overturned</span>
                </div>
              </div>
            ) : (
              <Reasons stage={s.id} rows={f.reasons[s.id]} snap={snap} dropped={s.dropped} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

const sentence = (p: Preferences) =>
  `Ages ${p.ageRange.min} to ${p.ageRange.max}, in ${p.cities.join(', ')}, ${p.requireSharedLanguage ? `sharing a language with you (${p.viewer.languages.map(langName).join(', ')})` : 'any language'}, with mutual interest and overlapping intent. Excluding ${[...p.excludedSmoking.map((s) => `${s} smokers`), ...p.excludedChildren.map((c) => (c === 'dont-want' ? 'people who do not want children' : `children: ${c}`))].join(' and ') || 'nobody else'}. ${p.gateSize} reach the gate per run.`;

export default function Funnel() {
  const snap = useResource(loadSnapshot);
  const prefs = useResource(() => agent.preferences());
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<Error>();

  const run = async () => {
    setRunning(true);
    setErr(undefined);
    try {
      await runFunnel();
      invalidateAll();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setRunning(false);
    }
  };

  const f = snap.data?.funnel;
  const gate = f?.stages.at(-1)?.out ?? 0;

  const button = (
    <button className={`btn ${f ? '' : 'btn--primary btn--lg'}`} onClick={run} disabled={running}>
      {running ? <span className="spin" /> : null}
      {f ? 'Run again' : 'Run the funnel'}
    </button>
  );

  return (
    <>
      <PageHeader
        eyebrow="The system, explaining itself"
        title={
          f ? (
            <>
              {f.entered.toLocaleString()} people came in. <em>{gate}</em> reached you.
            </>
          ) : (
            <>Nothing has run yet.</>
          )
        }
        lede={
          f
            ? 'Four stages, each one cheaper to explain than the last. Every drop below is local and reversible, and carries the reason it happened.'
            : 'The funnel reads the whole pool, filters it by what you declared, ranks what is left, and hands you a short list. It never touches the platform until you decide.'
        }
        right={f ? button : undefined}
      />

      {err ? <ErrorBox error={err} /> : null}
      {snap.error && !snap.data ? <ErrorBox error={snap.error} retry={snap.reload} /> : null}
      {snap.loading && !snap.data ? <Loading label="Reading the audit log" /> : null}

      {snap.data && !f ? (
        <Empty title="Start with one run." action={button}>
          It takes about a second. Stage 1 to 3 only read; no like, pass or message is ever sent by a run.
        </Empty>
      ) : null}

      {snap.data && f ? (
        <>
          <Stages f={f} snap={snap.data} />
          <section className="card inforce">
            <div>
              <p className="eyebrow">What you told it</p>
              <p className="inforce__text">{prefs.data ? sentence(prefs.data) : 'Loading preferences'}</p>
            </div>
            <ul className="inforce__rules">
              {snap.data.rules.map((r) => (
                <li key={r.id}>
                  <span className="mono">{r.id}</span>
                  <span className="dim">{r.description}</span>
                  <span className="faint mono">reads: {r.fields.join(', ')}</span>
                </li>
              ))}
            </ul>
            <p className="faint inforce__note">
              <Icon name="lock" size={14} /> Rules receive declared profile fields only. They cannot see a photograph, and nothing is inferred from one.{' '}
              {plural(snap.data.audit.length, 'evaluation')} are on the record.
            </p>
          </section>
        </>
      ) : null}
    </>
  );
}
