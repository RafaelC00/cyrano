/**
 * Phase-1 API: the platform (:4100) and the agent (:4200), reached through the dev proxy.
 * Everything in this file talks to services that exist on `main`. Types mirror the backend.
 */

export type Gender = 'woman' | 'man' | 'nonbinary';
export type Intent = 'long-term' | 'short-term' | 'casual' | 'open' | 'friendship';

export interface PromptAnswer {
  promptId: string;
  question: string;
  answer: string;
}

export interface DeclaredProfile {
  age: number;
  gender: Gender;
  interestedIn: Gender[];
  city: string;
  country: string;
  languages: string[];
  interests: string[];
  lookingFor: Intent[];
  smoking: 'never' | 'sometimes' | 'regularly';
  children: 'want' | 'dont-want' | 'open' | 'have';
  prompts: PromptAnswer[];
}

export interface Candidate {
  id: string;
  displayName: string;
  synthetic: true;
  declared: DeclaredProfile;
  photos: Array<{ slot: number; photoRef: string }>;
  activity: { lastActiveAt: string; daysSinceActive: number; sessionsLast30d: number };
}

export interface ScoreResult {
  score: number;
  components: Record<string, number>;
  explanation: string;
  scorer: string;
}

export interface GateItem {
  candidateId: string;
  displayName: string;
  rank?: number;
  score?: ScoreResult;
  overturned: boolean;
  declared: DeclaredProfile;
  photoRef: string | null;
}

export type Stage = 'broad' | 'rules' | 'rank' | 'gate';
export type AuditOutcome = 'pass' | 'fail' | 'overturn' | 'accept' | 'reject';

export interface AuditEntry {
  candidateId: string;
  rule: string;
  outcome: AuditOutcome;
  reason: string;
  timestamp: string;
  stage: Stage;
  runId?: string;
}

export interface DropRecord {
  stage: Stage;
  rule: string;
  reason: string;
  timestamp: string;
  alsoFailed: Array<{ rule: string; reason: string }>;
}

export interface WhyReport {
  candidateId: string;
  displayName: string;
  status: 'dropped' | 'pending' | 'accepted' | 'rejected';
  droppedBy: DropRecord | null;
  overturned: boolean;
  reversible: boolean;
  history: AuditEntry[];
}

export interface Rejection {
  candidateId: string;
  displayName: string;
  status: 'dropped' | 'rejected';
  droppedBy: DropRecord | null;
}

export interface RuleInfo {
  id: string;
  description: string;
  fields: string[];
}

export interface Preferences {
  viewer: {
    age: number;
    gender: Gender;
    interestedIn: Gender[];
    languages: string[];
    interests: string[];
    intents: Intent[];
  };
  ageRange: { min: number; max: number };
  cities: string[];
  requireSharedLanguage: boolean;
  excludedSmoking: string[];
  excludedChildren: string[];
  dormantAfterDays: number;
  gateSize: number;
}

export interface StageReport {
  stage: Stage;
  in: number;
  dropped: number;
  out: number;
}

export interface FunnelReport {
  runId: string;
  startedAt: string;
  fetched: number;
  alreadyTracked: number;
  entered: number;
  stages: StageReport[];
  droppedByRule: Record<string, number>;
  ruleFailuresByRule: Record<string, number>;
  reachedGate: number;
}

export interface SwipeResult {
  candidateId: string;
  action: 'like' | 'pass';
  matched: boolean;
  matchId?: string;
}
export interface Match {
  id: string;
  candidateId: string;
  matchedAt: string;
}
export interface ThreadMessage {
  id: string;
  matchId: string;
  from: 'viewer' | 'candidate';
  body: string;
  sentAt: string;
}

export interface Draft {
  kind: 'draft';
  id: string;
  matchId: string;
  body: string;
  author: 'agent' | 'human';
  generator: string;
  createdAt: string;
}
export interface DraftRecord {
  draft: Draft;
  status: 'pending' | 'sent' | 'discarded';
}

export interface SentMessage {
  kind: 'sent';
  draftId: string;
  message: ThreadMessage;
}

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const AGENT = '/api/agent';
const PLATFORM = '/api/platform';
const DOWN = 'The backend is not reachable. Start it with "npm run dev" in the repo root.';

export async function call<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + path, init);
  } catch {
    throw new ApiError(0, 'unreachable', DOWN);
  }
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // proxy error pages are not JSON
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    // A dev-proxy failure (backend down) surfaces as 5xx with a non-JSON body.
    if (!e && res.status >= 500) throw new ApiError(0, 'unreachable', DOWN);
    throw new ApiError(res.status, e?.code ?? 'error', e?.message ?? `Request failed (${res.status})`);
  }
  return json as T;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const AGENT_BASE = AGENT;

export const agent = {
  health: () => call<{ ok: boolean; adapter: string }>(AGENT, '/health'),
  preferences: () => call<Preferences>(AGENT, '/preferences'),
  rules: () => call<RuleInfo[]>(AGENT, '/rules'),
  run: () => call<FunnelReport>(AGENT, '/runs', post()),
  gate: () => call<{ items: GateItem[] }>(AGENT, '/gate').then((r) => r.items),
  accept: (id: string) => call<SwipeResult>(AGENT, `/gate/${id}/accept`, post()),
  reject: (id: string) => call<SwipeResult>(AGENT, `/gate/${id}/reject`, post()),
  audit: () => call<{ items: AuditEntry[] }>(AGENT, '/audit').then((r) => r.items),
  rejections: () => call<{ items: Rejection[] }>(AGENT, '/rejections').then((r) => r.items),
  why: (id: string) => call<WhyReport>(AGENT, `/candidates/${id}/why`),
  overturn: (id: string, note?: string) =>
    call<WhyReport>(AGENT, `/candidates/${id}/overturn`, post(note ? { note } : undefined)),
  matches: () => call<{ items: Match[] }>(AGENT, '/matches').then((r) => r.items),
  thread: (matchId: string) => call<{ items: ThreadMessage[] }>(AGENT, `/matches/${matchId}/thread`).then((r) => r.items),
  /** Creates a DRAFT only. With no body the agent's drafter writes one; with a body it is human-authored. */
  createDraft: (matchId: string, body?: string) =>
    call<DraftRecord>(AGENT, `/matches/${matchId}/drafts`, post(body === undefined ? undefined : { body })),
  drafts: () => call<{ items: DraftRecord[] }>(AGENT, '/drafts').then((r) => r.items),
  discardDraft: (id: string) => call<DraftRecord>(AGENT, `/drafts/${id}/discard`, post()),
  /** The one call that puts text on the wire. Only ever invoked from the confirm step of the Drafts screen. */
  approveDraft: (id: string, seenBody: string) => call<SentMessage>(AGENT, `/drafts/${id}/approve`, post({ seenBody })),
};

export const platform = {
  candidate: (id: string) => call<Candidate>(PLATFORM, `/candidates/${id}`),
  page: (cursor?: string) =>
    call<{ items: Candidate[]; nextCursor: string | null }>(PLATFORM, `/candidates?limit=100${cursor ? `&cursor=${cursor}` : ''}`),
  health: () => call<{ ok: boolean; profiles: number }>(PLATFORM, '/health'),
  photoUrl: (ref: string) => `${PLATFORM}/photos/${encodeURIComponent(ref)}`,
};
