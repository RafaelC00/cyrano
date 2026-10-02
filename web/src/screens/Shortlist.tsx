import { useState } from 'react';
import type { Candidate } from '../api/phase1.ts';
import { ENDPOINTS, fromSeam } from '../contracts.ts';
import type { LearnedScore } from '../contracts.ts';
import { fixtureLearnedScores } from '../fixtures.ts';
import { gateMemory, getCandidate, loadSnapshot } from '../lib/data.ts';
import { href } from '../lib/router.ts';
import { useResource } from '../lib/resource.ts';
import { Empty, ErrorBox, Loading, PageHeader, Photo, ScoreBar, SourceBadge } from '../ui/kit.tsx';
import { ProfileSheet, StandingTag } from '../ui/profile.tsx';

type Sort = 'stated' | 'learned';

export default function Shortlist() {
  const res = useResource(async () => {
    const snap = await loadSnapshot();
    const items = [...gateMemory.values()].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
    const learned = await fromSeam<LearnedScore[]>(`${ENDPOINTS.learnedScores}?ids=${items.map((i) => i.candidateId).join(',')}`, () => fixtureLearnedScores(items));
    return { snap, items, learned };
  });
  const [sort, setSort] = useState<Sort>('stated');
  const [open, setOpen] = useState<Candidate | null>(null);

  const d = res.data;
  const learnedBy = new Map((d?.learned.data ?? []).map((l) => [l.candidateId, l]));
  const rows = d
    ? [...d.items].sort((a, b) =>
        sort === 'stated' ? (b.score?.score ?? 0) - (a.score?.score ?? 0) : (learnedBy.get(b.candidateId)?.learned ?? 0) - (learnedBy.get(a.candidateId)?.learned ?? 0),
      )
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Stage 3 · Ranked"
        title={
          <>
            Who made <em>the cut.</em>
          </>
        }
        lede="Everyone the funnel surfaced, in order, with the reason each one is here. Scored two ways, so you can see where your stated preferences and your choices disagree."
        right={
          <div className="seg" role="group" aria-label="Sort by">
            <button aria-pressed={sort === 'stated'} onClick={() => setSort('stated')}>
              Stated
            </button>
            <button aria-pressed={sort === 'learned'} onClick={() => setSort('learned')}>
              Learned
            </button>
          </div>
        }
      />

      {res.error && !d ? <ErrorBox error={res.error} retry={res.reload} /> : null}
      {res.loading && !d ? <Loading /> : null}

      {d && rows.length === 0 ? (
        <Empty title="No shortlist yet." action={<a className="btn btn--primary" href={href('funnel')}>Run the funnel</a>}>
          The shortlist is whatever the funnel puts in front of you. Run it first.
        </Empty>
      ) : null}

      {d && rows.length > 0 ? (
        <>
          <div className="short-legend" aria-hidden="true">
            <span>
              Stated <span className="faint">weights you wrote down</span> <SourceBadge source="live" />
            </span>
            <span>
              Learned <span className="faint">from your choices</span> <SourceBadge source={d.learned.source} what="The learned model is not merged yet; these scores are generated locally." />
            </span>
          </div>
          <ol className="short">
            {rows.map((g, i) => {
              const l = learnedBy.get(g.candidateId);
              const stated = g.score?.score ?? 0;
              const delta = l ? l.learned - stated : 0;
              const st = d.snap.standing.get(g.candidateId);
              return (
                <li key={g.candidateId} className="short__row">
                  <span className="short__rank serif" aria-label={`Position ${i + 1}`}>
                    {i + 1}
                  </span>
                  <Photo photoRef={g.photoRef} name={g.displayName} className="short__photo" />
                  <div className="short__who">
                    <h2 className="serif">
                      {g.displayName}
                      <span className="mono dim"> {g.declared.age}</span>
                    </h2>
                    <p className="dim">
                      {g.declared.city} · {g.declared.interests.slice(0, 3).join(', ')}
                    </p>
                    <p className="short__reason">{g.score ? g.score.explanation.charAt(0).toUpperCase() + g.score.explanation.slice(1) + '.' : 'No score recorded.'}</p>
                    {l ? (
                      <ul className="chips">
                        {l.factors.map((f) => (
                          <li key={f.label} className={`chip ${f.contribution >= 0 ? 'chip--info' : ''}`}>
                            {f.contribution >= 0 ? '+' : '−'}
                            {Math.abs(f.contribution).toFixed(2)} {f.label}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="short__scores">
                    <div>
                      <span className="mono short__n">{stated.toFixed(2)}</span>
                      <ScoreBar value={stated} />
                    </div>
                    <div>
                      <span className="mono short__n">
                        {l ? l.learned.toFixed(2) : '–'}
                        {l ? (
                          <small className={delta >= 0 ? 'up' : 'down'}>
                            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(2)}
                          </small>
                        ) : null}
                      </span>
                      <ScoreBar value={l?.learned ?? 0} tone="info" />
                    </div>
                  </div>
                  <div className="short__actions">
                    <StandingTag s={st} />
                    <div className="row">
                      <button
                        className="btn btn--sm"
                        onClick={async () => setOpen(await getCandidate(g.candidateId))}
                      >
                        Profile
                      </button>
                      <a className="btn btn--sm btn--ghost" href={href('why', g.candidateId)}>
                        Why
                      </a>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      {open ? <ProfileSheet c={open} standing={d?.snap.standing.get(open.id)} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
