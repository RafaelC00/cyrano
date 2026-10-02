# CYRANO

An agent that does the labour of dating apps (volume, filtering, ranking) and hands a person the only part worth their time: who to meet, and what to say.

It runs against a dating platform built for this project and seeded with generated people. It does not touch a real platform, does not process any real person's data, and cannot send a message on its own.

> Cyrano de Bergerac wrote another man's love letters, and the play is a tragedy because of the deception. This project automates the search and refuses to automate the person.

**Status: phase 1.** The platform, the adapter interface, the funnel (rules, baseline ranking, human gate), reversibility, and the no-autonomous-send guarantee exist and are tested. Learned ranking, vision signals, voice-trained drafting and scheduling do not exist yet. See [What is not here](#what-is-not-here).

## The three lines it holds

1. **No real platform account is automated.** Mainstream dating apps prohibit automated access; accounts get terminated. `RealPlatform` exists only as a documented stub that throws on construction.
2. **No message is sent without a human action.** Drafting is the product; sending is the person's. This is enforced in types, at runtime and by tests (below), not by convention.
3. **No real person's photograph is processed.** Every profile is generated and flagged `synthetic: true`. Photos are deterministic placeholder art.

## Run it

Requires Node 22.18 or newer (it runs TypeScript directly, no build step and no native dependencies).

```
npm install
npm run dev        # platform on :4100, agent on :4200 (127.0.0.1 only)
npm run demo       # runs the whole funnel in-process and prints what happened
npm test
npm run typecheck
```

Open `http://127.0.0.1:4100/` for a gallery of the generated pool. Then:

```
curl -X POST localhost:4200/runs          # run the funnel
curl localhost:4200/gate                  # candidates waiting for a human
```

Nothing is metered, there are no accounts and no credentials. State is in memory and resets on restart.

## What happened on a real run

Output of `npm run demo` with the default seed (500 generated profiles, 8 of which start as existing matches), default preferences, gate size 10:

```
Entered the funnel: 492
  broad  in  492   dropped   38   out  454
  rules  in  454   dropped  438   out   16
  rank   in   16   dropped    6   out   10
  gate   in   10   dropped    0   out   10
Platform swipes recorded by the funnel itself: 0
```

The rule filter is strict because the demo preferences are (age range, four cities, mutual orientation, shared language, intent overlap, two exclusions). Dropped candidates are counted by the first rule they fail; the report also gives every failing evaluation per rule, since one person can fail several. These numbers describe the synthetic pool and the demo's preferences. They say nothing about how any real app behaves.

## Architecture

```
  platform (HTTP, :4100)              agent (HTTP, :4200)
  ----------------------              ---------------------------------------------
  candidates, swipes, matches   <-->  PlatformAdapter  (MockPlatform | RealPlatform)
  threads, placeholder photos            |
                                         |   1 broad pass     cheap, wide, no judgement
                                         |   2 rule filter    declared fields only, audited
                                         |   3 rank           Scorer seam, stated-preference baseline
                                         |   4 human gate     accept / reject, nothing moves without it
                                         |
                                         +-- audit log (append-only)   reversal API
                                         +-- outbox: Draft -> (human approval) -> sent
```

### The platform (`src/platform`)

A small Hono service shaped like a dating-app backend: cursor-paginated candidates, `POST /swipes`, `DELETE /swipes/:id` (rewind a pass), matches, a message thread per match, and photos. Profiles carry self-declared attributes (age, gender and who they are interested in, city, languages, interests, what they are looking for, smoking, children, answered prompts), photo slots and an activity signal. Generation is seeded and deterministic: the same seed gives the same 500 people. Names are invented syllables plus a compound surname.

**Photos.** Each slot has a `photoRef` of the form `<scheme>:<version>:<profileId>:<slot>`, served at `GET /photos/{photoRef}`. Phase 1 implements scheme `ph`, a seeded abstract SVG. Callers treat the ref as opaque, so generated portraits can later be served under a new scheme from the same route without touching anything else.

**Activity.** `daysSinceActive` is computed against the platform clock, which is pinned to a seed epoch (2026-10-01) so runs are reproducible.

### The adapter (`src/adapter`)

`PlatformAdapter` has: `listCandidates`, `getProfile`, `pass`, `like`, `rewindPass`, `listMatches`, `readThread`, `draftMessage`, `deliver`. `MockPlatform` implements all of them over the platform's HTTP API and maps failures to a typed `PlatformError` with a `retryable` flag. `RealPlatform` throws on construction, naming the terms-of-service and GDPR reasons; its doc comments record what a real integration would need (auth refresh, rate limiting, pagination quirks, backoff and circuit breaking, shadow bans, irreversible swipes).

### The funnel (`src/agent`)

1. **Broad pass.** Fetches every page, dedupes, skips candidates already tracked, and sets aside accounts inactive past a threshold (they cannot reply).
2. **Rule filter.** Hard constraints on self-declared fields only. A rule receives a `DeclaredProfile`, a type that has no photos and no activity, so a rule cannot read an image. A test also asserts the rules source never mentions photos. Every evaluation, pass or fail, writes `{candidateId, rule, outcome, reason, timestamp}` to the audit log. All rules run (no short-circuit) so "why" is complete.
3. **Rank.** Behind the `Scorer` interface. The baseline is a transparent weighted sum of stated preferences (interest overlap, intent, language, recent activity, age fit). The weights are hand-chosen constants, not learned, and no claim is made that they predict anything. A learned model plugs in at the same seam; the scorer receives the whole `Candidate` so later scorers can use more than declared fields for ranking, while only stage 2 may reject, and only on declared fields.
4. **Human gate.** The top `gateSize` candidates wait for `POST /gate/:id/accept` or `/reject`. Those are the only calls that `like` or `pass` on the platform.

Stages 1 to 3 never touch the platform: a drop is a local decision, which is why every drop is reversible.

### Reversibility

```
GET  /rejections?stage=rules        everything currently rejected
GET  /candidates/:id/why            rule, reason, other failing rules, full audit history
POST /candidates/:id/overturn       puts the candidate back at the gate (optional {"note": "..."})
GET  /audit?candidateId=&rule=&outcome=&stage=
```

Overturning works for stage 1, 2 and 3 drops and for human rejections (the platform pass is rewound). It is recorded as its own audit entry; the original failure stays in the log. An accepted candidate cannot be overturned, because a like cannot be taken back, and the API says so (`409 irreversible`).

### No autonomous send

A draft is a different type from a sent message. The chain is `Draft` (local text) to `ApprovedDraft` (a branded type) to a message on the platform, and one function makes the second step: `Outbox.approveAndSend`.

- **Types.** `PlatformAdapter.deliver` accepts only `ApprovedDraft`. That type carries a unique-symbol brand that is not exported, so no other module can build one. There is deliberately no `sendMessage(text)` on the adapter.
- **Runtime.** `ApprovedDraft` objects are minted inside `outbox.ts` and registered in a module-private `WeakSet`. The adapter checks `isApprovedDraft` before sending, so a forged or cloned object is refused even if someone casts past the type checker.
- **Single door.** `approveAndSend` is called from one place, `POST /drafts/:id/approve`. It requires `{seenBody}`, the exact text the person read; if it differs from the draft, the request is refused. A draft can be approved once.
- **Tests.** `test/no-autonomous-send.test.ts` runs the funnel, gate and drafting while spying on every request and asserts zero `POST .../messages`. It asserts the adapter rejects a Draft, a hand-built object and a clone of a real approval. It scans the source so that a second call site for `deliver` or `approveAndSend`, or any network call from the agent modules, fails the suite. Adding such a call to `funnel.ts` makes it fail; that was checked by trying it.

What this does not prove: that the caller of the approve route is a human. It proves no code path in this repository sends without that route being called. The route is the boundary, and a later phase should put authentication and a real review UI in front of it.

## Layout

```
src/platform   synthetic platform: seed, store, HTTP app, placeholder photos
src/adapter    PlatformAdapter, MockPlatform, RealPlatform (stub)
src/agent      preferences, rules, scoring seam, funnel, gate, reversal, audit, HTTP app
src/outbox     Draft and the approval gate
test           node:test suites (platform, adapter, rules, funnel, reversal, no-autonomous-send)
scripts/demo.ts
```

Stack: TypeScript run directly by Node's built-in type stripping, Hono, `node:test`. Runtime dependencies are `hono` and `@hono/node-server` only.

## What is not here

- **Learned ranking** (phase 4): a model trained on the user's own labels, a comparison against the stated-preference baseline on held-out labels, and calibration. The seam exists; the model does not, and there are no labels yet.
- **Vision and signal scoring** (phase 3): generated portraits behind `photoRef`, and scoring that uses them.
- **Voice-trained drafting.** The current drafter is a fixed template (`template-v0`) that proves the draft and approve path.
- **Scheduling and the weekly brief.**
- **Persistence.** Audit log and candidate state are in memory and reset on restart.
- **Editable preferences over the API.** Preferences are read-only (`GET /preferences`); change `defaultPreferences()` to experiment.
- **Authentication and a review UI** for the agent API. It binds to localhost only.
- **Platform realism.** Matches are decided by a hidden seeded flag, candidates never reply, and there is no rate limiting.
