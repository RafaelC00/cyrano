// Starts the backend (repo root) and the web dev server together. Windows-safe, no extra deps.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const web = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const root = path.dirname(web);
const run = (cwd, args) => spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

const procs = [run(root, ['run', 'dev']), run(web, ['run', 'dev'])];
const stop = () => procs.forEach((p) => p.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', stop));
