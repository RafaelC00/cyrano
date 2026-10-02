import { useEffect, useRef, useState } from 'react';
import { agent } from '../api/phase1.ts';
import type { Candidate, DraftRecord, Match, ThreadMessage } from '../api/phase1.ts';
import { ENDPOINTS, fromSeam } from '../contracts.ts';
import type { DraftMeta } from '../contracts.ts';
import { fixtureDraftMeta } from '../fixtures.ts';
import { firstName, getCandidate } from '../lib/data.ts';
import { langName, stamp } from '../lib/format.ts';
import { go, href } from '../lib/router.ts';
import { invalidateAll, useResource } from '../lib/resource.ts';
import { Empty, ErrorBox, Icon, Loading, PageHeader, Photo, SourceBadge } from '../ui/kit.tsx';

const MAX = 1000;

interface Row {
  match: Match;
  cand: Candidate | undefined;
  pending: DraftRecord | undefined;
  sent: DraftRecord | undefined;
  thread: ThreadMessage[];
}

async function loadRows(): Promise<Row[]> {
  const [matches, drafts] = await Promise.all([agent.matches(), agent.drafts()]);
  return Promise.all(
    matches.map(async (match) => {
      const [cand, thread] = await Promise.all([getCandidate(match.candidateId).catch(() => undefined), agent.thread(match.id)]);
      const mine = drafts.filter((d) => d.draft.matchId === match.id);
      const latest = (s: DraftRecord['status']) => mine.filter((d) => d.status === s).sort((a, b) => b.draft.createdAt.localeCompare(a.draft.createdAt))[0];
      return { match, cand, pending: latest('pending'), sent: latest('sent'), thread };
    }),
  );
}

/**
 * The approval gate. The ONLY place in this app that calls `agent.approveDraft`, and it is only
 * reachable from the "Send now" button inside `SendGate`, which requires: a saved draft, an
 * explicit "Review and send", a ticked confirmation, and a click. No keyboard shortcut, timer or
 * effect on this screen sends anything, and nothing advances to the next match on its own.
 */
function SendGate({ row, dirty, onSent }: { row: Row; dirty: boolean; onSent: () => void }) {
  const [stage, setStage] = useState<'idle' | 'review'>('idle');
  const [ticked, setTicked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error>();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef<HTMLButtonElement>(null);
  const draft = row.pending?.draft;

  // Anything that changes what would be sent closes the confirmation.
  useEffect(() => {
    setStage('idle');
    setTicked(false);
    setErr(undefined);
  }, [draft?.id, draft?.body, dirty, row.match.id]);

  useEffect(() => {
    if (stage !== 'review') return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setStage('idle');
        setTicked(false);
        openRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage]);

  if (!draft) return null;
  const name = firstName({ displayName: row.cand?.displayName ?? 'them' });

  const sendNow = async () => {
    if (stage !== 'review' || !ticked || dirty || busy) return;
    setBusy(true);
    setErr(undefined);
    try {
      await agent.approveDraft(draft.id, draft.body);
      onSent();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="sendgate" aria-labelledby="sg-title">
      <div className="sendgate__head">
        <Icon name="lock" size={18} />
        <div>
          <h3 id="sg-title" className="serif">
            You send this. Nobody else.
          </h3>
          <p className="dim">
            {dirty
              ? 'You have unsaved changes. Save them first, so what is sent is exactly what you read.'
              : 'Sending is a separate step on purpose. The system can draft, but only you can send.'}
          </p>
        </div>
      </div>

      {stage === 'idle' ? (
        <button ref={openRef} className="btn btn--lg sendgate__open" disabled={dirty} onClick={() => setStage('review')}>
          Review and send…
        </button>
      ) : (
        <div className="confirm" role="group" aria-labelledby="cf-title">
          <p id="cf-title" className="eyebrow">
            Final check · this is exactly what {name} will receive
          </p>
          <blockquote className="confirm__text">{draft.body}</blockquote>
          <dl className="confirm__meta">
            <div>
              <dt>To</dt>
              <dd>
                {row.cand?.displayName ?? row.match.candidateId} <span className="mono faint">{row.match.id}</span>
              </dd>
            </div>
            <div>
              <dt>From</dt>
              <dd>You, as yourself</dd>
            </div>
            <div>
              <dt>After sending</dt>
              <dd>It cannot be recalled.</dd>
            </div>
          </dl>
          <label className="check">
            <input type="checkbox" checked={ticked} onChange={(e) => setTicked(e.target.checked)} />
            <span>I have read this message and I am sending it myself.</span>
          </label>
          {err ? <ErrorBox error={err} /> : null}
          <div className="confirm__actions">
            <button ref={cancelRef} className="btn btn--lg" onClick={() => (setStage('idle'), setTicked(false), openRef.current?.focus())}>
              Cancel
            </button>
            <button className="btn btn--lg btn--send" onClick={sendNow} disabled={!ticked || busy}>
              {busy ? <span className="spin" /> : <Icon name="send" size={17} />} Send now
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function MetaPanel({ draft, cand }: { draft: DraftRecord['draft']; cand: Candidate | undefined }) {
  const meta = useResource(() => fromSeam<DraftMeta>(ENDPOINTS.draftMeta(draft.id), () => fixtureDraftMeta(draft, cand)), [draft.id, draft.body, cand?.id]);
  if (!meta.data) return null;
  const m = meta.data.data;
  return (
    <section className="dmeta" aria-label="How this draft was made">
      <div className="dmeta__row">
        <p className="eyebrow">Language</p>
        <p>
          <span className="chip chip--accent">{langName(m.language)}</span> <span className="dim">{m.languageReason}</span>
        </p>
      </div>
      <div className="dmeta__row">
        <p className="eyebrow">Profile detail used</p>
        <p>{m.detail ? <><span className="chip">{m.detail.field}</span> <span>{m.detail.value}</span></> : <span className="faint">None. The draft does not use anything specific from their profile.</span>}</p>
      </div>
      <div className="dmeta__row">
        <p className="eyebrow">
          Checked against your voice <SourceBadge source={meta.data.source} what="Checked in your browser against the written voice rules until the drafting service supplies its own." />
        </p>
        <ul className="vchecks">
          {m.voiceChecks.map((v) => (
            <li key={v.rule} className={v.ok ? 'ok' : 'miss'}>
              <Icon name={v.ok ? 'check' : 'x'} size={14} /> {v.rule}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Editor({ row }: { row: Row }) {
  const draft = row.pending?.draft;
  const [text, setText] = useState(draft?.body ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Error>();
  const [justSent, setJustSent] = useState(false);

  useEffect(() => setText(draft?.body ?? ''), [draft?.id, draft?.body]);
  useEffect(() => setJustSent(false), [row.match.id]);

  const dirty = !!draft && text !== draft.body;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(undefined);
    try {
      await fn();
      invalidateAll();
    } catch (e) {
      setErr(e as Error);
    } finally {
      setBusy(false);
    }
  };

  const make = () => run(() => agent.createDraft(row.match.id));
  const save = () =>
    run(async () => {
      // There is no edit endpoint: a human edit is a new human-authored draft, and the old one is discarded.
      await agent.createDraft(row.match.id, text);
      if (draft) await agent.discardDraft(draft.id);
    });
  const discard = () => run(() => agent.discardDraft(draft!.id));

  const c = row.cand;
  const sentMsgs = row.thread.filter((m) => m.from === 'viewer');

  return (
    <article className="editor">
      <header className="editor__head">
        <Photo photoRef={c?.photos[0]?.photoRef} name={c?.displayName ?? '?'} className="editor__photo" />
        <div>
          <h2 className="serif">
            {c?.displayName ?? row.match.candidateId}
            {c ? <span className="mono dim"> {c.declared.age}</span> : null}
          </h2>
          <p className="dim">
            {c ? `${c.declared.city} · ` : ''}matched {stamp(row.match.matchedAt)} · <a href={href('why', row.match.candidateId)}>why this person</a>
          </p>
        </div>
      </header>

      {err ? <ErrorBox error={err} /> : null}

      {row.thread.length ? (
        <section className="thread" aria-label="Conversation so far">
          <p className="eyebrow">Conversation</p>
          <ul>
            {row.thread.map((m) => (
              <li key={m.id} className={m.from === 'viewer' ? 'me' : 'them'}>
                <span>{m.body}</span>
                <small className="mono faint">{m.from === 'viewer' ? 'you' : firstName({ displayName: c?.displayName ?? 'them' })} · {stamp(m.sentAt)}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {justSent || (!draft && sentMsgs.length > 0) ? (
        <div className="notice notice--ok" role="status">
          <Icon name="check" />
          <div>
            <b>Sent by you.</b> The message is in the conversation above. Nothing else will be sent on this thread unless you draft and send again.
          </div>
        </div>
      ) : null}

      {!draft ? (
        <section className="nodraft">
          <p className="dim">{sentMsgs.length ? 'Want to send a follow-up? Draft another and review it the same way.' : 'No opener drafted yet.'}</p>
          <button className="btn btn--primary" onClick={make} disabled={busy}>
            {busy ? <span className="spin" /> : null} Draft an opener
          </button>
          <p className="faint">Drafting only writes text inside this system. It does not message them.</p>
        </section>
      ) : (
        <>
          <MetaPanel draft={draft} cand={c} />
          <section className="compose">
            <div className="compose__top">
              <label htmlFor="body" className="label">
                Opener <span className="faint">· written by {draft.author === 'human' ? 'you' : `the drafter (${draft.generator})`}</span>
              </label>
              {dirty ? <span className="chip chip--accent">Unsaved edit</span> : null}
            </div>
            <textarea id="body" className="textarea compose__area" rows={5} maxLength={MAX} value={text} onChange={(e) => setText(e.target.value)} />
            <div className="compose__bar">
              <span className={`mono faint ${text.length > MAX - 80 ? 'warn' : ''}`}>
                {text.length} / {MAX}
              </span>
              <div className="row">
                <button className="btn btn--ghost btn--sm" onClick={discard} disabled={busy}>
                  Discard
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => run(async () => { await agent.discardDraft(draft.id); await agent.createDraft(row.match.id); })}
                  disabled={busy}
                >
                  Redraft
                </button>
                <button className="btn btn--sm" onClick={save} disabled={!dirty || busy || !text.trim()}>
                  Save my edit
                </button>
              </div>
            </div>
          </section>
          <SendGate row={row} dirty={dirty} onSent={() => (setJustSent(true), invalidateAll())} />
        </>
      )}
    </article>
  );
}

export default function Drafts({ param }: { param?: string }) {
  const rows = useResource(loadRows);
  const [busy, setBusy] = useState(false);
  const list = rows.data ?? [];
  const sel = list.find((r) => r.match.id === param) ?? list[0];
  const waiting = list.filter((r) => !r.pending && !r.sent).length;

  const status = (r: Row) => (r.pending ? { cls: 'chip--accent', t: 'Draft ready' } : r.sent ? { cls: 'chip--ok', t: 'Sent' } : { cls: '', t: 'No draft' });

  const all = async () => {
    setBusy(true);
    try {
      for (const r of list) if (!r.pending && !r.sent) await agent.createDraft(r.match.id);
      invalidateAll();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Stage 5 · The approval gate"
        title={
          <>
            Written for you. <em>Sent by you.</em>
          </>
        }
        lede="The system drafts an opener from their profile. You read it, change what you like, and send it yourself. There is no other way a message leaves, and nothing here moves on without you."
        right={
          waiting > 0 ? (
            <button className="btn" onClick={all} disabled={busy}>
              {busy ? <span className="spin" /> : null} Draft {waiting} {waiting === 1 ? 'opener' : 'openers'}
            </button>
          ) : undefined
        }
      />

      {rows.error && !rows.data ? <ErrorBox error={rows.error} retry={rows.reload} /> : null}
      {rows.loading && !rows.data ? <Loading label="Loading matches" /> : null}

      {rows.data && list.length === 0 ? (
        <Empty title="No matches to write to." action={<a className="btn btn--primary" href={href('swipe')}>Go to the gate</a>}>
          An opener can be drafted once someone you accepted has liked you back.
        </Empty>
      ) : null}

      {sel ? (
        <div className="drafts">
          <nav className="dlist" aria-label="Matches">
            <p className="eyebrow">Matches · {list.length}</p>
            <ul>
              {list.map((r) => {
                const s = status(r);
                return (
                  <li key={r.match.id}>
                    <a href={href('drafts', r.match.id)} aria-current={r.match.id === sel.match.id ? 'true' : undefined} onClick={(e) => (e.preventDefault(), go('drafts', r.match.id))}>
                      <Photo photoRef={r.cand?.photos[0]?.photoRef} name={r.cand?.displayName ?? '?'} className="dlist__photo" />
                      <span className="dlist__name">
                        {r.cand?.displayName ?? r.match.candidateId}
                        <small className="faint">{r.cand?.declared.city}</small>
                      </span>
                      <span className={`chip ${s.cls}`}>{s.t}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <Editor row={sel} key={sel.match.id} />
        </div>
      ) : null}
    </>
  );
}
