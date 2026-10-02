# CYRANO

An agent that does the labour of dating apps (the volume, the filtering, the ranking, the scheduling) and hands a person the part that was never worth automating: who to meet, and what to say to them.

> Cyrano de Bergerac wrote another man's love letters, and the play is a tragedy because of the deception. This project automates the search and refuses to automate the person.

## Read this first

- **The user is fictional.** Eric Vossberg is invented. No real person's preferences, photographs or writing were used anywhere in this repository. His profile, his travel plan, his comparison labels and his writing voice were all written for the project.
- **The platform is fictional and the candidates are generated.** The dating "platform" is a small service in `src/platform` that I wrote, seeded with generated people. Their names are invented syllables, their profiles are random draws, and their portraits are generated images of invented people. No real dating service is contacted at any point.
- **Nothing sends without a human.** A draft and a sent message are different types in the code. The only function that can turn one into the other is `Outbox.approveAndSend`, which is called from exactly one place, the `POST /drafts/:id/approve` route, and which needs the exact text a person read. Tests scan the source so that a second call site, or any network call from the agent modules, fails the suite. **The limit of this guarantee:** it proves that no code path in this repository sends without that route being called. It does not prove that whoever calls the route is a human. The route is the boundary; the API has no authentication and binds to localhost only.
- **Why no real platform.** Mainstream dating apps prohibit automated access in their terms of service, and accounts get terminated for it. Separately, ranking real people's photographs is processing of special-category biometric data under the GDPR, and I have no lawful basis for it. So `RealPlatform` and `RealCalendar` exist only as stubs that throw on construction, with doc comments that record what a real integration would need (OAuth scopes, rate limits, time-zone traps, failure modes) and why this one does not exist.

## What it does

A funnel from a pool of generated people to a week on a calendar, with the reason for every decision kept:

```
  generated pool
      |
  1  broad pass          cheap, wide, no judgement (sets aside dormant accounts)
      |
  2  rule filter         Eric's hard constraints, declared fields only, every verdict audited
      |
  3  rank                a model learned from his comparisons (or the hand-written baseline)
      |
  4  human gate          accept or reject; he can overturn any drop at stages 1 to 3
      |
  5  drafted openers     in his voice, in her language, checked, never sent by the system
      |
  6  scheduling + brief  slots held on his calendar where he will actually be; one page a week
```

- **Rules (`src/agent/rules.ts`).** A rule receives a `DeclaredProfile`, a type with no photographs and no activity, so a rule cannot read an image. Every evaluation, pass or fail, goes to an append-only audit log, and all rules run so "why was she dropped" is complete. Any drop can be undone (`POST /candidates/:id/overturn`); an accepted like cannot, because the platform cannot take it back, and the API says so.
- **Ranking (`src/scoring`).** A pairwise logistic model over 23 named features: declared fields, work-and-roots fields, and descriptive features of the photograph (setting, visible activity, solo or group, photo type, lighting, sharpness). There is no attractiveness measure. It ranks; it never rejects.
- **Drafting (`src/drafting`).** Eric's written voice (short, concrete, one specific detail from her profile, her language if he writes it) is a template engine, not a language model. Every candidate text goes through a prohibited-content check (appearance, claiming to be somewhere his itinerary says he is not, implied commitment, a second message before she replies, greeting, small talk, pet names, length, and that the cited profile detail is real). A text that fails is never offered. `POST /matches/:id/drafts` is the only drafting path. It refuses with the reason when there is nothing to write (she wrote first, or he is not in her city in the next six weeks).
- **Scheduling (`src/schedule`, `src/calendar`).** Slots only on days he is in her city per his itinerary, never while he sleeps (he trades Asian hours), never on a clash. Proposing a slot holds it on his own calendar; confirming records that she agreed; an `.ics` file carries confirmed dates to any calendar app. None of it contacts her.
- **The weekly brief (`src/brief`).** Dates with the evidence for each, what is still his to decide, and the dropped candidates the system is least sure about, with how to bring them back.
- **The web client (`web`).** Ten screens over the agent API: pool, funnel, swipe, shortlist, audit trail, training, drafts, calendar, brief, and a chat box that answers from the same data with a local rule-based parser (no model).

## The funnel, from a real run

`npm run demo` with the default seed (500 generated profiles, 8 of which start as existing matches), Eric's preferences, gate size 10, clock pinned to 2026-10-02:

```
Entered the funnel: 492
  broad  in  492   dropped   38   out  454
  rules  in  454   dropped  447   out    7
  rank   in    7   dropped    0   out    7
  gate   in    7   dropped    0   out    7
```

Dropped by the first rule each person failed: age 283, orientation 98, city 46, intent 13, smoking 5, children 2 (plus 38 dormant accounts at stage 1). Every rule a person fails is counted separately in the full report, since one person can fail several.

Eric's rules are strict: **7 of the 454 who reach stage 2 survive them**, fewer than a gate holds, so on this pool the ranking has nothing to rank. That is why the calibration below uses its own, larger pool, and why `npm run demo:learned` runs the funnel on 4000 profiles (the first 500 are identical to the default pool):

```
  broad  in 3992   dropped  288   out 3704
  rules  in 3704   dropped 3623   out   81
  rank   in   81   dropped   71   out   10
  gate   in   10   dropped    0   out   10
```

On that run the three scorers put different people in front of him: the learned model and the stated-preference baseline share 3 of their 10, the learned model and the literal reading of his pitch share 0. These numbers describe a generated pool and one set of preferences. They say nothing about how any real app behaves.

## What the preference model learned, and how much to believe it

Eric's pitch says he wants someone as mobile and unanchored as he is. His comparison labels were generated from a latent function, written for this purpose, in which he prefers people with roots: a settled city, a practice tied to a place, long friendships, work that cannot be done from an airport lounge. The question the project can honestly answer is whether the method recovers that gap from the labels alone and reports it in a way a person could dispute. "The AI discovered something about Eric" would be theatre; I wrote Eric.

Held-out result from `npm run calibrate`, 30 random splits, each trained on 600 comparisons and tested on 300 comparisons between people the model never saw (`data/calibration/EVAL.md` has the full report; `eval.json` and `report.json` have the numbers):

| scorer | picks the same person as the label | rank correlation with true utility |
|---|---:|---:|
| learned (pairwise logistic) | **0.784** (0.776 to 0.793) | 0.925 |
| `stated-preference-v1` (the repo's baseline) | 0.506 | 0.012 |
| `stated-mobility-v1` (the literal reading of his pitch) | 0.247 | **-0.852** |
| the latent function itself (ceiling) | 0.814 | 1.000 |

The learned model beats the baseline in 30 of 30 splits (mean gain 0.28, 95% interval 0.26 to 0.30). The literal reading of his pitch scores far below a coin flip: ranking by what he says puts the people he picks near the bottom. In the 200 comparisons where one person clearly fitted "mobile and unanchored" better, he picked the better fit 8% of the time (16 of 200). The model recovered the sign of 9 of 9 features the labels really use and reported 1 spurious one.

**This win is partly by construction.** The labels come from a function I wrote, and the model class, a linear utility over named features, matches the shape of that function. A good score shows that the pipeline works and that the gap is recoverable. It does not show that the method works on a real person, whose choices are less tidy than a logistic choice rule. A second test, with a latent function the model cannot represent exactly (saturating curves, a threshold, an interaction), gives 0.791 against 0.499, so the result does not hinge on the shape match alone, but the labels are still synthetic.

What is weaker than the headline:

- **The visual features are the least reliable part of the model.** The portrait library has 60 images and, because they are matched to profiles on declared gender and age, the calibration pool draws on only 21 distinct ones. A visual weight rests on at most that many images, shared across many people. A nature setting and a craft activity never appear among them, so those two features get zero weight. One visual feature (`photo_urban`) came out as a spurious finding.
- **The feature-extraction accuracy is mildly optimistic.** The scene features come from a local vision-language model asked only about the photograph. Agreement with what the image generator was asked to draw, over 60 portraits, is setting 0.800, visible activity 0.767, people 0.983, photo type 0.850. The extraction prompt was revised after a first pass, which scored 0.600, 0.583, 0.983 and 0.667; those lower numbers are kept in `data/portraits/library/extraction-eval.pass1.json`. The generator can also drift from its prompt, so some disagreement is not extractor error.
- **The work-and-roots fields are synthesised.** The platform has no job, tenure or time-in-city fields, so `src/scoring/life.ts` generates them deterministically from each profile's identity, with plausible correlations. They are treated as self-declared fields. The model's central finding is about fields I made up, for a user I made up.
- **The calibration used three cities.** The labels were generated with Eric's cities as Amsterdam, Lisbon and Berlin; his default preferences now also include Madrid, which his itinerary has within six weeks. `calibrationPreferences()` freezes the original so the result stays reproducible. The one feature that reads the city list carries almost no weight.

## Run it

Requires Node 22.18 or newer (TypeScript runs directly; no build step, no native dependencies). Runtime dependencies are `hono` and `@hono/node-server`.

```
npm install
npm run typecheck
npm test                  # 157 tests
npm run dev               # platform on :4100, agent on :4200 (127.0.0.1 only)
npm run demo              # the funnel, a reversal, a match, a checked draft, an approval
npm run demo:week         # drafting in four languages, slots, a confirmed date, the .ics file, the brief
npm run demo:learned      # the funnel with the learned scorer; add -- --compare for all three
npm run calibrate         # regenerates data/calibration (about 20 seconds, deterministic)

cd web && npm install && npm run dev:all    # backend and web client at http://127.0.0.1:5173
```

With the backend running: `curl -X POST localhost:4200/runs` runs the funnel, `curl localhost:4200/gate` shows who is waiting, and `curl localhost:4200/model/report` serves the held-out result. Nothing is metered; there are no accounts or credentials.

The portrait library in `data/portraits/library` is committed. `scripts/portraits` holds the Python used to generate it and to extract features (OpenCV and a local Ollama model). They are only needed to rebuild the library. The raw generation runs in `data/portraits/generations/` are git-ignored.

**On the generation route, since this repository makes an argument about automated access.** The 60 portraits were made by driving an image model's web interface from a browser session rather than through its API. That is automation of somebody's service, and I have not checked it against that service's terms, so I am not going to claim it is clean.

What I will claim is that it is not the same act as the one this project refuses. Automating a dating platform means manufacturing contact with real people, at scale, on a service that prohibits it and enforces the prohibition, and the people on the other side never agreed to any of it. Scripting an image generator means asking a tool for the thing the tool is for, with nobody on the other end. The objection to the first is the people; the objection to the second, if there is one, is a contract between me and a vendor.

I would rather write that distinction down than publish a repository that implies a purity it does not have.

## Layout

```
src/platform     the synthetic platform: seed, store, HTTP app, portrait serving
src/adapter      PlatformAdapter, MockPlatform, RealPlatform (stub that throws)
src/agent        preferences, rules, funnel, gate, reversal, audit, views, HTTP app
src/outbox       Draft, ApprovedDraft and the approval gate
src/scoring      features, the pairwise model, work-and-roots fields
src/vision       portrait library and descriptive photo features
src/calibration  the latent function, held-out evaluation, divergence report
src/drafting     voice templates, the prohibited-content check, the Drafter
src/calendar     itinerary, slots, LocalCalendar, .ics, RealCalendar (stub)
src/schedule     Scheduler and Eric's invented travel plan
src/brief        the weekly brief
web              the React client (see web/README.md)
data/calibration labels, model, held-out results, divergence report
test             node:test suites
```

## Limitations

- **The scheduler keeps its plans in memory.** Holds and confirmed dates persist to the calendar file when one is configured, but the plans (who was offered which slots) do not survive a restart. The server does not configure a calendar file, so a restart resets everything, as it does for the audit log and the gate.
- **Eric's rules are strict enough that only 7 of the default 500 profiles survive them.** Calibration uses its own pool of 10000 generated profiles (439 of which pass his rules, city excluded), separate from the 500 the funnel runs on, so the model never ranks anyone it was trained on.
- **Drafting is a template engine.** The `DraftGenerator` seam would take a model-backed generator, whose output would go through the same check, but none is implemented. The check is a word list plus facts about his itinerary and her profile. It cannot judge tone, which is why a person reads every draft. A draft a person edits by hand is not re-checked.
- **The drafter writes first messages only.** A thread where she wrote first gets a reply written by hand. Follow-up and reschedule drafting exist in `src/drafting` and the demo, but the web client does not request them.
- **The platform is simple.** Whether a like becomes a match is a hidden seeded flag, candidates never reply, and there is no rate limiting.
- **The agent API has no authentication.** It binds to localhost. A real review UI would need it.
- **Preferences are read-only over the API.** Change `ericPreferences()` to experiment.
- **The model is trained once, offline.** It does not learn from anything a visitor does in the web client; the Training screen shows Eric's 600 generated comparisons, not a labelling tool.
