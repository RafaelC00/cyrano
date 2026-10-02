import { Hono } from 'hono';
import { handleError, HttpError, readJson } from '../http.ts';
import { parsePhotoRef, renderPhoto } from './photo.ts';
import type { PlatformStore } from './store.ts';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ESCAPES[c]!);

/** HTTP API of the synthetic dating platform. Single viewer, no auth: it is a local fixture. */
export function createPlatformApp(store: PlatformStore): Hono {
  const app = new Hono();
  app.onError(handleError);

  app.get('/health', (c) => c.json({ ok: true, service: 'platform', profiles: store.size }));

  app.get('/candidates', (c) => {
    const limit = c.req.query('limit') === undefined ? 50 : Number(c.req.query('limit'));
    return c.json(store.listCandidates(c.req.query('cursor'), limit));
  });
  app.get('/candidates/:id', (c) => c.json(store.getCandidate(c.req.param('id'))));

  app.post('/swipes', async (c) => {
    const body = await readJson(c);
    const { candidateId, action } = body;
    if (typeof candidateId !== 'string' || (action !== 'like' && action !== 'pass')) {
      throw new HttpError(400, 'bad_request', 'Expected {candidateId: string, action: "like" | "pass"}');
    }
    return c.json(store.swipe(candidateId, action), 201);
  });
  app.delete('/swipes/:candidateId', (c) => {
    store.rewindPass(c.req.param('candidateId'));
    return c.json({ ok: true });
  });

  app.get('/matches', (c) => c.json({ items: store.listMatches() }));
  app.get('/matches/:id/messages', (c) => c.json({ items: store.getThread(c.req.param('id')) }));
  app.post('/matches/:id/messages', async (c) => {
    const body = await readJson(c);
    if (typeof body.body !== 'string') throw new HttpError(400, 'bad_request', 'Expected {body: string}');
    return c.json(store.postMessage(c.req.param('id'), body.body), 201);
  });

  app.get('/photos/:ref', (c) => {
    const parsed = parsePhotoRef(c.req.param('ref'));
    const initials = parsed ? store.initialsFor(parsed.profileId) : null;
    const svg = parsed && initials ? renderPhoto(c.req.param('ref'), initials) : null;
    if (!svg) throw new HttpError(404, 'not_found', 'Unknown photoRef');
    return c.body(svg, 200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=31536000, immutable' });
  });

  // A small gallery so the seeded pool can be looked at in a browser.
  app.get('/', (c) => {
    const page = store.listCandidates(undefined, 48);
    const cards = page.items
      .map(
        (p) =>
          `<figure><img loading="lazy" src="/photos/${encodeURIComponent(p.photos[0]!.photoRef)}" alt="">` +
          `<figcaption><b>${esc(p.displayName)}</b>, ${p.declared.age}<br>${esc(p.declared.city)}</figcaption></figure>`,
      )
      .join('');
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Synthetic platform</title>` +
        `<style>body{font:14px system-ui;margin:16px;background:#faf7f5}h1{font-size:18px}` +
        `main{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}` +
        `figure{margin:0}img{width:100%;border-radius:8px;display:block}figcaption{padding:4px 0}</style>` +
        `<h1>Synthetic platform: first ${page.items.length} of ${store.size} generated profiles</h1><main>${cards}</main>`,
    );
  });

  return app;
}
