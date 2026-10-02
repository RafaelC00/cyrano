import { useEffect, useState } from 'react';
import { AGENT_BASE } from '../api/phase1.ts';
import { ENDPOINTS } from '../contracts.ts';
import type { CalendarState, DateProposal } from '../contracts.ts';
import { confirmProposal, dropProposal, loadCalendar, moveProposal, stayOn, useCalendar, weekStart } from '../lib/calendar.ts';
import { addDays, day, dayLong, kindWord, shortDate, time, weekdayIndex } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import { ErrorBox, Icon, Loading, PageHeader, Photo } from '../ui/kit.tsx';

const CITY_HUE: Record<string, number> = { Madrid: 28, Lisbon: 200, Amsterdam: 150, Singapore: 300, Barcelona: 10, Porto: 230, Berlin: 60, Dubai: 40 };
const hue = (city: string) => CITY_HUE[city] ?? 100;
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Stays({ cal }: { cal: CalendarState }) {
  const from = addDays(weekStart(cal.today), -7);
  const to = addDays(from, 56);
  const span = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 864e5;
  const total = span(from, to);
  const pos = (d: string) => `${(Math.max(0, span(from, d)) / total) * 100}%`;
  const here = stayOn(cal.stays, cal.today);
  return (
    <section className="stays" aria-label="Where Eric is">
      <div className="stays__bar" role="img" aria-label={cal.stays.map((s) => `${s.city} from ${s.from} to ${s.to}`).join('; ')}>
        {cal.stays.map((s) => (
          <div key={s.city + s.from} className="stays__seg" style={{ left: pos(s.from), width: `calc(${pos(s.to)} - ${pos(s.from)})`, ['--h' as string]: hue(s.city) }}>
            <b>{s.city}</b>
            <small className="mono">
              {shortDate(s.from)} to {shortDate(addDays(s.to, -1))}
            </small>
          </div>
        ))}
        <i className="stays__today" style={{ left: pos(cal.today) }} title="Today" />
      </div>
      <p className="stays__now">
        <Icon name="pin" size={15} /> Eric is in <b>{here?.city ?? 'transit'}</b>
        {here ? <> until {dayLong(addDays(here.to, -1))}</> : null}. Dates are only proposed in the city he will be in that day.
      </p>
    </section>
  );
}

function Pill({ p, on, onClick }: { p: DateProposal; on: boolean; onClick: () => void }) {
  return (
    <button className={`pill pill--${p.status}`} aria-pressed={on} onClick={onClick} style={{ ['--h' as string]: hue(p.city) }}>
      <span className="mono">{time(p.start)}</span>
      <span>{p.person.displayName.split(' ')[0]}</span>
    </button>
  );
}

function Detail({ p, cal }: { p: DateProposal; cal: CalendarState }) {
  const [date, setDate] = useState(p.start.slice(0, 10));
  const [clock, setClock] = useState(p.start.slice(11, 16));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<Error | null>(null);
  useEffect(() => (setDate(p.start.slice(0, 10)), setClock(p.start.slice(11, 16)), setMsg(null), setErr(null)), [p.id, p.start]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e as Error);
    }
  };

  const move = async () => {
    const r = await moveProposal(p.id, `${date}T${clock}:00`);
    setMsg({ ok: r.ok, text: r.message });
  };
  const stay = stayOn(cal.stays, date);

  return (
    <aside className="cdetail" aria-label="Date details">
      <header>
        <Photo photoRef={p.person.photoRef} name={p.person.displayName} className="cdetail__photo" />
        <div>
          <p className="eyebrow">
            {kindWord(p.kind)} · <span className={`status status--${p.status === 'confirmed' ? 'accepted' : p.status === 'declined' ? 'rejected' : 'pending'}`}>{p.status}</span>
          </p>
          <h2 className="serif">{p.person.displayName}</h2>
          <p className="dim">{p.person.age}, lives in {p.person.city}</p>
        </div>
      </header>
      <dl className="cdetail__facts">
        <div>
          <dt>When</dt>
          <dd>
            {dayLong(p.start)}, {time(p.start)} to {time(p.end)}
          </dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>
            {p.venue ? `${p.venue}, ` : ''}
            {p.city}
            {p.venue ? null : <span className="faint"> · place to be agreed</span>}
          </dd>
        </div>
        <div>
          <dt>Why this slot</dt>
          <dd>{p.reason}</dd>
        </div>
      </dl>

      <div className="cdetail__move">
        <p className="label">Move it</p>
        <div className="row">
          <input className="input mono" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="New date" />
          <input className="input mono" type="time" value={clock} onChange={(e) => setClock(e.target.value)} aria-label="New time" step={900} />
          <button className="btn" onClick={move}>
            Move
          </button>
        </div>
        <p className="faint">{stay ? `Eric is in ${stay.city} that day.` : 'Eric has no stay booked that day.'} Moving changes the proposal only; it sends nothing.</p>
        {msg ? (
          <p className={`notice ${msg.ok ? 'notice--ok' : 'notice--bad'}`} role="status">
            {msg.text}
          </p>
        ) : null}
      </div>

      <div className="cdetail__actions">
        {p.status === 'proposed' ? (
          <button className="btn btn--primary" onClick={() => act(() => confirmProposal(p.id))}>
            <Icon name="check" size={16} /> They agreed: mark confirmed
          </button>
        ) : null}
        {p.status !== 'declined' ? (
          <button className="btn btn--ghost btn--danger" onClick={() => act(() => dropProposal(p.id))}>
            {p.status === 'confirmed' ? 'Cancel this date' : 'Drop it'}
          </button>
        ) : null}
        <a className="btn btn--ghost" href={href('why', p.person.id)}>
          Why this person
        </a>
      </div>
      {err ? <ErrorBox error={err} /> : null}
      <p className="faint">Confirming, moving and dropping change Eric's own calendar. None of them sends anything; dropping gives back every slot held for her.</p>
    </aside>
  );
}

export default function Calendar() {
  const { cal, error } = useCalendar();
  const [sel, setSel] = useState<string | null>(null);

  if (!cal) {
    return (
      <>
        <PageHeader eyebrow="Scheduling" title={<>The calendar.</>} />
        {error ? <ErrorBox error={error} retry={() => void loadCalendar(true).catch(() => undefined)} /> : <Loading />}
      </>
    );
  }
  const props = cal.proposals.filter((p) => p.status !== 'declined');
  const confirmed = props.filter((p) => p.status === 'confirmed');
  const selected = cal.proposals.find((p) => p.id === (sel ?? props[0]?.id));
  const start = weekStart(cal.today);
  const weeks = [0, 1, 2, 3, 4, 5].map((w) => addDays(start, w * 7));

  return (
    <>
      <PageHeader
        eyebrow="Stage 6 · Scheduling"
        title={
          <>
            Dinner, <em>not notifications.</em>
          </>
        }
        lede="Proposed and confirmed dates, placed only where Eric will actually be. A proposal becomes a date when you say they agreed."
        right={
          <a className="btn" href={`${AGENT_BASE}${ENDPOINTS.calendarIcs}`} download="cyrano-dates.ics">
            <Icon name="download" size={16} /> Download .ics
          </a>
        }
      />

      <Stays cal={cal} />

      <div className="cal">
        <div className="cal__grid">
          <div className="cal__summary">
            <span>
              <b className="mono">{confirmed.length}</b> confirmed
            </span>
            <span>
              <b className="mono">{props.length - confirmed.length}</b> proposed
            </span>
            <span className="faint">The .ics file holds confirmed dates only.</span>
          </div>
          {weeks.map((ws) => (
            <section key={ws} className="week" aria-label={`Week of ${shortDate(ws)}`}>
              <h2 className="week__title mono">Week of {shortDate(ws)}</h2>
              <ol className="week__days">
                {Array.from({ length: 7 }, (_, i) => addDays(ws, i)).map((d) => {
                  const evs = props.filter((p) => p.start.slice(0, 10) === d);
                  const stay = stayOn(cal.stays, d);
                  return (
                    <li key={d} className={`dcell ${d === cal.today ? 'dcell--today' : ''} ${evs.length ? 'dcell--has' : ''}`} style={{ ['--h' as string]: hue(stay?.city ?? '') }}>
                      <div className="dcell__head">
                        <span className="mono dcell__d">{DOW[weekdayIndex(d) === 0 ? 6 : weekdayIndex(d) - 1]} {Number(d.slice(8))}</span>
                        <span className="dcell__city">{stay?.city ?? ''}</span>
                      </div>
                      <span className="sr-only">{day(d)}</span>
                      {evs.map((p) => (
                        <Pill key={p.id} p={p} on={selected?.id === p.id} onClick={() => setSel(p.id)} />
                      ))}
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        {selected ? <Detail p={selected} cal={cal} /> : null}
      </div>
    </>
  );
}
