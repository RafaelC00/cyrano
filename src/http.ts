import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { CalendarError } from './calendar/types.ts';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function handleError(err: Error, c: Context): Response {
  if (err instanceof HttpError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.status as ContentfulStatusCode);
  }
  if (err instanceof CalendarError) {
    return c.json({ error: { code: err.code, message: err.message } }, err.code === 'not_found' ? 404 : 409);
  }
  console.error(err);
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500);
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  try {
    const v = await c.req.json();
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'bad_json', 'Request body must be a JSON object');
}
