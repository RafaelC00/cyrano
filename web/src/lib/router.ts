import { useSyncExternalStore } from 'react';

export type ScreenId =
  | 'pool'
  | 'funnel'
  | 'swipe'
  | 'shortlist'
  | 'why'
  | 'training'
  | 'drafts'
  | 'calendar'
  | 'brief'
  | 'chat';

export interface Route {
  screen: ScreenId;
  param?: string;
}

export const SCREENS: Array<{ id: ScreenId; label: string; blurb: string; group: string }> = [
  { id: 'pool', label: 'Pool', blurb: 'Everyone the platform holds', group: 'Find' },
  { id: 'funnel', label: 'Funnel', blurb: 'Where people dropped, and why', group: 'Find' },
  { id: 'swipe', label: 'Swipe', blurb: 'Your gate', group: 'Decide' },
  { id: 'shortlist', label: 'Shortlist', blurb: 'Who made the cut', group: 'Decide' },
  { id: 'why', label: 'Why', blurb: 'Audit and overturn', group: 'Decide' },
  { id: 'training', label: 'Training', blurb: 'What Eric picked', group: 'Learn' },
  { id: 'drafts', label: 'Drafts', blurb: 'The approval gate', group: 'Act' },
  { id: 'calendar', label: 'Calendar', blurb: 'Dates and where you are', group: 'Act' },
  { id: 'brief', label: 'Brief', blurb: 'The week in one page', group: 'Act' },
  { id: 'chat', label: 'Ask', blurb: 'Ask the system', group: 'Ask' },
];

const IDS = new Set<string>(SCREENS.map((s) => s.id));

export function parseHash(hash: string): Route {
  const [screen, ...rest] = hash.replace(/^#\/?/, '').split('/');
  const param = rest.join('/') || undefined;
  return IDS.has(screen ?? '') ? { screen: screen as ScreenId, param } : { screen: 'funnel' };
}

let last = '';
let lastRoute: Route = parseHash(typeof location === 'undefined' ? '' : location.hash);
function snapshot(): Route {
  const h = location.hash;
  if (h !== last) {
    last = h;
    lastRoute = parseHash(h);
  }
  return lastRoute;
}
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};

export const useRoute = (): Route => useSyncExternalStore(subscribe, snapshot);

export const href = (screen: ScreenId, param?: string) => `#/${screen}${param ? `/${param}` : ''}`;
export const go = (screen: ScreenId, param?: string) => {
  location.hash = href(screen, param);
};
