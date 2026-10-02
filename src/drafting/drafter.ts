import type { Draft } from '../outbox/draft.ts';
import type { Outbox } from '../outbox/outbox.ts';
import { checkDraft, threadRejection } from './check.ts';
import { TemplateGenerator } from './generator.ts';
import type { Attempt, Citation, DraftContext, DraftGenerator, DraftLang, GeneratedDraft, PresenceClaim, RuleId } from './types.ts';

export interface DrafterOptions {
  /** Defaults to the free template engine. */
  generator?: DraftGenerator;
  /** How many candidate texts to try before giving up. Default 8. */
  maxAttempts?: number;
}

/** Why nothing was offered. Always one of these, never a silent empty result. */
export type HeldReason = 'no_overlap' | 'no_detail' | 'needs_slot' | 'thread_state' | 'all_rejected' | 'generator_failed';

export type DraftOutcome =
  | {
      status: 'ready';
      draft: GeneratedDraft;
      /** Texts that failed the check on the way here, in order. */
      rejected: Attempt[];
      /** The rules this text passed. */
      checked: RuleId[];
    }
  | { status: 'held'; reason: HeldReason; message: string; rejected: Attempt[] };

/** A draft that passed the check and now sits in the outbox as a plain `Draft`, awaiting a human. */
export interface OfferedDraft {
  status: 'offered';
  /** The ordinary outbox draft. Only `Outbox.approveAndSend` can turn it into anything sendable. */
  draft: Draft;
  /** What the UI shows next to the text. */
  citation: Citation;
  language: DraftLang;
  claims: PresenceClaim[];
  slotIds: string[];
  slips: number;
  rejected: Attempt[];
  checked: RuleId[];
}

export type OfferOutcome = OfferedDraft | Extract<DraftOutcome, { status: 'held' }>;

/**
 * Writes drafts in Eric's voice and refuses to offer any that break the rules.
 *
 * The loop: ask the generator for a text, run `checkDraft`, and on a rejection ask again (the
 * generator moves to a different detail and different wording). The first text that passes is
 * returned; if none does within `maxAttempts`, nothing is offered and the outcome says why.
 *
 * This class cannot send. `offer` hands the text to `Outbox.draft`, which makes a `Draft`;
 * approving and sending stays in `Outbox.approveAndSend`, reachable only through the approve
 * route. There is no second path from here.
 */
export class Drafter {
  private generator: DraftGenerator;
  private maxAttempts: number;
  private offered = new Map<string, OfferedDraft>();

  constructor(opts: DrafterOptions = {}) {
    this.generator = opts.generator ?? new TemplateGenerator();
    this.maxAttempts = opts.maxAttempts ?? 8;
  }

  /** The citation and checks behind a draft this drafter offered, by outbox draft id. For the UI. */
  offeredDraft(draftId: string): OfferedDraft | undefined {
    return this.offered.get(draftId);
  }

  get generatorName(): string {
    return this.generator.name;
  }

  async compose(ctx: DraftContext): Promise<DraftOutcome> {
    const rejected: Attempt[] = [];
    // Whether a message may go out at all does not depend on wording: ask before generating.
    const blocked = threadRejection(ctx.kind, ctx.thread);
    if (blocked) return { status: 'held', reason: 'thread_state', message: blocked.reason, rejected };
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      let out;
      try {
        out = await this.generator.generate(ctx, attempt);
      } catch (e) {
        return { status: 'held', reason: 'generator_failed', message: `The generator threw: ${e instanceof Error ? e.message : String(e)}`, rejected };
      }
      if ('refused' in out) return { status: 'held', reason: out.reason, message: out.message, rejected };
      const verdict = checkDraft(out, ctx);
      if (verdict.ok) return { status: 'ready', draft: out, rejected, checked: verdict.checked };
      rejected.push({ attempt, body: out.body, rejection: verdict.rejection });
    }
    return {
      status: 'held',
      reason: 'all_rejected',
      message: `${this.maxAttempts} attempts all failed the prohibited-content check; the last was "${rejected[rejected.length - 1]?.rejection.rule}".`,
      rejected,
    };
  }

  /** Compose, and if it passes, put it in the outbox as a draft for a human to read. */
  async offer(outbox: Outbox, matchId: string, ctx: DraftContext): Promise<OfferOutcome> {
    const outcome = await this.compose(ctx);
    if (outcome.status === 'held') return outcome;
    const d = outcome.draft;
    const draft = await outbox.draft(matchId, d.body, 'agent', d.generator);
    const result: OfferedDraft = {
      status: 'offered',
      draft,
      citation: d.citation,
      language: d.language,
      claims: d.claims,
      slotIds: d.slotIds,
      slips: d.slips,
      rejected: outcome.rejected,
      checked: outcome.checked,
    };
    this.offered.set(draft.id, result);
    return result;
  }
}
