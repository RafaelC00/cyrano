import type { Candidate, Match, Page, SwipeAction, SwipeResult, ThreadMessage } from '../domain/types.ts';
import { HttpError } from '../http.ts';
import { initialsOf } from './photo.ts';
import { SEED_EPOCH } from './seed.ts';
import type { SeedProfile } from './seed.ts';

export interface PlatformStoreOptions {
  /** Defaults to the seed epoch so activity signals are deterministic. */
  now?: () => Date;
  /** How many seeded profiles start as existing matches with an inbound message. */
  existingMatches?: number;
}

const MAX_LIMIT = 100;

/** In-memory dating-app backend for a single viewer. State resets on restart. */
export class PlatformStore {
  private profiles = new Map<string, SeedProfile>();
  private order: string[] = [];
  private swipes = new Map<string, SwipeAction>();
  private matches: Match[] = [];
  private threads = new Map<string, ThreadMessage[]>();
  private now: () => Date;
  private seq = 0;

  constructor(seed: SeedProfile[], opts: PlatformStoreOptions = {}) {
    this.now = opts.now ?? (() => new Date(SEED_EPOCH));
    for (const p of seed) {
      this.profiles.set(p.id, p);
      this.order.push(p.id);
    }
    for (const p of seed.slice(0, opts.existingMatches ?? 8)) {
      this.swipes.set(p.id, 'like');
      const match = this.createMatch(p.id);
      const interest = p.declared.interests[0] ?? 'weekends';
      this.append(match.id, 'candidate', `Hi! Your profile made me curious about ${interest}. What got you into it?`);
    }
  }

  get size(): number {
    return this.order.length;
  }

  private toCandidate(p: SeedProfile): Candidate {
    const days = Math.max(0, Math.floor((this.now().getTime() - Date.parse(p.lastActiveAt)) / 86_400_000));
    return {
      id: p.id,
      displayName: p.displayName,
      synthetic: true,
      declared: p.declared,
      photos: p.photoRefs.map((photoRef, slot) => ({ slot, photoRef })),
      activity: { lastActiveAt: p.lastActiveAt, daysSinceActive: days, sessionsLast30d: p.sessionsLast30d },
    };
  }

  /** Unswiped candidates in stable order. Cursor is an opaque offset. */
  listCandidates(cursor: string | undefined, limit: number): Page<Candidate> {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      throw new HttpError(400, 'bad_limit', `limit must be an integer between 1 and ${MAX_LIMIT}`);
    }
    let offset = 0;
    if (cursor !== undefined) {
      const decoded = /^[A-Za-z0-9_-]+$/.test(cursor) ? Buffer.from(cursor, 'base64url').toString('utf8') : '';
      offset = /^\d+$/.test(decoded) ? Number(decoded) : -1;
      if (offset < 0) throw new HttpError(400, 'bad_cursor', 'Invalid cursor');
    }
    const pool = this.order.filter((id) => !this.swipes.has(id));
    const items = pool.slice(offset, offset + limit).map((id) => this.toCandidate(this.profiles.get(id)!));
    const next = offset + limit;
    return { items, nextCursor: next < pool.length ? Buffer.from(String(next)).toString('base64url') : null };
  }

  getCandidate(id: string): Candidate {
    const p = this.profiles.get(id);
    if (!p) throw new HttpError(404, 'not_found', `No profile ${id}`);
    return this.toCandidate(p);
  }

  initialsFor(profileId: string): string | null {
    const p = this.profiles.get(profileId);
    return p ? initialsOf(p.displayName) : null;
  }

  swipe(candidateId: string, action: SwipeAction): SwipeResult {
    const p = this.profiles.get(candidateId);
    if (!p) throw new HttpError(404, 'not_found', `No profile ${candidateId}`);
    if (this.swipes.has(candidateId)) throw new HttpError(409, 'already_swiped', `Already swiped on ${candidateId}`);
    this.swipes.set(candidateId, action);
    if (action === 'like' && p.likesViewer) {
      const m = this.createMatch(candidateId);
      return { candidateId, action, matched: true, matchId: m.id };
    }
    return { candidateId, action, matched: false };
  }

  /** Undo a pass (like a "rewind" feature). Likes cannot be undone. */
  rewindPass(candidateId: string): void {
    const s = this.swipes.get(candidateId);
    if (s === undefined) throw new HttpError(404, 'no_swipe', `No swipe recorded for ${candidateId}`);
    if (s !== 'pass') throw new HttpError(409, 'not_a_pass', 'Only a pass can be rewound');
    this.swipes.delete(candidateId);
  }

  swipeCount(action?: SwipeAction): number {
    if (!action) return this.swipes.size;
    return [...this.swipes.values()].filter((a) => a === action).length;
  }

  listMatches(): Match[] {
    return [...this.matches];
  }

  getThread(matchId: string): ThreadMessage[] {
    this.requireMatch(matchId);
    return [...(this.threads.get(matchId) ?? [])];
  }

  postMessage(matchId: string, body: string): ThreadMessage {
    this.requireMatch(matchId);
    if (typeof body !== 'string' || !body.trim() || body.length > 1000) {
      throw new HttpError(400, 'bad_body', 'Message body must be 1-1000 characters');
    }
    return this.append(matchId, 'viewer', body);
  }

  /** Count of messages the viewer has sent, across all threads. Used by tests and the demo. */
  viewerMessageCount(): number {
    let n = 0;
    for (const t of this.threads.values()) n += t.filter((m) => m.from === 'viewer').length;
    return n;
  }

  private requireMatch(matchId: string): Match {
    const m = this.matches.find((x) => x.id === matchId);
    if (!m) throw new HttpError(404, 'not_found', `No match ${matchId}`);
    return m;
  }

  private createMatch(candidateId: string): Match {
    const m: Match = {
      id: `m_${String(this.matches.length + 1).padStart(4, '0')}`,
      candidateId,
      matchedAt: this.now().toISOString(),
    };
    this.matches.push(m);
    this.threads.set(m.id, []);
    return m;
  }

  private append(matchId: string, from: 'viewer' | 'candidate', body: string): ThreadMessage {
    const msg: ThreadMessage = {
      id: `msg_${String(++this.seq).padStart(5, '0')}`,
      matchId,
      from,
      body,
      sentAt: this.now().toISOString(),
    };
    this.threads.get(matchId)!.push(msg);
    return msg;
  }
}
