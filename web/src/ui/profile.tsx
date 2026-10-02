import { useEffect, useRef } from 'react';
import type { Candidate } from '../api/phase1.ts';
import { href } from '../lib/router.ts';
import type { Standing } from '../lib/data.ts';
import { langName, ruleLabel } from '../lib/format.ts';
import { Icon, Photo } from './kit.tsx';

const INTENT: Record<string, string> = {
  'long-term': 'Long-term',
  'short-term': 'Short-term',
  casual: 'Casual',
  open: 'Open to anything',
  friendship: 'Friendship',
};
const CHILDREN: Record<string, string> = { want: 'Wants children', 'dont-want': 'Does not want children', open: 'Open on children', have: 'Has children' };
const SMOKING: Record<string, string> = { never: 'Does not smoke', sometimes: 'Smokes sometimes', regularly: 'Smokes regularly' };

export function StandingTag({ s }: { s: Standing | undefined }) {
  if (!s || s.status === 'untracked') return <span className="status">Not evaluated</span>;
  if (s.status === 'dropped') return <span className="status status--dropped">Dropped: {ruleLabel(s.rule).toLowerCase()}</span>;
  if (s.status === 'pending') return <span className="status status--pending">At your gate</span>;
  if (s.status === 'accepted') return <span className="status status--accepted">Accepted</span>;
  return <span className="status status--rejected">Passed by you</span>;
}

/** The declared fields, in the order a person would read them. */
export function Facts({ c }: { c: Candidate }) {
  const d = c.declared;
  return (
    <dl className="facts">
      <div>
        <dt>Lives in</dt>
        <dd>
          {d.city}, {d.country}
        </dd>
      </div>
      <div>
        <dt>Languages</dt>
        <dd>{d.languages.map(langName).join(', ')}</dd>
      </div>
      <div>
        <dt>Looking for</dt>
        <dd>{d.lookingFor.map((i) => INTENT[i] ?? i).join(', ')}</dd>
      </div>
      <div>
        <dt>Smoking</dt>
        <dd>{SMOKING[d.smoking] ?? d.smoking}</dd>
      </div>
      <div>
        <dt>Children</dt>
        <dd>{CHILDREN[d.children] ?? d.children}</dd>
      </div>
      <div>
        <dt>Active</dt>
        <dd>{c.activity.daysSinceActive === 0 ? 'today' : `${c.activity.daysSinceActive} days ago`}</dd>
      </div>
    </dl>
  );
}

export function Interests({ c, highlight = [] }: { c: Candidate; highlight?: string[] }) {
  return (
    <ul className="chips">
      {c.declared.interests.map((i) => (
        <li key={i} className={`chip ${highlight.includes(i) ? 'chip--accent' : ''}`}>
          {i}
        </li>
      ))}
    </ul>
  );
}

export function Prompts({ c }: { c: Candidate }) {
  return (
    <div className="prompts">
      {c.declared.prompts.map((p) => (
        <figure key={p.promptId} className="prompt">
          <figcaption>{p.question}</figcaption>
          <blockquote>{p.answer}</blockquote>
        </figure>
      ))}
    </div>
  );
}

/** Side sheet with the whole profile. Escape closes it; focus returns to whatever opened it. */
export function ProfileSheet({ c, standing, onClose }: { c: Candidate; standing?: Standing; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="sheet-wrap" onClick={onClose}>
      <aside className="sheet" role="dialog" aria-modal="true" aria-label={`${c.displayName}, profile`} onClick={(e) => e.stopPropagation()}>
        <button ref={closeRef} className="btn btn--ghost btn--sm sheet__close" onClick={onClose} aria-label="Close profile">
          <Icon name="close" />
        </button>
        <div className="sheet__photos">
          {c.photos.slice(0, 3).map((p) => (
            <Photo key={p.slot} photoRef={p.photoRef} name={c.displayName} className="sheet__photo" />
          ))}
        </div>
        <div className="sheet__body">
          <h2 className="serif sheet__name">
            {c.displayName}, <span className="mono">{c.declared.age}</span>
          </h2>
          <StandingTag s={standing} />
          <Facts c={c} />
          <Interests c={c} />
          <Prompts c={c} />
          <a className="btn" href={href('why', c.id)} onClick={onClose}>
            See every rule that evaluated them
            <Icon name="arrow" size={16} />
          </a>
        </div>
      </aside>
    </div>
  );
}
