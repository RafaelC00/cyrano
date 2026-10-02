import type { Candidate, Match, Page, SwipeResult, ThreadMessage } from '../domain/types.ts';
import type { Draft } from '../outbox/draft.ts';
import type { ApprovedDraft } from '../outbox/outbox.ts';

export interface ListCandidatesOptions {
  cursor?: string;
  limit?: number;
}

export interface DraftInput {
  body: string;
  author: 'agent' | 'human';
  generator: string;
}

/** Thrown by adapters for any platform-side failure. */
export class PlatformError extends Error {
  status: number;
  code: string;
  /** True when retrying the same call later could succeed (429, 5xx, network). */
  retryable: boolean;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'PlatformError';
    this.status = status;
    this.code = code;
    this.retryable = status === 429 || status >= 500 || status === 0;
  }
}

/**
 * The operations the funnel needs from a dating platform.
 *
 * Note what is absent: there is no `sendMessage(text)`. The only way to put text on the wire
 * is `deliver`, which accepts an `ApprovedDraft`, a type only `Outbox.approveAndSend` can make.
 */
export interface PlatformAdapter {
  readonly name: string;

  /** Candidates the viewer has not acted on, in stable order, cursor-paginated. */
  listCandidates(opts?: ListCandidatesOptions): Promise<Page<Candidate>>;
  getProfile(candidateId: string): Promise<Candidate>;

  /** Records a pass on the platform. Callers must only do this on an explicit human decision. */
  pass(candidateId: string): Promise<SwipeResult>;
  /** Records a like. May produce a match. Callers must only do this on an explicit human decision. */
  like(candidateId: string): Promise<SwipeResult>;
  /** Undoes a pass. Platforms that cannot do this should throw `PlatformError(501, ...)`. */
  rewindPass(candidateId: string): Promise<void>;

  listMatches(): Promise<Match[]>;
  readThread(matchId: string): Promise<ThreadMessage[]>;

  /** Builds a Draft. Local only: never contacts the platform to send anything. */
  draftMessage(matchId: string, input: DraftInput): Promise<Draft>;
  /** Puts an approved draft on the wire. Rejects anything that is not a minted `ApprovedDraft`. */
  deliver(approved: ApprovedDraft): Promise<ThreadMessage>;
}
