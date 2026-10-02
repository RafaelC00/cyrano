import type { Candidate, Match, Page, SwipeResult, ThreadMessage } from '../domain/types.ts';
import type { Draft } from '../outbox/draft.ts';
import type { ApprovedDraft } from '../outbox/outbox.ts';
import type { DraftInput, ListCandidatesOptions, PlatformAdapter } from './types.ts';

/**
 * RealPlatform: a specification, not an implementation. Constructing it throws.
 *
 * Why it is disabled, in two reasons that are not negotiable here:
 *
 *  1. Terms of service. Mainstream dating apps (Tinder, Bumble, Hinge, Feeld, Pure and others)
 *     prohibit automated access in their terms. Accounts are terminated and operators have been
 *     sued. A demo that depends on one dies on a ban or a selector change.
 *  2. GDPR. Ranking real people by their photographs is special-category biometric processing
 *     (Art. 9) with no lawful basis here. Real profile photographs are never fetched, stored or
 *     scored by this project.
 *
 * What a real integration would need, which is why the signatures below are shaped as they are:
 *
 *  - Auth: a user-granted credential (OAuth where offered, otherwise a session the user owns),
 *    with refresh, secure storage, and handling of 401/403 as "stop", not "retry".
 *  - Rate limits: a token bucket per endpoint honouring `Retry-After`; swipe and message
 *    endpoints are the most tightly limited, and platforms flag burst patterns.
 *  - Pagination: candidate lists are usually cursor- or batch-based, non-stable between calls,
 *    and can repeat items across pages. Callers must dedupe by id.
 *  - Backoff: exponential with jitter on 429 and 5xx; a circuit breaker that halts all calls
 *    after repeated failures, because continuing risks the account.
 *  - Failure modes: shadow bans (calls succeed, effects do not), silently changed schemas,
 *    CAPTCHAs and device attestation, partial outages, and swipes that cannot be undone.
 *    Every one of these must surface as a typed `PlatformError`, never as an empty result.
 */
export interface RealPlatformOptions {
  baseUrl: string;
  auth: { kind: 'oauth'; accessToken: string; refresh: () => Promise<string> };
  rateLimit: { requestsPerMinute: number; burst: number };
  backoff: { baseMs: number; maxMs: number; maxAttempts: number };
}

export class RealPlatformDisabledError extends Error {
  constructor() {
    super(
      'RealPlatform is intentionally disabled. (1) The terms of service of dating platforms prohibit ' +
        'automated access. (2) GDPR bars processing real people\'s profile photographs here (special-category ' +
        'biometric data, no lawful basis). Use MockPlatform, which runs against the synthetic platform.',
    );
    this.name = 'RealPlatformDisabledError';
  }
}

function unreachable(): never {
  throw new RealPlatformDisabledError();
}

export class RealPlatform implements PlatformAdapter {
  readonly name = 'real';

  constructor(_opts: RealPlatformOptions) {
    throw new RealPlatformDisabledError();
  }

  /** Must paginate with the platform's cursor, dedupe by id, and respect the rate limiter. */
  listCandidates(_opts?: ListCandidatesOptions): Promise<Page<Candidate>> {
    return unreachable();
  }

  /** Profile reads are rate-limited separately and often return a thinner shape than the list. */
  getProfile(_candidateId: string): Promise<Candidate> {
    return unreachable();
  }

  /** Irreversible on most platforms. Only ever called on an explicit human decision. */
  pass(_candidateId: string): Promise<SwipeResult> {
    return unreachable();
  }

  /** Irreversible, may create a match, and is the most aggressively rate-limited call. */
  like(_candidateId: string): Promise<SwipeResult> {
    return unreachable();
  }

  /** Usually a paid feature with a time window. Should throw PlatformError(501) where absent. */
  rewindPass(_candidateId: string): Promise<void> {
    return unreachable();
  }

  /** Matches can expire and can disappear when the other side unmatches. Handle 404 as expected. */
  listMatches(): Promise<Match[]> {
    return unreachable();
  }

  /** Thread reads should be incremental (since-id) to avoid re-fetching whole histories. */
  readThread(_matchId: string): Promise<ThreadMessage[]> {
    return unreachable();
  }

  /** Local only. Drafting never contacts the platform. */
  draftMessage(_matchId: string, _input: DraftInput): Promise<Draft> {
    return unreachable();
  }

  /**
   * The single egress point for text. Must verify `isApprovedDraft`, must be idempotent per
   * draft id (a retry after a timeout must not double-send), and must treat a rate-limit or
   * moderation rejection as final for that attempt rather than retrying blindly.
   */
  deliver(_approved: ApprovedDraft): Promise<ThreadMessage> {
    return unreachable();
  }
}
