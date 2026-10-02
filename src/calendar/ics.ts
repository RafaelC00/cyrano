import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatLocal } from './time.ts';
import type { ConfirmedEvent } from './types.ts';

/** RFC 5545 TEXT escaping: backslash, semicolon, comma and newlines. */
export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets (not characters), continuing with a leading space. */
export function foldLine(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = Buffer.byteLength(ch, 'utf8');
    if (bytes + b > limit) {
      out.push(cur);
      cur = ' ';
      bytes = 1;
      limit = 75;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n');
}

const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export interface IcsOptions {
  /** DTSTAMP. Defaults to the event's confirmation time, so output is deterministic. */
  now?: Date;
}

/**
 * A standard iCalendar (RFC 5545) file for one confirmed date. Times are written in UTC so no
 * VTIMEZONE block is needed and every calendar app interprets them identically. The local time
 * is spelled out in the description for the human reading it.
 *
 * Importing this file needs no account and no API: it is how the date reaches any calendar.
 */
export function buildIcs(event: ConfirmedEvent, opts: IcsOptions = {}): string {
  return buildIcsCalendar([event], opts);
}

/** One calendar file holding every given confirmed date. */
export function buildIcsCalendar(events: readonly ConfirmedEvent[], opts: IcsOptions = {}): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//cyrano//scheduling//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events.flatMap((e) => veventLines(e, opts)), 'END:VCALENDAR'];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

function veventLines(event: ConfirmedEvent, opts: IcsOptions): string[] {
  const { slot } = event;
  const stampIso = (opts.now ?? new Date(event.confirmedAt)).toISOString();
  const localStart = formatLocal(new Date(slot.start), slot.timezone);
  const where = event.place ? `${event.place}, ${slot.city}` : slot.city;
  const description = [
    `${capitalise(slot.kind)} with ${event.label}`,
    `Local time: ${localStart} (${slot.timezone})`,
    slot.confidence === 'tentative' ? "Eric's travel to this city is not booked yet." : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${stamp(stampIso)}`,
    `DTSTART:${stamp(slot.start)}`,
    `DTEND:${stamp(slot.end)}`,
    `SUMMARY:${escapeText(`${capitalise(slot.kind)} with ${event.label}`)}`,
    `LOCATION:${escapeText(where)}`,
    `DESCRIPTION:${escapeText(description)}`,
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`${capitalise(slot.kind)} with ${event.label}`)}`,
    'TRIGGER:-PT2H',
    'END:VALARM',
    'END:VEVENT',
  ];
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Writes `<dir>/<event id>.ics` and returns the path. */
export function writeIcs(event: ConfirmedEvent, dir: string, opts: IcsOptions = {}): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${event.id}.ics`);
  writeFileSync(path, buildIcs(event, opts), 'utf8');
  return path;
}
