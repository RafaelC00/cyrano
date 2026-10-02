import type { DateProposal } from '../contracts.ts';

/** Offsets for the cities the fixtures use, in hours from UTC for October 2026. */
const OFFSET: Record<string, number> = {
  Madrid: 2,
  Barcelona: 2,
  Lisbon: 1,
  Porto: 1,
  Amsterdam: 2,
  Berlin: 2,
  Paris: 2,
  Milan: 2,
  Dublin: 1,
  Singapore: 8,
  Dubai: 4,
};

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Local wall-clock ISO (no zone) in `city` to a UTC basic-format timestamp. */
export function toUtcStamp(localIso: string, city: string): string {
  const d = new Date(`${localIso.slice(0, 19)}Z`);
  d.setUTCHours(d.getUTCHours() - (OFFSET[city] ?? 0));
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** RFC 5545 line folding at 75 characters. */
const fold = (line: string) => {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    out.push(rest.slice(0, 75));
    rest = ` ${rest.slice(75)}`;
  }
  out.push(rest);
  return out.join('\r\n');
};

const TITLE = { coffee: 'Coffee', drink: 'Drinks', dinner: 'Dinner' } as const;

export function buildIcs(events: DateProposal[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cyrano//Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Cyrano dates'];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@cyrano.local`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toUtcStamp(e.start, e.city)}`,
      `DTEND:${toUtcStamp(e.end, e.city)}`,
      `SUMMARY:${esc(`${TITLE[e.kind]} with ${e.person.displayName}`)}`,
      `LOCATION:${esc(`${e.venue}, ${e.city}`)}`,
      `DESCRIPTION:${esc(e.reason)}`,
      `STATUS:${e.status === 'confirmed' ? 'CONFIRMED' : 'TENTATIVE'}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(events: DateProposal[], filename = 'cyrano-dates.ics') {
  const blob = new Blob([buildIcs(events)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
