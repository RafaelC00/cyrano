import { agent } from '../api/phase1.ts';
import { ENDPOINTS, fromSeam } from '../contracts.ts';
import type { WeeklyBrief } from '../contracts.ts';
import { fixtureBrief } from '../fixtures.ts';
import { gateMemory } from '../lib/data.ts';
import { loadCalendar } from '../lib/calendar.ts';
import { dayLong, shortDate, time } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { useResource } from '../lib/resource.ts';
import { Empty, ErrorBox, Icon, Loading, PageHeader, Photo, SourceBadge } from '../ui/kit.tsx';

export default function Brief() {
  const res = useResource(async () => {
    const gate = await agent.gate().catch(() => []);
    for (const g of gate) gateMemory.set(g.candidateId, g);
    const cal = await loadCalendar();
    return fromSeam<WeeklyBrief>(ENDPOINTS.brief, () => fixtureBrief(cal.data, [...gateMemory.values()]));
  });
  const b = res.data?.data;

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
        right={res.data ? <SourceBadge source={res.data.source} what="The scheduling service is not merged yet. Times and places are fixtures; names and reasons come from the live shortlist where they match." /> : undefined}
      />

      {res.error && !res.data ? <ErrorBox error={res.error} retry={res.reload} /> : null}
      {res.loading && !res.data ? <Loading /> : null}
      {b && b.entries.length === 0 ? (
        <Empty title="Nothing to report this week.">No dates are proposed and nobody is waiting. Run the funnel and clear the gate first.</Empty>
      ) : null}

      {b && b.entries.length ? (
        <ol className="brief">
          {b.entries.map((e, i) => (
            <li key={e.person.id + i} className="brief__item">
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
                </p>
                <p className="brief__where dim">
                  <Icon name="pin" size={15} /> {e.where}, {e.city}
                </p>
                <div className="brief__why">
                  <p className="eyebrow">Why this person</p>
                  <p className="serif">{e.why.charAt(0).toUpperCase() + e.why.slice(1)}{/[.!?]$/.test(e.why) ? '' : '.'}</p>
                </div>
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

      {b ? (
        <p className="brief__foot faint">
          <Icon name="lock" size={14} /> Prepared for Eric. The system sends nothing on its own. Every opener waits in Drafts for you to read, change and send yourself.
        </p>
      ) : null}
    </>
  );
}
