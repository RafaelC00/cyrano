import { parse } from './parser.ts';
import type { Intent, ParseContext, Parsed } from './parser.ts';

/**
 * Where a chat message becomes an intent. The default is the local rule-based parser: free,
 * offline, deterministic. An LLM can be put behind the same interface later; nothing else in the
 * chat (the engine, the screen) knows or cares which one answered.
 */
export interface IntentProvider {
  readonly name: string;
  /** Whether using it costs money or sends text off the machine. */
  readonly metered: boolean;
  parse(text: string, ctx: ParseContext): Promise<Parsed>;
}

export const localProvider: IntentProvider = {
  name: 'Local rules',
  metered: false,
  parse: async (text, ctx) => parse(text, ctx),
};

const KINDS: Intent['kind'][] = ['help', 'greeting', 'why_dropped', 'top', 'move', 'overturn', 'funnel', 'dropped_by', 'calendar', 'where', 'brief', 'model', 'send', 'unknown'];

/** Cheap structural check, so a model that returns nonsense falls back to the local parser. */
export function isIntent(x: unknown): x is Intent {
  return typeof x === 'object' && x !== null && KINDS.includes((x as { kind: Intent['kind'] }).kind);
}

export function intentPrompt(text: string, ctx: ParseContext): string {
  return [
    'Classify the message into one JSON object with a "kind" field, one of:',
    KINDS.join(', ') + '.',
    'Use "who" ({id, name}) from this list when a person is meant:',
    JSON.stringify(ctx.people.slice(0, 200)),
    `Today is ${ctx.today}. Reply with JSON only.`,
    `Message: ${JSON.stringify(text)}`,
  ].join('\n');
}

/**
 * An LLM-backed provider. NOT wired by default and nothing in this app constructs one: it exists
 * so the seam is real. Give it a `complete` function (your own client) and call `setProvider`.
 * Anything it returns that is not a valid intent falls back to the local parser.
 */
export function createLlmProvider(complete: (prompt: string) => Promise<string>, name = 'Language model'): IntentProvider {
  return {
    name,
    metered: true,
    async parse(text, ctx) {
      try {
        const raw = await complete(intentPrompt(text, ctx));
        const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as unknown;
        if (isIntent(json)) return { intent: json, confidence: 0.9, scores: [] };
      } catch {
        // fall through
      }
      return localProvider.parse(text, ctx);
    },
  };
}

let active: IntentProvider = localProvider;
export const getProvider = () => active;
export const setProvider = (p: IntentProvider) => {
  active = p;
};
