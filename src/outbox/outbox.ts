import type { PlatformAdapter } from '../adapter/types.ts';
import type { ThreadMessage } from '../domain/types.ts';
import { HttpError } from '../http.ts';
import type { Draft } from './draft.ts';

/**
 * THE NO-AUTONOMOUS-SEND GUARANTEE
 * --------------------------------
 * 1. Types. `Draft` and `ApprovedDraft` are distinct. `ApprovedDraft` carries a unique-symbol
 *    brand that is not exported, so no other module can write an object literal of that type.
 *    `PlatformAdapter.deliver` accepts only `ApprovedDraft`.
 * 2. Runtime. `ApprovedDraft` objects are minted by `mint` below (module-private) and recorded
 *    in a WeakSet. `isApprovedDraft` is how an adapter verifies it, so a forged or cloned object
 *    is rejected even if someone defeats the type checker with a cast.
 * 3. Single door. `mint` is called from exactly one place: `Outbox.approveAndSend`, which needs a
 *    `HumanApproval` and the exact text the human saw. Only the HTTP approve route builds one.
 * 4. Tests. test/no-autonomous-send.test.ts scans the source so adding a second call site for
 *    `deliver` or `approveAndSend` fails the suite.
 *
 * What this cannot prove: that the person calling the approve route is a human. It proves that
 * no code path in this repo sends without that route being called.
 */

declare const approvedBrand: unique symbol;

export interface ApprovedDraft {
  readonly kind: 'approved';
  readonly [approvedBrand]: true;
  readonly draftId: string;
  readonly matchId: string;
  readonly body: string;
  readonly approvedAt: string;
}

/** Evidence that a human pressed the button. Built by the approve route and nowhere else. */
export interface HumanApproval {
  readonly via: 'http';
  /** The exact text the human was shown. Must equal the draft's current body. */
  readonly seenBody: string;
}

export interface SentMessage {
  readonly kind: 'sent';
  readonly draftId: string;
  readonly message: ThreadMessage;
}

const minted = new WeakSet<object>();

function mint(draft: Draft, now: Date): ApprovedDraft {
  const approved = Object.freeze({
    kind: 'approved' as const,
    draftId: draft.id,
    matchId: draft.matchId,
    body: draft.body,
    approvedAt: now.toISOString(),
  }) as unknown as ApprovedDraft;
  minted.add(approved);
  return approved;
}

/** Adapters call this before putting anything on the wire. */
export function isApprovedDraft(x: unknown): x is ApprovedDraft {
  return typeof x === 'object' && x !== null && minted.has(x);
}

export type DraftStatus = 'pending' | 'sent' | 'discarded';

export interface DraftRecord {
  draft: Draft;
  status: DraftStatus;
  sent?: SentMessage;
}

export class Outbox {
  private records = new Map<string, DraftRecord>();
  private adapter: PlatformAdapter;
  private clock: () => Date;

  constructor(adapter: PlatformAdapter, clock: () => Date = () => new Date()) {
    this.adapter = adapter;
    this.clock = clock;
  }

  /** Creates a draft. Never touches the wire. */
  async draft(matchId: string, body: string, author: 'agent' | 'human', generator: string): Promise<Draft> {
    const draft = await this.adapter.draftMessage(matchId, { body, author, generator });
    this.records.set(draft.id, { draft, status: 'pending' });
    return draft;
  }

  list(status?: DraftStatus): DraftRecord[] {
    return [...this.records.values()].filter((r) => !status || r.status === status);
  }

  get(id: string): DraftRecord {
    const r = this.records.get(id);
    if (!r) throw new HttpError(404, 'not_found', `No draft ${id}`);
    return r;
  }

  discard(id: string): DraftRecord {
    const r = this.get(id);
    if (r.status !== 'pending') throw new HttpError(409, 'not_pending', `Draft is already ${r.status}`);
    r.status = 'discarded';
    return r;
  }

  /** The only place a Draft becomes a sent message. */
  async approveAndSend(draftId: string, approval: HumanApproval): Promise<SentMessage> {
    const r = this.get(draftId);
    if (r.status !== 'pending') throw new HttpError(409, 'not_pending', `Draft is already ${r.status}`);
    if (approval.via !== 'http' || approval.seenBody !== r.draft.body) {
      throw new HttpError(409, 'body_mismatch', 'The approved text does not match the draft. Re-read it and approve again.');
    }
    const message = await this.adapter.deliver(mint(r.draft, this.clock()));
    const sent: SentMessage = { kind: 'sent', draftId, message };
    r.status = 'sent';
    r.sent = sent;
    return sent;
  }
}
