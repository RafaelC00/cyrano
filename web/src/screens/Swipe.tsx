import { useCallback, useEffect, useRef, useState } from 'react';
import { agent, platform } from '../api/phase1.ts';
import type { Candidate, GateItem } from '../api/phase1.ts';
import { firstName, getCandidate } from '../lib/data.ts';
import { href } from '../lib/router.ts';
import { invalidateAll, useResource } from '../lib/resource.ts';
import { Empty, ErrorBox, Icon, Kbd, Loading, PageHeader, Photo } from '../ui/kit.tsx';
import { Facts, Interests, Prompts } from '../ui/profile.tsx';

const COMPONENT: Record<string, { label: string; weight: number }> = {
  interests: { label: 'Shared interests', weight: 0.4 },
  activity: { label: 'Recently active', weight: 0.2 },
  intent: { label: 'Looking for the same', weight: 0.15 },
  ageFit: { label: 'Age fit', weight: 0.15 },
  language: { label: 'Shared language', weight: 0.1 },
};

function Why({ g }: { g: GateItem }) {
  const s = g.score;
  if (!s) return null;
  const rows = Object.entries(s.components).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...rows.map(([k]) => COMPONENT[k]?.weight ?? 0.2));
  return (
    <section className="whybox" aria-labelledby="why-title">
      <div className="whybox__head">
        <p className="eyebrow" id="why-title">
          Why you are seeing this person
        </p>
        <span className="mono whybox__score">
          {s.score.toFixed(2)}
          {g.rank ? <span className="faint"> · rank {g.rank}</span> : null}
        </span>
      </div>
      <p className="whybox__text serif">{s.explanation.charAt(0).toUpperCase() + s.explanation.slice(1)}.</p>
      <ul className="whybox__rows">
        {rows.map(([k, v]) => {
          const meta = COMPONENT[k];
          return (
            <li key={k}>
              <span>{meta?.label ?? k}</span>
              <div className="meter">
                <i style={{ width: `${Math.max(2, (v / (meta?.weight ?? max)) * 100)}%`, opacity: 0.4 + 0.6 * (v / max) }} />
              </div>
              <span className="mono faint">{v.toFixed(2)}</span>
            </li>
          );
        })}
      </ul>
      <p className="faint whybox__scorer mono">scorer: {s.scorer}</p>
    </section>
  );
}

function Gallery({ c, idx, setIdx }: { c: Candidate; idx: number; setIdx: (i: number) => void }) {
  const n = c.photos.length;
  return (
    <div className="gallery">
      <Photo photoRef={c.photos[idx]?.photoRef} name={c.displayName} className="gallery__photo" />
      {n > 1 ? (
        <>
          <div className="gallery__dots" role="group" aria-label="Photos">
            {c.photos.map((p, i) => (
              <button key={p.slot} aria-label={`Photo ${i + 1} of ${n}`} aria-current={i === idx} onClick={() => setIdx(i)} />
            ))}
          </div>
          <button className="gallery__nav gallery__nav--prev" aria-label="Previous photo" onClick={() => setIdx((idx + n - 1) % n)}>
            <Icon name="back" />
          </button>
          <button className="gallery__nav gallery__nav--next" aria-label="Next photo" onClick={() => setIdx((idx + 1) % n)}>
            <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}>
              <Icon name="back" />
            </span>
          </button>
        </>
      ) : null}
    </div>
  );
}

export default function Swipe() {
  const gate = useResource(() => agent.gate());
  const items = gate.data ?? [];
  const current = items[0];
  const loaded = useResource(() => (current ? getCandidate(current.candidateId) : Promise.resolve(undefined)), [current?.candidateId]);
  const cand = { data: loaded.data && loaded.data.id === current?.candidateId ? loaded.data : undefined };
  const [idx, setIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [exit, setExit] = useState<'left' | 'right' | null>(null);
  const [error, setError] = useState<Error>();
  const [last, setLast] = useState<{ id: string; name: string; action: 'like' | 'pass'; matched: boolean } | null>(null);
  const [say, setSay] = useState('');
  const total = useRef(0);
  if (items.length > total.current) total.current = items.length;

  useEffect(() => setIdx(0), [current?.candidateId]);
  useEffect(() => setExit(null), [current?.candidateId]);

  // Warm the next few photos so the next card is instant.
  useEffect(() => {
    for (const g of items.slice(1, 4)) if (g.photoRef) new Image().src = platform.photoUrl(g.photoRef);
  }, [items]);

  const decide = useCallback(
    async (action: 'like' | 'pass') => {
      if (!current || busy) return;
      setBusy(true);
      setError(undefined);
      setExit(action === 'like' ? 'right' : 'left');
      try {
        const r = action === 'like' ? await agent.accept(current.candidateId) : await agent.reject(current.candidateId);
        setLast({ id: current.candidateId, name: current.displayName, action, matched: r.matched });
        setSay(`${action === 'like' ? 'Accepted' : 'Passed'} ${firstName(current)}. ${items.length - 1} left.`);
        invalidateAll();
      } catch (e) {
        setExit(null);
        setError(e as Error);
      } finally {
        setBusy(false);
      }
    },
    [current, busy, items.length],
  );

  const undo = useCallback(async () => {
    if (!last || last.action !== 'pass' || busy) return;
    setBusy(true);
    try {
      await agent.overturn(last.id, 'undone from the swipe screen');
      setSay(`${last.name} is back at the gate.`);
      setLast(null);
      invalidateAll();
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }, [last, busy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const n = cand.data?.photos.length ?? 1;
      switch (e.key) {
        case 'ArrowLeft':
        case 'j':
          e.preventDefault();
          void decide('pass');
          break;
        case 'ArrowRight':
        case 'l':
          e.preventDefault();
          void decide('like');
          break;
        case '[':
        case 'ArrowUp':
          e.preventDefault();
          setIdx((i) => (i + n - 1) % n);
          break;
        case ']':
        case 'ArrowDown':
          e.preventDefault();
          setIdx((i) => (i + 1) % n);
          break;
        case 'u':
          void undo();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [decide, undo, cand.data?.photos.length]);

  const done = total.current - items.length;

  return (
    <>
      <PageHeader
        eyebrow="Stage 4 · The manual gate"
        title={current ? <>Your call.</> : <>The gate is clear.</>}
        lede="The system chose who you see and says why. A like or a pass is recorded on the platform only when you do it here."
        right={
          current ? (
            <p className="swipe-count mono" aria-hidden="true">
              <b>{done + 1}</b> / {total.current}
            </p>
          ) : undefined
        }
      />
      <p className="sr-only" role="status" aria-live="polite">
        {say}
      </p>

      {gate.error && !gate.data ? <ErrorBox error={gate.error} retry={gate.reload} /> : null}
      {error ? <ErrorBox error={error} /> : null}
      {gate.loading && !gate.data ? <Loading label="Loading the gate" /> : null}

      {last?.matched ? (
        <div className="notice notice--ok swipe-match" role="status">
          <Icon name="spark" />
          <div>
            <b>
              {last.name} liked you back.
            </b>{' '}
            An opener can be drafted for you to read and send yourself.{' '}
            <a href={href('drafts')}>Go to Drafts</a>
          </div>
        </div>
      ) : null}

      {gate.data && !current ? (
        <Empty
          title={total.current ? 'That was everyone.' : 'Nobody is waiting.'}
          action={
            <div className="row">
              <a className="btn btn--primary" href={href(total.current ? 'shortlist' : 'funnel')}>
                {total.current ? 'See the shortlist' : 'Run the funnel'}
              </a>
              {last?.action === 'pass' ? (
                <button className="btn" onClick={undo} disabled={busy}>
                  <Icon name="undo" /> Undo last pass
                </button>
              ) : null}
            </div>
          }
        >
          {total.current ? 'Everyone the system surfaced has a decision. Accepted people can be messaged from Drafts.' : 'Run the funnel to bring a new short list to the gate.'}
        </Empty>
      ) : null}

      {current && cand.data ? (
        <div className={`swipe ${exit ? `swipe--out-${exit}` : ''}`} key={current.candidateId}>
          <Gallery c={cand.data} idx={idx} setIdx={setIdx} />
          <div className="swipe__info">
            <div className="swipe__id">
              <h2 className="serif">
                {current.displayName}
                <span className="mono"> {current.declared.age}</span>
              </h2>
              <p className="dim">
                {current.declared.city}, {current.declared.country}
                {current.overturned ? <span className="chip chip--accent" style={{ marginLeft: 10 }}>Overturned drop</span> : null}
              </p>
            </div>
            <Why g={current} />
            <Facts c={cand.data} />
            <Interests c={cand.data} />
            <Prompts c={cand.data} />
          </div>

          <div className="swipe__bar" role="group" aria-label="Decide">
            <button className="decide decide--pass" onClick={() => decide('pass')} disabled={busy} aria-keyshortcuts="ArrowLeft J">
              <Icon name="x" size={22} />
              <span>Pass</span>
              <Kbd>←</Kbd>
            </button>
            <button className="btn btn--ghost btn--sm swipe__undo" onClick={undo} disabled={busy || last?.action !== 'pass'} aria-keyshortcuts="U">
              <Icon name="undo" size={16} /> Undo <Kbd>U</Kbd>
            </button>
            <button className="decide decide--like" onClick={() => decide('like')} disabled={busy} aria-keyshortcuts="ArrowRight L">
              <Icon name="check" size={22} />
              <span>Accept</span>
              <Kbd>→</Kbd>
            </button>
          </div>
          <p className="swipe__hint faint">
            <Kbd>←</Kbd> pass · <Kbd>→</Kbd> accept · <Kbd>[</Kbd> <Kbd>]</Kbd> photos · <Kbd>U</Kbd> undo a pass. An accept cannot be undone: it is a like on the platform.
          </p>
        </div>
      ) : null}
    </>
  );
}
