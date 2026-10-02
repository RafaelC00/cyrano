import { agentGet, ENDPOINTS } from '../contracts.ts';
import type { WeeklyBrief } from '../contracts.ts';
import { dayLong, shortDate, time } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useResource } from '../lib/resource.ts';
import { Empty, ErrorBox, Icon, Loading, PageHeader, Photo } from '../ui/kit.tsx';

export default function Brief() {
  const res = useResource(() => agentGet<WeeklyBrief>(ENDPOINTS.brief));
  const b = res.data;

  return (
    <>
      <PageHeader
        eyebrow={b ? `Weekly brief · week of ${shortDate(b.weekOf)}` : 'Weekly brief'}
        title={
          <>
            Once a week, <em>one page.</em>
          </>
        }
        lede={b?.summary ?? 'Who is worth meeting, when, where, and why.'}
      />

      {res.error && !b ? <ErrorBox error={res.error} retry={res.reload} /> : null}
      {res.loading && !b ? <Loading /> : null}
      {b && b.entries.length === 0 ? (
        <Empty title="Nothing to report this week.">No dates are proposed. Run the funnel, clear the gate, and ask for an opener in Drafts: that is what puts evenings on the calendar.</Empty>
      ) : null}

      {b && b.entries.length ? (
        <ol className="brief">
          {b.entries.map((e, i) => (
            <li key={e.person.id} className="brief__item">
              <span className="brief__n serif" aria-hidden="true">
                {i + 1}
              </span>
              <Photo photoRef={e.person.photoRef} name={e.person.displayName} className="brief__photo" />
              <div className="brief__main">
                <h2 className="serif">
                  {e.person.displayName}
                  <span className="mono dim"> {e.person.age}</span>
                </h2>
                <p className="brief__when">
                  <span>{dayLong(e.when)}</span>
                  <span className="mono">{time(e.when)}</span>
                  <span className={`chip ${e.status === 'confirmed' ? 'chip--ok' : ''}`}>{e.status}</span>
                </p>
                <p className="brief__where dim">
                  <Icon name="pin" size={15} /> {e.where}, {e.city}
                </p>
                <div className="brief__why">
                  <p className="eyebrow">Why this person</p>
                  <p className="serif">{e.why}</p>
                  <details className="brief__evidence">
                    <summary className="faint">The evidence behind that</summary>
                    <ul>
                      {e.evidence.map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </details>
                </div>
                {e.alsoOffered.length ? <p className="faint">Also offered: {e.alsoOffered.join('; ')}</p> : null}
                {e.travelNote ? <p className="dim">{e.travelNote}</p> : null}
                <div className="row">
                  <a className="btn btn--sm" href={href('drafts')}>
                    Their opener
                  </a>
                  <a className="btn btn--sm btn--ghost" href={href('why', e.person.id)}>
                    Audit trail
                  </a>
                  <a className="btn btn--sm btn--ghost" href={href('calendar')}>
                    On the calendar
                  </a>
                </div>
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {b && b.pending.length ? (
        <section className="brief__side" aria-label="Still yours to decide">
          <p className="eyebrow">Still yours to decide</p>
          <ul>
            {b.pending.map((p) => (
              <li key={p.text}>{p.text}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {b && b.leastSure.length ? (
        <section className="brief__side" aria-label="Dropped, and least sure about">
          <p className="eyebrow">Dropped, and the system is least sure about</p>
          <ul>
            {b.leastSure.map((d) => (
              <li key={d.candidateId}>
                <b>{d.name}</b> <span className="mono faint">[{d.rule}, confidence {d.confidence}]</span>
                <br />
                <span className="dim">{d.reason}. {d.whyUnsure}</span>{' '}
                <a href={href('why', d.candidateId)}>Why, and how to bring her back</a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {b ? (
        <p className="brief__foot faint">
          <Icon name="lock" size={14} /> Prepared for Eric. The system sends nothing on its own. Every opener waits in Drafts for you to read, change and send yourself. {b.basis}
        </p>
      ) : null}
    </>
  );
}
