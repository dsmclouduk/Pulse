#!/usr/bin/env node
/**
 * Starts the local database, the API server and the Vite client together.
 *
 * Replaces `concurrently`, which on Windows launched the server through
 * `cmd /d /s /c npm run dev --workspace server`. That extra npm hop swallowed the child's output and
 * left the server looking hung: Vite came up, the API never did, and `npm run dev` appeared broken.
 * Spawning the two binaries directly removes the hop, so both start and both log.
 *
 *   node scripts/dev/dev.mjs            database + server + client
 *   node scripts/dev/dev.mjs --no-db    skip the database (already running, or using Azure SQL)
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const skipDatabase = process.argv.includes('--no-db');

const COLOURS = { server: '\u001b[36m', client: '\u001b[35m', dev: '\u001b[33m' };
const RESET = '\u001b[0m';

function log(name, line) {
  process.stdout.write(`${COLOURS[name] ?? ''}[${name}]${RESET} ${line}\n`);
}

/**
 * Resolve the tool's JavaScript entry point and run it under this same node binary. The
 * node_modules/.bin shims are .cmd files on Windows, and node refuses to spawn those without a
 * shell (EINVAL); going through a shell then breaks on the spaces in the repository path. Running
 * the .mjs/.js directly sidesteps both.
 */
function entryPoint(...segments) {
  return path.join(root, 'node_modules', ...segments);
}

function startDatabase() {
  if (skipDatabase) {
    log('dev', 'Skipping the database (--no-db).');
    return;
  }

  log('dev', 'Starting the local SQL Server container…');
  const result = spawnSync('docker', ['compose', 'up', '-d', 'db'], { cwd: root, encoding: 'utf8', shell: false });

  if (result.error || result.status !== 0) {
    // Not fatal: without a database Pulse runs in memory, which is a valid mode.
    const reason = result.error?.message ?? (result.stderr || '').trim().split('\n').at(-1) ?? `exit ${result.status}`;
    log('dev', `Could not start the database (${reason}). Pulse will run in memory: alerts are lost on restart.`);
    return;
  }

  log('dev', 'Database container is up on localhost:14330.');
}

const children = [];
let shuttingDown = false;

function start(name, command, args, cwd) {
  const script = args.find((arg) => arg.endsWith('.mjs') || arg.endsWith('.js'));

  if (script && !existsSync(script)) {
    log('dev', `Cannot find ${script}. Run npm install first.`);
    process.exitCode = 1;
    return;
  }

  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
  children.push(child);

  for (const stream of [child.stdout, child.stderr]) {
    let buffer = '';

    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        log(name, line);
      }
    });
    stream.on('end', () => {
      if (buffer) log(name, buffer);
    });
  }

  child.on('error', (error) => {
    log('dev', `${name} failed to start: ${error.message}`);
    shutdown(1);
  });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    log('dev', `${name} exited (${signal ?? `code ${code}`}); stopping the others.`);
    shutdown(code ?? 1);
  });
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const child of children) {
    if (child.exitCode === null) {
      child.kill();
    }
  }

  process.exitCode = code;
  // Give the children a moment to die before the event loop empties.
  setTimeout(() => process.exit(code), 500).unref();
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('dev', 'Shutting down…');
    shutdown(0);
  });
}

startDatabase();
start('server', process.execPath, [entryPoint('tsx', 'dist', 'cli.mjs'), 'watch', 'src/index.ts'], path.join(root, 'server'));
start('client', process.execPath, [entryPoint('vite', 'bin', 'vite.js')], path.join(root, 'client'));
