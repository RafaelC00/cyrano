import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Comparisons, TrainingReport } from '../calibration/trainingReport.ts';
import { HttpError } from '../http.ts';

const DIR = fileURLToPath(new URL('../../data/calibration/', import.meta.url));

const cache = new Map<string, unknown>();
function load<T>(file: string): T {
  if (!cache.has(file)) {
    try {
      cache.set(file, JSON.parse(readFileSync(`${DIR}${file}`, 'utf8')));
    } catch {
      throw new HttpError(503, 'not_calibrated', `data/calibration/${file} is missing. Run \`npm run calibrate\` to create it.`);
    }
  }
  return cache.get(file) as T;
}

/** The held-out result of the calibration run, exactly as `npm run calibrate` wrote it. */
export const trainingReport = () => load<TrainingReport>('report.json');

/**
 * A page of Eric's comparison labels with the people in them. `against` keeps only the
 * comparisons where he picked the person who fits his stated profile worse.
 */
export function comparisonsPage(offset: number, n: number, against: boolean) {
  const all = load<Comparisons>('comparisons.json');
  const rows = against ? all.items.filter((x) => x.fitsPitch !== null && x.fitsPitch !== x.chosen) : all.items;
  const items = rows.slice(offset, offset + n);
  const people = Object.fromEntries(items.flatMap((x) => [x.a, x.b]).map((id) => [id, all.people[id]!]));
  return { total: rows.length, of: all.total, offset, items, people };
}
