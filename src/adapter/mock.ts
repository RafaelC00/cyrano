import type { Candidate, Match, Page, SwipeResult, ThreadMessage } from '../domain/types.ts';
import { createDraft } from '../outbox/draft.ts';
import type { Draft } from '../outbox/draft.ts';
import { isApprovedDraft } from '../outbox/outbox.ts';
import type { ApprovedDraft } from '../outbox/outbox.ts';
import { PlatformError } from './types.ts';
import type { DraftInput, ListCandidatesOptions, PlatformAdapter } from './types.ts';

export interface MockPlatformOptions {
  baseUrl: string;
  /** Injectable so tests can route requests straight into the platform app without a socket. */
  fetch?: typeof fetch;
  clock?: () => Date;
}

/** Fully implemented adapter over the synthetic platform's HTTP API. */
export class MockPlatform implements PlatformAdapter {
  readonly name = 'mock';
  private baseUrl: string;
  private fetchImpl: typeof fetch;
  private clock: () => Date;

  constructor(opts: MockPlatformOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
    this.clock = opts.clock ?? (() => new Date());
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      throw new PlatformError(0, 'network', `Platform unreachable: ${(e as Error).message}`);
    }
    if (!res.ok) {
      let code = 'http_error';
      let message = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: { code?: string; message?: string } };
        code = j.error?.code ?? code;
        message = j.error?.message ?? message;
      } catch {
        // keep defaults
      }
      throw new PlatformError(res.status, code, message);
    }
    return (await res.json()) as T;
  }

  listCandidates(opts: ListCandidatesOptions = {}): Promise<Page<Candidate>> {
    const q = new URLSearchParams();
    if (opts.cursor) q.set('cursor', opts.cursor);
    if (opts.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    return this.request('GET', `/candidates${qs ? `?${qs}` : ''}`);
  }

  getProfile(candidateId: string): Promise<Candidate> {
    return this.request('GET', `/candidates/${encodeURIComponent(candidateId)}`);
  }

  pass(candidateId: string): Promise<SwipeResult> {
    return this.request('POST', '/swipes', { candidateId, action: 'pass' });
  }

  like(candidateId: string): Promise<SwipeResult> {
    return this.request('POST', '/swipes', { candidateId, action: 'like' });
  }

  async rewindPass(candidateId: string): Promise<void> {
    await this.request('DELETE', `/swipes/${encodeURIComponent(candidateId)}`);
  }

  async listMatches(): Promise<Match[]> {
    return (await this.request<{ items: Match[] }>('GET', '/matches')).items;
  }

  async readThread(matchId: string): Promise<ThreadMessage[]> {
    return (await this.request<{ items: ThreadMessage[] }>('GET', `/matches/${encodeURIComponent(matchId)}/messages`)).items;
  }

  async draftMessage(matchId: string, input: DraftInput): Promise<Draft> {
    // Validates the match exists; sends nothing.
    await this.readThread(matchId);
    return createDraft({ matchId, ...input, now: this.clock() });
  }

  deliver(approved: ApprovedDraft): Promise<ThreadMessage> {
    if (!isApprovedDraft(approved)) {
      return Promise.reject(new PlatformError(403, 'not_approved', 'Refusing to send: not an approved draft'));
    }
    return this.request('POST', `/matches/${encodeURIComponent(approved.matchId)}/messages`, { body: approved.body });
  }
}
