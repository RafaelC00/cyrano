import { randomUUID } from 'node:crypto';

/**
 * A Draft is text that exists only inside this system. It is a different type from a sent
 * message and from an `ApprovedDraft`, and nothing in the platform adapter accepts it.
 * The only way to turn one into the other is `Outbox.approveAndSend` (see outbox.ts).
 */
export interface Draft {
  readonly kind: 'draft';
  readonly id: string;
  readonly matchId: string;
  readonly body: string;
  readonly author: 'agent' | 'human';
  /** Which generator wrote it, e.g. `template-v0`. Lets later phases compare drafters. */
  readonly generator: string;
  readonly createdAt: string;
}

export const MAX_MESSAGE_LENGTH = 1000;

export function createDraft(input: {
  matchId: string;
  body: string;
  author: 'agent' | 'human';
  generator: string;
  now: Date;
}): Draft {
  const body = input.body.trim();
  if (!body) throw new Error('A draft needs a non-empty body');
  if (body.length > MAX_MESSAGE_LENGTH) throw new Error(`A draft must be at most ${MAX_MESSAGE_LENGTH} characters`);
  return Object.freeze({
    kind: 'draft' as const,
    id: `d_${randomUUID().slice(0, 8)}`,
    matchId: input.matchId,
    body,
    author: input.author,
    generator: input.generator,
    createdAt: input.now.toISOString(),
  });
}
