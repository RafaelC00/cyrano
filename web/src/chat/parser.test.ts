import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalise, parse } from './parser.ts';
import type { Intent, ParseContext } from './parser.ts';

const ctx: ParseContext = {
  today: '2026-10-02', // a Friday
  people: [
    { id: 'p_0149', name: 'Kaebiagas Fenstone' },
    { id: 'p_0212', name: 'Marta Illesca' },
    { id: 'p_0213', name: 'Marta Voss' },
    { id: 'p_0301', name: 'Ines Kallergis' },
  ],
  lastPersonId: 'p_0301',
};

const kind = (t: string, c = ctx) => parse(t, c).intent.kind;
const intent = <K extends Intent['kind']>(t: string, c = ctx) => parse(t, c).intent as Extract<Intent, { kind: K }>;

test('normalise strips accents and punctuation and converts number words', () => {
  assert.equal(normalise('Show me the TOP five, please!'), 'show me the top 5 please');
  assert.equal(normalise("Why didn't you drop Inés?"), 'why didnt you drop ines');
});

test('why did you drop her resolves the pronoun from context', () => {
  const i = intent<'why_dropped'>('why did you drop her');
  assert.equal(i.kind, 'why_dropped');
  assert.equal(i.who?.id, 'p_0301');
});

test('why questions find a person by first name, with a typo, and by id', () => {
  assert.equal(intent<'why_dropped'>('why was Kaebiagas dropped').who?.id, 'p_0149');
  assert.equal(intent<'why_dropped'>('what happened to Kallergis').who?.id, 'p_0301');
  assert.equal(intent<'why_dropped'>('why was Fenstoen rejected').who?.id, 'p_0149');
  assert.equal(intent<'why_dropped'>('why was p_0212 dropped').who?.id, 'p_0212');
});

test('an ambiguous first name is reported, not guessed', () => {
  const i = intent<'why_dropped'>('why did you drop Marta');
  assert.equal(i.who, null);
  assert.deepEqual(i.ambiguous?.map((p) => p.id).sort(), ['p_0212', 'p_0213']);
});

test('top n, with digits, words and a default', () => {
  assert.equal(intent<'top'>('show me the top five').n, 5);
  assert.equal(intent<'top'>('top 3').n, 3);
  assert.equal(intent<'top'>('who are the best 8 right now').n, 8);
  assert.equal(intent<'top'>('show me the shortlist').n, 5);
  assert.equal(intent<'top'>('top 500').n, 20);
});

test('move reads what is moved and where it goes', () => {
  const a = intent<'move'>('move Friday');
  assert.equal(a.which?.date, '2026-10-02');
  assert.equal(a.to, null);

  const b = intent<'move'>('move the friday dinner to saturday at 9pm');
  assert.equal(b.which?.date, '2026-10-02');
  assert.equal(b.which?.kind, 'dinner');
  assert.equal(b.to?.date, '2026-10-03');
  assert.equal(b.to?.time, '21:00');

  const c = intent<'move'>('push thursday to next week');
  assert.equal(c.which?.date, '2026-10-08');
  assert.equal(c.to?.shiftWeeks, 1);

  const d = intent<'move'>('reschedule friday to 20:30');
  assert.equal(d.to?.time, '20:30');
  assert.equal(d.to?.date, undefined);
});

test('overturn', () => {
  assert.equal(intent<'overturn'>('bring her back').who?.id, 'p_0301');
  assert.equal(intent<'overturn'>('put Kaebiagas back on the list').who?.id, 'p_0149');
  assert.equal(kind('overturn Ines'), 'overturn');
});

test('funnel and rule questions', () => {
  assert.equal(kind('how many made it'), 'funnel');
  assert.equal(kind('how is the funnel looking'), 'funnel');
  assert.equal(intent<'dropped_by'>('who got dropped by the language rule').rule, 'language.shared');
  assert.equal(intent<'dropped_by'>('who was rejected because of age').rule, 'age.range');
});

test('calendar, where, brief, model', () => {
  assert.equal(kind("what's on this week"), 'calendar');
  assert.equal(kind('where am I next week'), 'where');
  assert.equal(kind('where is Eric'), 'where');
  assert.equal(kind('show me the weekly brief'), 'brief');
  assert.equal(kind('what have you learned about me'), 'model');
});

test('sending is recognised so it can be refused', () => {
  assert.equal(kind('send her a message'), 'send');
  assert.equal(kind('text Marta Voss now'), 'send');
  assert.equal(kind('draft an opener'), 'send');
});

test('help, greeting and nonsense', () => {
  assert.equal(kind('help'), 'help');
  assert.equal(kind('hello there'), 'greeting');
  assert.equal(kind('purple monkey dishwasher'), 'unknown');
  assert.equal(kind(''), 'unknown');
});

test('parsing is deterministic and does no I/O', () => {
  const a = JSON.stringify(parse('why did you drop her', ctx));
  const b = JSON.stringify(parse('why did you drop her', ctx));
  assert.equal(a, b);
});
