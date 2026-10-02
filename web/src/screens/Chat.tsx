import { useEffect, useRef, useState } from 'react';
import { answer, perform } from '../chat/engine.ts';
import type { Action, Block, Memory } from '../chat/engine.ts';
import { getProvider } from '../chat/provider.ts';
import { go, href } from '../lib/router.ts';
import { Icon, PageHeader, Photo } from '../ui/kit.tsx';

interface Msg {
  id: number;
  from: 'you' | 'system';
  text?: string;
  blocks?: Block[];
  /** Action buttons are one-shot: once used or superseded they are disabled. */
  spent?: boolean;
  meta?: string;
}

// Kept at module level so the conversation survives moving between screens.
let history: Msg[] = [];
let seq = 0;
const memory: Memory = {};

const STARTERS = ['Why did you drop her?', 'Show me the top five', 'Move Friday', 'How many made it?', "What's on this week?"];

function Blocks({ blocks, spent, onAction }: { blocks: Block[]; spent: boolean; onAction: (a: Action) => void }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'p':
            return (
              <p key={i} className={b.tone ? `msg__p msg__p--${b.tone}` : 'msg__p'}>
                {b.text}
              </p>
            );
          case 'people':
            return (
              <ul key={i} className="msg__people">
                {b.rows.map((r) => (
                  <li key={r.id}>
                    <a href={href('why', r.id)}>
                      {r.photoRef !== null ? <Photo photoRef={r.photoRef} name={r.name} className="msg__thumb" /> : null}
                      <span>
                        <b>{r.name}</b>
                        <small className="dim">{r.line}</small>
                      </span>
                      {r.score !== undefined ? <span className="mono faint">{r.score.toFixed(2)}</span> : null}
                    </a>
                  </li>
                ))}
              </ul>
            );
          case 'facts':
            return (
              <dl key={i} className="msg__facts">
                {b.rows.map(([k, v]) => (
                  <div key={k + v}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            );
          case 'actions':
            return (
              <div key={i} className="msg__actions">
                {b.items.map((it) => (
                  <button key={it.label} className={`btn btn--sm ${it.primary ? 'btn--primary' : ''}`} disabled={spent && it.action.kind !== 'go' && it.action.kind !== 'ask'} onClick={() => onAction(it.action)}>
                    {it.label}
                  </button>
                ))}
              </div>
            );
        }
      })}
    </>
  );
}

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>(history);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const provider = getProvider();

  const push = (m: Omit<Msg, 'id'>) => {
    history = [...history, { ...m, id: ++seq }];
    setMsgs(history);
  };
  const spend = (id: number) => {
    history = history.map((m) => (m.id === id ? { ...m, spent: true } : m));
    setMsgs(history);
  };

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [msgs.length, busy]);

  const ask = async (q: string) => {
    const t = q.trim();
    if (!t || busy) return;
    setText('');
    setBusy(true);
    push({ from: 'you', text: t });
    try {
      const a = await answer(t, memory);
      push({ from: 'system', blocks: a.blocks, meta: `${a.intent.replace('_', ' ')} · ${a.parser}` });
    } finally {
      setBusy(false);
    }
  };

  const act = async (msgId: number, a: Action) => {
    if (a.kind === 'go') return go(a.screen, a.param);
    if (a.kind === 'ask') return void ask(a.text);
    spend(msgId);
    setBusy(true);
    try {
      push({ from: 'system', blocks: await perform(a) });
    } catch (e) {
      push({ from: 'system', blocks: [{ t: 'p', tone: 'bad', text: (e as Error).message }] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="chat">
      <PageHeader
        eyebrow="Ask the system"
        title={
          <>
            Ask it <em>anything it knows.</em>
          </>
        }
        lede="Plain questions about the funnel, the audit trail and the calendar, answered from the same data as the other screens."
        right={
          <span className="chat__parser" title="Messages are read by a small rule-based parser in your browser. No model is called and nothing is sent anywhere.">
            <Icon name="lock" size={14} /> {provider.name} · {provider.metered ? 'metered' : 'no model call, free'}
          </span>
        }
      />

      <div className="chat__log" role="log" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 ? (
          <div className="chat__empty">
            <p className="serif">Try one.</p>
            <div className="msg__actions">
              {STARTERS.map((s) => (
                <button key={s} className="btn" onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
            <p className="faint">
              It can look things up and propose changes. It cannot send a message: that is only ever done by you, on the Drafts screen.
            </p>
          </div>
        ) : null}

        {msgs.map((m, idx) => (
          <div key={m.id} className={`msg msg--${m.from}`}>
            {m.from === 'you' ? (
              <p className="msg__bubble">{m.text}</p>
            ) : (
              <div className="msg__sys">
                <Blocks blocks={m.blocks ?? []} spent={!!m.spent || idx < msgs.length - 1} onAction={(a) => act(m.id, a)} />
                {m.meta ? <p className="msg__meta mono faint">{m.meta}</p> : null}
              </div>
            )}
          </div>
        ))}
        {busy ? (
          <div className="msg msg--system" aria-hidden="true">
            <div className="msg__sys">
              <span className="spin" />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(text);
        }}
      >
        <label htmlFor="chat-in" className="sr-only">
          Ask a question
        </label>
        <input id="chat-in" className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Why did you drop her? Show me the top five. Move Friday." autoComplete="off" enterKeyHint="send" />
        <button className="btn btn--primary" type="submit" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
