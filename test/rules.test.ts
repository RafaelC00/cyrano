import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AuditLog } from '../src/agent/audit.ts';
import { defaultPreferences } from '../src/agent/preferences.ts';
import { evaluateRules, RULES } from '../src/agent/rules.ts';
import { candidate } from './helpers.ts';

const prefs = defaultPreferences();
const run = (over: Parameters<typeof candidate>[0]) => {
  const audit = new AuditLog(() => new Date('2026-10-02T09:00:00.000Z'));
  // Eric is a man interested in women, so the baseline candidate is a woman interested in men.
  const c = candidate({ gender: 'woman', interestedIn: ['man'], city: 'Lisbon', ...over });
  return { audit, verdict: evaluateRules(c.id, c.declared, prefs, audit, 'run_t') };
};

test('a candidate matching every constraint passes', () => {
  assert.equal(run({}).verdict.passed, true);
});

for (const [rule, over] of [
  ['age.range', { age: 45 }],
  ['orientation.mutual', { gender: 'man' }],
  ['orientation.mutual', { interestedIn: ['woman'] }],
  ['city.allowed', { city: 'Porto' }],
  ['language.shared', { languages: ['pt'] }],
  ['intent.overlap', { lookingFor: ['casual'] }],
  ['smoking.excluded', { smoking: 'regularly' }],
  ['children.excluded', { children: 'want' }],
] as const) {
  test(`${rule} fails on ${JSON.stringify(over)} and says why`, () => {
    const { verdict } = run(over as never);
    assert.equal(verdict.passed, false);
    const f = verdict.failures.find((x) => x.rule === rule);
    assert.ok(f, `expected ${rule} among ${verdict.failures.map((x) => x.rule)}`);
    assert.ok(f.reason.length > 10);
  });
}

test('every evaluation, pass or fail, writes an audit entry with the required shape', () => {
  const { audit } = run({ age: 45, city: 'Porto' });
  const entries = audit.query({ candidateId: 'p_test' });
  assert.equal(entries.length, RULES.length);
  for (const e of entries) {
    assert.deepEqual(Object.keys(e).filter((k) => ['candidateId', 'rule', 'outcome', 'reason', 'timestamp'].includes(k)).sort(),
      ['candidateId', 'outcome', 'reason', 'rule', 'timestamp']);
    assert.equal(e.timestamp, '2026-10-02T09:00:00.000Z');
  }
  assert.deepEqual(entries.filter((e) => e.outcome === 'fail').map((e) => e.rule).sort(), ['age.range', 'city.allowed']);
});

test('all rules are evaluated even after a failure, so "why" is complete', () => {
  const { verdict } = run({ age: 45, city: 'Porto', smoking: 'regularly' });
  assert.deepEqual(verdict.failures.map((f) => f.rule), ['age.range', 'city.allowed', 'smoking.excluded']);
});

test('audit entries are immutable and the log is append-only', () => {
  const { audit } = run({});
  const e = audit.query()[0]!;
  assert.throws(() => {
    (e as { reason: string }).reason = 'tampered';
  });
  assert.equal('delete' in audit, false);
});

test('rules read only declared fields: the rule engine has no way to see a photograph', () => {
  const src = readFileSync(new URL('../src/agent/rules.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /photo/i);
  assert.doesNotMatch(src, /activity/i);
  // And the engine's parameter type is DeclaredProfile, not Candidate.
  assert.match(src, /declared: DeclaredProfile/);
  for (const r of RULES) assert.ok(r.fields.length > 0, `${r.id} must declare which fields it reads`);
});
