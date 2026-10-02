import { Suspense, lazy, useEffect, useState } from 'react';
import { agent, platform } from './api/phase1.ts';
import { SCREENS, href, useRoute } from './lib/router.ts';
import type { ScreenId } from './lib/router.ts';
import { useResource } from './lib/resource.ts';
import { Icon, Loading } from './ui/kit.tsx';

const Pool = lazy(() => import('./screens/Pool.tsx'));
const Funnel = lazy(() => import('./screens/Funnel.tsx'));
const Swipe = lazy(() => import('./screens/Swipe.tsx'));
const Shortlist = lazy(() => import('./screens/Shortlist.tsx'));
const Why = lazy(() => import('./screens/Why.tsx'));
const Training = lazy(() => import('./screens/Training.tsx'));
const Drafts = lazy(() => import('./screens/Drafts.tsx'));
const Calendar = lazy(() => import('./screens/Calendar.tsx'));
const Brief = lazy(() => import('./screens/Brief.tsx'));
const Chat = lazy(() => import('./screens/Chat.tsx'));

const VIEW: Record<ScreenId, React.LazyExoticComponent<(p: { param?: string }) => React.JSX.Element>> = {
  pool: Pool,
  funnel: Funnel,
  swipe: Swipe,
  shortlist: Shortlist,
  why: Why,
  training: Training,
  drafts: Drafts,
  calendar: Calendar,
  brief: Brief,
  chat: Chat,
};

const TAB_IDS: ScreenId[] = ['swipe', 'shortlist', 'drafts', 'chat'];
const GROUPS = ['Find', 'Decide', 'Learn', 'Act', 'Ask'];

function Wordmark() {
  return (
    <a className="wordmark" href={href('funnel')} aria-label="Cyrano, home">
      <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden="true">
        <rect width="32" height="32" rx="8" fill="#17151b" stroke="#37343e" />
        <path d="M9 22 L21 8 L23 10 L11 24 Z" fill="#d9b26f" />
        <path d="M9 22 L11 24 L8 25 Z" fill="#ece7de" />
      </svg>
      <span className="serif">Cyrano</span>
    </a>
  );
}

function Health() {
  const a = useResource(() => agent.health(), []);
  const p = useResource(() => platform.health(), []);
  const up = (r: { data?: unknown; error?: Error }) => (r.data ? 'up' : r.error ? 'down' : 'wait');
  return (
    <ul className="health" aria-label="Backend status">
      <li className={`health__dot health__dot--${up(p)}`}>
        <i /> Platform{p.data ? <span className="mono faint"> {(p.data as { profiles: number }).profiles} profiles</span> : null}
      </li>
      <li className={`health__dot health__dot--${up(a)}`}>
        <i /> Agent
      </li>
    </ul>
  );
}

export default function App() {
  const route = useRoute();
  const [menu, setMenu] = useState(false);
  const View = VIEW[route.screen];
  const current = SCREENS.find((s) => s.id === route.screen)!;

  useEffect(() => {
    setMenu(false);
    window.scrollTo(0, 0);
    document.title = `${current.label} · Cyrano`;
  }, [route.screen, route.param, current.label]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  const nav = (
    <>
      {GROUPS.map((g) => (
        <div key={g} className="nav__group">
          <p className="eyebrow">{g}</p>
          <ul>
            {SCREENS.filter((s) => s.group === g).map((s) => (
              <li key={s.id}>
                <a href={href(s.id)} className="nav__link" aria-current={route.screen === s.id ? 'page' : undefined}>
                  <span>{s.label}</span>
                  <small>{s.blurb}</small>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="side">
        <Wordmark />
        <nav aria-label="Screens" className="nav">
          {nav}
        </nav>
        <div className="side__foot">
          <div className="humanline">
            <Icon name="lock" size={15} />
            <p>
              Nothing is sent unless <b>you</b> press Send on the Drafts screen.
            </p>
          </div>
          <Health />
        </div>
      </aside>

      <header className="topbar">
        <Wordmark />
        <span className="topbar__title">{current.label}</span>
      </header>

      <main id="main" className="main" tabIndex={-1}>
        <Suspense fallback={<Loading />}>
          <View param={route.param} />
        </Suspense>
      </main>

      <nav className="tabbar" aria-label="Screens">
        {TAB_IDS.map((id) => {
          const s = SCREENS.find((x) => x.id === id)!;
          return (
            <a key={id} href={href(id)} aria-current={route.screen === id ? 'page' : undefined}>
              {s.label}
            </a>
          );
        })}
        <button aria-expanded={menu} aria-controls="more-sheet" onClick={() => setMenu((m) => !m)}>
          More
        </button>
      </nav>

      {menu ? (
        <div className="more-wrap" onClick={() => setMenu(false)}>
          <div id="more-sheet" className="more" role="dialog" aria-modal="true" aria-label="All screens" onClick={(e) => e.stopPropagation()}>
            <div className="more__head">
              <Wordmark />
              <button className="btn btn--ghost btn--sm" onClick={() => setMenu(false)} aria-label="Close menu">
                <Icon name="close" />
              </button>
            </div>
            <nav aria-label="All screens" className="nav nav--sheet">
              {nav}
            </nav>
            <Health />
          </div>
        </div>
      ) : null}
    </div>
  );
}
