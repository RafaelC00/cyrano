/**
 * Visual signals: what a PHOTOGRAPH shows.
 *
 * DECISION. This module describes photographs. It does not rate people. There is no
 * attractiveness score, no face rating, and no field here that describes the person's face,
 * body, age, gender, ethnicity or health. Ranking people by facial attractiveness is unreliable
 * (raters disagree with each other, and models inherit the prejudices of the images they were
 * trained on) and indefensible (it is biometric profiling of special-category data, and it turns
 * prejudice into a number that looks objective). The honest alternative is descriptive features
 * of the image: where it was taken, what is visibly happening, solo or group, how it was framed,
 * and a rough technical quality signal. A preference model can legitimately learn from those, a
 * person can read and dispute every one of them, and none of them is a verdict on a human being.
 *
 * Two further rules follow:
 *  - Visual features are used for RANKING only. Hard rejection stays on self-declared fields
 *    (stage 2), and a visual feature is never a filter.
 *  - Nothing here infers a protected characteristic. The extractor that produces these values
 *    (scripts/portraits/extract_features.py) is never asked about the person, and a test checks
 *    that this schema contains no such field.
 */

export type Setting = 'indoor' | 'outdoor' | 'nature' | 'urban';
export type ActivityKind = 'food' | 'craft' | 'culture' | 'sport' | 'outdoors' | 'social' | 'everyday' | 'none';
export type PeopleInFrame = 'solo' | 'group';
export type PhotoType = 'candid' | 'posed' | 'portrait';

/** Raw pixel statistics of the image file. Technical, not aesthetic judgements of anyone. */
export interface PixelStats {
  width: number;
  height: number;
  megapixels: number;
  /** Mean luminance, 0 (black) to 1 (white). */
  brightness: number;
  /** Standard deviation of luminance. */
  contrast: number;
  /** Variance of the Laplacian at a fixed width. Low means soft or blurred. */
  sharpness: number;
  /** Fraction of pixels that are nearly white (blown highlights, flash). */
  clippedHighlights: number;
  /** Fraction of pixels that are nearly black. */
  underexposed: number;
}

export interface VisualFeatures {
  libraryId: string;
  setting: Setting;
  activityKind: ActivityKind;
  people: PeopleInFrame;
  photoType: PhotoType;
  pixels: PixelStats;
}

/**
 * The complete set of field names a visual feature record may contain. A test asserts the
 * extracted data has exactly these and that none of them names a characteristic of a person.
 */
export const VISUAL_FIELDS = ['libraryId', 'setting', 'activityKind', 'people', 'photoType', 'pixels'] as const;
export const PIXEL_FIELDS = ['width', 'height', 'megapixels', 'brightness', 'contrast', 'sharpness', 'clippedHighlights', 'underexposed'] as const;

/** Plain-language reading of the pixel statistics, for explanations a person can check by eye. */
export function describePixels(p: PixelStats): { lighting: 'dim' | 'even' | 'harsh'; focus: 'soft' | 'sharp' } {
  const lighting = p.brightness < 0.36 || p.underexposed > 0.25 ? 'dim' : p.clippedHighlights > 0.05 || p.contrast > 0.3 ? 'harsh' : 'even';
  // Sharpness depends on how much texture the scene has, so this is a rough, library-relative cut
  // (roughly the softest fifth of the portraits), not an absolute measure of focus.
  const focus = p.sharpness < 150 ? 'soft' : 'sharp';
  return { lighting, focus };
}
