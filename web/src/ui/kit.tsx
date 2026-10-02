import type { CSSProperties, ReactNode } from 'react';
import { platform } from '../api/phase1.ts';
import type { Source } from '../contracts.ts';
import { initials } from '../lib/format.ts';
import { isUnreachable } from '../lib/data.ts';

export function Photo({ photoRef, name, className = '', style }: { photoRef: string | null | undefined; name: string; className?: string; style?: CSSProperties }) {
  return (
    <div className={`photo ${className}`} style={style}>
      {photoRef ? (
        <img src={platform.photoUrl(photoRef)} alt="" loading="lazy" decoding="async" />
      ) : (
        <div className="mono-photo" aria-hidden="true">
          {initials(name)}
        </div>
      )}
    </div>
  );
}

export function SourceBadge({ source, what }: { source: Source; what?: string }) {
  return source === 'fixture' ? (
    <span className="badge-fixture" title={what ?? 'Not served by the backend yet. Local fixture data.'}>
      Fixture
    </span>
  ) : (
    <span className="badge-live" title="From the backend">
      Live
    </span>
  );
}

export function PageHeader({ eyebrow, title, lede, right }: { eyebrow: string; title: ReactNode; lede?: ReactNode; right?: ReactNode }) {
  return (
    <header className="page-head">
      <div className="page-head__text">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lede ? <p className="page-head__lede">{lede}</p> : null}
      </div>
      {right ? <div className="page-head__right">{right}</div> : null}
    </header>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spin" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: Error; retry?: () => void }) {
  const down = isUnreachable(error);
  return (
    <div className="notice notice--bad" role="alert">
      <div style={{ flex: 1 }}>
        <b>{down ? 'The backend is not running.' : 'Something went wrong.'}</b>
        <p style={{ marginTop: 4 }}>
          {down ? (
            <>
              Start it from the repo root with <code className="mono">npm run dev</code>, or run <code className="mono">npm run dev:all</code> from <code className="mono">web/</code> to start both.
            </>
          ) : (
            error.message
          )}
        </p>
      </div>
      {retry ? (
        <button className="btn btn--sm" onClick={retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function ScoreBar({ value, tone = 'accent' }: { value: number; tone?: 'accent' | 'info' }) {
  return (
    <div className={`meter ${tone === 'info' ? 'meter--info' : ''}`} role="img" aria-label={`${Math.round(value * 100)} percent`}>
      <i style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Icon({ name, size = 18 }: { name: 'check' | 'x' | 'back' | 'arrow' | 'undo' | 'send' | 'download' | 'search' | 'menu' | 'close' | 'lock' | 'pin' | 'spark'; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;
  switch (name) {
    case 'check':
      return (
        <svg {...p}>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    case 'x':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'back':
      return (
        <svg {...p}>
          <path d="M15 5l-7 7 7 7" />
        </svg>
      );
    case 'arrow':
      return (
        <svg {...p}>
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      );
    case 'undo':
      return (
        <svg {...p}>
          <path d="M9 14L4 9l5-5M4 9h9a6 6 0 010 12h-3" />
        </svg>
      );
    case 'send':
      return (
        <svg {...p}>
          <path d="M4 12l16-8-6 17-3-7-7-2z" />
        </svg>
      );
    case 'download':
      return (
        <svg {...p}>
          <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
        </svg>
      );
    case 'search':
      return (
        <svg {...p}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4 4" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...p}>
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      );
    case 'close':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 018 0v3" />
        </svg>
      );
    case 'pin':
      return (
        <svg {...p}>
          <path d="M12 21s6-5.5 6-10a6 6 0 10-12 0c0 4.5 6 10 6 10z" />
          <circle cx="12" cy="11" r="2" />
        </svg>
      );
    case 'spark':
      return (
        <svg {...p}>
          <path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" />
        </svg>
      );
  }
}
