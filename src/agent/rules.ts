import type { DeclaredProfile } from '../domain/types.ts';
import type { AuditLog } from './audit.ts';
import type { Preferences } from './preferences.ts';

/**
 * Stage 2: hard constraints.
 *
 * Rules receive a `DeclaredProfile`: what the person typed into their own profile. They cannot
 * see photographs or activity, and nothing here infers an attribute from an image. This file must
 * stay free of any reference to photos (a test enforces it).
 */
export interface RuleResult {
  pass: boolean;
  reason: string;
}

export interface Rule {
  id: string;
  description: string;
  /** The self-declared field(s) this rule reads. Documentation, and asserted in tests. */
  fields: ReadonlyArray<keyof DeclaredProfile>;
  evaluate(declared: DeclaredProfile, prefs: Preferences): RuleResult;
}

const shared = <T>(a: readonly T[], b: readonly T[]): T[] => a.filter((x) => b.includes(x));

export const RULES: readonly Rule[] = [
  {
    id: 'age.range',
    description: 'Declared age is inside the accepted range',
    fields: ['age'],
    evaluate: (d, p) => {
      const ok = d.age >= p.ageRange.min && d.age <= p.ageRange.max;
      return {
        pass: ok,
        reason: ok
          ? `age ${d.age} is within ${p.ageRange.min}-${p.ageRange.max}`
          : `declared age ${d.age} is outside ${p.ageRange.min}-${p.ageRange.max}`,
      };
    },
  },
  {
    id: 'orientation.mutual',
    description: 'Each side declares interest in the other\'s gender',
    fields: ['gender', 'interestedIn'],
    evaluate: (d, p) => {
      const theyFit = p.viewer.interestedIn.includes(d.gender);
      const weFit = d.interestedIn.includes(p.viewer.gender);
      if (theyFit && weFit) return { pass: true, reason: 'declared interests are mutual' };
      return {
        pass: false,
        reason: !theyFit
          ? `declared gender "${d.gender}" is not in the viewer's stated interest`
          : `candidate declares interest in [${d.interestedIn.join(', ')}], not "${p.viewer.gender}"`,
      };
    },
  },
  {
    id: 'city.allowed',
    description: 'Declared city is in the accepted list',
    fields: ['city'],
    evaluate: (d, p) => {
      const ok = p.cities.includes(d.city);
      return {
        pass: ok,
        reason: ok ? `${d.city} is accepted` : `declared city ${d.city} is not in [${p.cities.join(', ')}]`,
      };
    },
  },
  {
    id: 'language.shared',
    description: 'At least one declared language in common',
    fields: ['languages'],
    evaluate: (d, p) => {
      if (!p.requireSharedLanguage) return { pass: true, reason: 'shared language not required' };
      const common = shared(d.languages, p.viewer.languages);
      return {
        pass: common.length > 0,
        reason: common.length
          ? `shared language: ${common.join(', ')}`
          : `declared languages [${d.languages.join(', ')}] share none with [${p.viewer.languages.join(', ')}]`,
      };
    },
  },
  {
    id: 'intent.overlap',
    description: 'Declared relationship intent overlaps with the viewer\'s',
    fields: ['lookingFor'],
    evaluate: (d, p) => {
      const common = shared(d.lookingFor, p.viewer.intents);
      return {
        pass: common.length > 0,
        reason: common.length
          ? `both looking for: ${common.join(', ')}`
          : `declared intent [${d.lookingFor.join(', ')}] does not overlap [${p.viewer.intents.join(', ')}]`,
      };
    },
  },
  {
    id: 'smoking.excluded',
    description: 'Declared smoking habit is not excluded',
    fields: ['smoking'],
    evaluate: (d, p) => {
      const bad = p.excludedSmoking.includes(d.smoking);
      return {
        pass: !bad,
        reason: bad ? `declared smoking "${d.smoking}" is excluded` : `declared smoking "${d.smoking}" is acceptable`,
      };
    },
  },
  {
    id: 'children.excluded',
    description: 'Declared stance on children is not excluded',
    fields: ['children'],
    evaluate: (d, p) => {
      const bad = p.excludedChildren.includes(d.children);
      return {
        pass: !bad,
        reason: bad ? `declared stance "${d.children}" on children is excluded` : `declared stance "${d.children}" is acceptable`,
      };
    },
  },
];

export interface RuleVerdict {
  passed: boolean;
  /** Every failing rule, in rule order. The first is reported as the primary reason. */
  failures: Array<{ rule: string; reason: string }>;
}

/**
 * Evaluates every rule (no short-circuit, so "why" is complete) and writes one audit entry per
 * evaluation, pass or fail.
 */
export function evaluateRules(
  candidateId: string,
  declared: DeclaredProfile,
  prefs: Preferences,
  audit: AuditLog,
  runId?: string,
  rules: readonly Rule[] = RULES,
): RuleVerdict {
  const failures: RuleVerdict['failures'] = [];
  for (const rule of rules) {
    const r = rule.evaluate(declared, prefs);
    audit.record({
      candidateId,
      rule: rule.id,
      outcome: r.pass ? 'pass' : 'fail',
      reason: r.reason,
      stage: 'rules',
      runId,
    });
    if (!r.pass) failures.push({ rule: rule.id, reason: r.reason });
  }
  return { passed: failures.length === 0, failures };
}
