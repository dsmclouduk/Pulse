#!/usr/bin/env node
// Runs `ngrok http <PORT> --url <APP_SERVICE_URL>` using the values already in .env, so the public
// domain lives in one place. Equivalent to typing the command yourself.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')];
    })
);

// Prefer APP_SERVICE_URL when it points at ngrok (so the same value drives the webhook URL shown in
// Settings); otherwise fall back to NGROK_URL.
const url = [env.APP_SERVICE_URL, env.NGROK_URL].find((value) => value && value.includes('ngrok'));
const port = env.PORT || '3001';

if (!url) {
  console.error('Set APP_SERVICE_URL (or NGROK_URL) in .env to your ngrok static domain, e.g. https://example.ngrok-free.dev');
  process.exit(1);
}

if (env.APP_SERVICE_URL !== url) {
  console.warn(`Note: APP_SERVICE_URL is ${env.APP_SERVICE_URL ?? 'unset'}; set it to ${url} so Settings shows the action-group URL Azure will call.`);
}

console.log(`ngrok http ${port} --url ${url}`);
const child = spawn('ngrok', ['http', port, '--url', url], { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
