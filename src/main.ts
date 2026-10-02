import { serve } from '@hono/node-server';
import { MockPlatform } from './adapter/mock.ts';
import { createAgent } from './system.ts';
import { createPlatform } from './platform/server.ts';

const PLATFORM_PORT = Number(process.env.PLATFORM_PORT ?? 4100);
const AGENT_PORT = Number(process.env.AGENT_PORT ?? 4200);
const HOST = '127.0.0.1'; // local fixture: never bind publicly

const platform = createPlatform();
serve({ fetch: platform.app.fetch, port: PLATFORM_PORT, hostname: HOST });

const adapter = new MockPlatform({ baseUrl: `http://${HOST}:${PLATFORM_PORT}` });
const agent = createAgent(adapter);
serve({ fetch: agent.app.fetch, port: AGENT_PORT, hostname: HOST });

console.log(`platform  http://${HOST}:${PLATFORM_PORT}  (${platform.store.size} synthetic profiles; open / for a gallery)`);
console.log(`agent     http://${HOST}:${AGENT_PORT}  (POST /runs to run the funnel)`);
