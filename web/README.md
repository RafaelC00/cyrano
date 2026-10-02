# Cyrano web

The front end for Cyrano. React, TypeScript and Vite, hand-written CSS, self-hosted fonts. No paid services, no accounts, no model calls.

```
npm install
npm run dev:all    # starts the backend (repo root) and this app: http://127.0.0.1:5173
npm run dev        # this app only; the backend must already be running
npm run build      # typecheck and build to dist/
npm run typecheck
npm test           # the chat parser
```

Needs Node 22.18 or newer. The browser only talks to this origin; the dev and preview servers forward `/api/agent` to `:4200` and `/api/platform` to `:4100`.

## Real data and fixtures

Phase 1 (platform, funnel, audit, reversal, outbox) is used live: Pool, Funnel, Swipe, Shortlist (stated scores), Why, Drafts and the lookups in Chat.

Scoring and preference learning, and drafting and scheduling, are not merged yet. Everything the UI needs from them is declared in one file, `src/contracts.ts`: types, expected endpoint paths and `fromSeam`, which asks the agent for the live endpoint and falls back to `src/fixtures.ts`. Screens show a "Fixture" badge wherever data did not come from the backend. When a branch merges, check its response shape against the type in `contracts.ts`; the screen switches to live without other changes.

## The approval gate

`agent.approveDraft` is called from exactly one place: the "Send now" button inside `SendGate` in `src/screens/Drafts.tsx`. It is reachable only after a saved draft, an explicit "Review and send", a ticked confirmation and a click. No keyboard shortcut, timer or effect sends, and nothing advances to the next match on its own.

## Chat

`src/chat/parser.ts` turns a message into an intent with weighted cues and slot rules, no model and no network. `src/chat/provider.ts` is the interface an LLM can sit behind later; the default is the local parser.
