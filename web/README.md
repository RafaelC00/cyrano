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

## Data

Every screen reads the agent live; there are no local fixtures, and if the agent is down the screen says so. The funnel, audit, reversal and outbox calls are in `src/api/phase1.ts`. Everything else the screens use is declared in one file, `src/contracts.ts`: the held-out model result (`/model/report`) and Eric's comparisons (`/model/comparisons`), learned scores for the shortlist (`/scores`), how a draft was made (`/drafts/:id/meta`), the calendar and its actions, and the weekly brief. Its types mirror `src/agent/views.ts` and `src/calibration/trainingReport.ts` in the backend, and the numbers on the Training screen are the ones in `data/calibration/EVAL.md`.

## The approval gate

`agent.approveDraft` is called from exactly one place: the "Send now" button inside `SendGate` in `src/screens/Drafts.tsx`. It is reachable only after a saved draft, an explicit "Review and send", a ticked confirmation and a click. No keyboard shortcut, timer or effect sends, and nothing advances to the next match on its own.

## Chat

`src/chat/parser.ts` turns a message into an intent with weighted cues and slot rules, no model and no network. `src/chat/provider.ts` is the interface an LLM can sit behind later; the default is the local parser.
