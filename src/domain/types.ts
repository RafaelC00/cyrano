/**
 * Shared domain types. Everything here is synthetic data shaped like a dating-app backend.
 */

export type Gender = 'woman' | 'man' | 'nonbinary';
export type Intent = 'long-term' | 'short-term' | 'casual' | 'open' | 'friendship';
export type Smoking = 'never' | 'sometimes' | 'regularly';
export type Children = 'want' | 'dont-want' | 'open' | 'have';

export interface PromptAnswer {
  promptId: string;
  question: string;
  answer: string;
}

/**
 * Everything a person typed into their own profile, and nothing else.
 *
 * The rule engine accepts ONLY this type. Photos and activity live on `Candidate`, outside it,
 * so a hard-constraint rule cannot read a photograph even by accident.
 */
export interface DeclaredProfile {
  age: number;
  gender: Gender;
  interestedIn: Gender[];
  city: string;
  country: string;
  /** ISO 639-1 codes. */
  languages: string[];
  interests: string[];
  lookingFor: Intent[];
  smoking: Smoking;
  children: Children;
  prompts: PromptAnswer[];
}

export interface PhotoSlot {
  slot: number;
  /**
   * Opaque reference to an image. Format: `<scheme>:<version>:<profileId>:<slot>`.
   * Phase 1 uses scheme `ph` (deterministic placeholder SVG). The image is fetched from
   * `GET /photos/{photoRef}` on the platform. Nothing else in the system depends on the scheme,
   * so generated portraits can be introduced later by serving a new scheme from the same route.
   */
  photoRef: string;
}

export interface Activity {
  lastActiveAt: string;
  /** Computed by the platform against its own clock (pinned to the seed epoch by default). */
  daysSinceActive: number;
  sessionsLast30d: number;
}

export interface Candidate {
  id: string;
  /** Deliberately synthetic name combination. */
  displayName: string;
  synthetic: true;
  declared: DeclaredProfile;
  photos: PhotoSlot[];
  activity: Activity;
}

export interface Match {
  id: string;
  candidateId: string;
  matchedAt: string;
}

export interface ThreadMessage {
  id: string;
  matchId: string;
  from: 'viewer' | 'candidate';
  body: string;
  sentAt: string;
}

export type SwipeAction = 'like' | 'pass';

export interface SwipeResult {
  candidateId: string;
  action: SwipeAction;
  matched: boolean;
  matchId?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
