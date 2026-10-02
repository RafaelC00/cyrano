import { Hono } from 'hono';
import { handle } from 'hono/vercel';
import { createSystem } from '../src/system.ts';

/**
 * Vercel entry point. One function serves both apps so the agent and the platform it drives share
 * a single in-memory state within an instance (two functions would each seed their own platform
 * and the agent's swipes would never show up in the pool). The path prefixes match the Vite dev
 * proxy, so the web client's API paths are the same locally and deployed.
 *
 * State lives in module scope: it is per instance and resets on a cold start.
 */
const system = createSystem();

const app = new Hono();
app.route('/api/platform', system.platform.app);
app.route('/api/agent', system.app);

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
export const OPTIONS = handle(app);
