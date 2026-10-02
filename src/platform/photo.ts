import { hashString, mulberry32 } from './rng.ts';

/**
 * Photo contract
 * --------------
 * A profile's photo slots carry a `photoRef`: `<scheme>:<version>:<profileId>:<slot>`.
 * The platform serves the image at `GET /photos/{photoRef}`. Callers treat the ref as opaque.
 *
 * Two schemes:
 *   `ph`  placeholder: a seeded abstract SVG, deterministic per ref, with initials on slot 0.
 *   `gp`  generated portrait: a JPEG from the portrait library (src/vision), chosen
 *         deterministically for the profile. Used for slot 0. Independent generations cannot
 *         depict the same person twice, so other slots stay placeholder art.
 * Callers treat the ref as opaque.
 */

export interface ParsedPhotoRef {
  scheme: string;
  version: string;
  profileId: string;
  slot: number;
}

export function makePhotoRef(profileId: string, slot: number): string {
  return `${slot === 0 ? 'gp' : 'ph'}:v1:${profileId}:${slot}`;
}

export function parsePhotoRef(ref: string): ParsedPhotoRef | null {
  const m = /^([a-z]+):(v\d+):([A-Za-z0-9_]+):(\d+)$/.exec(ref);
  if (!m) return null;
  return { scheme: m[1]!, version: m[2]!, profileId: m[3]!, slot: Number(m[4]) };
}

export function initialsOf(displayName: string): string {
  return displayName
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

export function renderPlaceholderSvg(ref: string, initials: string): string {
  const rng = mulberry32(hashString(ref));
  const hue = Math.floor(rng() * 360);
  const hue2 = (hue + 40 + Math.floor(rng() * 80)) % 360;
  const shapes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const cx = Math.floor(rng() * 400);
    const cy = Math.floor(rng() * 500);
    const r = 40 + Math.floor(rng() * 120);
    const h = (hue + Math.floor(rng() * 120)) % 360;
    shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="hsl(${h} 60% 70%)" opacity="0.35"/>`);
  }
  const parsed = parsePhotoRef(ref);
  const label =
    parsed && parsed.slot === 0
      ? `<text x="200" y="285" text-anchor="middle" font-family="system-ui,sans-serif" font-size="120" font-weight="600" fill="#fff" fill-opacity="0.9">${initials}</text>`
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" role="img" aria-label="Placeholder art">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue} 55% 45%)"/><stop offset="1" stop-color="hsl(${hue2} 60% 30%)"/>` +
    `</linearGradient></defs><rect width="400" height="500" fill="url(#g)"/>${shapes.join('')}${label}</svg>`
  );
}

type Renderer = (ref: ParsedPhotoRef, initials: string, raw: string) => string;

const renderers: Record<string, Renderer> = {
  ph: (_p, initials, raw) => renderPlaceholderSvg(raw, initials),
};

export function renderPhoto(ref: string, initials: string): string | null {
  const parsed = parsePhotoRef(ref);
  if (!parsed) return null;
  const r = renderers[parsed.scheme];
  return r ? r(parsed, initials, ref) : null;
}
