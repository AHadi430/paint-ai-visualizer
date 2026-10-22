// Make the app reachable from anywhere through a free Cloudflare Tunnel.
//
//   npm run tunnel              start everything, point the iPhone app at it
//   npm run tunnel -- --no-ios  don't touch the iPhone project
//
// Starts the backend (if needed) and the fast production build of the
// app, opens a Cloudflare quick tunnel to it and prints its https
// address. The iPhone app is pointed at that address, so it works on
// mobile data and other Wi-Fi networks. Keeps this Mac awake while it
// runs; press Ctrl+C to stop.
//
// Quick tunnels get a new random address each time they start, so the
// iPhone app has to be run from Xcode again after each restart.

import { execSync, spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncIos } from './sync-ios.mjs';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = resolve(appDir, '../backend');

const BACKEND = 'http://127.0.0.1:8000';
const APP = 'http://127.0.0.1:4174';

const children = [];

function start(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
}

process.on('SIGINT', () => {
  console.log('\nStopping the tunnel…');
  stopAll();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function isUp(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitFor(url, label, seconds) {
  for (let i = 0; i < seconds; i++) {
    if (await isUp(url)) {
      return;
    }
    await sleep(1000);
  }
  throw new Error(`${label} did not start within ${seconds} seconds.`);
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  stopAll();
  process.exit(1);
}

try {
  execSync('cloudflared --version', { stdio: 'ignore' });
} catch {
  fail('cloudflared is not installed. Install it with:  brew install cloudflared');
}

// 1. Backend (the AI). Reuse it if it's already running.
if (await isUp(`${BACKEND}/health`)) {
  console.log('✔ Backend already running');
} else {
  console.log('… Starting the backend (loading the AI models)');
  const backend = start(resolve(backendDir, '.venv/bin/uvicorn'), [
    'app.main:app',
    '--port',
    '8000',
  ], { cwd: backendDir });
  backend.on('exit', (code) => code && fail(`The backend stopped (exit code ${code}).`));
  await waitFor(`${BACKEND}/health`, 'The backend', 180).catch((error) => fail(error.message));
  console.log('✔ Backend running');
}

// 2. The app: build the fast production version and serve it.
console.log('… Building the app');
execSync('npx vite build', { cwd: appDir, stdio: 'ignore' });

if (await isUp(APP)) {
  console.log('✔ App server already running (serving the new build)');
} else {
  const preview = start('npx', ['vite', 'preview'], { cwd: appDir });
  preview.on('exit', (code) => code && fail(`The app server stopped (exit code ${code}).`));
  await waitFor(APP, 'The app server', 60).catch((error) => fail(error.message));
  console.log('✔ App server running');
}

// 3. Cloudflare quick tunnel. Cloudflare's service sometimes takes too
//    long to hand out an address, so try a few times.
function openTunnel() {
  const child = start('cloudflared', ['tunnel', '--no-autoupdate', '--url', APP]);

  const url = new Promise((done, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Cloudflare did not give a tunnel address in time.')),
      60_000
    );

    const scan = (chunk) => {
      // The tunnel's own address, not Cloudflare's api.trycloudflare.com.
      const match = String(chunk).match(/https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/);
      if (match) {
        clearTimeout(timer);
        done(match[0]);
      }
    };

    child.stdout.on('data', scan);
    child.stderr.on('data', scan);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`cloudflared stopped (exit code ${code}).`));
    });
  });

  return { child, url };
}

console.log('… Opening the Cloudflare tunnel');

let tunnel;
let publicUrl;

for (let attempt = 1; attempt <= 4 && !publicUrl; attempt++) {
  const opened = openTunnel();

  try {
    publicUrl = await opened.url;
    tunnel = opened.child;
  } catch (error) {
    opened.child.kill('SIGTERM');

    if (attempt === 4) {
      fail(`${error.message} Check your internet connection and try again.`);
    }

    console.log(`  Cloudflare was slow to respond, retrying (${attempt}/3)…`);
    await sleep(3000);
  }
}

// New tunnel addresses take a few seconds to become reachable.
await waitFor(`${publicUrl}/api/visualizer/shades`, 'The tunnel', 90).catch((error) =>
  fail(`${error.message} Try again in a minute.`)
);
console.log(`✔ Tunnel open: ${publicUrl}`);

// 4. Point the iPhone app at the tunnel.
if (!process.argv.includes('--no-ios')) {
  syncIos(publicUrl, { stdio: 'ignore' });
  console.log('✔ iPhone app now points at the tunnel');
}

// 5. Keep the Mac awake while the tunnel runs (ends with this script).
start('caffeinate', ['-dims', '-w', String(process.pid)]);

console.log(`
The app is online at:

    ${publicUrl}

  • iPhone app: in Xcode, choose your iPhone and press Run (▶). It now
    works over mobile data and any Wi-Fi.
  • Any phone: open the address above in Safari or Chrome.

Keep this window open: closing it (or Ctrl+C) takes the app offline.
The Mac stays awake while it runs; keep it plugged in and connected.
The address changes each time you start the tunnel.
`);

// Stay running; exit if the tunnel drops.
tunnel.on('exit', (code) => fail(`The tunnel closed (exit code ${code}). Run npm run tunnel again.`));
