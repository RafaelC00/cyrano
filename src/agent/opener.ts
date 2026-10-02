import type { Candidate } from '../domain/types.ts';
import type { Preferences } from './preferences.ts';

export const OPENER_GENERATOR = 'template-v0';

/**
 * Phase 1 drafter: a fixed template over declared fields. It exists to prove the draft/approve
 * path end to end. A voice-trained drafter replaces it in a later phase; the human still sends.
 */
export function draftOpener(candidate: Candidate, prefs: Preferences): string {
  const first = candidate.displayName.split(' ')[0];
  const common = candidate.declared.interests.find((i) => prefs.viewer.interests.includes(i));
  if (common) return `Hi ${first}, I saw you are into ${common} too. What is the best thing you have done with it lately?`;
  const prompt = candidate.declared.prompts[0];
  if (prompt) return `Hi ${first}, your answer to "${prompt.question}" made me smile. Is that still true on a bad day?`;
  return `Hi ${first}, what does a good weekend look like for you?`;
}
