import { useMemo, useState } from 'react';
import type { Candidate } from '../api/phase1.ts';
import { loadPool, loadSnapshot } from '../lib/data.ts';
import type { Standing } from '../lib/data.ts';
import { langName } from '../lib/format.ts';
import { useResource } from '../lib/resource.ts';
import { StandingTag, ProfileSheet } from '../ui/profile.tsx';
import { Empty, ErrorBox, Loading, PageHeader, Photo } from '../ui/kit.tsx';

type StatusFilter = 'all' | 'untracked' | 'pending' | 'dropped' | 'decided';
const PAGE = 48;

const kindOf = (s: Standing | undefined): StatusFilter => {
  if (!s || s.status === 'untracked') return 'untracked';
  if (s.status === 'accepted' || s.status === 'rejected') return 'decided';
  return s.status;
};

export default function Pool() {
  const pool = useResource(() => loadPool());
  const snap = useResource(loadSnapshot);

  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [lang, setLang] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Candidate | null>(null);

  const all = pool.data ?? [];
  const standing = snap.data?.standing;

  const facets = useMemo(() => {
    const cities = new Map<string, number>();
    const langs = new Map<string, number>();
    let lo = 99;
    let hi = 0;
    for (const c of all) {
      cities.set(c.declared.city, (cities.get(c.declared.city) ?? 0) + 1);
      for (const l of c.declared.languages) langs.set(l, (langs.get(l) ?? 0) + 1);
      lo = Math.min(lo, c.declared.age);
      hi = Math.max(hi, c.declared.age);
    }
    return { cities: [...cities.entries()].sort((a, b) => b[1] - a[1]), langs: [...langs.entries()].sort((a, b) => b[1] - a[1]), lo, hi };
  }, [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const lo = ageMin ? Number(ageMin) : 0;
    const hi = ageMax ? Number(ageMax) : 200;
    return all.filter((c) => {
      const d = c.declared;
      if (needle && !`${c.displayName} ${c.id} ${d.interests.join(' ')}`.toLowerCase().includes(needle)) return false;
      if (city && d.city !== city) return false;
      if (lang && !d.languages.includes(lang)) return false;
      if (d.age < lo || d.age > hi) return false;
      if (status !== 'all' && kindOf(standing?.get(c.id)) !== status) return false;
      return true;
    });
  }, [all, q, city, lang, ageMin, ageMax, status, standing]);

  const reset = () => {
    setQ('');
    setCity('');
    setLang('');
    setStatus('all');
    setAgeMin('');
    setAgeMax('');
    setLimit(PAGE);
  };
  const filtered = q || city || lang || status !== 'all' || ageMin || ageMax;

  return (
    <>
      <PageHeader
        eyebrow="Seeded pool"
        title={
          pool.data ? (
            <>
              <em>{all.length.toLocaleString()}</em> people, none of them real.
            </>
          ) : (
            <>The pool.</>
          )
        }
        lede="Every profile is generated, flagged synthetic, and carries a placeholder image. This is the whole supply the funnel starts from."
      />

      {pool.error ? <ErrorBox error={pool.error} retry={pool.reload} /> : null}
      {pool.loading && !pool.data ? <Loading label="Loading the pool" /> : null}

      {pool.data ? (
        <>
          <dl className="poolstats">
            <div>
              <dt>Profiles</dt>
              <dd className="serif">{all.length}</dd>
            </div>
            <div>
              <dt>Cities</dt>
              <dd className="serif">{facets.cities.length}</dd>
            </div>
            <div>
              <dt>Languages</dt>
              <dd className="serif">{facets.langs.length}</dd>
            </div>
            <div>
              <dt>Ages</dt>
              <dd className="serif">
                {facets.lo} to {facets.hi}
              </dd>
            </div>
            <div className="poolstats__bars" aria-hidden="true">
              {facets.cities.map(([c, n]) => (
                <i key={c} title={`${c}: ${n}`} style={{ height: `${(n / facets.cities[0]![1]) * 100}%` }} />
              ))}
            </div>
          </dl>

          <form className="filters" role="search" onSubmit={(e) => e.preventDefault()}>
            <div className="field filters__q">
              <label htmlFor="pool-q">Search</label>
              <input id="pool-q" className="input" type="search" placeholder="Name, id or interest" value={q} onChange={(e) => (setQ(e.target.value), setLimit(PAGE))} />
            </div>
            <div className="field">
              <label htmlFor="pool-city">City</label>
              <select id="pool-city" className="select" value={city} onChange={(e) => (setCity(e.target.value), setLimit(PAGE))}>
                <option value="">All cities</option>
                {facets.cities.map(([c, n]) => (
                  <option key={c} value={c}>
                    {c} ({n})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="pool-lang">Language</label>
              <select id="pool-lang" className="select" value={lang} onChange={(e) => (setLang(e.target.value), setLimit(PAGE))}>
                <option value="">Any language</option>
                {facets.langs.map(([l, n]) => (
                  <option key={l} value={l}>
                    {langName(l)} ({n})
                  </option>
                ))}
              </select>
            </div>
            <div className="field filters__age">
              <label htmlFor="pool-amin">Age</label>
              <div>
                <input id="pool-amin" className="input mono" inputMode="numeric" placeholder={String(facets.lo)} value={ageMin} onChange={(e) => (setAgeMin(e.target.value.replace(/\D/g, '')), setLimit(PAGE))} aria-label="Minimum age" />
                <span className="faint">to</span>
                <input className="input mono" inputMode="numeric" placeholder={String(facets.hi)} value={ageMax} onChange={(e) => (setAgeMax(e.target.value.replace(/\D/g, '')), setLimit(PAGE))} aria-label="Maximum age" />
              </div>
            </div>
            <div className="field filters__status">
              <span className="label" id="pool-status">
                Where they stand
              </span>
              <div className="seg" role="group" aria-labelledby="pool-status">
                {(['all', 'untracked', 'pending', 'dropped', 'decided'] as StatusFilter[]).map((s) => (
                  <button key={s} type="button" aria-pressed={status === s} onClick={() => (setStatus(s), setLimit(PAGE))}>
                    {{ all: 'All', untracked: 'New', pending: 'At gate', dropped: 'Dropped', decided: 'Decided' }[s]}
                  </button>
                ))}
              </div>
            </div>
          </form>

          <div className="poolcount" aria-live="polite">
            <span>
              <b className="mono">{rows.length.toLocaleString()}</b> {filtered ? `of ${all.length.toLocaleString()} match` : 'shown'}
            </span>
            {filtered ? (
              <button className="btn btn--ghost btn--sm" onClick={reset}>
                Clear filters
              </button>
            ) : null}
          </div>

          {rows.length === 0 ? (
            <Empty title="Nobody matches that." action={<button className="btn" onClick={reset}>Clear filters</button>}>
              Loosen a filter. The pool has {all.length} people; the funnel will do this more strictly.
            </Empty>
          ) : (
            <ul className="poolgrid">
              {rows.slice(0, limit).map((c) => (
                <li key={c.id}>
                  <button className="pcard" onClick={() => setOpen(c)} aria-label={`${c.displayName}, ${c.declared.age}, ${c.declared.city}. Open profile`}>
                    <Photo photoRef={c.photos[0]?.photoRef} name={c.displayName} className="pcard__photo" />
                    <span className="pcard__body">
                      <span className="pcard__name">
                        {c.displayName}
                        <span className="mono dim">{c.declared.age}</span>
                      </span>
                      <span className="pcard__meta">
                        {c.declared.city} · {c.declared.languages.map((l) => l.toUpperCase()).join(' ')}
                      </span>
                      <StandingTag s={standing?.get(c.id)} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {rows.length > limit ? (
            <div className="more-row">
              <button className="btn" onClick={() => setLimit((l) => l + PAGE * 2)}>
                Show {Math.min(PAGE * 2, rows.length - limit)} more
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {open ? <ProfileSheet c={open} standing={standing?.get(open.id)} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
