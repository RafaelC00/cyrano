import type { Candidate } from '../src/domain/types.ts';
import { createSystem } from '../src/system.ts';
import type { SystemOptions } from '../src/system.ts';

export function makeSys(opts: SystemOptions = {}) {
  return createSystem({ clock: () => new Date('2026-10-02T09:00:00.000Z'), ...opts });
}

export function candidate(overrides: Partial<Candidate['declared']> = {}): Candidate {
  return {
    id: 'p_test',
    displayName: 'Testa Quillfield',
    synthetic: true,
    declared: {
      age: 33,
      gender: 'man',
      interestedIn: ['woman'],
      city: 'Lisbon',
      country: 'PT',
      languages: ['en', 'pt'],
      interests: ['cooking', 'hiking', 'jazz'],
      lookingFor: ['long-term'],
      smoking: 'never',
      children: 'open',
      prompts: [],
      ...overrides,
    },
    photos: [{ slot: 0, photoRef: 'ph:v1:p_test:0' }],
    activity: { lastActiveAt: '2026-09-30T12:00:00.000Z', daysSinceActive: 1, sessionsLast30d: 12 },
  };
}

export async function call<T = unknown>(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const res = await app.request(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}
