// Point the iPhone app at a server address and sync the Xcode project.
//
// Also writes dist/offline.html (from scripts/offline.html) with that
// address filled in: the app shows it instead of a blank screen when
// it can't reach the server, and reconnects once the server is back.

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function syncIos(serverUrl, { stdio = 'inherit' } = {}) {
  const page = readFileSync(resolve(appDir, 'scripts/offline.html'), 'utf8');
  writeFileSync(
    resolve(appDir, 'dist/offline.html'),
    page.replace('"__SERVER_URL__"', JSON.stringify(serverUrl))
  );

  execSync('npx cap sync ios', {
    cwd: appDir,
    stdio,
    env: { ...process.env, CAP_SERVER_URL: serverUrl },
  });
}
